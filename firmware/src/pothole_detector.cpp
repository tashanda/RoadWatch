#include "pothole_detector.h"

#include <cmath>

namespace {
constexpr float kQuaternionNormMinimum = 0.5f;

int8_t signOf(float value) {
  return value >= 0.0f ? 1 : -1;
}

float medianOfThree(float first, float second, float third) {
  if (first > second) {
    const float swap = first;
    first = second;
    second = swap;
  }
  if (second > third) {
    const float swap = second;
    second = third;
    third = swap;
  }
  return first > second ? first : second;
}

bool rotateSensorAccelerationToWorld(
    const ImuReading& reading,
    float& worldX,
    float& worldY,
    float& worldZ) {
  const float norm = std::sqrt(
      reading.quaternionW * reading.quaternionW +
      reading.quaternionX * reading.quaternionX +
      reading.quaternionY * reading.quaternionY +
      reading.quaternionZ * reading.quaternionZ);
  if (!std::isfinite(norm) || norm < kQuaternionNormMinimum) return false;

  const float qw = reading.quaternionW / norm;
  const float qx = reading.quaternionX / norm;
  const float qy = reading.quaternionY / norm;
  const float qz = reading.quaternionZ / norm;
  const float tx = 2.0f * (qy * reading.accelZ - qz * reading.accelY);
  const float ty = 2.0f * (qz * reading.accelX - qx * reading.accelZ);
  const float tz = 2.0f * (qx * reading.accelY - qy * reading.accelX);

  worldX = reading.accelX + qw * tx + qy * tz - qz * ty;
  worldY = reading.accelY + qw * ty + qz * tx - qx * tz;
  worldZ = reading.accelZ + qw * tz + qx * ty - qy * tx;
  return std::isfinite(worldX) && std::isfinite(worldY) && std::isfinite(worldZ);
}
}

PotholeDetector::PotholeDetector(const PotholeDetectorConfig& config)
    : config_(config) {}

bool PotholeDetector::beginImpact(
    float verticalAcceleration,
    float jerk,
    uint32_t nowMs) {
  if (std::fabs(verticalAcceleration) < config_.impactThresholdMps2 ||
      std::fabs(jerk) < config_.minimumJerkMps3) {
    return false;
  }
  primarySign_ = signOf(verticalAcceleration);
  primaryPeak_ = std::fabs(verticalAcceleration);
  gyroPeak_ = debug_.angularRateRadS;
  impactStartedMs_ = nowMs;
  impactActive_ = true;
  return true;
}

void PotholeDetector::updateVibration(float verticalAcceleration) {
  const float squared = verticalAcceleration * verticalAcceleration;
  if (vibrationCount_ == 8) {
    vibrationSquaredSum_ -= vibrationSquared_[vibrationIndex_];
  } else {
    ++vibrationCount_;
  }
  vibrationSquared_[vibrationIndex_] = squared;
  vibrationSquaredSum_ += squared;
  vibrationIndex_ = (vibrationIndex_ + 1) % 8;
}

float PotholeDetector::vibrationRms() const {
  if (vibrationCount_ == 0) return 0.0f;
  return std::sqrt(vibrationSquaredSum_ / vibrationCount_);
}

