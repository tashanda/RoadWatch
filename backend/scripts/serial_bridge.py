#!/usr/bin/env python3
"""Stream live ESP32 sensor telemetry from USB serial to the RoadWatch frontend.

The firmware (built with ROADWATCH_DETECTOR_DEBUG=1) prints one JSON sample
about every 100 ms with accelerometer, gyroscope, orientation, jerk, vibration
RMS, calibration, and GPS values, plus one JSON line per pothole detection.
This script reads those lines continuously and, once per second, POSTs the
latest sample and the peaks since the previous post to /api/telemetry. The
dashboard polls that endpoint to show live measurements.

Pothole detections are NOT uploaded by default because the ESP32 already
uploads them itself over Wi-Fi; sending them again would create duplicates.
Use --forward-events only when the board has no Wi-Fi: each detection is then
held for 20 seconds and uploaded only if the ESP32's own copy has not arrived.

Setup:   python3 -m venv backend/.venv && backend/.venv/bin/pip install pyserial
Run:     ROADWATCH_DEVICE_TOKEN=... backend/.venv/bin/python \
             backend/scripts/serial_bridge.py --url https://your-app.vercel.app
Options: --port /dev/cu.usbserial-0001  --interval 1  --forward-events  --dry-run

Close `pio device monitor` first; only one program can hold the serial port.
"""

import argparse
import json
import math
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("pyserial is missing. Install it with: pip install pyserial")

DEVICE_ID = "roadwatch-esp32-01"
SEVERITIES = {"low", "medium", "high"}
GPS_MAX_AGE_SECONDS = 5
MAX_LINE_CHARS = 2000
FORWARD_DELAY_SECONDS = 20
FORWARD_MATCH_SECONDS = 15

# Arduino prints non-finite floats as nan/inf/ovf, which is not valid JSON.
NONFINITE = re.compile(r"(?<=[:\[,])\s*-?(?:nan|inf(?:inity)?|ovf)\s*(?=[,\]}])", re.I)
RAW_ACCEL = re.compile(r"RAW_ACCEL: X=(\S+) Y=(\S+) Z=(\S+)")
NOISY_PREFIXES = ("RAW_ACCEL", "WIFI_STATUS", "WIFI_IP")


