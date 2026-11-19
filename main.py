"""AllvidLink backend — turns Facebook / YouTube / Instagram / TikTok links
into downloadable video (MP4) or audio (MP3/M4A) files using yt-dlp."""

from __future__ import annotations

import logging
import os
import re
import shutil
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import defaultdict, deque
from pathlib import Path
from typing import Literal
from urllib.parse import urljoin, urlparse

import imageio_ffmpeg
import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

log = logging.getLogger("allvidlink")
logging.basicConfig(level=logging.INFO)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# ---------- configuration (override with environment variables) ----------

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
COOKIES_FILE = os.environ.get("COOKIES_FILE")  # optional, helps with IG/FB/YT login walls
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip()]
# Behind Render / a reverse proxy, the real client IP is in X-Forwarded-For.
TRUST_PROXY = os.environ.get("TRUST_PROXY", "1" if os.environ.get("RENDER") else "0") == "1"

JOB_TTL_SECONDS = _env_int("JOB_TTL_MINUTES", 30) * 60
MAX_DURATION_SECONDS = _env_int("MAX_DURATION_MINUTES", 120) * 60
MAX_FILESIZE_BYTES = _env_int("MAX_FILESIZE_MB", 800) * 1024 * 1024
MAX_ACTIVE_JOBS = _env_int("MAX_ACTIVE_JOBS", 3)           # whole server
MAX_ACTIVE_JOBS_PER_IP = _env_int("MAX_ACTIVE_JOBS_PER_IP", 1)
RATE_INFO = (_env_int("RATE_INFO_PER_MIN", 20), 60)          # requests, window seconds
RATE_JOBS = (_env_int("RATE_JOBS_PER_10MIN", 10), 600)

WORK_ROOT = Path(tempfile.gettempdir()) / "allvidlink"
shutil.rmtree(WORK_ROOT, ignore_errors=True)  # clear leftovers from a previous run
WORK_ROOT.mkdir(exist_ok=True)

PLATFORMS = {
    "youtube": ("youtube.com", "youtu.be"),
    "facebook": ("facebook.com", "fb.watch"),
    "instagram": ("instagram.com",),
    "tiktok": ("tiktok.com",),
}

# Only these yt-dlp extractors may run. This blocks the "generic" extractor,
# so the server can never be pointed at arbitrary pages (SSRF), playlists,
# channels or search pages.
ALLOWED_EXTRACTORS = [
    "youtube", "youtube:clip",
    "facebook", "facebook:reel",
    "instagram", "instagram:story",
    "tiktok", "vm.tiktok",
]

ANSI = re.compile(r"\x1b\[[0-9;]*m")
JOB_ID = re.compile(r"^[0-9a-f]{32}$")
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)

app = FastAPI(title="AllvidLink", docs_url=None, redoc_url=None, openapi_url=None)
if ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


# ---------- security headers ----------

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    https = _is_https(request)
    response.headers.setdefault(
        "Content-Security-Policy", CSP + ("; upgrade-insecure-requests" if https else "")
    )
    if https:
        response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# ---------- rate limiting ----------

_hits: dict[tuple[str, str], deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def _is_https(request: Request) -> bool:
    if TRUST_PROXY and request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https":
        return True
    return request.url.scheme == "https"


def client_ip(request: Request) -> str:
    if TRUST_PROXY:
        # Render sits behind Cloudflare, which overwrites CF-Connecting-IP with the
        # real client address. A client can't spoof it, unlike the first hop of
        # X-Forwarded-For.
        cf = request.headers.get("cf-connecting-ip")
        if cf:
            return cf.strip()[:64]
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[-1].strip()[:64]
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request, bucket: str, limit: tuple[int, int]) -> str:
    ip = client_ip(request)
    max_hits, window = limit
    now = time.monotonic()
    with _hits_lock:
        q = _hits[(bucket, ip)]
        while q and q[0] <= now - window:
            q.popleft()
        if len(q) >= max_hits:
            retry = int(window - (now - q[0])) + 1
            raise HTTPException(429, f"Too many requests. Try again in {retry} seconds.",
                                headers={"Retry-After": str(retry)})
        q.append(now)
    return ip


# ---------- helpers ----------

@app.get("/api/health")
def health():
    return {"ok": True}


def _host_platform(host: str) -> str | None:
    host = host.lower().rstrip(".")
    for name, domains in PLATFORMS.items():
        if any(host == d or host.endswith("." + d) for d in domains):
            return name
    return None


