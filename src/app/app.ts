import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subscription, switchMap, takeWhile, timer } from 'rxjs';
import { COMPANY, POLICIES, PolicyId } from './legal';

const CONSENT_KEY = 'avl-cookie-consent';

type Platform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';

interface VideoInfo {
  platform: Platform;
  title: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
  heights: number[];
  webpage_url: string;
}

interface Job {
  id: string;
  status: 'queued' | 'downloading' | 'processing' | 'done' | 'error';
  progress: number | null;
  part: number;
  kind: 'video' | 'audio';
  speed?: number;
  eta?: number;
  downloaded?: number;
  total?: number;
  filename?: string;
  size?: number;
  error?: string;
}

const API = '/api';

const PLATFORM_PATTERNS: [Platform, RegExp][] = [
  ['youtube', /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i],
  ['facebook', /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i],
  ['instagram', /(^|\.)(instagram\.com|instagr\.am)$/i],
  ['tiktok', /(^|\.)tiktok\.com$/i],
];

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  template: `
    <main class="shell">
      <header class="brand">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        </div>
        <h1>AllvidLink</h1>
        <p class="tagline">Paste a link. Get the video or audio. That's it.</p>
        <ul class="platforms">
          @for (p of platforms; track p.id) {
            <li [class.active]="detected() === p.id" [attr.data-p]="p.id">{{ p.label }}</li>
          }
        </ul>
      </header>

      <form class="search" (ngSubmit)="fetchInfo()">
        <input
          type="url"
          name="url"
          [ngModel]="url()"
          (ngModelChange)="url.set($event)"
          placeholder="https://www.youtube.com/watch?v=…"
          autocomplete="off"
          spellcheck="false"
          aria-label="Video URL"
        />
        @if (url()) {
          <button type="button" class="ghost" (click)="reset()" aria-label="Clear">✕</button>
        } @else {
          <button type="button" class="ghost" (click)="paste()">Paste</button>
        }
        <button type="submit" class="primary" [disabled]="!url() || loadingInfo()">
          @if (loadingInfo()) { <span class="spinner"></span> } @else { Convert }
        </button>
      </form>

      @if (error()) {
        <div class="alert" role="alert">{{ error() }}</div>
      }

      @if (info(); as v) {
        <section class="card">
          <div class="thumb">
            @if (v.thumbnail) {
              <img [src]="v.thumbnail" alt="" referrerpolicy="no-referrer" />
            }
            @if (v.duration) {
              <span class="duration">{{ formatDuration(v.duration) }}</span>
            }
            <span class="badge" [attr.data-p]="v.platform">{{ v.platform }}</span>
          </div>

          <div class="details">
            <h2 [title]="v.title">{{ v.title }}</h2>
            @if (v.uploader) { <p class="muted">{{ v.uploader }}</p> }

            <div class="tabs" role="tablist">
              <button type="button" role="tab" [class.on]="kind() === 'video'"
                      (click)="kind.set('video')" [disabled]="busy()">🎬 Video (MP4)</button>
              <button type="button" role="tab" [class.on]="kind() === 'audio'"
                      (click)="kind.set('audio')" [disabled]="busy()">🎵 Audio</button>
            </div>

            <div class="options">
              @if (kind() === 'video') {
                <label>
                  Quality
                  <select [ngModel]="quality()" (ngModelChange)="quality.set($event)" [disabled]="busy()">
                    <option [ngValue]="null">Best available</option>
                    @for (h of qualityOptions(); track h) {
                      <option [ngValue]="h">{{ h }}p</option>
                    }
                  </select>
                </label>
              } @else {
                <label>
                  Format
                  <select [ngModel]="audioFormat()" (ngModelChange)="audioFormat.set($event)" [disabled]="busy()">
                    <option value="mp3">MP3 · 192 kbps</option>
                    <option value="m4a">M4A · AAC</option>
                  </select>
                </label>
              }

              <button type="button" class="primary wide" (click)="startDownload()" [disabled]="busy()">
                @if (busy()) { <span class="spinner"></span> Working… } @else { ⬇ Download }
              </button>
            </div>

            @if (job(); as j) {
              <div class="progress-wrap">
                <div class="progress" [class.indeterminate]="j.progress == null || j.status !== 'downloading'"
                     [class.done]="j.status === 'done'" [class.failed]="j.status === 'error'">
                  <div class="bar" [style.width.%]="j.status === 'done' ? 100 : (j.progress ?? 0)"></div>
                </div>
                <p class="status">{{ statusText() }}</p>
                @if (j.status === 'done') {
                  <a class="save" [href]="fileUrl(j.id)" download>💾 Save {{ j.filename }}</a>
                }
              </div>
            }
          </div>
        </section>
      }

      <p class="fineprint">
        Only download content you own or have permission to use. Respect each platform's terms.
      </p>
    </main>

    <footer class="site-footer">
      <div class="footer-grid">
        <div class="footer-brand">
          <div class="footer-logo">
            <span class="logo small" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
            <strong>AllvidLink</strong>
          </div>
          <p class="footer-tagline">{{ company.tagline }}</p>
          <p class="muted-sm">Fast, free video &amp; audio conversion for the platforms you use every day.</p>
        </div>

        <nav aria-label="Supported platforms">
          <h3>Platforms</h3>
          <ul>
            @for (p of platforms; track p.id) { <li>{{ p.label }}</li> }
          </ul>
        </nav>

        <nav aria-label="Legal">
          <h3>Legal</h3>
          <ul>
            @for (p of policies; track p.id) {
              <li><button type="button" class="link" (click)="openPolicy(p.id)">{{ p.title }}</button></li>
            }
            <li><button type="button" class="link" (click)="cookieNotice.set(true)">Cookie settings</button></li>
          </ul>
        </nav>

        <div>
          <h3>Company</h3>
          <ul class="plain">
            <li>{{ company.name }}</li>
            <li>Reg No: {{ company.reg }}</li>
            @if (company.address) { <li>{{ company.address }}</li> }
            @if (company.email) { <li><a [href]="'mailto:' + company.email">{{ company.email }}</a></li> }
          </ul>
        </div>
      </div>

      <div class="footer-bottom">
        <span>© {{ company.year }} {{ company.name }}. Reg No: {{ company.reg }}. All rights reserved.</span>
        <span class="footer-tagline">{{ company.tagline }}</span>
      </div>
    </footer>

    @if (activePolicy(); as pol) {
      <div class="modal-backdrop" (click)="closePolicy()">
        <article class="modal" role="dialog" aria-modal="true" [attr.aria-labelledby]="'pol-' + pol.id"
                 (click)="$event.stopPropagation()">
          <header class="modal-head">
            <div>
              <h2 [id]="'pol-' + pol.id">{{ pol.title }}</h2>
              <p class="muted-sm">Last updated: {{ pol.updated }}</p>
            </div>
            <button type="button" class="ghost close" (click)="closePolicy()" aria-label="Close">✕</button>
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
              <p>Questions? Email <a [href]="'mailto:' + company.email">{{ company.email }}</a>.</p>
            }
          </div>
          <nav class="modal-tabs" aria-label="Other policies">
            @for (p of policies; track p.id) {
              <button type="button" [class.on]="p.id === pol.id" (click)="openPolicy(p.id)">{{ p.title }}</button>
            }
          </nav>
        </article>
      </div>
    }

    @if (cookieNotice()) {
      <aside class="cookie-bar" role="region" aria-label="Cookie notice">
        <p>
          🍪 We use only essential browser storage to make AllvidLink work. There are no advertising or tracking cookies.
          <button type="button" class="link" (click)="openPolicy('cookies')">Cookie Policy</button> ·
          <button type="button" class="link" (click)="openPolicy('privacy')">Privacy Policy</button>
        </p>
        <button type="button" class="primary" (click)="acceptCookies()">Got it</button>
      </aside>
    }
  `,
})
export class App {
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);
  private poll?: Subscription;

  readonly platforms = [
    { id: 'youtube', label: 'YouTube' },
    { id: 'facebook', label: 'Facebook' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'tiktok', label: 'TikTok' },
  ] as const;

  readonly url = signal('');
  readonly info = signal<VideoInfo | null>(null);
  readonly error = signal<string | null>(null);
  readonly loadingInfo = signal(false);
  readonly kind = signal<'video' | 'audio'>('video');
  readonly quality = signal<number | null>(null);
  readonly audioFormat = signal<'mp3' | 'm4a'>('mp3');
  readonly job = signal<Job | null>(null);

  readonly detected = computed<Platform | null>(() => {
    try {
      const host = new URL(this.url().trim()).hostname;
      return PLATFORM_PATTERNS.find(([, re]) => re.test(host))?.[0] ?? null;
    } catch {
      return null;
    }
  });

  readonly qualityOptions = computed(() => {
    const common = [2160, 1440, 1080, 720, 480, 360, 240];
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
        const parts: string[] = [];
        if (j.kind === 'video' && j.part > 0) parts.push('Fetching audio track');
        else parts.push('Downloading');
        if (j.progress != null) parts.push(`${j.progress.toFixed(0)}%`);
        if (j.speed) parts.push(`${this.formatBytes(j.speed)}/s`);
        if (j.eta != null) parts.push(`~${j.eta}s left`);
        return parts.join(' · ');
      }
      case 'processing':
        return j.kind === 'audio' ? 'Converting to audio…' : 'Merging video & audio…';
      case 'done':
        return `Ready · ${this.formatBytes(j.size ?? 0)}`;
      case 'error':
        return j.error ?? 'Something went wrong.';
    }
  });

  readonly company = COMPANY;
  readonly policies = POLICIES;
  readonly activePolicyId = signal<PolicyId | null>(null);
  readonly activePolicy = computed(() => POLICIES.find((p) => p.id === this.activePolicyId()) ?? null);
  readonly cookieNotice = signal(!this.readConsent());

  constructor() {
    this.destroyRef.onDestroy(() => this.poll?.unsubscribe());
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
      localStorage.setItem(CONSENT_KEY, new Date().toISOString());
    } catch {
      /* storage blocked — notice just reappears next visit */
    }
    this.cookieNotice.set(false);
  }

  private readConsent(): boolean {
    try {
      return !!localStorage.getItem(CONSENT_KEY);
    } catch {
      return false;
    }
  }

  async paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        this.url.set(text.trim());
        this.fetchInfo();
      }
    } catch {
      this.error.set('Clipboard access was blocked — paste the link manually.');
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
      this.error.set('Please paste a YouTube, Facebook, Instagram or TikTok link.');
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
    if (!v) return;
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
    this.poll = timer(0, 800)
      .pipe(
        switchMap(() => this.http.get<Job>(`${API}/jobs/${id}`)),
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
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  fileUrl(id: string) {
    return `${API}/jobs/${id}/file`;
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
      if (e.status === 0) return 'Cannot reach the server. Is the Python backend running?';
      return e.error?.detail ?? e.message;
    }
    return String(e);
  }
}
