import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RoadWatchStore, TelemetryRow } from "./supabase-store";
import { ingestTelemetry, latestTelemetry, parseTelemetry } from "./telemetry";

const sample = {
  device_id: "roadwatch-esp32-01",
  imu_valid: true,
  orientation_valid: true,
  gps_valid: false,
  calibration: { system: 3, accel: 2, gyro: 3, mag: null },
  linear_accel_m_s2: [0.03, 0.02, -0.49],
  gyro_rad_s: [0.06, -0.25, 0.12],
  orientation_deg: [322.4, -2.1, -0.2],
  vertical_accel_m_s2: -0.46,
  jerk_m_s3: 0.125,
  vibration_rms_m_s2: 0.456,
  latitude: null,
  longitude: null,
  peak: { vertical_accel_m_s2: -4.2, jerk_m_s3: 310.5, vibration_rms_m_s2: 1.9 },
  samples_in_window: 10,
  malformed_lines: 2,
  last_detection: {
    timestamp: "2026-11-21T20:00:00+00:00",
    severity: "medium",
    impact_m_s2: 9.81,
  },
};

function makeStore() {
  let row: TelemetryRow | null = null;
  const store = {
    upsertTelemetry: async (next: TelemetryRow) => {
      row = next;
    },
    latestTelemetry: async () => row,
  } as unknown as RoadWatchStore;
  return { factory: () => store, getRow: () => row };
}

function post(body: string, token: string | null = "secret-token") {
  return new Request("https://roadwatch.example/api/telemetry", {
    method: "POST",
    headers: token ? { "X-Device-Token": token } : {},
    body,
  });
}

describe("telemetry API", () => {
  const original = process.env.ROADWATCH_DEVICE_TOKEN;
  beforeEach(() => {
    process.env.ROADWATCH_DEVICE_TOKEN = "secret-token";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ROADWATCH_DEVICE_TOKEN;
    else process.env.ROADWATCH_DEVICE_TOKEN = original;
  });

  it("stores a sample and returns it with the server time", async () => {
    const { factory } = makeStore();
    const accepted = await ingestTelemetry(post(JSON.stringify(sample)), factory);
    expect(accepted.status).toBe(202);

    const response = await latestTelemetry(factory);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.telemetry.device_id).toBe("roadwatch-esp32-01");
    expect(body.telemetry.vertical_accel_m_s2).toBe(-0.46);
    expect(body.telemetry.peak.jerk_m_s3).toBe(310.5);
    expect(body.telemetry.calibration).toEqual({ system: 3, accel: 2, gyro: 3, mag: null });
    expect(body.telemetry.last_detection.severity).toBe("medium");
    expect(Number.isNaN(Date.parse(body.server_time))).toBe(false);
    expect(Number.isNaN(Date.parse(body.telemetry.received_at))).toBe(false);
  });

  it("returns null telemetry before any sample arrives", async () => {
    const response = await latestTelemetry(makeStore().factory);
    expect((await response.json()).telemetry).toBeNull();
  });

  it("rejects missing or wrong device tokens without storing", async () => {
    const { factory, getRow } = makeStore();
    expect((await ingestTelemetry(post(JSON.stringify(sample), null), factory)).status).toBe(401);
    expect((await ingestTelemetry(post(JSON.stringify(sample), "wrong"), factory)).status).toBe(401);
    expect(getRow()).toBeNull();
  });

  it("is unavailable when no device token is configured", async () => {
    delete process.env.ROADWATCH_DEVICE_TOKEN;
    const response = await ingestTelemetry(post(JSON.stringify(sample)), makeStore().factory);
    expect(response.status).toBe(503);
  });

  it("rejects malformed JSON, non-objects, bad device ids, and oversized bodies", async () => {
    const { factory, getRow } = makeStore();
    expect((await ingestTelemetry(post("{not json"), factory)).status).toBe(400);
    // Bare NaN is what a naive serializer would emit for a failed reading.
    expect((await ingestTelemetry(post('{"device_id":"a","jerk_m_s3":NaN}'), factory)).status).toBe(400);
    expect((await ingestTelemetry(post("[1,2,3]"), factory)).status).toBe(422);
    expect(
      (await ingestTelemetry(post(JSON.stringify({ ...sample, device_id: "bad id!" })), factory)).status,
    ).toBe(422);
    expect(
      (await ingestTelemetry(post(JSON.stringify({ ...sample, pad: "x".repeat(9000) })), factory)).status,
    ).toBe(413);
    expect(getRow()).toBeNull();
  });

  it("nulls unusable values instead of storing them", () => {
    const { payload } = parseTelemetry({
      device_id: "roadwatch-esp32-01",
      imu_valid: "yes",
      calibration: { system: 7, accel: 1.5, gyro: 2 },
      linear_accel_m_s2: [1, "nan", 9999],
      gyro_rad_s: [1, 2],
      vertical_accel_m_s2: "nan",
      jerk_m_s3: 1e12,
      latitude: 27.95,
      longitude: null,
      peak: "high",
      last_detection: { timestamp: "yesterday", severity: "medium" },
      unexpected: { nested: true },
    });
    expect(payload.imu_valid).toBeNull();
    expect(payload.calibration).toEqual({ system: null, accel: null, gyro: 2, mag: null });
    expect(payload.linear_accel_m_s2).toEqual([1, null, null]);
    expect(payload.gyro_rad_s).toBeNull();
    expect(payload.vertical_accel_m_s2).toBeNull();
    expect(payload.jerk_m_s3).toBeNull();
    expect(payload.latitude).toBeNull();
    expect(payload.peak.jerk_m_s3).toBeNull();
    expect(payload.last_detection).toBeNull();
    expect("unexpected" in payload).toBe(false);
  });

  it("reports storage failures as 503 without leaking details", async () => {
    const failing = () =>
      ({
        latestTelemetry: async () => {
          throw new Error('relation "device_telemetry" does not exist');
        },
      }) as unknown as RoadWatchStore;
    const response = await latestTelemetry(failing);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("device_telemetry");
  });
});
