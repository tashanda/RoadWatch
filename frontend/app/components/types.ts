export type Severity = "low" | "medium" | "high";
export type SeverityFilter = "all" | Severity;

export type RoadEvent = {
  id: number;
  latitude: number;
  longitude: number;
  severity: Severity;
  timestamp: string;
  event_type: "pothole" | "speed_bump" | "rough_road";
  simulated: boolean;
};

export type CommunityReport = {
  id: string;
  latitude: number;
  longitude: number;
  severity: Severity;
  description: string | null;
  photo_url: string;
  created_at: string;
  source: "community";
  status: "unverified";
};

export type DeviceEvent = {
  event_id: string;
  device_id: string;
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
  sensor_summary: string;
  severity: Severity | null;
  event_type: RoadEvent["event_type"] | null;
  impact_magnitude: number | null;
  source: "esp32_sensor";
  status: "unverified";
  received_at: string;
};

export type MapHazard = {
  id: string;
  latitude: number;
  longitude: number;
  severity: Severity;
  timestamp: string;
  event_type: RoadEvent["event_type"];
  simulated: boolean;
  source: "community" | "sensor";
  description?: string | null;
  photo_url?: string;
  status?: "unverified";
  sensor_summary?: string;
  impact_magnitude?: number | null;
  detection_source?: "esp32_sensor";
};

// A hazard for counters and lists. Sensor detections made without a GPS fix
// have null coordinates and are never placed on the map.
export type Hazard = Omit<MapHazard, "latitude" | "longitude"> & {
  latitude: number | null;
  longitude: number | null;
};

type Vector3 = [number | null, number | null, number | null];

export type LiveTelemetry = {
  device_id: string;
  received_at: string;
  imu_valid: boolean | null;
  orientation_valid: boolean | null;
  gps_valid: boolean | null;
  calibration: {
    system: number | null;
    accel: number | null;
    gyro: number | null;
    mag: number | null;
  };
  linear_accel_m_s2: Vector3 | null;
  raw_accel_m_s2: Vector3 | null;
  gyro_rad_s: Vector3 | null;
  orientation_deg: Vector3 | null;
  vertical_accel_m_s2: number | null;
  jerk_m_s3: number | null;
  vibration_rms_m_s2: number | null;
  latitude: number | null;
  longitude: number | null;
  peak: {
    vertical_accel_m_s2: number | null;
    jerk_m_s3: number | null;
    vibration_rms_m_s2: number | null;
  };
  samples_in_window: number | null;
  malformed_lines: number | null;
  last_detection: {
    timestamp: string;
    severity: Severity;
    impact_m_s2: number | null;
  } | null;
};

export type TelemetryResponse = {
  telemetry: LiveTelemetry | null;
  server_time: string;
};

export type EventListResponse = {
  items: RoadEvent[];
  total: number;
};

export type CommunityReportListResponse = {
  items: CommunityReport[];
  total: number;
};

export type DeviceEventListResponse = {
  items: DeviceEvent[];
  total: number;
};
