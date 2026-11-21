# RoadWatch

RoadWatch is a road hazard reporting prototype. The Next.js dashboard displays community photo reports, demo events, and ESP32 Wi-Fi events on an OpenStreetMap view. Community, sensor, unverified, and simulated data are labeled separately. The ESP32 firmware uses a BNO055 and GPS for configurable, unverified pothole candidates; real-world detection accuracy has not been validated.

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

4. The confirmed IMU wiring is BNO055 SDA GPIO 25, SCL GPIO 33, address `0x28`. Verify the exact ESP32 DevKit V1 board, GPS module, power, and logic levels before connecting hardware.

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

The monitor uses **460800 baud**. Firmware samples the BNO055 at approximately 100 Hz; enable `ROADWATCH_DETECTOR_DEBUG` in the local secrets header to print diagnostic JSON at 10 Hz. GPS values are `null` until TinyGPSPlus receives a valid, recent fix from actual GPS UART data. No location is simulated. Sensor initialization and physical mounting still require hardware verification.

## Local development

The Next.js dashboard uses same-origin API routes and Supabase. For local API
tests without hosted credentials, use `npm run test:api`; the test fixtures are
explicitly mocked and are not production data. To use the live local dashboard
or submit photos, configure the Supabase variables from
[`docs/vercel-supabase.md`](docs/vercel-supabase.md).

### Start the Next.js dashboard

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. Without Supabase, data endpoints return a
service-unavailable error; the application does not quietly substitute mock
production data.

For hosted or locally configured photo reporting, choose **Report a pothole**, take/select a JPG/PNG/WebP photo, use GPS only as a suggested starting point or click/drag the map pin, choose severity, and submit. The Next.js route handlers store sanitized photos in private Supabase Storage and metadata in Supabase PostgreSQL.

To run a production frontend build, use another terminal in `frontend`:

```powershell
npm run build
```

### Run backend regression tests

The retained FastAPI service is not used by the Next.js application. To run its
regression suite:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest
```

The test suite uses a temporary SQLite database and does not change your local development detections.

## Community pothole reports and API

- `GET /api/health` — read-only Supabase readiness check for required tables and the private reports bucket
- `GET /api/events?severity=high&limit=200` — list events (severity and limit are optional)
- `GET /api/events/{id}` — retrieve one event
- `POST /api/events` — validate and save a detection
- `DELETE /api/events/simulated` — remove only simulated events
- `POST /api/reports/upload` — create a rate-limited, one-use signed upload for a JPG, PNG, or WebP photo
- `DELETE /api/reports/upload/{id}` — cancel and clean up an incomplete upload
- `POST /api/reports` — finalize a staged photo report (`upload_id`, `latitude`, `longitude`, `severity`, optional `description`)
- `GET /api/reports?limit=200` and `GET /api/reports/{id}` — community reports and their status
- `GET /api/reports/{id}/photo` — redirect to a short-lived URL for a private, EXIF-stripped JPEG
- `POST /api/device-events` — authenticated ESP32 event ingestion
- `GET /api/device-events` — accepted device events

The Next.js report handlers validate JPG, PNG, and WebP photo content (maximum 5 MB), coordinates, severity, and a 500-character description. They re-encode photos to JPEG to strip EXIF metadata, generate UUID-based storage keys, rate-limit uploads, and mark reports `source=community` and `status=unverified`. The photo itself is uploaded directly to Supabase Storage using a short-lived signed URL to avoid Vercel request-body limits. Phone GPS only suggests a location; reporters must place or adjust the pin on the map.

The FastAPI backend retains its legacy local SQLite/file-upload behavior for rollback and reference. The Next.js application does not call it; frontend API routes require Supabase configuration. Apply [`supabase/schema.sql`](supabase/schema.sql) to the selected Supabase project and follow [`docs/vercel-supabase.md`](docs/vercel-supabase.md) for environment variables and deployment.

For the Next.js deployment, configure these Vercel environment variables:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET=roadwatch-reports` for server routes.
- `ROADWATCH_DEVICE_TOKEN` for authenticated ESP32 uploads.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the one-time browser upload flow.

Only the Supabase URL and publishable/anon key may be public. Never expose the service-role key or device token through a `NEXT_PUBLIC_*` variable or commit credentials.

## ESP32 Wi-Fi event ingestion

The device accepts `POST /api/device-events` with an `X-Device-Token` header and a stable UUID `event_id`. Repeated event IDs are idempotent. Coordinates may both be null when GPS has no fix; partial or invalid coordinates are rejected. Events without coordinates remain stored but are not given a map marker. A shared `ROADWATCH_DEVICE_TOKEN` must be configured privately in Vercel and in the ESP32 local secrets header.

The firmware transport runs on a separate FreeRTOS task, uses HTTPS certificate validation, syncs UTC with NTP, and retries uploads with capped exponential backoff. Failed retry batches are retained in RAM and retried after a delay; power loss, queue saturation, or prolonged network failure can still lose events. Event IDs are generated once when queued and reused for retries. BNO055 candidate detections are always unverified and require physical calibration and real-world validation.

Copy `firmware/include/secrets.example.h` to the ignored `firmware/include/secrets.h`. Set the Wi-Fi network name/password, HTTPS Vercel origin, device token, and the HTTPS server root CA certificate. The sample intentionally contains no real credentials. Wi-Fi can come from a phone hotspot or a regular network, but do not assume there is internet access while driving; events are held in RAM.

The Next.js API is same-origin and does not need CORS configuration. Comma-separated `CORS_ORIGINS` (and the backwards-compatible `ROADWATCH_CORS_ORIGINS` alias) apply only to the retained FastAPI service. Its legacy `POST /api/events` endpoint is not device-authenticated and should not be exposed as an untrusted public write API.

## iPhone Drive Mode

Drive Mode uses the browser's foreground geolocation, hazard coordinates, GPS heading, and an accuracy threshold to estimate proximity. Distance is calculated with Haversine; visual alerts are configurable, while audio must be enabled by a user gesture. Alert cooldowns prevent repeated warnings for the same hazard. Its simulation uses map data without reading or sharing real GPS. iPhone Safari can suspend geolocation and audio in the background or when locked. Alerts are estimates, not guaranteed detection or driving-safety advice; use a passenger to operate the phone.

## Vercel + Supabase deployment

The Next.js frontend and API are intended to run together on Vercel, with
Supabase providing PostgreSQL and private photo storage. Render is no longer
required. The FastAPI backend remains in the repository as a rollback/reference
implementation until the replacement is fully verified.

Follow [`docs/vercel-supabase.md`](docs/vercel-supabase.md) to apply the SQL
schema, configure server/public environment variables, deploy through the
existing Vercel project, and test a report from iPhone Safari. No push or
deployment has been performed as part of this work.

## Hardware and configuration

Review [`docs/hardware.md`](docs/hardware.md) before wiring anything. BNO055 I2C pins/address and detector defaults live in `firmware/include/config.h` and `firmware/include/pothole_detector.h`. The quaternion transform accounts for sensor orientation, but physical mounting, calibration, thresholds, and vehicle-specific false positives still need testing. Configure Wi-Fi using a phone hotspot or regular Wi-Fi network and keep the vehicle parked during setup; connectivity may be unavailable while driving.

For backend tests, run `python -m pytest` from `backend`. From `frontend`, run `npm run test:api`, `npm run test:geo`, and `npm run build`. Do not commit local credentials or collected data.