def validate_url(url: str) -> tuple[str, str]:
    """Return (normalised_url, platform) or raise 400."""
    bad = HTTPException(400, "Paste a valid YouTube, Facebook, Instagram or TikTok link.")
    url = url.strip()
    try:
        p = urlparse(url)
        port = p.port
    except ValueError:
        raise bad
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        raise bad
    if port not in (None, 80, 443):
        raise bad
    platform = _host_platform(p.hostname)
    if not platform:
        raise bad
    return url, platform


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _extractor_supports(url: str) -> bool:
    from yt_dlp.extractor import gen_extractor_classes
    return any(
        ie.IE_NAME.lower() in ALLOWED_EXTRACTORS and ie.suitable(url)
        for ie in gen_extractor_classes()
    )


def resolve_short_link(url: str) -> str:
    """Short/share links (fb.watch, facebook.com/share/...) redirect to the real
    video page. Follow those redirects ourselves, but only while they stay on
    the supported platforms over HTTPS."""
    if _extractor_supports(url):
        return url
    current = url
    for _ in range(5):
        req = urllib.request.Request(current, method="GET", headers={"User-Agent": BROWSER_UA})
        try:
            with _opener.open(req, timeout=10) as resp:
                status, location = resp.status, resp.headers.get("Location")
        except urllib.error.HTTPError as e:
            status, location = e.code, e.headers.get("Location")
        except (urllib.error.URLError, TimeoutError, ValueError):
            break
        if status not in (301, 302, 303, 307, 308) or not location:
            break
        nxt = urljoin(current, location)
        p = urlparse(nxt)
        if p.scheme != "https" or not p.hostname or not _host_platform(p.hostname):
            break
        current = nxt
        if _extractor_supports(current):
            return current
    raise HTTPException(400, "This link type isn't supported. Open the video and copy its full link.")


def base_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "no_color": True,
        "noprogress": True,
        "cachedir": False,
        "allowed_extractors": ALLOWED_EXTRACTORS,
        "ffmpeg_location": FFMPEG,
        "windowsfilenames": True,
        "socket_timeout": 20,
        "retries": 3,
    }
    if COOKIES_FILE:
        opts["cookiefile"] = COOKIES_FILE
    return opts


def clean_error(e: Exception) -> str:
    msg = ANSI.sub("", str(e)).replace("ERROR: ", "").strip()
    msg = re.sub(r"^\[[^\]]+\]\s*[^:]*:\s*", "", msg)  # drop "[youtube] abc123: " prefix
    msg = re.sub(r"[A-Za-z]:\\[^\s]+|/(?:tmp|opt|home|var)/[^\s]+", "", msg)  # never leak paths
    if not msg:
        return "This video couldn't be processed."
    return msg[:300]


def check_limits(info: dict):
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise HTTPException(422, "Live streams can't be downloaded.")
    duration = info.get("duration") or 0
    if duration > MAX_DURATION_SECONDS:
        raise HTTPException(422, f"Videos longer than {MAX_DURATION_SECONDS // 60} minutes aren't supported.")


# ---------- /api/info ----------

class InfoRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


@app.post("/api/info")
def get_info(req: InfoRequest, request: Request):
    rate_limit(request, "info", RATE_INFO)
    url, platform = validate_url(req.url)
    url = resolve_short_link(url)
    try:
        with yt_dlp.YoutubeDL(base_opts()) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(422, clean_error(e))
    except Exception:
        log.exception("info failed for %s", url)
        raise HTTPException(422, "This video couldn't be processed.")

    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise HTTPException(422, "No video found at this link.")
        info = entries[0]
    check_limits(info)

    heights = sorted(
        {
            f["height"]
            for f in info.get("formats") or []
            if isinstance(f.get("height"), int) and f.get("vcodec") not in (None, "none")
        },
        reverse=True,
    )
    page_url = info.get("webpage_url") or url
    return {
        "platform": platform,
        "title": str(info.get("title") or "Untitled")[:300],
        "uploader": (str(info.get("uploader") or info.get("channel") or "")[:120]) or None,
        "thumbnail": info.get("thumbnail") if str(info.get("thumbnail", "")).startswith("https://") else None,
        "duration": info.get("duration"),
        "heights": heights,
        "webpage_url": page_url,
    }


# ---------- download jobs ----------

class JobRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    kind: Literal["video", "audio"] = "video"
    quality: int | None = Field(default=None, ge=100, le=4320)
    audio_format: Literal["mp3", "m4a"] = "mp3"


jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


def _update(job_id: str, **fields):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(fields)


