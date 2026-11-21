# RoadWatch

RoadWatch is a road hazard reporting prototype. The web dashboard displays community photo reports, API events, and ESP32 Wi-Fi events on an OpenStreetMap view. Local/demo events are visibly distinguished from community reports and device events. The ESP32 firmware samples an MPU6050 and GPS; its HTTPS transport is ready for a calibrated candidate detector, but the current firmware does not yet classify or enqueue road hazards.

## Repository layout

- `firmware/` — PlatformIO ESP32 firmware
- `backend/` — FastAPI service
- `frontend/` — Next.js application
- `data/` — local, untracked data files
- `docs/` — hardware notes and safety guidance

## Prerequisites on Windows

1. Install [Visual Studio Code](https://code.visualstudio.com/), then use **File > Open Folder...** to open this `RoadWatch` folder.
2. Install the **PlatformIO IDE** extension in VS Code. PlatformIO will install its toolchain and libraries the first time you build.
3. Install Python 3.10 or newer and Node.js 20.9 or newer (required by the current Next.js release). Confirm in a new VS Code PowerShell terminal:

   ```powershell
   python --version
   node --version
   npm --version
   ```

4. Before connecting or flashing hardware, identify the exact ESP32 board and sensor/GPS models. `esp32dev`, the pin assignments, and peripheral settings in this starter are provisional; verify them against your hardware.

## Firmware: build, upload, and monitor

In VS Code, open the PlatformIO sidebar, choose **Open Project**, and select this repository's `firmware` folder. Use the PlatformIO **Build** action to compile. Alternatively, open a PowerShell terminal in `firmware` if PlatformIO Core CLI is installed and available on `PATH`:

```powershell
cd firmware
pio run
```

Only after verifying the exact board, wiring, and selected PlatformIO environment, connect the ESP32 and use the PlatformIO **Upload** action. The equivalent CLI commands are:

```powershell
pio run -t upload
pio device monitor
```

The monitor uses **460800 baud** to accommodate newline-delimited readings near 100 Hz. Firmware samples the MPU6050 at approximately 100 Hz and prints one JSON object per sample; `timestamp_ms` is elapsed milliseconds since boot, not UTC time. GPS values are `null` until TinyGPSPlus receives a valid, recent fix from actual GPS UART data. No fix is simulated. Sensor initialization and hardware compatibility require physical verification.

## Phase 2 dashboard: Windows setup

Use three VS Code PowerShell terminals opened at the repository root. Python commands below use the virtual-environment interpreter directly, so PowerShell activation policy changes are not needed.

### 1. Start the FastAPI backend

In the first terminal:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:ROADWATCH_ENV = "development"
$env:ROADWATCH_DB_PATH = "data/roadwatch.db"
$env:CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

The SQLite database is created locally at `backend/data/roadwatch.db`. Check `http://127.0.0.1:8000/health` and `http://127.0.0.1:8000/docs`.

### 2. Add fictional Tampa demo events

In the second terminal, explicitly enable development seeding and use the same database path:

```powershell
cd backend
$env:ROADWATCH_ENV = "development"
$env:ROADWATCH_DB_PATH = "data/roadwatch.db"
.\.venv\Scripts\python.exe scripts\seed_simulated.py
```

This explicitly run, development-only script creates 10 fictional detections and replaces any existing simulated events in the selected database. It refuses to run unless `ROADWATCH_ENV=development`. Demo rows are marked `simulated: true` and visibly labeled in the UI. To clear simulated events but keep real events, use the dashboard's **Clear demo data** button or:

```powershell
Invoke-RestMethod -Method Delete -Uri http://127.0.0.1:8000/api/events/simulated
```

### 3. Start the Next.js dashboard

In the third terminal:

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:8000"
npm run dev
```

Open `http://localhost:3000`. The dashboard fetches backend events immediately and refreshes every five seconds. Filter by hazard source and severity. Marker colors indicate low (green), medium (orange), and high (red) severity; marker shapes distinguish community reports from sensor detections. Map tiles come from OpenStreetMap and require an internet connection.

To try a local photo report, choose **Report a pothole**, take/select a JPG/PNG/WebP photo, use GPS only as a suggested starting point or click/drag the map pin, choose severity, and submit. The backend stores the photo in `backend/data/uploads/` and metadata in SQLite. The new community marker appears after the form confirms and the map refreshes. This local file/database mode is not the public site and is not durable hosting.

To run a production frontend build, use another terminal in `frontend`:

```powershell
npm run build
```

### 4. Run backend tests

In a terminal at the repository root:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest
```

The test suite uses a temporary SQLite database and does not change your local development detections.

## Community pothole reports and API

- `GET /health` — service status
- `GET /api/events?severity=high&limit=200` — list events (severity and limit are optional)
- `GET /api/events/{id}` — retrieve one event
- `POST /api/events` — validate and save a detection
- `DELETE /api/events/simulated` — remove only simulated events
- `POST /api/reports` — multipart photo report (`photo`, `latitude`, `longitude`, `severity`, optional `description`)
- `GET /api/reports?limit=200` and `GET /api/reports/{id}` — community reports and their status
- `GET /api/reports/{id}/photo` — serve an uploaded, EXIF-stripped JPEG
- `POST /api/device-events` — authenticated ESP32 event ingestion
- `GET /api/device-events` — accepted device events

The report form validates JPG, PNG, and WebP photo content (maximum 5 MB), coordinates, severity, and a 500-character description. It re-encodes photos to JPEG to strip EXIF metadata, generates UUID-based storage keys, limits reports by client address, and marks each report `source=community` and `status=unverified`. Phone GPS only suggests a location; reporters must place or adjust the pin on the map.

In local development with `ROADWATCH_ENV=development` and no Supabase storage variables, images are saved in `backend/data/uploads/` and metadata in the configured SQLite database. This local mode is for testing only; Render's production mode refuses report uploads unless storage credentials are configured. The local database and image directory are not public and do not provide durable hosted storage.

For hosted reports, create a Supabase project and a **private** Storage bucket (for example `roadwatch-reports`). Set the backend-only Render variables:

- `DATABASE_URL` — Supabase PostgreSQL connection URI (the existing SQLAlchemy layer creates the report table at startup).
- `SUPABASE_URL` — project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key; keep it only in Render's environment settings.
- `SUPABASE_STORAGE_BUCKET` — private bucket name.

The browser calls the FastAPI photo proxy; never add a service-role key to any `NEXT_PUBLIC_*` setting. Keep credentials in the hosting provider's secret environment settings, not in Git.

## ESP32 Wi-Fi event ingestion

The device accepts `POST /api/device-events` with an `X-Device-Token` header and a stable UUID `event_id`. Repeated event IDs are idempotent. Coordinates may both be null when GPS has no fix; partial or invalid coordinates are rejected. Only events with GPS coordinates and a supported classification appear on the map. A shared `ROADWATCH_DEVICE_TOKEN` must be configured privately on the backend and in the ESP32 local secrets header.

The firmware transport runs on a separate FreeRTOS task, uses HTTPS certificate validation, syncs UTC with NTP, and retries uploads with capped exponential backoff. It drops a queued event after five failed attempts; `uploadFailureCount()` exposes the failure counter to firmware diagnostics. Event IDs are generated once when queued and reused for retries. The current firmware has no candidate classifier and does not enqueue events automatically; do not treat raw IMU samples as verified potholes. Preserve the existing sensor drivers until the exact sensor and wiring are confirmed and calibrated.

Copy `firmware/include/secrets.example.h` to the ignored `firmware/include/secrets.h`. Set the Wi-Fi network name/password, HTTPS API origin, backend device token, and the HTTPS server root CA certificate. The sample intentionally contains no real credentials. Wi-Fi can come from a phone hotspot or a regular network, but do not assume there is internet access while driving; queued uploads are held in memory and can be lost on power loss or after the retry limit.

Configure browser origins using comma-separated `CORS_ORIGINS`; CORS is not authentication. The legacy `POST /api/events` endpoint is not device-authenticated and should not be exposed as an untrusted public write API. `ROADWATCH_CORS_ORIGINS` remains supported as a backwards-compatible alias.

## iPhone Drive Mode

Drive Mode uses the browser's foreground geolocation, hazard coordinates, GPS heading, and an accuracy threshold to estimate proximity. Distance is calculated with Haversine; visual alerts are configurable, while audio must be enabled by a user gesture. Alert cooldowns prevent repeated warnings for the same hazard. Its simulation uses map data without reading or sharing real GPS. iPhone Safari can suspend geolocation and audio in the background or when locked. Alerts are estimates, not guaranteed detection or driving-safety advice; use a passenger to operate the phone.

## Public deployment: Render API + Vercel frontend

The app is **not deployed by these instructions**. Deployments and Git pushes require your approval. The repository is already on GitHub; these steps connect its current code to hosting after you commit/push the changes yourself.

### Deploy the API on Render

1. Push the prepared changes to the GitHub repository after reviewing them.
2. In Render, choose **New > Blueprint**, connect `tashanda/RoadWatch`, and select the branch to deploy. The root [`render.yaml`](./render.yaml) configures the API service, health check, and production startup command:
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
3. Set the required `CORS_ORIGINS` value when prompted. Initially use your Vercel origin, for example `https://roadwatch-yourname.vercel.app` (no trailing slash). Include additional trusted origins as comma-separated values. For local testing, add `http://localhost:3000`.
4. Wait for Render's `/health` check to pass and note the service URL, such as `https://roadwatch-api.onrender.com`.
5. Test `https://<render-service>/health` and `https://<render-service>/docs`.

The included free Render service uses SQLite by default. Free hosting filesystems are ephemeral: events may disappear when the service restarts or redeploys. The SQLite database is suitable for local development, not durable hosted storage. Do not expect seeded data to persist on Render.

For persistent PostgreSQL and photos, configure the Supabase variables described above in Render's environment settings—never commit credentials. The backend uses SQLAlchemy and accepts `postgresql://`, `postgres://`, or `sqlite` URLs; if `DATABASE_URL` is unset it falls back to SQLite. Supabase setup, database creation, hosting, and deployment are external actions and are not performed by this repository.

### Connect the frontend in Vercel

1. In Vercel, import the same GitHub repository and set **Root Directory** to `frontend`.
2. Keep the default Next.js build settings (`npm run build` / `npm run start`).
3. Add `NEXT_PUBLIC_API_URL` with the Render service origin, e.g. `https://roadwatch-api.onrender.com` (no `/api/events` suffix and no trailing slash). Set it for Preview and Production as needed.
4. After the Vercel URL is assigned, copy its exact origin into Render's `CORS_ORIGINS`, save, and redeploy/restart the API. Then redeploy the Vercel frontend so its public API URL is baked into the client bundle.
5. Open the Vercel URL. The public site must be served over HTTPS for iPhone camera and geolocation APIs. For a public photo-report test:
   1. Configure Render with Supabase `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`; keep the bucket private and set production `ROADWATCH_ENV=production`.
   2. Open the HTTPS Vercel URL in iPhone Safari and tap **Report a pothole**.
   3. Tap **Take photo** (or **Choose photo** for an existing JPG, PNG, or WebP). Review the preview.
   4. Optionally tap **Suggest my location** and allow GPS; explicitly select that suggestion or tap/drag the map pin to the pothole itself. Do not submit a phone location without checking the pin.
   5. Select Low, Medium, or High, optionally add a description, and tap **Submit pothole report**.
   6. After the confirmation, the map refreshes. The new diamond-shaped **Community** marker should open a popup with the photo, severity, description, date, and **unverified** status.

   If it does not appear, check the browser's network request to `/api/reports`, Render logs, CORS origin, Supabase database connection, private bucket name, and Render's service-role environment variables. No public report can appear until you configure and approve deployment yourself.

Demo data is not inserted automatically in production. To show clearly marked examples, run the seed script only against a database you intentionally selected for development/demo use, with `ROADWATCH_ENV=development`; it refuses unless this is explicit. Never mark real sensor reports as simulated. Community reports are rate-limited per client IP; for multiple backend instances or high-traffic public use, replace the in-memory limiter with shared infrastructure and add user/account abuse controls.

## Hardware and configuration

Review [`docs/hardware.md`](docs/hardware.md) before wiring anything. Provisional firmware pin and UART settings live in `firmware/include/config.h`; the MPU6050 implementation is isolated behind `firmware/include/imu.h`. Do not assume an axis is vertical—mounting orientation must be measured and calibrated. Configure Wi-Fi using a phone hotspot or regular Wi-Fi network and keep the vehicle parked during setup; connectivity may be unavailable while driving. The firmware was build-tested with PlatformIO; no physical ESP32 was connected or flashed.

For photo upload and map math tests, run `python -m pytest` from `backend` and `npm run test:geo` from `frontend`. Do not commit local credentials or collected data.
