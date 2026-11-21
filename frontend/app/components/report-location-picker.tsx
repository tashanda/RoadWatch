"use client";

import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useEffect } from "react";

type Coordinates = { latitude: number; longitude: number };

function MapClick({ onSelect }: { onSelect: (point: Coordinates) => void }) {
  useMapEvents({
    click(event) {
      onSelect({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      });
    },
  });
  return null;
}

function Recenter({ center }: { center: Coordinates }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.latitude, center.longitude], map.getZoom());
  }, [center, map]);
  return null;
}

export function ReportLocationPicker({
  location,
  center,
  onSelect,
}: {
  location: Coordinates | null;
  center: Coordinates;
  onSelect: (point: Coordinates) => void;
}) {
  return (
    <div className="report-location-map" aria-label="Select pothole location on map">
      <MapContainer
        center={[center.latitude, center.longitude]}
        zoom={14}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClick onSelect={onSelect} />
        <Recenter center={center} />
        {location && (
          <Marker
            position={[location.latitude, location.longitude]}
            draggable
            eventHandlers={{
              dragend(event: L.DragEndEvent) {
                const point = event.target.getLatLng();
                onSelect({ latitude: point.lat, longitude: point.lng });
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
