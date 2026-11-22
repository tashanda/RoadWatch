import {
  ApiError,
  hasValidDeviceToken,
  isRecord,
  jsonError,
  reportError,
  validSeverity,
  validatedTimestamp,
  type StoreFactory,
} from "./http";
import {
  createSupabaseStore,
  type TelemetryPayload,
  type Vector3,
} from "./supabase-store";

const MAX_BODY_BYTES = 8_192;

// Sensor readings are best-effort: an unusable value becomes null instead of
// rejecting the whole sample, so one bad field never hides the others.
function boundedNumber(value: unknown, maxAbsolute: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maxAbsolute
    ? value
    : null;
}

function vector(value: unknown, maxAbsolute: number): Vector3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return [
    boundedNumber(value[0], maxAbsolute),
    boundedNumber(value[1], maxAbsolute),
    boundedNumber(value[2], maxAbsolute),
  ];
}

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function count(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : null;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function parseTelemetry(value: unknown): {
  device_id: string;
  payload: TelemetryPayload;
} {
  if (!isRecord(value)) throw new ApiError(422, "Telemetry details are invalid.");
  if (
    typeof value.device_id !== "string" ||
    value.device_id.length < 1 ||
    value.device_id.length > 80 ||
    !/^[A-Za-z0-9._-]+$/.test(value.device_id)
  ) {
    throw new ApiError(422, "device_id is invalid.");
  }

  const latitude = boundedNumber(value.latitude, 90);
  const longitude = boundedNumber(value.longitude, 180);
  const hasPosition = latitude !== null && longitude !== null;

  const detection = value.last_detection;
  const detectionTime = validatedTimestamp(field(detection, "timestamp"));
  const detectionSeverity = field(detection, "severity");

  return {
    device_id: value.device_id,
    payload: {
      imu_valid: flag(value.imu_valid),
      orientation_valid: flag(value.orientation_valid),
      gps_valid: flag(value.gps_valid),
      calibration: {
        system: count(field(value.calibration, "system"), 3),
        accel: count(field(value.calibration, "accel"), 3),
        gyro: count(field(value.calibration, "gyro"), 3),
        mag: count(field(value.calibration, "mag"), 3),
      },
      linear_accel_m_s2: vector(value.linear_accel_m_s2, 200),
      raw_accel_m_s2: vector(value.raw_accel_m_s2, 200),
      gyro_rad_s: vector(value.gyro_rad_s, 100),
      orientation_deg: vector(value.orientation_deg, 360),
      vertical_accel_m_s2: boundedNumber(value.vertical_accel_m_s2, 200),
      jerk_m_s3: boundedNumber(value.jerk_m_s3, 100_000),
      vibration_rms_m_s2: boundedNumber(value.vibration_rms_m_s2, 200),
      latitude: hasPosition ? latitude : null,
      longitude: hasPosition ? longitude : null,
      peak: {
        vertical_accel_m_s2: boundedNumber(field(value.peak, "vertical_accel_m_s2"), 200),
        jerk_m_s3: boundedNumber(field(value.peak, "jerk_m_s3"), 100_000),
        vibration_rms_m_s2: boundedNumber(field(value.peak, "vibration_rms_m_s2"), 200),
      },
      samples_in_window: count(value.samples_in_window, 100_000),
      malformed_lines: count(value.malformed_lines, 1_000_000_000),
      last_detection:
        detectionTime && validSeverity(detectionSeverity)
          ? {
              timestamp: detectionTime,
              severity: detectionSeverity,
              impact_m_s2: boundedNumber(field(detection, "impact_m_s2"), 200),
            }
          : null,
    },
  };
}

export async function ingestTelemetry(
  request: Request,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  if (!process.env.ROADWATCH_DEVICE_TOKEN) {
    return jsonError(new ApiError(503, "Telemetry ingestion is not configured."));
  }
  if (!hasValidDeviceToken(request)) {
    return jsonError(new ApiError(401, "Invalid device token."));
  }
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) throw new ApiError(413, "Telemetry is too large.");
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new ApiError(400, "Telemetry must be valid JSON.");
    }
    const { device_id, payload } = parseTelemetry(input);
    const received_at = new Date().toISOString();
    await storeFactory().upsertTelemetry({ device_id, payload, received_at });
    return Response.json({ received_at }, { status: 202 });
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error);
    return reportError("Could not accept telemetry", error);
  }
}

export async function latestTelemetry(
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  try {
    const row = await storeFactory().latestTelemetry();
    return Response.json(
      {
        telemetry: row
          ? { device_id: row.device_id, received_at: row.received_at, ...row.payload }
          : null,
        // The browser compares against this instead of its own clock.
        server_time: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return reportError("Could not load telemetry", error);
  }
}
