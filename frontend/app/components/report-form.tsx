"use client";

import dynamic from "next/dynamic";
import { Camera, CheckCircle2, LocateFixed, MapPin, Upload, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

const ReportLocationPicker = dynamic(
  () =>
    import("./report-location-picker").then((module) => module.ReportLocationPicker),
  { ssr: false, loading: () => <div className="report-location-map map-loading">Loading map…</div> },
);

type Coordinates = { latitude: number; longitude: number };
type Severity = "low" | "medium" | "high";

const defaultCenter: Coordinates = { latitude: 27.9506, longitude: -82.4572 };
const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
const maximumPhotoSize = 5 * 1024 * 1024;

export function ReportForm({
  apiBaseUrl,
  onClose,
  onSubmitted,
}: {
  apiBaseUrl: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [suggestedLocation, setSuggestedLocation] = useState<Coordinates | null>(null);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [locationMessage, setLocationMessage] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const libraryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function choosePhoto(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!allowedTypes.includes(file.type)) {
      setPhoto(null);
      setError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > maximumPhotoSize) {
      setPhoto(null);
      setError("Photo must be 5 MB or smaller.");
      return;
    }
    setPhoto(file);
  }

  function suggestCurrentLocation() {
    setLocationMessage("");
    if (!navigator.geolocation) {
      setLocationMessage("Location is unavailable in this browser. Place the pin manually.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const suggested = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setSuggestedLocation(suggested);
        setMapCenter(suggested);
        setLocationMessage(
          "GPS suggestion found. Confirm it as the pothole pin or choose the pothole directly on the map.",
        );
      },
      () => {
        setLocationMessage(
          "Location permission was not available. Tap the map to place the pothole pin.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!photo) {
      setError("Add a pothole photo before submitting.");
      return;
    }
    if (!location) {
      setError("Select the pothole location by placing the pin on the map.");
      return;
    }

    const payload = new FormData();
    payload.set("photo", photo);
    payload.set("latitude", String(location.latitude));
    payload.set("longitude", String(location.longitude));
    payload.set("severity", severity);
    payload.set("description", description);
    setSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/reports`, {
        method: "POST",
        body: payload,
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as
          | { detail?: unknown }
          | null;
        const message =
          typeof result?.detail === "string"
            ? result.detail
            : `Report submission failed (HTTP ${response.status}).`;
        throw new Error(message);
      }
      setSubmitted(true);
      onSubmitted();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not submit this report.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="report-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onClose();
    }}>
      <section
        aria-labelledby="report-form-title"
        aria-modal="true"
        className="report-modal"
        role="dialog"
      >
        <header className="report-modal-header">
          <div>
            <span className="report-kicker">COMMUNITY REPORT</span>
            <h2 id="report-form-title">Report a pothole</h2>
          </div>
          <button
            aria-label="Close report form"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={19} />
          </button>
        </header>

        {submitted ? (
          <div className="report-success" role="status">
            <CheckCircle2 size={40} />
            <h3>Thanks for looking out.</h3>
            <p>Your photo report is on the map as an unverified community report.</p>
            <button className="report-submit-button" onClick={onClose} type="button">
              Done
            </button>
          </div>
        ) : (
          <form className="report-form" onSubmit={(event) => void submitReport(event)}>
            <div className="report-field">
              <span className="report-label">Pothole photo <span>JPG, PNG, WebP · up to 5 MB</span></span>
              <div className="photo-actions">
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="visually-hidden"
                  onChange={(event) => {
                    choosePhoto(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                  ref={libraryInput}
                  type="file"
                />
                <input
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="visually-hidden"
                  onChange={(event) => {
                    choosePhoto(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                  ref={cameraInput}
                  type="file"
                />
                <button className="photo-action" onClick={() => cameraInput.current?.click()} type="button">
                  <Camera size={17} /> Take photo
                </button>
                <button className="photo-action" onClick={() => libraryInput.current?.click()} type="button">
                  <Upload size={16} /> Choose photo
                </button>
              </div>
              {previewUrl && (
                <figure className="photo-preview">
                  <img alt="Preview of selected pothole" src={previewUrl} />
                  <button
                    aria-label="Remove selected photo"
                    className="icon-button photo-remove"
                    onClick={() => setPhoto(null)}
                    type="button"
                  >
                    <X size={16} />
                  </button>
                </figure>
              )}
            </div>

            <div className="report-field">
              <div className="report-label">
                <span>Pothole location</span>
                <button className="location-suggest-button" onClick={suggestCurrentLocation} type="button">
                  <LocateFixed size={15} /> Suggest my location
                </button>
              </div>
              <p className="report-hint">
                Phone GPS is only a starting point. Tap the map or drag the pin to the pothole.
              </p>
              <ReportLocationPicker
                center={mapCenter}
                location={location}
                onSelect={(point) => {
                  setLocation(point);
                  setMapCenter(point);
                  setLocationMessage("");
                }}
              />
              {location ? (
                <p className="picked-coordinates">
                  <MapPin size={14} /> Pin: {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                </p>
              ) : (
                <p className="picked-coordinates">Tap the map to choose the pothole location.</p>
              )}
              {suggestedLocation && (
                <button
                  className="location-suggest-button"
                  onClick={() => {
                    setLocation(suggestedLocation);
                    setLocationMessage(
                      "GPS suggestion selected. Adjust the pin if the pothole is elsewhere.",
                    );
                  }}
                  type="button"
                >
                  <LocateFixed size={14} /> Use phone GPS suggestion as pin
                </button>
              )}
              {locationMessage && <p className="report-hint" role="status">{locationMessage}</p>}
            </div>

            <div className="report-field">
              <span className="report-label">Severity</span>
              <div aria-label="Pothole severity" className="severity-choice" role="group">
                {(["low", "medium", "high"] as const).map((value) => (
                  <button
                    aria-pressed={severity === value}
                    className={severity === value ? `severity-choice-active severity-${value}` : ""}
                    key={value}
                    onClick={() => setSeverity(value)}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <label className="report-field" htmlFor="report-description">
              <span className="report-label">Description <span>Optional</span></span>
              <textarea
                id="report-description"
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Add nearby landmarks or details that could help others."
                rows={3}
                value={description}
              />
              <span className="character-count">{description.length}/500</span>
            </label>

            {error && <p className="report-error" role="alert">{error}</p>}
            <button className="report-submit-button" disabled={submitting} type="submit">
              {submitting ? "Uploading photo and saving report…" : "Submit pothole report"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
