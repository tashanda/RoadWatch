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

The API tests use fake storage and do not require Supabase credentials. Once
the approved source changes are pushed and the Vercel environment is
configured, deploy through the existing Vercel project. This repository task
does not push or deploy.

After deployment, verify:

```text
https://<vercel-domain>/api/health
https://<vercel-domain>/api/events?limit=10
https://<vercel-domain>/api/reports?limit=10
https://<vercel-domain>/api/device-events?limit=10
```

The API list endpoints return an explicit service-unavailable error if
Supabase is not configured; they do not return simulated data as if it were
production data. Drive Mode's simulation remains a separate, visibly marked
feature.

## 4. Configure the ESP32

Copy `firmware/include/secrets.example.h` to the ignored
`firmware/include/secrets.h`. Set:

- `ROADWATCH_WIFI_SSID` and `ROADWATCH_WIFI_PASSWORD` to a phone hotspot or
  regular Wi-Fi network.
- `ROADWATCH_BACKEND_URL` to the Vercel origin, such as
  `https://roadwatch.example`, without `/api/device-events`.
- `ROADWATCH_DEVICE_TOKEN` to the same value configured in Vercel.
- `ROADWATCH_BACKEND_ROOT_CA` to the trusted root certificate for the
  Vercel-hosted HTTPS endpoint.

The firmware posts to `/api/device-events`. Keep this token out of GitHub and
out of all browser-visible variables. Wi-Fi can be unavailable while driving;
device events are queued only in RAM and are not guaranteed to survive power
loss or queue saturation.

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
