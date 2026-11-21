#pragma once

#include <stdint.h>

#include "imu.h"

struct PotholeDetectorConfig {
  float verticalFilterAlpha = 0.45f;
  float impactThresholdMps2 = 4.5f;
  float reboundThresholdMps2 = 1.25f;
  float minimumVibrationRmsMps2 = 0.8f;
  float minimumGyroSupportRadS = 0.25f;
  float minimumJerkMps3 = 35.0f;
  float lowSeverityBelowMps2 = 6.0f;
  float highSeverityAtMps2 = 10.0f;
  uint32_t minimumReboundDelayMs = 20;
  uint32_t maximumReboundDelayMs = 450;
  uint32_t cooldownMs = 3000;
};

struct PotholeCandidate {
  float impactMagnitudeMps2;
  float peakVerticalMps2;
  float vibrationRmsMps2;
  float angularRateRadS;
  const char* severity;
};

struct PotholeDetectorDebug {
  float verticalAccelerationMps2;
  float jerkMps3;
  float vibrationRmsMps2;
  float angularRateRadS;
  float rollDegrees;
  float pitchDegrees;
  float headingDegrees;
  bool trackingImpact;
};

class PotholeDetector {
 public:
  explicit PotholeDetector(
      const PotholeDetectorConfig& config = PotholeDetectorConfig{});

  bool update(
      const ImuReading& reading,
      uint32_t nowMs,
      PotholeCandidate& candidate);
  const PotholeDetectorDebug& debug() const;
  void reset();

 private:
  void updateVibration(float verticalAcceleration);
  float vibrationRms() const;

  bool beginImpact(float verticalAcceleration, float jerk, uint32_t nowMs);

  PotholeDetectorConfig config_;
  float filteredVertical_ = 0.0f;
  float previousVertical_ = 0.0f;
  float previousPreviousVertical_ = 0.0f;
  float vibrationSquared_[8]{};
  float vibrationSquaredSum_ = 0.0f;
  float primaryPeak_ = 0.0f;
  float gyroPeak_ = 0.0f;
  uint32_t vibrationIndex_ = 0;
  uint32_t vibrationCount_ = 0;
  uint32_t lastSampleMs_ = 0;
  uint32_t impactStartedMs_ = 0;
  uint32_t lastCandidateMs_ = 0;
  int8_t primarySign_ = 0;
  bool initialized_ = false;
  bool impactActive_ = false;
  bool hasCandidate_ = false;
  PotholeDetectorDebug debug_{};
};
