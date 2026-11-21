"use client";

import { AlertTriangle, Bell, BellOff, Navigation, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  haversineMeters,
  initialBearingDegrees,
  pointAtDistance,
  shouldAlertForHazard,
} from "./geo.mjs";
import type { MapHazard } from "./types";

type Position = {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
};

const MAX_GPS_ACCURACY_METERS = 35;
const ALERT_COOLDOWN_MS = 90_000;

export function DriveMode({ hazards }: { hazards: MapHazard[] }) {
  const [active, setActive] = useState(false);
  const [simulation, setSimulation] = useState(false);
  const [visualAlerts, setVisualAlerts] = useState(true);
  const [audioAlerts, setAudioAlerts] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [alertDistance, setAlertDistance] = useState(200);
  const [positionMessage, setPositionMessage] = useState("Drive Mode is off.");
  const [lastAlert, setLastAlert] = useState<MapHazard | null>(null);
  const [pageVisible, setPageVisible] = useState(false);
  const watchId = useRef<number | null>(null);
  const previousDistances = useRef(new Map<string, number>());
  const cooldowns = useRef(new Map<string, number>());
  const simulationDistance = useRef(250);

  const playableHazards = useMemo(
    () => hazards.filter((hazard) => !hazard.simulated || simulation),
    [hazards, simulation],
  );
  const audioContext = useRef<AudioContext | null>(null);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const evaluatePosition = useCallback(
    (position: Position, simulated: boolean) => {
      if (position.accuracy > MAX_GPS_ACCURACY_METERS) {
        setPositionMessage(
          `Waiting for a more accurate GPS fix (${Math.round(position.accuracy)} m accuracy).`,
        );
        return;
      }
      if (position.heading === null || !Number.isFinite(position.heading)) {
        setPositionMessage("Waiting for a valid direction of travel from GPS.");
        return;
      }

      setPositionMessage(
        simulated
          ? "Simulated route active. No location is being shared."
          : `GPS active (${Math.round(position.accuracy)} m accuracy). Keep this page open and visible.`,
      );
      for (const hazard of playableHazards) {
        const distance = haversineMeters(
          position.latitude,
          position.longitude,
          hazard.latitude,
          hazard.longitude,
        );
        const previous = previousDistances.current.get(hazard.id);
        previousDistances.current.set(hazard.id, distance);
        const bearing = initialBearingDegrees(
          position.latitude,
          position.longitude,
          hazard.latitude,
          hazard.longitude,
        );
        const lastTriggered = cooldowns.current.get(hazard.id) ?? 0;
        const cooldownElapsed = Date.now() - lastTriggered >= ALERT_COOLDOWN_MS;
        if (
          shouldAlertForHazard({
            distance,
            previousDistance: previous,
            alertDistance,
            heading: position.heading,
            bearing,
            accuracy: position.accuracy,
            cooldownElapsed,
          })
        ) {
          cooldowns.current.set(hazard.id, Date.now());
          setLastAlert(hazard);
          if (audioAlerts && audioEnabled && audioContext.current) {
            void playAlertTone(audioContext.current).catch(() => {
              setPositionMessage("Audio playback is unavailable in this browser.");
            });
          }
          setPositionMessage(
            `${hazard.severity.toUpperCase()} hazard about ${Math.round(distance)} m ahead.`,
          );
          break;
        }
      }
    },
    [alertDistance, audioAlerts, audioEnabled, playableHazards],
  );

  useEffect(() => {
    if (!active || simulation) return;
    if (!pageVisible) {
      setPositionMessage("Drive Mode pauses while this page is in the background.");
      return;
    }
    if (!navigator.geolocation) {
      setPositionMessage("This browser does not support geolocation.");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (current) => {
        evaluatePosition(
          {
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
            accuracy: current.coords.accuracy,
            heading: current.coords.heading,
          },
          false,
        );
      },
      () => setPositionMessage("Could not read GPS. Check permission and location settings."),
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 15_000 },
    );
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [active, evaluatePosition, pageVisible, simulation]);

  useEffect(() => {
    return () => {
      if (audioContext.current) void audioContext.current.close();
      audioContext.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active || !simulation) return;
    const target = playableHazards[0];
    if (!target) {
      setPositionMessage("No map hazards are available to simulate.");
      return;
    }
    simulationDistance.current = 250;
    const timer = window.setInterval(() => {
      simulationDistance.current = Math.max(15, simulationDistance.current - 20);
      const current = pointAtDistance(
        target.latitude,
        target.longitude,
        180,
        simulationDistance.current,
      );
      evaluatePosition(
        { ...current, accuracy: 5, heading: 0 },
        true,
      );
    }, 1_500);
    setPositionMessage("Starting simulated route; no real GPS is used.");
    return () => window.clearInterval(timer);
  }, [active, evaluatePosition, playableHazards, simulation]);

  function stopDriveMode() {
    setActive(false);
    setSimulation(false);
    setLastAlert(null);
    previousDistances.current.clear();
    setPositionMessage("Drive Mode is off.");
  }

  async function enableAudio() {
    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) {
        setPositionMessage("Audio alerts are not supported by this browser.");
        return;
      }
      const context = audioContext.current ?? new AudioContextConstructor();
      audioContext.current = context;
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 660;
      gain.gain.value = 0.001;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.08);
      setAudioEnabled(true);
      setAudioAlerts(true);
    } catch {
      setPositionMessage("Audio could not be enabled. Check Safari's sound settings.");
    }
  }

  return (
    <section className="drive-panel" id="drive-mode">
      <div className="drive-panel-heading">
        <div>
          <div className="panel-title-row"><h2><Navigation size={19} /> Drive Mode</h2>
            {simulation && active && <span className="simulation-badge">SIMULATION</span>}
          </div>
          <p>Optional proximity alerts using this phone’s GPS while the page is active.</p>
        </div>
        {active ? (
          <button className="drive-stop-button" onClick={stopDriveMode} type="button">
            <Square size={15} /> Stop
          </button>
        ) : (
          <div className="drive-actions">
            <button
              className="drive-start-button"
              onClick={() => {
                previousDistances.current.clear();
                setSimulation(false);
                setActive(true);
              }}
              type="button"
            >
              Start Drive Mode
            </button>
            <button
              className="drive-simulate-button"
              disabled={hazards.length === 0}
              onClick={() => {
                previousDistances.current.clear();
                setSimulation(true);
                setActive(true);
              }}
              type="button"
            >
              Simulate
            </button>
          </div>
        )}
      </div>
      <div className="drive-settings">
        <label>
          Alert range
          <select
            onChange={(event) => setAlertDistance(Number(event.target.value))}
            value={alertDistance}
          >
            <option value={100}>100 m</option>
            <option value={200}>200 m</option>
            <option value={350}>350 m</option>
            <option value={500}>500 m</option>
          </select>
        </label>
        <label className="drive-toggle">
          <input checked={visualAlerts} onChange={(event) => setVisualAlerts(event.target.checked)} type="checkbox" />
          Visual alerts
        </label>
        {audioEnabled ? (
          <label className="drive-toggle">
            <input checked={audioAlerts} onChange={(event) => setAudioAlerts(event.target.checked)} type="checkbox" />
            Audio alerts
          </label>
        ) : (
          <button className="audio-enable-button" onClick={() => void enableAudio()} type="button">
            <Volume2 size={15} /> Enable audio
          </button>
        )}
      </div>
      <p className="drive-status" role="status">{positionMessage}</p>
      {visualAlerts && active && lastAlert && (
        <div className="drive-alert" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>{lastAlert.severity} hazard ahead</strong>
            <span>{lastAlert.source === "community" ? "Community report" : "Sensor detection"} · use caution; unverified reports may be inaccurate.</span>
          </div>
          <button aria-label="Dismiss alert" onClick={() => setLastAlert(null)} type="button">
            <BellOff size={16} />
          </button>
        </div>
      )}
      <p className="drive-disclaimer">
        Alerts are estimates, not guaranteed detection or driving-safety advice. iPhone Safari can pause GPS and audio when the page is backgrounded or the screen locks. Use only while parked or with a passenger operating the phone.
      </p>
      {active && <span className="drive-active-indicator"><Bell size={13} /> Monitoring nearby map hazards</span>}
    </section>
  );
}

async function playAlertTone(context: AudioContext) {
  await context.resume();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 740;
  gain.gain.value = 0.12;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
}
