import { metric } from "@vercel/functions";

import {
  ApiError,
  hasValidDeviceToken,
  isRecord,
  jsonError,
  queryLimit,
  reportError,
  validEventType,
  validSeverity,
  validUuid,
  validatedTimestamp,
  type StoreFactory,
} from "./http";
import {
  createSupabaseStore,
  type DeviceEventRow,
  type RoadWatchStore,
} from "./supabase-store";

function parseDeviceEvent(value: unknown): Omit<DeviceEventRow, "received_at"> {
  if (!isRecord(value)) throw new ApiError(422, "Device event details are invalid.");
  if (!validUuid(value.event_id)) throw new ApiError(422, "event_id must be a UUID.");
  if (
    typeof value.device_id !== "string" ||
    value.device_id.length < 1 ||
    value.device_id.length > 80 ||
    !/^[A-Za-z0-9._-]+$/.test(value.device_id)
  ) {
    throw new ApiError(422, "device_id is invalid.");
  }
  const timestamp = validatedTimestamp(value.timestamp);
  if (!timestamp) throw new ApiError(422, "Timestamp must include a valid timezone.");
  if (
    typeof value.sensor_summary !== "string" ||
    value.sensor_summary.length < 1 ||
    value.sensor_summary.length > 500
  ) {
    throw new ApiError(422, "sensor_summary must be 1 to 500 characters.");
  }
  const latitude = value.latitude === undefined ? null : value.latitude;
  const longitude = value.longitude === undefined ? null : value.longitude;
  if (
    (latitude === null) !== (longitude === null) ||
    (latitude !== null &&
      (typeof latitude !== "number" ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90)) ||
    (longitude !== null &&
      (typeof longitude !== "number" ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180))
  ) {
    throw new ApiError(422, "Latitude and longitude must both be valid or both omitted.");
  }
  const severity = value.severity === undefined ? null : value.severity;
  const eventType = value.event_type === undefined ? null : value.event_type;
  const impactMagnitude =
    value.impact_magnitude === undefined ? null : value.impact_magnitude;
  const source = value.source === undefined ? "esp32_sensor" : value.source;
  const status = value.status === undefined ? "unverified" : value.status;
  if (
    (severity === null) !== (eventType === null) ||
    (severity !== null && !validSeverity(severity)) ||
    (eventType !== null && !validEventType(eventType))
  ) {
    throw new ApiError(422, "Severity and event_type must be supported and provided together.");
  }
  if (
    (impactMagnitude !== null &&
      (typeof impactMagnitude !== "number" ||
        !Number.isFinite(impactMagnitude) ||
        impactMagnitude < 0 ||
        impactMagnitude > 200)) ||
    source !== "esp32_sensor" ||
    status !== "unverified"
  ) {
    throw new ApiError(422, "Impact, source, or verification status is invalid.");
  }
  return {
    event_id: value.event_id,
    device_id: value.device_id,
    timestamp,
    latitude,
    longitude,
    sensor_summary: value.sensor_summary,
    severity,
    event_type: eventType,
    impact_magnitude: impactMagnitude,
    source,
    status,
  };
}

async function withStore(
  label: string,
  storeFactory: StoreFactory,
  run: (store: RoadWatchStore) => Promise<Response>,
): Promise<Response> {
  try {
    return await run(storeFactory());
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error);
    return reportError(label, error);
  }
}

export async function ingestDeviceEvent(
  request: Request,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  const startedAt = performance.now();
  let outcome = "error";
  if (!process.env.ROADWATCH_DEVICE_TOKEN) {
    metric("roadwatch.device_events.ingested", 1, { outcome: "not_configured" });
    metric("roadwatch.device_events.duration_ms", performance.now() - startedAt);
    return jsonError(new ApiError(503, "Device event ingestion is not configured."));
  }
  if (!hasValidDeviceToken(request)) {
    metric("roadwatch.device_events.ingested", 1, { outcome: "unauthorized" });
    metric("roadwatch.device_events.duration_ms", performance.now() - startedAt);
    return jsonError(new ApiError(401, "Invalid device token."));
  }

  const response = await withStore("Could not accept device event", storeFactory, async (store) => {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      throw new ApiError(400, "Device event details must be valid JSON.");
    }
    const event = parseDeviceEvent(input);
    const result = await store.insertDeviceEvent({
      ...event,
      received_at: new Date().toISOString(),
    });
    if (result.conflict) throw new ApiError(409, "Event ID is already in use.");
    outcome = result.duplicate ? "duplicate" : "success";
    return Response.json(
      { event: result.event, duplicate: result.duplicate },
      { status: 202 },
    );
  });
  if (response.status >= 400) outcome = response.status === 401 ? "unauthorized" : "error";
  metric("roadwatch.device_events.ingested", 1, { outcome });
  metric("roadwatch.device_events.duration_ms", performance.now() - startedAt);
  return response;
}

export async function listDeviceEvents(
  request: Request,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  const limit = queryLimit(new URL(request.url));
  if (limit === null) return jsonError(new ApiError(422, "Limit must be between 1 and 500."));
  return withStore("Could not list device events", storeFactory, async (store) => {
    return Response.json(await store.listDeviceEvents(limit));
  });
}
