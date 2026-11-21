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
