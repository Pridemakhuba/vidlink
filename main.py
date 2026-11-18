"""AllvidLink backend — turns Facebook / YouTube / Instagram / TikTok links
into downloadable video (MP4) or audio (MP3) files using yt-dlp."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import imageio_ffmpeg
import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
COOKIES_FILE = os.environ.get("COOKIES_FILE")  # optional, helps with IG/FB login walls
JOB_TTL_SECONDS = 60 * 60
WORK_ROOT = Path(tempfile.gettempdir()) / "allvidlink"
WORK_ROOT.mkdir(exist_ok=True)

PLATFORMS = {
    "youtube": ("youtube.com", "youtu.be", "youtube-nocookie.com"),
    "facebook": ("facebook.com", "fb.watch", "fb.com"),
    "instagram": ("instagram.com", "instagr.am"),
    "tiktok": ("tiktok.com",),
}

ANSI = re.compile(r"\x1b\[[0-9;]*m")

app = FastAPI(title="AllvidLink API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


# ---------- helpers ----------

def detect_platform(url: str) -> str:
    try:
        host = (urlparse(url.strip()).hostname or "").lower()
    except ValueError:
        host = ""
    for name, domains in PLATFORMS.items():
        if any(host == d or host.endswith("." + d) for d in domains):
            return name
    raise HTTPException(
        400, "Unsupported link. Paste a YouTube, Facebook, Instagram or TikTok URL."
    )


def base_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "no_color": True,
        "ffmpeg_location": FFMPEG,
        "windowsfilenames": True,
    }
    if COOKIES_FILE:
        opts["cookiefile"] = COOKIES_FILE
    return opts


def clean_error(e: Exception) -> str:
    msg = ANSI.sub("", str(e)).replace("ERROR: ", "").strip()
    return msg or "Download failed."


# ---------- /api/info ----------

class InfoRequest(BaseModel):
    url: str


@app.post("/api/info")
def get_info(req: InfoRequest):
    platform = detect_platform(req.url)
    try:
        with yt_dlp.YoutubeDL(base_opts()) as ydl:
            info = ydl.extract_info(req.url, download=False)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, clean_error(e))

    if info.get("_type") == "playlist" and info.get("entries"):
        info = next(iter(info["entries"]))

    heights = sorted(
        {
            f["height"]
            for f in info.get("formats") or []
            if f.get("height") and f.get("vcodec") not in (None, "none")
        },
        reverse=True,
    )
    return {
        "platform": platform,
        "title": info.get("title") or "Untitled",
        "uploader": info.get("uploader") or info.get("channel"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "heights": heights,
        "webpage_url": info.get("webpage_url") or req.url,
    }


# ---------- download jobs ----------

class JobRequest(BaseModel):
    url: str
    kind: Literal["video", "audio"] = "video"
    quality: int | None = None  # max height for video; None = best
    audio_format: Literal["mp3", "m4a"] = "mp3"


jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


def _update(job_id: str, **fields):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(fields)


def _run_job(job_id: str, req: JobRequest, workdir: Path):
    def progress_hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            done = d.get("downloaded_bytes") or 0
            _update(
                job_id,
                status="downloading",
                progress=round(done / total * 100, 1) if total else None,
                speed=d.get("speed"),
                eta=d.get("eta"),
                downloaded=done,
                total=total,
            )
        elif d["status"] == "finished":
            with jobs_lock:
                jobs[job_id]["part"] += 1

    def pp_hook(d):
        if d["status"] == "started":
            _update(job_id, status="processing", progress=None)

    opts = base_opts() | {
        "outtmpl": str(workdir / "%(title).80B.%(ext)s"),
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [pp_hook],
    }

    if req.kind == "audio":
        opts["format"] = "bestaudio[ext=m4a]/bestaudio/best"
        opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": req.audio_format,
                "preferredquality": "192",
            }
        ]
    else:
        h = f"[height<={req.quality}]" if req.quality else ""
        opts["format"] = (
            f"bv*{h}[ext=mp4]+ba[ext=m4a]/bv*{h}+ba/b{h}[ext=mp4]/b{h}/bv*+ba/b"
        )
        opts["merge_output_format"] = "mp4"

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([req.url])
        files = [p for p in workdir.iterdir() if p.is_file() and not p.name.endswith(".part")]
        if not files:
            raise RuntimeError("No file was produced.")
        out = max(files, key=lambda p: p.stat().st_size)
        _update(
            job_id,
            status="done",
            progress=100,
            filename=out.name,
            path=str(out),
            size=out.stat().st_size,
        )
    except Exception as e:  # noqa: BLE001
        _update(job_id, status="error", error=clean_error(e))


@app.post("/api/jobs")
def create_job(req: JobRequest):
    detect_platform(req.url)
    job_id = uuid.uuid4().hex
    workdir = WORK_ROOT / job_id
    workdir.mkdir()
    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "part": 0,
            "kind": req.kind,
            "created": time.time(),
            "workdir": str(workdir),
        }
    threading.Thread(target=_run_job, args=(job_id, req, workdir), daemon=True).start()
    return {"id": job_id}


PUBLIC_FIELDS = ("id", "status", "progress", "part", "kind", "speed", "eta",
                 "downloaded", "total", "filename", "size", "error")


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found or expired.")
        return {k: job.get(k) for k in PUBLIC_FIELDS}


@app.get("/api/jobs/{job_id}/file")
def job_file(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job or job.get("status") != "done":
        raise HTTPException(404, "File not ready.")
    media = "audio/mpeg" if job["filename"].endswith(".mp3") else None
    return FileResponse(job["path"], filename=job["filename"], media_type=media)


def _janitor():
    while True:
        time.sleep(300)
        cutoff = time.time() - JOB_TTL_SECONDS
        with jobs_lock:
            expired = [j for j in jobs.values() if j["created"] < cutoff]
            for j in expired:
                jobs.pop(j["id"], None)
        for j in expired:
            shutil.rmtree(j["workdir"], ignore_errors=True)


threading.Thread(target=_janitor, daemon=True).start()


# ---------- serve built Angular app (production) ----------

DIST = Path(__file__).resolve().parent / "dist" / "allvidlink" / "browser"
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="spa")
