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

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_ROADWATCH_API_URL ??
    "http://127.0.0.1:8000"
).replace(/\/$/, "");

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
        fetch(`${apiBaseUrl}/api/events?limit=500`, requestOptions),
        fetch(`${apiBaseUrl}/api/reports?limit=500`, requestOptions),
        fetch(`${apiBaseUrl}/api/device-events?limit=500`, requestOptions),
      ]);
      const failedResponse = [eventsResponse, reportsResponse, deviceEventsResponse].find(
        (response) => !response.ok,
      );
      if (failedResponse) {
        throw new Error(`The road hazards service returned HTTP ${failedResponse.status}.`);
      }
      const [eventsResult, reportsResult, deviceEventsResult] = (await Promise.all([
        eventsResponse.json(),
        reportsResponse.json(),
        deviceEventsResponse.json(),
      ])) as [EventListResponse, CommunityReportListResponse, DeviceEventListResponse];
      const sensorHazards: MapHazard[] = eventsResult.items.map((event) => ({
        ...event,
        id: `event-${event.id}`,
        source: "sensor",
      }));
      const reportHazards: MapHazard[] = reportsResult.items.map((report) => ({
        id: `report-${report.id}`,
        latitude: report.latitude,
        longitude: report.longitude,
        severity: report.severity,
        timestamp: report.created_at,
        event_type: "pothole",
        simulated: false,
        source: "community",
        description: report.description,
        photo_url: report.photo_url.startsWith("http")
          ? report.photo_url
          : `${apiBaseUrl}${report.photo_url}`,
        status: report.status,
      }));
      const deviceHazards: MapHazard[] = deviceEventsResult.items.flatMap((event) => {
        if (
          event.latitude === null ||
          event.longitude === null ||
          event.severity === null ||
          event.event_type === null
        ) {
          return [];
        }
        return [{
          id: `device-${event.event_id}`,
          latitude: event.latitude,
          longitude: event.longitude,
          severity: event.severity,
          timestamp: event.timestamp,
          event_type: event.event_type,
          simulated: false,
          source: "sensor",
          sensor_summary: event.sensor_summary,
        }];
      });
      setHazards([...reportHazards, ...sensorHazards, ...deviceHazards]);
      setError("");
      setLastUpdated(new Date());
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") {
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load road events.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshEvents(controller.signal);
    const interval = window.setInterval(() => {
      void refreshEvents();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshEvents]);

  const visibleHazards = useMemo(
    () =>
      hazards.filter((hazard) => {
        const matchesSeverity = filter === "all" || hazard.severity === filter;
        const matchesSource = sourceFilter === "all" || hazard.source === sourceFilter;
        return matchesSeverity && matchesSource;
      }),
    [filter, hazards, sourceFilter],
  );
  const potholes = hazards.filter((hazard) => hazard.event_type === "pothole");
  const highSeverity = hazards.filter((hazard) => hazard.severity === "high");
  const recentEvents = hazards.filter(
    (hazard) => Date.now() - new Date(hazard.timestamp).getTime() < 86_400_000,
  );
  const simulatedCount = hazards.filter((hazard) => hazard.simulated).length;
  const communityCount = hazards.filter((hazard) => hazard.source === "community").length;

  async function clearSimulatedEvents() {
    if (simulatedCount === 0 || clearing) return;
    if (!window.confirm(`Clear ${simulatedCount} simulated detections?`)) return;
    setClearing(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/events/simulated`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Could not clear simulated data (HTTP ${response.status}).`);
      }
      await refreshEvents();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not clear simulated data.",
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="RoadWatch home">
          <span className="brand-mark">
            <Waves size={21} strokeWidth={2.5} />
          </span>
          <span>roadwatch<span className="brand-period">.</span></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-link nav-link-active" href="#overview">
            <Activity size={18} />
            <span>Overview</span>
          </a>
          <a className="nav-link" href="#live-map">
            <MapPin size={18} />
            <span>Live map</span>
          </a>
          <a className="nav-link" href="#drive-mode">
            <Radio size={18} />
            <span>Drive mode</span>
          </a>
          <a className="nav-link" href="#detections">
            <Clock3 size={18} />
            <span>Detections</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sensor-card">
            <span className="sensor-icon"><Radio size={17} /></span>
            <div>
              <p className="sensor-title">Road network</p>
              <p className="sensor-caption">
                <span className={error ? "offline-dot" : "online-dot"} />
                {loading ? "Connecting…" : error ? "API offline" : "API connected"}
              </p>
            </div>
          </div>
          <p className="sidebar-footnote">BUILDING SAFER STREETS<br />ONE SIGNAL AT A TIME</p>
        </div>
      </aside>

      <section className="dashboard-main" id="overview">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> Overview</div>
          <div className="topbar-right">
            <span className="live-status">
              <span className={error ? "offline-dot" : "online-dot"} />
              {error ? "Connection issue" : "Live updates"}
            </span>
            <span className="avatar" aria-label="RoadWatch">R</span>
          </div>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> ROAD CONDITIONS, AT A GLANCE</div>
              <h1>Your streets, <span>in focus.</span></h1>
              <p className="welcome-copy">
                A live look at road hazards reported by the RoadWatch community.
              </p>
            </div>
            <div className="welcome-actions">
              <button className="report-open-button" onClick={() => setReportOpen(true)} type="button">
                <Plus size={17} /> Report a pothole
              </button>
              <button className="refresh-button" onClick={() => void refreshEvents()} type="button">
                <RefreshCw size={15} />
                Refresh data
              </button>
            </div>
          </section>

          <section className="stats-grid" aria-label="Detection statistics">
            <article className="stat-card">
              <div className="stat-top"><span>Total potholes</span><span className="stat-icon stat-icon-green"><MapPin size={17} /></span></div>
              <div className="stat-value">{loading ? "—" : potholes.length}</div>
              <div className="stat-foot"><span className="trend-neutral"><ArrowUpRight size={14} /> All time</span><span>in monitored area</span></div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>High-severity hazards</span><span className="stat-icon stat-icon-red"><AlertTriangle size={17} /></span></div>
              <div className="stat-value">{loading ? "—" : highSeverity.length}</div>
              <div className="stat-foot"><span className="trend-alert"><ArrowUpRight size={14} /> Needs attention</span><span>across all event types</span></div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Recent detections</span><span className="stat-icon stat-icon-amber"><Clock3 size={17} /></span></div>
              <div className="stat-value">{loading ? "—" : recentEvents.length}</div>
              <div className="stat-foot"><span className="trend-neutral"><ArrowDownRight size={14} /> Last 24 hours</span><span>all sources</span></div>
            </article>
          </section>

          {simulatedCount > 0 && (
            <div className="simulation-banner">
              <span className="simulation-badge">DEMO DATA</span>
              <p><strong>{simulatedCount} simulated detections</strong> are shown for development. They are fictional examples, not verified potholes.</p>
              <button onClick={() => void clearSimulatedEvents()} disabled={clearing} type="button">
                {clearing ? "Clearing…" : "Clear demo data"}
              </button>
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={17} />
              <div><strong>Couldn’t refresh road hazards.</strong> {error} Check that the FastAPI backend is running.</div>
              <button onClick={() => void refreshEvents()} type="button">Retry</button>
            </div>
          )}

          <DriveMode hazards={hazards} />

          <section className="map-panel" id="live-map">
            <div className="panel-heading map-heading">
              <div>
                <div className="panel-title-row"><h2>Hazard map</h2><span className="map-live-tag"><span className="online-dot" /> LIVE</span></div>
                <p>Explore reported road conditions around Tampa, Florida</p>
              </div>
              <div className="map-meta"><span><MapPin size={14} /> Tampa, FL</span><span className="meta-divider" /><span>Updated {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</span></div>
            </div>
            <div className="map-layout">
              <div className="map-canvas">
                <HazardMap events={visibleHazards} />
                {loading && <div className="map-overlay"><span className="loading-spinner" /> Loading detections…</div>}
                {!loading && visibleHazards.length === 0 && !error && (
                  <div className="map-overlay map-empty"><MapPin size={22} /><strong>No detections in this view</strong><span>Seed development data or check back later.</span></div>
                )}
              </div>
              <div className="map-legend">
                <span className="legend-title">SOURCE / SEVERITY</span>
                <span><i className="legend-source community" /> Community</span>
                <span><i className="legend-source sensor" /> Sensor</span>
                <span><i className="legend-dot low" /> Low</span>
                <span><i className="legend-dot medium" /> Medium</span>
                <span><i className="legend-dot high" /> High</span>
              </div>
            </div>
          </section>

          <section className="detections-panel" id="detections">
            <div className="panel-heading detections-heading">
              <div>
                <h2>Recent hazards <span className="count-pill">{visibleHazards.length}</span></h2>
                <p>{communityCount} community photo reports · sensor detections shown separately</p>
              </div>
              <div className="filter-groups">
                <div className="filter-control"><Filter size={15} /><span>Source</span>
                  <div className="filter-options" role="group" aria-label="Filter by hazard source">
                    {sourceFilters.map((option) => (
                      <button
                        aria-pressed={sourceFilter === option.value}
                        className={sourceFilter === option.value ? "filter-active" : ""}
                        key={option.value}
                        onClick={() => setSourceFilter(option.value)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="filter-control"><span>Severity</span>
                  <div className="filter-options" role="group" aria-label="Filter by severity">
                  {filters.map((option) => (
                    <button
                      aria-pressed={filter === option.value}
                      className={filter === option.value ? "filter-active" : ""}
                      key={option.value}
                      onClick={() => setFilter(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="detection-list">
              {loading ? (
                <div className="list-message"><span className="loading-spinner" /> Loading recent detections…</div>
              ) : visibleHazards.length === 0 ? (
                <div className="list-message">No detections match this filter.</div>
              ) : (
                visibleHazards.slice(0, 8).map((event) => (
                  <article className="detection-row" key={event.id}>
                    <span className={`event-marker ${severityClass(event.severity)}`}><MapPin size={17} /></span>
                    <div className="event-main">
                      <div className="event-name">
                        {event.event_type.replaceAll("_", " ")}
                        <span className={event.source === "community" ? "community-tag" : "sensor-tag"}>
                          {event.source === "community" ? "COMMUNITY" : "SENSOR"}
                        </span>
                        {event.simulated && <span className="simulated-tag">SIMULATED</span>}
                      </div>
                      <div className="event-coords">{formatCoordinates(event.latitude, event.longitude)}</div>
                      {event.description && <div className="event-description">{event.description}</div>}
                    </div>
                    <span className={`severity-pill ${severityClass(event.severity)}`}>
                      {event.status ? `${event.severity} · ${event.status}` : event.severity}
                    </span>
                    <div className="event-time"><strong>{relativeTime(event.timestamp)}</strong><span>{formatTimestamp(event.timestamp)}</span></div>
                  </article>
                ))
              )}
            </div>
            {visibleHazards.length > 8 && (
              <div className="list-footer">Showing 8 of {visibleHazards.length} hazards</div>
            )}
          </section>

          <footer className="dashboard-footer">
            <span><ShieldCheck size={15} /> RoadWatch Community Intelligence</span>
            <span>{error ? "Backend disconnected" : "Auto-refreshes every 5 seconds"}</span>
          </footer>
        </div>
      </section>
      {reportOpen && (
        <ReportForm
          apiBaseUrl={apiBaseUrl}
          onClose={() => setReportOpen(false)}
          onSubmitted={() => void refreshEvents()}
        />
      )}
    </main>
  );
}