def number(value, max_abs):
    """Return a finite float within +/-max_abs, or None for anything else."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        value = float(value)
    except OverflowError:
        return None
    return value if math.isfinite(value) and abs(value) <= max_abs else None


def vector(value, max_abs):
    if not isinstance(value, list) or len(value) != 3:
        return None
    return [number(item, max_abs) for item in value]


def flag(value):
    return value if isinstance(value, bool) else None


def level(value):
    """BNO055 calibration level, 0 (uncalibrated) to 3 (fully calibrated)."""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 0 <= value <= 3 else None


def parse_json_line(line):
    """Parse one serial line as a JSON object; return None if it is malformed."""
    start = line.find("{")
    if start < 0:
        return None
    try:
        data = json.loads(
            NONFINITE.sub("null", line[start:]), parse_constant=lambda _: None
        )
    except (ValueError, RecursionError):
        return None
    return data if isinstance(data, dict) else None


def parse_raw_accel(line):
    match = RAW_ACCEL.search(line)
    if not match:
        return None
    values = []
    for text in match.groups():
        try:
            values.append(number(float(text), 200))
        except ValueError:
            values.append(None)
    return values


def utc_now():
    return datetime.now(timezone.utc)


class Telemetry:
    """Latest sensor values plus the peaks seen since the last upload."""

    PEAK_LIMITS = {
        "vertical_accel_m_s2": 200,
        "jerk_m_s3": 100_000,
        "vibration_rms_m_s2": 200,
    }

    def __init__(self):
        self.latest = {}
        self.raw_accel = None
        self.peak = dict.fromkeys(self.PEAK_LIMITS)
        self.samples = 0
        self.malformed = 0
        self.last_fix = None  # (latitude, longitude, monotonic time)
        self.last_detection = None

    def add_sample(self, data):
        latitude = number(data.get("latitude"), 90)
        longitude = number(data.get("longitude"), 180)
        gps_valid = flag(data.get("gps_valid"))
        if gps_valid and latitude is not None and longitude is not None:
            self.last_fix = (latitude, longitude, time.monotonic())
        else:
            latitude = longitude = None
        self.latest = {
            "imu_valid": flag(data.get("imu_valid")),
            "orientation_valid": flag(data.get("orientation_valid")),
            "gps_valid": gps_valid,
            "calibration": {
                "system": level(data.get("calibration_system")),
                "accel": level(data.get("calibration_accel")),
                "gyro": level(data.get("calibration_gyro")),
                "mag": level(data.get("calibration_mag")),
            },
            "linear_accel_m_s2": vector(data.get("linear_accel_sensor_m_s2"), 200),
            "gyro_rad_s": vector(data.get("gyro_rad_s"), 100),
            "orientation_deg": vector(data.get("orientation_deg"), 360),
            "latitude": latitude,
            "longitude": longitude,
        }
        for key, limit in self.PEAK_LIMITS.items():
            value = number(data.get(key), limit)
            self.latest[key] = value
            if value is not None and (
                self.peak[key] is None or abs(value) > abs(self.peak[key])
            ):
                self.peak[key] = value
        self.samples += 1

    def add_raw_accel(self, values):
        self.raw_accel = values
        self.samples += 1

    def recent_fix(self):
        if self.last_fix and time.monotonic() - self.last_fix[2] < GPS_MAX_AGE_SECONDS:
            return self.last_fix[0], self.last_fix[1]
        return None

    def take_payload(self):
        """Build the upload body and start a new peak window."""
        payload = {
            "device_id": DEVICE_ID,
            **self.latest,
            "raw_accel_m_s2": self.raw_accel,
            "peak": self.peak,
            "samples_in_window": self.samples,
            "malformed_lines": self.malformed,
            "last_detection": self.last_detection,
        }
        self.peak = dict.fromkeys(self.PEAK_LIMITS)
        self.samples = 0
        return payload


def http_json(method, url, token=None, body=None):
    """Return (status, parsed JSON or None). Status 0 means the request failed."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Device-Token"] = token
    request = urllib.request.Request(
        url,
        data=None if body is None else json.dumps(body, allow_nan=False).encode(),
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status, text = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, text = error.code, error.read()
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return 0, str(error)
    try:
        return status, json.loads(text)
    except ValueError:
        return status, None


def already_uploaded(base_url, detected_at):
    """True if the ESP32's own Wi-Fi upload of this detection is on the server.

    Returns None when the server could not be checked.
    """
    status, body = http_json("GET", f"{base_url}/api/device-events?limit=50")
    if status != 200 or not isinstance(body, dict):
        return None
    for item in body.get("items") or []:
        if not isinstance(item, dict) or item.get("device_id") != DEVICE_ID:
            continue
        try:
            uploaded_at = datetime.fromisoformat(
                str(item.get("timestamp")).replace("Z", "+00:00")
            )
            if abs((uploaded_at - detected_at).total_seconds()) <= FORWARD_MATCH_SECONDS:
                return True
        except (ValueError, TypeError):
            continue
    return False


def uploader(base_url, token, outbox, pending, dry_run):
    """Background thread: uploads telemetry and (optionally) held detections."""
    last_status = None
    while True:
        try:
            payload = outbox.get(timeout=1)
        except queue.Empty:
            payload = None
        if payload is not None:
            if dry_run:
                print(f"telemetry (dry run): {json.dumps(payload)}")
            else:
                status, body = http_json(
                    "POST", f"{base_url}/api/telemetry", token, payload
                )
                if status != last_status:
                    detail = "" if status == 202 else f" {body}"
                    print(f"telemetry upload: HTTP {status or 'failed'}{detail}"[:300])
                    last_status = status

        while pending and pending[0][0] <= time.monotonic():
            _, detected_at, event = pending.pop(0)
            if dry_run:
                print(f"detection (dry run, not sent): {json.dumps(event)}")
                continue
            found = already_uploaded(base_url, detected_at)
            if found:
                print("detection already uploaded by the ESP32; not sending a duplicate")
            elif found is None:
                print("could not check for the ESP32's upload; skipping to avoid a duplicate")
            else:
                status, body = http_json(
                    "POST", f"{base_url}/api/device-events", token, event
                )
                print(f"detection forwarded: HTTP {status or 'failed'}"
                      + ("" if status == 202 else f" {body}")[:300])


def find_port():
    ports = [p.device for p in list_ports.comports()]
    usb = [p for p in ports if "usbserial" in p or "usbmodem" in p or "ttyUSB" in p]
    if len(usb) == 1:
        return usb[0]
    found = ", ".join(usb or ports) or "none"
    sys.exit(f"Could not pick a serial port automatically (found: {found}). Use --port.")


def open_serial(port, baud):
    connection = serial.Serial()
    connection.port = port
    connection.baudrate = baud
    connection.timeout = 1
    # Keep DTR/RTS low so opening the port is less likely to reset the ESP32.
    connection.dtr = False
    connection.rts = False
    connection.open()
    return connection


def build_event(data, telemetry, detected_at):
    impact = number(data.get("impact_m_s2"), 200)
    severity = data.get("severity")
    event = {
        "event_id": str(uuid.uuid4()),
        "device_id": DEVICE_ID,
        "timestamp": detected_at.isoformat(),
        "sensor_summary": f"possible_pothole impact={impact}m/s2 via serial bridge",
        "source": "esp32_sensor",
        "status": "unverified",
    }
    if severity in SEVERITIES:
        event["severity"] = severity
        event["event_type"] = "pothole"
    if impact is not None and impact >= 0:
        event["impact_magnitude"] = impact
    fix = telemetry.recent_fix()
    if fix:
        event["latitude"], event["longitude"] = fix
    return event


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", help="serial port (auto-detected if omitted)")
    parser.add_argument("--baud", type=int, default=460800)
    parser.add_argument(
        "--url",
        default=os.getenv("ROADWATCH_FRONTEND_URL", "http://localhost:3000"),
        help="frontend origin (default: %(default)s)",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("ROADWATCH_DEVICE_TOKEN", ""),
        help="device token (default: $ROADWATCH_DEVICE_TOKEN)",
    )
    parser.add_argument(
        "--interval", type=float, default=1.0,
        help="seconds between telemetry uploads (default: %(default)s)",
    )
    parser.add_argument(
        "--forward-events", action="store_true",
        help="upload detections the ESP32 did not upload itself (see module help)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="print uploads without sending them"
    )
    args = parser.parse_args()
    if not args.token and not args.dry_run:
        sys.exit("Set ROADWATCH_DEVICE_TOKEN or pass --token (or use --dry-run).")
    interval = max(0.2, args.interval)
    base_url = args.url.rstrip("/")

    port = args.port or find_port()
    print(f"Reading {port} at {args.baud} baud; sending telemetry to {base_url}")

    telemetry = Telemetry()
    outbox = queue.Queue(maxsize=1)
    pending = []  # (due monotonic time, detection time, event), oldest first
    threading.Thread(
        target=uploader,
        args=(base_url, args.token, outbox, pending, args.dry_run),
        daemon=True,
    ).start()

    connection = None
    next_upload = time.monotonic() + interval
    while True:
        try:
            if connection is None:
                connection = open_serial(port, args.baud)
                print(f"Serial connected on {port}")
            raw = connection.readline()
        except (serial.SerialException, OSError) as error:
            print(f"Serial error ({error}); retrying in 2s")
            if connection is not None:
                try:
                    connection.close()
                except (serial.SerialException, OSError):
                    pass
                connection = None
            time.sleep(2)
            continue

        line = raw.decode("utf-8", errors="replace").strip()[:MAX_LINE_CHARS]
        if line:
            handle_line(line, telemetry, pending, args.forward_events)

        now = time.monotonic()
        if now >= next_upload:
            next_upload = now + interval
            if telemetry.samples > 0:  # stay silent when the board is quiet
                payload = telemetry.take_payload()
                try:
                    outbox.get_nowait()  # drop an unsent older snapshot
                except queue.Empty:
                    pass
                outbox.put(payload)


def handle_line(line, telemetry, pending, forward_events):
    raw_accel = parse_raw_accel(line)
    if raw_accel is not None and "{" not in line:
        telemetry.add_raw_accel(raw_accel)
        return
    if "{" not in line and "}" not in line and '":' not in line:
        # Show firmware status lines such as [net] ...; hide boot-time noise.
        if line.isascii() and line.isprintable() and not line.startswith(NOISY_PREFIXES):
            print(line[:200])
        return

    data = parse_json_line(line)
    if data is None:
        telemetry.malformed += 1  # partial or interleaved serial output
        return

    if "candidate" in data:
        detected_at = utc_now()
        severity = data.get("severity") if data.get("severity") in SEVERITIES else None
        impact = number(data.get("impact_m_s2"), 200)
        if severity:
            telemetry.last_detection = {
                "timestamp": detected_at.isoformat(),
                "severity": severity,
                "impact_m_s2": impact,
            }
        print(f"-> pothole detected: severity={severity} impact={impact} m/s2")
        if forward_events:
            pending.append((
                time.monotonic() + FORWARD_DELAY_SECONDS,
                detected_at,
                build_event(data, telemetry, detected_at),
            ))
    elif "vertical_accel_m_s2" in data or "timestamp_ms" in data:
        telemetry.add_sample(data)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
