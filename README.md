# AllvidLink

Paste a YouTube, Facebook, Instagram or TikTok link and download it as a video (MP4) or audio (MP3/M4A) file.

The Angular page and the Python server are in one folder:

```
vidlink/
├─ main.py            Python server (FastAPI + yt-dlp), also serves the built page
├─ requirements.txt   Python dependencies
├─ src/               Angular page (src/app/app.ts, src/styles.css)
├─ public/            static assets (favicon)
├─ angular.json, package.json, tsconfig*.json, proxy.conf.json
└─ .venv/  node_modules/  dist/   (generated, not in git)
```

ffmpeg comes bundled through `imageio-ffmpeg`, so you don't install it separately.

## Setup (one time)

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
npm install
```

## Run: production (one server)

```powershell
npm run serve:prod
```
This builds the page and starts the server. Open http://localhost:8000

## Run: development (hot reload)

```powershell
npm run api      # terminal 1: Python server on :8000
npm start        # terminal 2: http://localhost:4200, with /api proxied to :8000
```

## Deploy to Render

Use a **Web Service**, not a Static Site. A Static Site can't run the Python server.

- **Easiest:** in Render, choose **New → Blueprint** and pick this repo. [render.yaml](render.yaml) fills in all the settings.
- **Manual:** choose **New → Web Service**, then:
  - Runtime: **Python 3**
  - Build command: `npm ci && npx ng build && pip install -r requirements.txt`
  - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT --no-server-header`
  - Health check path: `/api/health`

## Security

- **Links:** only YouTube, Facebook, Instagram and TikTok links are accepted, and only the extractors for single videos run. Arbitrary websites, internal addresses, playlists and channels are rejected. Short links are followed only while they stay on those platforms over HTTPS.
- **Limits:** each IP can make 20 info requests a minute and start 10 downloads per 10 minutes, with 1 download running at a time. The server runs at most 3 downloads at once. Files over 800 MB, videos over 2 hours and live streams are refused.
- **Headers:** a strict Content Security Policy (no inline scripts or styles), HSTS, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, a locked-down Permissions-Policy and cross-origin isolation headers. API responses are never cached.
- **Data:** finished files are deleted after 30 minutes, and failed ones straight away. Download IDs are random 128-bit values. The API docs pages are turned off, and error messages never show server file paths.

To change a limit, set one of these environment variables (in Render: **Environment**):

| Variable | Default |
|---|---|
| `MAX_DURATION_MINUTES` | 120 |
| `MAX_FILESIZE_MB` | 800 |
| `MAX_ACTIVE_JOBS` / `MAX_ACTIVE_JOBS_PER_IP` | 3 / 1 |
| `RATE_INFO_PER_MIN` / `RATE_JOBS_PER_10MIN` | 20 / 10 |
| `JOB_TTL_MINUTES` | 30 |
| `ALLOWED_HOSTS` | (off) e.g. `vidlink-2.onrender.com,yourdomain.com` |

## API

| Method | Path | Body / result |
|---|---|---|
| POST | `/api/info` | `{url}` → title, thumbnail, duration, available heights |
| POST | `/api/jobs` | `{url, kind: "video"\|"audio", quality?: 1080, audio_format?: "mp3"\|"m4a"}` → `{id}` |
| GET | `/api/jobs/{id}` | status, progress %, speed, ETA |
| GET | `/api/jobs/{id}/file` | the finished file (attachment) |

Finished files are stored in your system temp folder (`%TEMP%\allvidlink`). They are deleted after 30 minutes.

## Notes

- **Instagram/Facebook login walls:** some posts need a logged-in session. Export your browser cookies to a Netscape `cookies.txt` file and set `COOKIES_FILE=C:\path\cookies.txt` before you start the server.
- **Sites change often.** When a platform stops working, update yt-dlp: `.venv\Scripts\python -m pip install -U yt-dlp`.
- Only download content you own or have permission to use.
