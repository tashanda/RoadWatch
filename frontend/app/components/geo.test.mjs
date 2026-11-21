import assert from "node:assert/strict";
import test from "node:test";

import {
  bearingDifferenceDegrees,
  haversineMeters,
  initialBearingDegrees,
  pointAtDistance,
  shouldAlertForHazard,
} from "./geo.mjs";

test("Haversine distance returns the expected short distance", () => {
  assert.ok(Math.abs(haversineMeters(0, 0, 0, 1) - 111_195) < 20);
});

test("bearing and destination helpers handle a northbound approach", () => {
  const destination = pointAtDistance(27.9, -82.45, 0, 250);
  assert.ok(Math.abs(haversineMeters(27.9, -82.45, destination.latitude, destination.longitude) - 250) < 0.1);
  assert.ok(bearingDifferenceDegrees(initialBearingDegrees(27.9, -82.45, destination.latitude, destination.longitude), 0) < 0.01);
});

test("bearing difference wraps around north", () => {
  assert.equal(bearingDifferenceDegrees(359, 1), 2);
});

test("proximity alert requires an accurate, forward, approaching GPS fix", () => {
  const base = {
    distance: 100,
    previousDistance: 130,
    alertDistance: 200,
    heading: 0,
    bearing: 5,
    accuracy: 10,
    cooldownElapsed: true,
  };
  assert.equal(shouldAlertForHazard(base), true);
  assert.equal(shouldAlertForHazard({ ...base, accuracy: 40 }), false);
  assert.equal(shouldAlertForHazard({ ...base, heading: 180 }), false);
  assert.equal(shouldAlertForHazard({ ...base, previousDistance: 90 }), false);
  assert.equal(shouldAlertForHazard({ ...base, cooldownElapsed: false }), false);
});
