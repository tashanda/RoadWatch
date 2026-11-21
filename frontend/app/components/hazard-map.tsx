"use client";

import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

import type { MapHazard, Severity } from "./types";

const severityColors: Record<Severity, string> = {
  low: "#16a36a",
  medium: "#ed9636",
  high: "#e64e4e",
};

function markerIcon(severity: Severity, source: MapHazard["source"]) {
  return L.divIcon({
    className: "roadwatch-marker-shell",
    html: `<span class="roadwatch-marker marker-${source}" style="--marker-color:${severityColors[severity]}"><span></span></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -13],
  });
}

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function HazardMap({ events }: { events: MapHazard[] }) {
  return (
    <MapContainer
      center={[27.9506, -82.4572]}
      zoom={13}
      scrollWheelZoom
      className="h-full min-h-[420px] w-full rounded-2xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {events.map((event) => (
        <Marker
          key={event.id}
          position={[event.latitude, event.longitude]}
          icon={markerIcon(event.severity, event.source)}
        >
          <Popup>
            <div className="min-w-40 space-y-1 text-sm">
              <p className="font-semibold capitalize">
                {event.event_type.replaceAll("_", " ")}
              </p>
              <p className="font-medium">
                {event.source === "community" ? "Community photo report" : "Sensor detection"}
              </p>
              {event.photo_url && (
                <img
                  alt="Community pothole report"
                  className="max-h-36 w-full rounded object-cover"
                  src={event.photo_url}
                />
              )}
              {event.description && <p>{event.description}</p>}
              <p className="capitalize">Severity: {event.severity}</p>
              <p>
                {event.latitude.toFixed(5)}, {event.longitude.toFixed(5)}
              </p>
              <p>{formatTimestamp(event.timestamp)}</p>
              {event.status && <p>Status: {event.status}</p>}
              {event.detection_source && <p>Detection source: ESP32 sensor</p>}
              {event.impact_magnitude !== undefined && event.impact_magnitude !== null && (
                <p>Impact magnitude: {event.impact_magnitude.toFixed(2)} m/s²</p>
              )}
              {event.sensor_summary && <p>{event.sensor_summary}</p>}
              {event.simulated && (
                <p className="font-medium text-amber-700">Simulated example</p>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
