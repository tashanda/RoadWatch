"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Filter,
  MapPin,
  Radio,
  Plus,
  RefreshCw,
  ShieldCheck,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DriveMode } from "./drive-mode";
import { ReportForm } from "./report-form";
import type {
  CommunityReportListResponse,
  DeviceEventListResponse,
  EventListResponse,
  MapHazard,
  SeverityFilter,
} from "./types";

const HazardMap = dynamic(
  () => import("./hazard-map").then((module) => module.HazardMap),
  { ssr: false, loading: () => <div className="map-loading">Loading map…</div> },
);

const filters: { label: string; value: SeverityFilter }[] = [
  { label: "All events", value: "all" },
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
];

const sourceFilters = [
  { label: "All hazards", value: "all" },
  { label: "Community reports", value: "community" },
  { label: "Sensor detections", value: "sensor" },
] as const;

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeTime(timestamp: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function severityClass(severity: MapHazard["severity"]) {
  return `severity-${severity}`;
}

function formatCoordinates(latitude: number, longitude: number) {
  const latHemisphere = latitude < 0 ? "S" : "N";
  const lonHemisphere = longitude < 0 ? "W" : "E";
  return `${Math.abs(latitude).toFixed(5)}° ${latHemisphere}, ${Math.abs(longitude).toFixed(5)}° ${lonHemisphere}`;
}

export function RoadWatchDashboard() {
  const [hazards, setHazards] = useState<MapHazard[]>([]);
  const [unlocatedEvents, setUnlocatedEvents] = useState<DeviceEventListResponse["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<(typeof sourceFilters)[number]["value"]>("all");
  const [clearing, setClearing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const refreshEvents = useCallback(async (signal?: AbortSignal) => {
    try {
      const requestOptions = { cache: "no-store" as RequestCache, signal };
      const [eventsResponse, reportsResponse, deviceEventsResponse] = await Promise.all([
        fetch("/api/events?limit=500", requestOptions),
        fetch("/api/reports?limit=500", requestOptions),
        fetch("/api/device-events?limit=500", requestOptions),