bool PotholeDetector::update(
    const ImuReading& reading,
    uint32_t nowMs,
    PotholeCandidate& candidate) {
  const float angularRate = std::sqrt(
      reading.gyroX * reading.gyroX +
      reading.gyroY * reading.gyroY +
      reading.gyroZ * reading.gyroZ);
  float worldX = 0.0f;
  float worldY = 0.0f;
  float worldZ = 0.0f;
  if (
      !reading.orientationValid ||
      !std::isfinite(angularRate) ||
      !rotateSensorAccelerationToWorld(reading, worldX, worldY, worldZ)) {
    impactActive_ = false;
    debug_.trackingImpact = false;
    debug_.angularRateRadS = std::isfinite(angularRate) ? angularRate : 0.0f;
    debug_.rollDegrees = reading.rollDegrees;
    debug_.pitchDegrees = reading.pitchDegrees;
    debug_.headingDegrees = reading.headingDegrees;
    return false;
  }

  const float verticalRaw = worldZ;
  if (!initialized_) {
    previousVertical_ = verticalRaw;
    previousPreviousVertical_ = verticalRaw;
    filteredVertical_ = verticalRaw;
    lastSampleMs_ = nowMs;
    initialized_ = true;
  }

  const float medianVertical = medianOfThree(
      previousPreviousVertical_,
      previousVertical_,
      verticalRaw);
  previousPreviousVertical_ = previousVertical_;
  previousVertical_ = verticalRaw;
  filteredVertical_ += config_.verticalFilterAlpha *
      (medianVertical - filteredVertical_);

  uint32_t elapsedMs = nowMs - lastSampleMs_;
  lastSampleMs_ = nowMs;
  if (elapsedMs == 0) elapsedMs = 1;
  const float jerk = (filteredVertical_ - debug_.verticalAccelerationMps2) /
      (static_cast<float>(elapsedMs) / 1000.0f);
  updateVibration(filteredVertical_);
  debug_ = {
      filteredVertical_,
      jerk,
      vibrationRms(),
      angularRate,
      reading.rollDegrees,
      reading.pitchDegrees,
      reading.headingDegrees,
      impactActive_,
  };

  if (impactActive_) {
    const uint32_t impactAge = nowMs - impactStartedMs_;
    const float magnitude = std::fabs(filteredVertical_);
    if (signOf(filteredVertical_) == primarySign_) {
      if (magnitude > primaryPeak_) primaryPeak_ = magnitude;
      if (angularRate > gyroPeak_) gyroPeak_ = angularRate;
      if (impactAge > config_.maximumReboundDelayMs) {
        impactActive_ = false;
      }
    } else if (
        impactAge >= config_.minimumReboundDelayMs &&
        magnitude >= config_.reboundThresholdMps2 &&
        impactAge <= config_.maximumReboundDelayMs) {
      if (angularRate > gyroPeak_) gyroPeak_ = angularRate;
      const float rms = vibrationRms();
      const bool vibrationConfirmed =
          rms >= config_.minimumVibrationRmsMps2 ||
          gyroPeak_ >= config_.minimumGyroSupportRadS;
      impactActive_ = false;
      if (
          vibrationConfirmed &&
          (!hasCandidate_ || nowMs - lastCandidateMs_ >= config_.cooldownMs)) {
        const float impactMagnitude =
            primaryPeak_ > magnitude ? primaryPeak_ : magnitude;
        candidate = {
            impactMagnitude,
            primaryPeak_,
            rms,
            gyroPeak_,
            impactMagnitude >= config_.highSeverityAtMps2
                ? "high"
                : impactMagnitude >= config_.lowSeverityBelowMps2 ? "medium" : "low",
        };
        lastCandidateMs_ = nowMs;
        hasCandidate_ = true;
        debug_.trackingImpact = false;
        return true;
      }
    }
  }

  if (
      !impactActive_ &&
      (!hasCandidate_ || nowMs - lastCandidateMs_ >= config_.cooldownMs)) {
    beginImpact(filteredVertical_, jerk, nowMs);
    debug_.trackingImpact = impactActive_;
  }
  return false;
}

const PotholeDetectorDebug& PotholeDetector::debug() const {
  return debug_;
}

void PotholeDetector::reset() {
  filteredVertical_ = 0.0f;
  previousVertical_ = 0.0f;
  previousPreviousVertical_ = 0.0f;
  vibrationSquaredSum_ = 0.0f;
  primaryPeak_ = 0.0f;
  gyroPeak_ = 0.0f;
  vibrationIndex_ = 0;
  vibrationCount_ = 0;
  lastSampleMs_ = 0;
  impactStartedMs_ = 0;
  lastCandidateMs_ = 0;
  primarySign_ = 0;
  initialized_ = false;
  impactActive_ = false;
  hasCandidate_ = false;
  debug_ = {};
}
