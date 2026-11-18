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
  - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
  - Health check path: `/api/health`

## API

| Method | Path | Body / result |
|---|---|---|
| POST | `/api/info` | `{url}` → title, thumbnail, duration, available heights |
| POST | `/api/jobs` | `{url, kind: "video"\|"audio", quality?: 1080, audio_format?: "mp3"\|"m4a"}` → `{id}` |
| GET | `/api/jobs/{id}` | status, progress %, speed, ETA |
| GET | `/api/jobs/{id}/file` | the finished file (attachment) |

Finished files are stored in your system temp folder (`%TEMP%\allvidlink`). They are deleted after 1 hour.

## Notes

- **Instagram/Facebook login walls:** some posts need a logged-in session. Export your browser cookies to a Netscape `cookies.txt` file and set `COOKIES_FILE=C:\path\cookies.txt` before you start the server.
- **Sites change often.** When a platform stops working, update yt-dlp: `.venv\Scripts\python -m pip install -U yt-dlp`.
- Only download content you own or have permission to use.
