#include <cassert>
#include <cmath>
#include <cstdio>

#include "pothole_detector.h"

namespace {
ImuReading readingFor(float verticalAcceleration, float gyroY = 0.0f) {
  ImuReading reading{};
  reading.accelZ = verticalAcceleration;
  reading.gyroY = gyroY;
  reading.quaternionW = 1.0f;
  reading.orientationValid = true;
  reading.calibrationAccelerometer = 3;
  return reading;
}

ImuReading readingForMountedVertical(float verticalAcceleration, float gyroY = 0.0f) {
  ImuReading reading{};
  reading.accelY = verticalAcceleration;
  reading.gyroY = gyroY;
  reading.quaternionW = 0.70710678f;
  reading.quaternionX = 0.70710678f;
  reading.orientationValid = true;
  reading.calibrationAccelerometer = 3;
  return reading;
}

void testSmoothRoadDoesNotCreateCandidate() {
  PotholeDetector detector;
  PotholeCandidate candidate{};
  bool detected = false;
  for (uint32_t index = 0; index < 600; ++index) {
    const float smooth = 0.5f * std::sin(static_cast<float>(index) * 0.08f);
    detected = detector.update(readingFor(smooth), index * 10, candidate) || detected;
  }
  assert(!detected);
}

void testRoughRoadVibrationDoesNotCreateCandidate() {
  PotholeDetector detector;
  PotholeCandidate candidate{};
  bool detected = false;
  for (uint32_t index = 0; index < 600; ++index) {
    const float rough =
        1.7f * std::sin(static_cast<float>(index) * 0.71f) +
        0.6f * std::sin(static_cast<float>(index) * 1.63f);
    detected = detector.update(readingFor(rough, 0.06f), index * 10, candidate) || detected;
  }
  assert(!detected);
}

bool sendPotholePulse(PotholeDetector& detector, uint32_t startMs, PotholeCandidate& candidate) {
  bool detected = false;
  for (uint32_t index = 0; index < 8; ++index) {
    detected = detector.update(readingFor(-8.0f, 0.35f), startMs + index * 10, candidate) || detected;
  }
  for (uint32_t index = 0; index < 16; ++index) {
    const float rebound = index < 4 ? 4.5f : 0.0f;
    detected = detector.update(
        readingFor(rebound, index < 4 ? 0.45f : 0.0f),
        startMs + 80 + index * 10,
        candidate) || detected;
  }
  return detected;
}

bool sendMountedPotholePulse(
    PotholeDetector& detector,
    uint32_t startMs,
    PotholeCandidate& candidate) {
  bool detected = false;
  for (uint32_t index = 0; index < 8; ++index) {
    detected = detector.update(
        readingForMountedVertical(-8.0f, 0.35f),
        startMs + index * 10,
        candidate) || detected;
  }
  for (uint32_t index = 0; index < 16; ++index) {
    const float rebound = index < 4 ? 4.5f : 0.0f;
    detected = detector.update(
        readingForMountedVertical(rebound, index < 4 ? 0.45f : 0.0f),
        startMs + 80 + index * 10,
        candidate) || detected;
  }
  return detected;
}

void testPotholeLikeImpactCreatesCandidate() {
  PotholeDetector detector;
  PotholeCandidate candidate{};
  detector.update(readingFor(0.0f), 0, candidate);
  for (uint32_t index = 1; index < 50; ++index) {
    detector.update(readingFor(0.1f * std::sin(index)), index * 10, candidate);
  }
  assert(sendPotholePulse(detector, 500, candidate));
  assert(candidate.impactMagnitudeMps2 >= 4.5f);
  assert(candidate.peakVerticalMps2 >= 4.5f);
  assert(candidate.angularRateRadS > 0.25f);
  assert(candidate.severity != nullptr);
}

void testOrientationCompensatesForSensorMounting() {
  PotholeDetector detector;
  PotholeCandidate candidate{};
  detector.update(readingForMountedVertical(0.0f), 0, candidate);
  for (uint32_t index = 1; index < 50; ++index) {
    detector.update(
        readingForMountedVertical(0.0f),
        index * 10,
        candidate);
  }
  assert(sendMountedPotholePulse(detector, 500, candidate));
}

void testBroadSpeedBumpProfileDoesNotCreateCandidate() {
  PotholeDetector detector;
  PotholeCandidate candidate{};
  bool detected = false;
  for (uint32_t index = 0; index < 600; ++index) {
    float bump = 0.0f;
    if (index >= 150 && index < 230) {
      const float phase = static_cast<float>(index - 150) / 80.0f;
      bump = 3.8f * std::sin(phase * 3.14159265f);
    }
    detected = detector.update(readingFor(bump, 0.08f), index * 10, candidate) || detected;
  }
  assert(!detected);
}

void testCooldownSuppressesRepeatedPotholePulse() {
  PotholeDetector detector;
  PotholeCandidate candidate{};
  detector.update(readingFor(0.0f), 0, candidate);
  for (uint32_t index = 1; index < 50; ++index) {
    detector.update(readingFor(0.0f), index * 10, candidate);
  }
  assert(sendPotholePulse(detector, 500, candidate));
  bool detected = false;
  for (uint32_t index = 0; index < 100; ++index) {
    detected = detector.update(
        readingFor(0.0f),
        800 + index * 10,
        candidate) || detected;
  }
  assert(!sendPotholePulse(detector, 1800, candidate));
  assert(!detected);
}
}

int main() {
  testSmoothRoadDoesNotCreateCandidate();
  testRoughRoadVibrationDoesNotCreateCandidate();
  testPotholeLikeImpactCreatesCandidate();
  testOrientationCompensatesForSensorMounting();
  testBroadSpeedBumpProfileDoesNotCreateCandidate();
  testCooldownSuppressesRepeatedPotholePulse();
  std::puts("Firmware detector tests passed (6 cases).");
  return 0;
}
