-- Latest live sensor snapshot per device, written by backend/scripts/serial_bridge.py
-- through POST /api/telemetry and read by the dashboard through GET /api/telemetry.
begin;

create table if not exists public.device_telemetry (
  device_id text primary key check (char_length(device_id) between 1 and 80),
  payload jsonb not null,
  received_at timestamptz not null
);

alter table public.device_telemetry enable row level security;

revoke all on public.device_telemetry from anon, authenticated, service_role;
grant select, insert, update on public.device_telemetry to service_role;

commit;
