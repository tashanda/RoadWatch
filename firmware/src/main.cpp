#include <Arduino.h>
#include <TinyGPSPlus.h>
#include <math.h>
#include <stdio.h>

#include "config.h"
#include "imu.h"
#include "pothole_detector.h"
#include "wifi_uploader.h"

namespace {
TinyGPSPlus gps;
HardwareSerial gpsSerial(1);
PotholeDetector potholeDetector;

bool imuReady = false;
uint32_t nextSampleMicros = 0;
uint32_t lastDebugMs = 0;

void printNullableFloat(bool valid, double value) {
  if (valid) {
    Serial.print(value, 6);
  } else {
    Serial.print("null");
  }
}

void printDebugSample(
    const ImuReading& reading,
    bool imuValid,
    bool gpsValid,
    const PotholeDetectorDebug& detectorDebug) {
  Serial.print("{\"timestamp_ms\":");
  Serial.print(millis());
  Serial.print(",\"imu_valid\":");
  Serial.print(imuValid ? "true" : "false");
  Serial.print(",\"orientation_valid\":");
  Serial.print(reading.orientationValid ? "true" : "false");
  Serial.print(",\"calibration_system\":");
  Serial.print(reading.calibrationSystem);
  Serial.print(",\"calibration_accel\":");
  Serial.print(reading.calibrationAccelerometer);
  Serial.print(",\"calibration_gyro\":");
  Serial.print(reading.calibrationGyroscope);
  Serial.print(",\"linear_accel_sensor_m_s2\":[");
  printNullableFloat(imuValid, reading.accelX);
  Serial.print(",");
  printNullableFloat(imuValid, reading.accelY);
  Serial.print(",");
  printNullableFloat(imuValid, reading.accelZ);
  Serial.print("],\"gyro_rad_s\":[");
  printNullableFloat(imuValid, reading.gyroX);
  Serial.print(",");
  printNullableFloat(imuValid, reading.gyroY);
  Serial.print(",");
  printNullableFloat(imuValid, reading.gyroZ);
  Serial.print("],\"orientation_deg\":[");
  printNullableFloat(imuValid, reading.headingDegrees);
  Serial.print(",");
  printNullableFloat(imuValid, reading.rollDegrees);
  Serial.print(",");
  printNullableFloat(imuValid, reading.pitchDegrees);
  Serial.print("],\"vertical_accel_m_s2\":");
  printNullableFloat(imuValid, detectorDebug.verticalAccelerationMps2);
  Serial.print(",\"jerk_m_s3\":");
  printNullableFloat(imuValid, detectorDebug.jerkMps3);
  Serial.print(",\"vibration_rms_m_s2\":");
  printNullableFloat(imuValid, detectorDebug.vibrationRmsMps2);
  Serial.print(",\"gps_valid\":");
  Serial.print(gpsValid ? "true" : "false");
  Serial.print(",\"latitude\":");
  printNullableFloat(gpsValid, gps.location.lat());
  Serial.print(",\"longitude\":");
  printNullableFloat(gpsValid, gps.location.lng());
  Serial.println("}");
}

void queueDetectedCandidate(
    const PotholeCandidate& candidate,
    bool gpsValid,
    double latitude,
    double longitude) {
  char summary[256];
  snprintf(
      summary,
      sizeof(summary),
      "possible_pothole impact=%.2fm/s2 vertical_peak=%.2fm/s2 "
      "vibration_rms=%.2fm/s2 gyro=%.2frad/s",
      candidate.impactMagnitudeMps2,
      candidate.peakVerticalMps2,
      candidate.vibrationRmsMps2,
      candidate.angularRateRadS);
  const bool queued = queueCandidate(
      summary,
      gpsValid,
      latitude,
      longitude,
      candidate.severity,
      "pothole",
      candidate.impactMagnitudeMps2);
  Serial.print("{\"candidate\":\"possible_pothole\",\"queued\":");
  Serial.print(queued ? "true" : "false");
  Serial.print(",\"impact_m_s2\":");
  Serial.print(candidate.impactMagnitudeMps2, 2);
  Serial.print(",\"severity\":\"");
  Serial.print(candidate.severity);
  Serial.print("\",\"gps_valid\":");
  Serial.print(gpsValid ? "true" : "false");
  Serial.println("}");
}

void sampleSensors() {
  ImuReading reading{};
  const bool imuValid = imuReady && readImu(reading);
  const bool gpsValid =
      gps.location.isValid() && gps.location.age() < 2000;
  PotholeCandidate candidate{};
  const bool detected =
      imuValid && potholeDetector.update(reading, millis(), candidate);
  const PotholeDetectorDebug& detectorDebug = potholeDetector.debug();

  if (detected) {
    queueDetectedCandidate(
        candidate,
        gpsValid,
        gpsValid ? gps.location.lat() : 0.0,
        gpsValid ? gps.location.lng() : 0.0);
  }

  const uint32_t nowMs = millis();
  if (config::kDetectorDebug && nowMs - lastDebugMs >= 100) {
    lastDebugMs = nowMs;
    printDebugSample(reading, imuValid, gpsValid, detectorDebug);
  }
}
}

void setup() {
  Serial.begin(config::kSerialBaud);
  gpsSerial.begin(
      config::kGpsBaud,
      SERIAL_8N1,
      config::kGpsRxPin,
      config::kGpsTxPin);

  imuReady = beginImu();
  Serial.println(imuReady ? "BNO055 ready" : "BNO055 not detected");
  Serial.print("BNO055 I2C address: 0x");
  Serial.println(config::kBno055Address, HEX);
  Serial.print("Detector debug mode: ");
  Serial.println(config::kDetectorDebug ? "enabled" : "disabled");
  beginWifiUploader();
  nextSampleMicros = micros();
}

void loop() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  const uint32_t now = micros();
  if (static_cast<int32_t>(now - nextSampleMicros) >= 0) {
    nextSampleMicros += config::kSamplePeriodMicros;
    if (static_cast<int32_t>(now - nextSampleMicros) >= 0) {
      nextSampleMicros = now + config::kSamplePeriodMicros;
    }
    sampleSensors();
  }
}
