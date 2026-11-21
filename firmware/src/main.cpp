
#include <Arduino.h>
#include <TinyGPSPlus.h>
#include <math.h>

#include "config.h"
#include "imu.h"
#include "wifi_uploader.h"

namespace {

TinyGPSPlus gps;
HardwareSerial gpsSerial(1);

bool imuReady = false;
uint32_t nextSampleMicros = 0;

// Initial experimental threshold in m/s²
constexpr float kImpactThreshold = 4.0f;
constexpr uint32_t kCooldownMs = 1500;

float baseline = 9.81f;
bool baselineReady = false;
uint32_t lastDetectionMs = 0;

void printNullableFloat(bool valid, double value) {
  if (valid) {
    Serial.print(value, 6);
  } else {
    Serial.print("null");
  }
}

bool detectImpact(const ImuReading& reading,
                  float& impactStrength) {

  float magnitude = sqrtf(
      reading.accelX * reading.accelX +
      reading.accelY * reading.accelY +
      reading.accelZ * reading.accelZ
  );

  if (!baselineReady) {
    baseline = magnitude;
    baselineReady = true;
  }

  impactStrength = fabsf(magnitude - baseline);

  // Slowly follow normal changes in acceleration.
  if (impactStrength < kImpactThreshold) {
    baseline = 0.98f * baseline + 0.02f * magnitude;
  }

  uint32_t now = millis();

  if (impactStrength > kImpactThreshold &&
      (lastDetectionMs == 0 ||
       now - lastDetectionMs >= kCooldownMs)) {

    lastDetectionMs = now;
    return true;
  }

  return false;
}

void printSample() {
  ImuReading reading{};

  bool imuValid = imuReady && readImu(reading);
  bool gpsValid = gps.location.isValid() &&
                  gps.location.age() < 2000;

  float impactStrength = 0.0f;
  bool potentialPothole = false;

  if (imuValid) {
    potentialPothole =
        detectImpact(reading, impactStrength);
  }

  Serial.print("{\"timestamp_ms\":");
  Serial.print(millis());

  Serial.print(",\"imu_valid\":");
  Serial.print(imuValid ? "true" : "false");

  Serial.print(",\"accel_x_m_s2\":");
  printNullableFloat(imuValid, reading.accelX);

  Serial.print(",\"accel_y_m_s2\":");
  printNullableFloat(imuValid, reading.accelY);

  Serial.print(",\"accel_z_m_s2\":");
  printNullableFloat(imuValid, reading.accelZ);

  Serial.print(",\"gyro_x_rad_s\":");
  printNullableFloat(imuValid, reading.gyroX);

  Serial.print(",\"gyro_y_rad_s\":");
  printNullableFloat(imuValid, reading.gyroY);

  Serial.print(",\"gyro_z_rad_s\":");
  printNullableFloat(imuValid, reading.gyroZ);

  Serial.print(",\"gps_valid\":");
  Serial.print(gpsValid ? "true" : "false");

  Serial.print(",\"latitude\":");
  printNullableFloat(gpsValid, gps.location.lat());

  Serial.print(",\"longitude\":");
  printNullableFloat(gpsValid, gps.location.lng());

  Serial.print(",\"impact_m_s2\":");
  printNullableFloat(imuValid, impactStrength);

  Serial.print(",\"potential_pothole\":");
  Serial.print(potentialPothole ? "true" : "false");

  Serial.println("}");
}

}

void setup() {
  Serial.begin(config::kSerialBaud);

  gpsSerial.begin(
      config::kGpsBaud,
      SERIAL_8N1,
      config::kGpsRxPin,
      config::kGpsTxPin
  );

  imuReady = beginImu();
  beginWifiUploader();
  nextSampleMicros = micros();
}

void loop() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  uint32_t now = micros();

  if (static_cast<int32_t>(
      now - nextSampleMicros) >= 0) {

    nextSampleMicros += config::kSamplePeriodMicros;

    if (static_cast<int32_t>(
        now - nextSampleMicros) >= 0) {
      nextSampleMicros =
          now + config::kSamplePeriodMicros;
    }

    printSample();
  }
}
