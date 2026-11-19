import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subscription, switchMap, takeWhile, timer } from 'rxjs';
import { COMPANY, POLICIES, PolicyId } from './legal';

type Platform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';

interface VideoInfo {
  platform: Platform;
  title: string;
  uploader?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
  heights: number[];
  webpage_url: string;
}

interface Job {
  id: string;
  status: 'queued' | 'downloading' | 'processing' | 'done' | 'error';
  progress: number | null;
  part: number;
  kind: 'video' | 'audio';
  speed?: number | null;
  eta?: number | null;
  filename?: string | null;
  size?: number | null;
  error?: string | null;
}

const API = '/api';
const CONSENT_KEY = 'avl-cookie-consent';
const MAX_URL = 2048;

const PLATFORM_PATTERNS: [Platform, RegExp][] = [
  ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/i],
  ['facebook', /(^|\.)(facebook\.com|fb\.watch)$/i],
  ['instagram', /(^|\.)instagram\.com$/i],
  ['tiktok', /(^|\.)tiktok\.com$/i],
];

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  template: `
    <header class="topbar">
      <div class="container topbar-inner">
        <a class="brand" href="/" aria-label="AllvidLink home">
          <span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
          AllvidLink
        </a>
      </div>
    </header>

    <main class="container main">
      <section class="hero">
        <h1>Download video or audio</h1>
        <p class="lead">Paste a YouTube, Facebook, Instagram or TikTok link.</p>
      </section>

      <form class="search" (ngSubmit)="fetchInfo()" novalidate>
        <input
          type="url"
          name="url"
          inputmode="url"
          [maxlength]="maxUrl"
          [ngModel]="url()"
          (ngModelChange)="url.set($event)"
          placeholder="https://"
          autocomplete="off"
          spellcheck="false"
          aria-label="Video link"
        />
        @if (url()) {
          <button type="button" class="icon-btn" (click)="reset()" aria-label="Clear">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        } @else {
          <button type="button" class="text-btn" (click)="paste()">Paste</button>
        }
        <button type="submit" class="btn" [disabled]="!url() || loadingInfo()">
          @if (loadingInfo()) { <span class="spinner" aria-hidden="true"></span> } Continue
        </button>
      </form>

      @if (error()) {
        <p class="alert" role="alert">{{ error() }}</p>
      }

      @if (info(); as v) {
        <section class="result" aria-live="polite">
          <div class="thumb">
            @if (v.thumbnail) {
              <img [src]="v.thumbnail" alt="" referrerpolicy="no-referrer" loading="lazy" />
            }
            @if (v.duration) {
              <span class="duration">{{ formatDuration(v.duration) }}</span>
            }
          </div>

          <div class="details">
            <div>
              <h2 [title]="v.title">{{ v.title }}</h2>
              @if (v.uploader) { <p class="meta">{{ v.uploader }}</p> }
            </div>

            <div class="segmented" role="radiogroup" aria-label="Format">
              <button type="button" role="radio" [attr.aria-checked]="kind() === 'video'"
                      [class.on]="kind() === 'video'" (click)="kind.set('video')" [disabled]="busy()">Video</button>
              <button type="button" role="radio" [attr.aria-checked]="kind() === 'audio'"
                      [class.on]="kind() === 'audio'" (click)="kind.set('audio')" [disabled]="busy()">Audio</button>
            </div>

            <div class="actions">
              @if (kind() === 'video') {
                <select aria-label="Quality" [ngModel]="quality()" (ngModelChange)="quality.set($event)" [disabled]="busy()">
                  <option [ngValue]="null">Best quality</option>
                  @for (h of qualityOptions(); track h) {
                    <option [ngValue]="h">{{ h }}p</option>
                  }
                </select>
              } @else {
                <select aria-label="Audio format" [ngModel]="audioFormat()" (ngModelChange)="audioFormat.set($event)" [disabled]="busy()">
                  <option value="mp3">MP3</option>
                  <option value="m4a">M4A</option>
                </select>
              }
              <button type="button" class="btn grow" (click)="startDownload()" [disabled]="busy()">
                @if (busy()) { <span class="spinner" aria-hidden="true"></span> Preparing } @else { Download }
              </button>
            </div>

            @if (job(); as j) {
              <div class="progress-wrap">
                <div class="progress" [class.indeterminate]="j.progress == null || j.status !== 'downloading'"
                     [class.done]="j.status === 'done'" [class.failed]="j.status === 'error'"
                     role="progressbar" aria-label="Download progress"
                     [attr.aria-valuenow]="j.status === 'downloading' ? j.progress : null">
                  <div class="bar" [style.width.%]="j.status === 'done' ? 100 : (j.progress ?? 0)"></div>
                </div>
                <div class="status-row">
                  <span class="status" [class.err]="j.status === 'error'">{{ statusText() }}</span>
                  @if (j.status === 'done') {
                    <a class="text-btn" [href]="fileUrl(j.id)" download>Save again</a>
                  }
                </div>
              </div>
            }
          </div>
        </section>
      }
    </main>

    <footer class="footer">
      <div class="container footer-inner">
        <nav class="footer-links" aria-label="Legal">
          @for (p of policies; track p.id) {
            <button type="button" (click)="openPolicy(p.id)">{{ p.short }}</button>
          }
          <button type="button" (click)="cookieNotice.set(true)">Cookie settings</button>
          @if (company.email) { <a [href]="'mailto:' + company.email">Contact</a> }
        </nav>
        <p class="copyright">
          © {{ company.year }} {{ company.name }}. Reg No: {{ company.reg }}. All rights reserved.
        </p>
        <p class="tagline">{{ company.tagline }}</p>
      </div>
    </footer>

    @if (activePolicy(); as pol) {
      <div class="backdrop" (click)="closePolicy()">
        <article class="modal" role="dialog" aria-modal="true" [attr.aria-labelledby]="'pol-' + pol.id"
                 (click)="$event.stopPropagation()">
          <header class="modal-head">
            <div>
              <h2 [id]="'pol-' + pol.id">{{ pol.title }}</h2>
              <p class="meta">Last updated {{ pol.updated }}</p>
            </div>
            <button type="button" class="icon-btn" (click)="closePolicy()" aria-label="Close">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>
          <div class="modal-body">
            @for (s of pol.sections; track s.h) {
              <h3>{{ s.h }}</h3>
              @for (para of s.p ?? []; track $index) { <p>{{ para }}</p> }
              @if (s.ul) {
                <ul>@for (li of s.ul; track $index) { <li>{{ li }}</li> }</ul>
              }
            }
            @if (company.email) {
              <h3>Contact</h3>
              <p><a [href]="'mailto:' + company.email">{{ company.email }}</a></p>
            }
          </div>
          <nav class="modal-tabs" aria-label="Policies">
            @for (p of policies; track p.id) {
              <button type="button" [class.on]="p.id === pol.id" (click)="openPolicy(p.id)">{{ p.short }}</button>
            }
          </nav>
        </article>
      </div>
    }

    @if (cookieNotice()) {
      <aside class="cookie" aria-label="Cookie notice">
        <p>
          We use only essential storage. No tracking.
          <button type="button" class="link" (click)="openPolicy('cookies')">Learn more</button>
        </p>
        <button type="button" class="btn small" (click)="acceptCookies()">OK</button>
      </aside>
    }
  `,
})
export class App {
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);
  private poll?: Subscription;

  readonly maxUrl = MAX_URL;
  readonly company = COMPANY;
  readonly policies = POLICIES;

  readonly url = signal('');
  readonly info = signal<VideoInfo | null>(null);
  readonly error = signal<string | null>(null);
  readonly loadingInfo = signal(false);
  readonly kind = signal<'video' | 'audio'>('video');
  readonly quality = signal<number | null>(null);
  readonly audioFormat = signal<'mp3' | 'm4a'>('mp3');
  readonly job = signal<Job | null>(null);
  readonly activePolicyId = signal<PolicyId | null>(null);
  readonly activePolicy = computed(() => POLICIES.find((p) => p.id === this.activePolicyId()) ?? null);
  readonly cookieNotice = signal(!this.readConsent());

  readonly detected = computed<Platform | null>(() => {
    try {
      const u = new URL(this.url().trim());
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      return PLATFORM_PATTERNS.find(([, re]) => re.test(u.hostname))?.[0] ?? null;
    } catch {
      return null;
    }
  });

  readonly qualityOptions = computed(() => {
    const common = [2160, 1440, 1080, 720, 480, 360];
    const hs = this.info()?.heights ?? [];
    const max = hs[0] ?? 0;
    const opts = common.filter((h) => h <= max);
    return opts.length ? opts : hs;
  });

  readonly busy = computed(() => {
    const s = this.job()?.status;
    return s === 'queued' || s === 'downloading' || s === 'processing';
  });

  readonly statusText = computed(() => {
    const j = this.job();
    if (!j) return '';
    switch (j.status) {
      case 'queued':
        return 'Starting…';
      case 'downloading': {
        const label = j.kind === 'video' && j.part > 0 ? 'Downloading audio' : 'Downloading';
        const parts = [label];
        if (j.progress != null) parts.push(`${j.progress.toFixed(0)}%`);
        if (j.eta != null && j.eta > 0) parts.push(`${j.eta}s left`);
        return parts.join(' · ');
      }
      case 'processing':
        return j.kind === 'audio' ? 'Converting…' : 'Finishing…';
      case 'done':
        return `Ready · ${j.filename ?? ''} · ${this.formatBytes(j.size ?? 0)}`;
      case 'error':
        return j.error ?? 'Something went wrong.';
    }
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.poll?.unsubscribe());
  }

  async paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim().slice(0, MAX_URL);
      if (text) {
        this.url.set(text);
        this.fetchInfo();
      }
    } catch {
      this.error.set('Clipboard access was blocked. Paste the link manually.');
    }
  }

  reset() {
    this.poll?.unsubscribe();
    this.url.set('');
    this.info.set(null);
    this.job.set(null);
    this.error.set(null);
  }

  fetchInfo() {
    const url = this.url().trim();
    if (!url) return;
    if (!this.detected()) {
      this.error.set('Paste a valid YouTube, Facebook, Instagram or TikTok link.');
      return;
    }
    this.poll?.unsubscribe();
    this.error.set(null);
    this.info.set(null);
    this.job.set(null);
    this.quality.set(null);
    this.loadingInfo.set(true);

    this.http.post<VideoInfo>(`${API}/info`, { url }).subscribe({
      next: (v) => {
        this.info.set(v);
        this.loadingInfo.set(false);
      },
      error: (e) => {
        this.error.set(this.errMsg(e));
        this.loadingInfo.set(false);
      },
    });
  }

  startDownload() {
    const v = this.info();
    if (!v || this.busy()) return;
    this.error.set(null);
    const body = {
      url: v.webpage_url,
      kind: this.kind(),
      quality: this.kind() === 'video' ? this.quality() : null,
      audio_format: this.audioFormat(),
    };
    this.job.set({ id: '', status: 'queued', progress: 0, part: 0, kind: this.kind() });

    this.http.post<{ id: string }>(`${API}/jobs`, body).subscribe({
      next: ({ id }) => this.watch(id),
      error: (e) => {
        this.job.set(null);
        this.error.set(this.errMsg(e));
      },
    });
  }

  private watch(id: string) {
    this.poll?.unsubscribe();
    this.poll = timer(0, 1000)
      .pipe(
        switchMap(() => this.http.get<Job>(`${API}/jobs/${encodeURIComponent(id)}`)),
        takeWhile((j) => j.status !== 'done' && j.status !== 'error', true),
      )
      .subscribe({
        next: (j) => {
          this.job.set(j);
          if (j.status === 'done') this.triggerSave(j.id);
        },
        error: (e) => {
          this.job.set(null);
          this.error.set(this.errMsg(e));
        },
      });
  }

  private triggerSave(id: string) {
    const a = document.createElement('a');
    a.href = this.fileUrl(id);
    a.download = '';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  fileUrl(id: string) {
    return `${API}/jobs/${encodeURIComponent(id)}/file`;
  }

  openPolicy(id: PolicyId) {
    this.activePolicyId.set(id);
    queueMicrotask(() => document.querySelector('.modal-body')?.scrollTo(0, 0));
  }

  @HostListener('document:keydown.escape')
  closePolicy() {
    this.activePolicyId.set(null);
  }

  acceptCookies() {
    try {
      localStorage.setItem(CONSENT_KEY, '1');
    } catch {
      /* storage blocked: the notice will show again next visit */
    }
    this.cookieNotice.set(false);
  }

  private readConsent(): boolean {
    try {
      return localStorage.getItem(CONSENT_KEY) === '1';
    } catch {
      return false;
    }
  }

  formatDuration(s: number) {
    s = Math.round(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  formatBytes(b: number) {
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) {
      b /= 1024;
      i++;
    }
    return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  private errMsg(e: unknown) {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 0) return 'Can\'t reach the server. Check your connection and try again.';
      const d = e.error?.detail;
      if (typeof d === 'string') return d;
      if (e.status === 422) return 'Please check the link and try again.';
      return 'Something went wrong. Please try again.';
    }
    return 'Something went wrong. Please try again.';
  }
}
