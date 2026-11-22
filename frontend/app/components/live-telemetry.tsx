"use client";

import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";

import type { LiveTelemetry as Telemetry, TelemetryResponse } from "./types";

const POLL_MS = 1000;
const LIVE_WINDOW_MS = 6000;

type Status = "connecting" | "live" | "offline" | "unavailable";

function fixed(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function axes(values: Telemetry["gyro_rad_s"], digits = 2) {
  if (!values) return "—";
  return values.map((value) => fixed(value, digits)).join("  ");
}

function secondsAgo(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function LiveTelemetry() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [ageMs, setAgeMs] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();

    async function poll() {
      try {
        const response = await fetch("/api/telemetry", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = (await response.json()) as TelemetryResponse;
        if (cancelled) return;
        const latest = result.telemetry;
        // Age is measured on the server's clock so a wrong browser clock
        // cannot make a stale reading look live.
        const age = latest
          ? new Date(result.server_time).getTime() - new Date(latest.received_at).getTime()
          : null;
        setTelemetry(latest);
        setAgeMs(age);
        setStatus(age !== null && age < LIVE_WINDOW_MS ? "live" : "offline");
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setStatus("unavailable");
      }
      // Do not poll in a hidden tab; resume on the next visibility change.
      if (!cancelled && !document.hidden) timer = window.setTimeout(poll, POLL_MS);
    }

    function onVisibilityChange() {
      window.clearTimeout(timer);
      if (!document.hidden) void poll();
    }

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const live = status === "live";
  const statusLabel =
    status === "connecting"
      ? "Connecting…"
      : status === "unavailable"
        ? "Telemetry service unavailable"
        : live
          ? "Sensor live"
          : telemetry && ageMs !== null
            ? `Sensor offline · last seen ${secondsAgo(ageMs)}`
            : "Sensor offline · no data received yet";
  const calibration = telemetry?.calibration;
  const detection = telemetry?.last_detection ?? null;
  const hasFix =
    telemetry?.gps_valid === true && telemetry.latitude !== null && telemetry.longitude !== null;

  return (
    <section className="telemetry-panel" id="live-sensor" aria-label="Live sensor measurements">
      <div className="panel-heading telemetry-heading">
        <div>
          <div className="panel-title-row">
            <h2>Live sensor</h2>
            <span className={live ? "map-live-tag" : "map-live-tag telemetry-tag-offline"}>
              <span className={live ? "online-dot" : "offline-dot"} /> {live ? "LIVE" : "OFFLINE"}
            </span>
          </div>
          <p>ESP32 measurements streamed through the USB serial bridge</p>
        </div>
        <div className="telemetry-status" role="status">
          <Cpu size={14} />
          <span>{statusLabel}</span>
        </div>
      </div>

      <div className={live ? "telemetry-grid" : "telemetry-grid telemetry-stale"}>
        <article className="telemetry-tile telemetry-tile-primary">
          <span className="telemetry-label">Vertical acceleration</span>
          <strong>{fixed(telemetry?.vertical_accel_m_s2)}<small> m/s²</small></strong>
          <span className="telemetry-sub">Peak {fixed(telemetry?.peak.vertical_accel_m_s2)} in last second</span>
        </article>
        <article className="telemetry-tile telemetry-tile-primary">
          <span className="telemetry-label">Jerk</span>
          <strong>{fixed(telemetry?.jerk_m_s3, 1)}<small> m/s³</small></strong>
          <span className="telemetry-sub">Peak {fixed(telemetry?.peak.jerk_m_s3, 1)} in last second</span>
        </article>
        <article className="telemetry-tile telemetry-tile-primary">
          <span className="telemetry-label">Vibration RMS</span>
          <strong>{fixed(telemetry?.vibration_rms_m_s2)}<small> m/s²</small></strong>
          <span className="telemetry-sub">Peak {fixed(telemetry?.peak.vibration_rms_m_s2)} in last second</span>
        </article>
        <article className="telemetry-tile">
          <span className="telemetry-label">Accelerometer X Y Z (m/s²)</span>
          <strong className="telemetry-axes">{axes(telemetry?.linear_accel_m_s2 ?? null)}</strong>
          <span className="telemetry-sub">
            Raw {axes(telemetry?.raw_accel_m_s2 ?? null)}
          </span>
        </article>
        <article className="telemetry-tile">
          <span className="telemetry-label">Gyroscope X Y Z (rad/s)</span>
          <strong className="telemetry-axes">{axes(telemetry?.gyro_rad_s ?? null)}</strong>
          <span className="telemetry-sub">
            {telemetry?.imu_valid === false ? "IMU reading invalid" : "Angular rate"}
          </span>
        </article>
        <article className="telemetry-tile">
          <span className="telemetry-label">Orientation heading / roll / pitch (°)</span>
          <strong className="telemetry-axes">{axes(telemetry?.orientation_deg ?? null, 1)}</strong>
          <span className="telemetry-sub">
            {telemetry?.orientation_valid === false ? "Orientation not yet valid" : "Fused orientation"}
          </span>
        </article>
        <article className="telemetry-tile">
          <span className="telemetry-label">Calibration (0–3)</span>
          <strong className="telemetry-axes">
            Sys {calibration?.system ?? "—"} · Acc {calibration?.accel ?? "—"} · Gyr {calibration?.gyro ?? "—"}
            {calibration?.mag != null && ` · Mag ${calibration.mag}`}
          </strong>
          <span className="telemetry-sub">3 is fully calibrated</span>
        </article>
        <article className="telemetry-tile">
          <span className="telemetry-label">GPS</span>
          <strong className="telemetry-axes">
            {hasFix
              ? `${fixed(telemetry?.latitude, 5)}, ${fixed(telemetry?.longitude, 5)}`
              : "No fix"}
          </strong>
          <span className="telemetry-sub">
            {hasFix ? "Position valid" : "Detections are kept but not mapped"}
          </span>
        </article>
        <article className="telemetry-tile">
          <span className="telemetry-label">Last impact seen on device</span>
          <strong className="telemetry-axes">
            {detection
              ? `${detection.severity} · ${fixed(detection.impact_m_s2)} m/s²`
              : "None this session"}
          </strong>
          <span className="telemetry-sub">
            {detection
              ? new Date(detection.timestamp).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "Shake the sensor to trigger a detection"}
          </span>
        </article>
      </div>
    </section>
  );
}
