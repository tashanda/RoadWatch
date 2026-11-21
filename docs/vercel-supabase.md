# Vercel and Supabase setup

The Next.js application and API routes live under `frontend/`. The routes use
Supabase PostgreSQL and a private Supabase Storage bucket; no Render service or
database connection string is required. The FastAPI backend remains in the
repository as a rollback/reference implementation and is not used by the
frontend routes.

## 1. Prepare Supabase

1. Create or select the Supabase project you want RoadWatch to use.
2. Open **SQL Editor**, paste and run [`../supabase/schema.sql`](../supabase/schema.sql).
   This creates the tables and rate-limit function, enables row-level security,
   grants access to the server role, and creates the private
   `roadwatch-reports` bucket with a 5 MB image limit and JPG/PNG/WebP MIME
   restrictions.
3. In **Project Settings → API**, copy the project URL, the publishable/anon
   browser key, and the service-role secret. The service-role secret must only
   be stored in Vercel's server environment.
4. Choose a long random device token. It is shared only between Vercel and the
   device's local `secrets.h` file.

The SQL is intended for a new RoadWatch Supabase project. Review it before
running if the project already contains tables with any of these names.

## 2. Configure Vercel

Keep the existing GitHub repository connection and set the Vercel project root
directory to `frontend/`. Add these environment variables for Preview and
Production (and Development if desired):

| Variable | Value | Exposure |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase project URL | Server only |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role secret | Server-only secret |
| `SUPABASE_STORAGE_BUCKET` | `roadwatch-reports` | Server only |
| `ROADWATCH_DEVICE_TOKEN` | Your randomly generated device token | Server-only secret |
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key | Public |

Never use a `NEXT_PUBLIC_` prefix for the service-role key or device token.
`NEXT_PUBLIC_API_URL` and `DATABASE_URL` are not used by the migrated frontend.
The photo form sends same-origin requests to `/api/reports`; it uses the public
key only to upload a photo with a one-use, short-lived signed upload token.

The bucket remains private. The public photo URL is a same-origin API route
that returns a 60-second signed download redirect. The final report request
contains only metadata; the image itself is uploaded directly to Storage, so
the 5 MB photo does not pass through the Vercel request-body limit. The server
then downloads the staged image, checks its actual content, removes EXIF data
by re-encoding it, stores the sanitized JPEG under a server-generated UUID key,
and removes the staging object.

Vercel Custom Metrics are emitted for report uploads/finalization and device
ingestion. They are no-ops locally; availability and any Observability Plus
charges depend on the linked Vercel plan and settings.

## 3. Build, test, and deploy

From `frontend/`, run:

```powershell
npm ci
npm run test:api
npm run test:geo
npm run build
```

The API tests use fake storage and do not require Supabase credentials. Once the source changes are pushed and the Vercel environment is configured,
deploy through the existing Vercel project. Environment-variable changes apply
to new deployments, so create a fresh Production deployment after adding or
changing variables.

After deployment, verify:

```text
https://<vercel-domain>/api/health
https://<vercel-domain>/api/events?limit=10
https://<vercel-domain>/api/reports?limit=10
https://<vercel-domain>/api/device-events?limit=10
```

`GET /api/health` performs read-only checks for the required database tables
and confirms `roadwatch-reports` exists and is private. It returns HTTP 503 if
the Supabase credentials, permissions, schema, or bucket configuration are not
ready. The API list endpoints also return an explicit service-unavailable
error on Supabase failures; they do not return simulated data as if it were
production data. Drive Mode's simulation remains a separate, visibly marked
feature.

If the readiness check logs a table permission error, verify that
`SUPABASE_SERVICE_ROLE_KEY` is the service-role key for the same project as
`SUPABASE_URL` (not the anon key) and that `supabase/schema.sql` was run in that
project. For an existing project, run
`supabase/migrations/20261121160000_roadwatch_service_role_permissions.sql` in
the Supabase SQL Editor to reapply the least-privilege grants. Keep the key in
Vercel Production variables only; do not share or commit it.

## 4. Configure the ESP32

Copy `firmware/include/secrets.example.h` to the ignored
`firmware/include/secrets.h`. Set:

- `ROADWATCH_WIFI_SSID` and `ROADWATCH_WIFI_PASSWORD` to a phone hotspot or
  regular Wi-Fi network.
- `ROADWATCH_BACKEND_URL` to the Vercel origin, such as
  `https://roadwatch.example`, without `/api/device-events`.
- `ROADWATCH_DEVICE_TOKEN` to the same value configured in Vercel.

The firmware uses the public Google Trust Services GTS Root R1 certificate
embedded in `firmware/include/backend_root_ca.h` to validate the Vercel TLS
chain. The server does not send its trust root; the chain was verified against
the system and certifi trust stores. `WiFiClientSecure` keeps certificate and
hostname verification enabled. This public CA certificate is not a secret.

Certificate validation requires a valid system clock. After Wi-Fi connects,
the uploader starts SNTP synchronization using `pool.ntp.org` and
`time.nist.gov`; it will not send an event until the clock is valid. The ESP32
needs internet access to synchronize time. Keep the device token out of GitHub
and browser-visible variables. Wi-Fi can be unavailable while driving; device
events are queued only in RAM and are not guaranteed to survive power loss or
queue saturation.

For a no-record connectivity check, add `#define ROADWATCH_DIAGNOSTIC_MODE 1`
to the local, ignored `firmware/include/secrets.h`, then build and flash. This
mode suppresses sensor-event uploads, GETs `/api/health`, and sends deliberately
invalid JSON to `/api/device-events` with the configured device token. The
current handler validates the token before parsing JSON, then returns HTTP 400
for this malformed body before inserting anything. Thus HTTP 400 for this
specific probe means the token was accepted; HTTP 401 means it was rejected.
Return the macro to `0` and reflash for normal event uploads.

On Windows, replace `COM5` below with the port shown by PlatformIO:

```powershell
cd firmware
.\.venv\Scripts\pio.exe device list
.\.venv\Scripts\pio.exe run -e esp32dev -t upload --upload-port COM5
.\.venv\Scripts\pio.exe device monitor --port COM5 --baud 460800
```

Serial output reports configuration omissions, Wi-Fi state, SNTP readiness,
TLS transport errors, and HTTP status codes. Never paste the local
`secrets.h` contents into logs or commit that file.

## 5. Test a photo report from iPhone Safari

1. Confirm the Vercel deployment is HTTPS and its environment variables are
   configured, then open the public URL in Safari.
2. Tap **Report a pothole**, choose **Take photo** or **Choose photo**, and
   review the preview.
3. Tap **Suggest my location** if desired, but use the map to place or adjust
   the pin at the pothole itself. Phone GPS is only a suggestion.
4. Select severity, optionally enter a description of at most 500 characters,
   and submit. The UI shows secure upload, upload, and save progress.
5. After confirmation, verify the community marker appears on the shared map
   with its photo, severity, date, and unverified status. Refresh the page and
   verify it persists. The image remains in private Storage; its same-origin
   photo route issues a short-lived signed URL.

If a report fails, check the browser's `/api/reports/upload` and `/api/reports`
responses, Vercel function logs, Supabase SQL setup, and the private bucket.
No live external services, credentials, push, or deployment were changed as
part of this implementation.