def _run_job(job_id: str, req: JobRequest, url: str, workdir: Path):
    def progress_hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            done = d.get("downloaded_bytes") or 0
            if total and total > MAX_FILESIZE_BYTES:
                raise yt_dlp.utils.DownloadError("This file is too large to download.")
            _update(
                job_id,
                status="downloading",
                progress=round(done / total * 100, 1) if total else None,
                speed=d.get("speed"),
                eta=d.get("eta"),
            )
        elif d["status"] == "finished":
            with jobs_lock:
                if job_id in jobs:
                    jobs[job_id]["part"] += 1

    def pp_hook(d):
        if d["status"] == "started":
            _update(job_id, status="processing", progress=None)

    opts = base_opts() | {
        "outtmpl": str(workdir / "%(title).80B.%(ext)s"),
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [pp_hook],
        "max_filesize": MAX_FILESIZE_BYTES,
        "match_filter": yt_dlp.utils.match_filter_func(
            f"!is_live & duration <=? {MAX_DURATION_SECONDS}"
        ),
    }

    if req.kind == "audio":
        opts["format"] = "bestaudio[ext=m4a]/bestaudio/best"
        opts["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": req.audio_format, "preferredquality": "192"}
        ]
    else:
        h = f"[height<={req.quality}]" if req.quality else ""
        opts["format"] = f"bv*{h}[ext=mp4]+ba[ext=m4a]/bv*{h}+ba/b{h}[ext=mp4]/b{h}/bv*+ba/b"
        opts["merge_output_format"] = "mp4"

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
        files = [p for p in workdir.iterdir() if p.is_file() and not p.name.endswith((".part", ".ytdl"))]
        if not files:
            raise yt_dlp.utils.DownloadError("This video is too long, too large or is a live stream.")
        out = max(files, key=lambda p: p.stat().st_size)
        _update(job_id, status="done", progress=100, filename=out.name, path=str(out),
                size=out.stat().st_size)
    except yt_dlp.utils.DownloadError as e:
        _update(job_id, status="error", error=clean_error(e))
    except Exception:
        log.exception("job %s failed", job_id)
        _update(job_id, status="error", error="This video couldn't be processed.")
    finally:
        with jobs_lock:
            job = jobs.get(job_id)
            if job:
                job["active"] = False
            done = bool(job) and job.get("status") == "done"
        if not done:  # free disk straight away on failure
            shutil.rmtree(workdir, ignore_errors=True)


@app.post("/api/jobs")
def create_job(req: JobRequest, request: Request):
    ip = rate_limit(request, "jobs", RATE_JOBS)
    url, _ = validate_url(req.url)
    url = resolve_short_link(url)

    with jobs_lock:
        active = [j for j in jobs.values() if j["active"]]
        if len(active) >= MAX_ACTIVE_JOBS:
            raise HTTPException(503, "The server is busy. Please try again in a minute.")
        if sum(1 for j in active if j["ip"] == ip) >= MAX_ACTIVE_JOBS_PER_IP:
            raise HTTPException(429, "Please wait for your current download to finish.")
        job_id = uuid.uuid4().hex
        workdir = WORK_ROOT / job_id
        workdir.mkdir()
        jobs[job_id] = {
            "id": job_id, "status": "queued", "progress": 0, "part": 0, "kind": req.kind,
            "created": time.time(), "workdir": str(workdir), "ip": ip, "active": True,
        }
    threading.Thread(target=_run_job, args=(job_id, req, url, workdir), daemon=True).start()
    return {"id": job_id}


PUBLIC_FIELDS = ("id", "status", "progress", "part", "kind", "speed", "eta", "filename", "size", "error")


def _get_job(job_id: str) -> dict:
    if not JOB_ID.match(job_id):
        raise HTTPException(404, "Not found.")
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "This download has expired. Please start again.")
        return dict(job)


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = _get_job(job_id)
    return {k: job.get(k) for k in PUBLIC_FIELDS}


@app.get("/api/jobs/{job_id}/file")
def job_file(job_id: str):
    job = _get_job(job_id)
    path = Path(job.get("path") or "")
    if job.get("status") != "done" or not path.is_file() or WORK_ROOT not in path.parents:
        raise HTTPException(404, "File not ready.")
    media = "audio/mpeg" if path.suffix == ".mp3" else "audio/mp4" if path.suffix == ".m4a" else "video/mp4"
    return FileResponse(path, filename=job["filename"], media_type=media)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong."}, status_code=500)


def _janitor():
    while True:
        time.sleep(120)
        cutoff = time.time() - JOB_TTL_SECONDS
        with jobs_lock:
            expired = [j for j in jobs.values() if j["created"] < cutoff and not j["active"]]
            for j in expired:
                jobs.pop(j["id"], None)
        for j in expired:
            shutil.rmtree(j["workdir"], ignore_errors=True)
        now = time.monotonic()
        with _hits_lock:
            for key in [k for k, q in _hits.items() if not q or q[-1] < now - 600]:
                _hits.pop(key, None)


threading.Thread(target=_janitor, daemon=True).start()


# ---------- serve built Angular app (production) ----------

DIST = Path(__file__).resolve().parent / "dist" / "allvidlink" / "browser"
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="spa")
