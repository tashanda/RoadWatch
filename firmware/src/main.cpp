
#include <Arduino.h>
#include <TinyGPSPlus.h>

#include "config.h"
#include "imu.h"

namespace {

TinyGPSPlus gps;
HardwareSerial gpsSerial(1);
bool imuReady = false;
uint32_t nextSampleMicros = 0;

void printNullableFloat(bool valid, double value) {
  if (valid) {
    Serial.print(value, 6);
  } else {
    Serial.print("null");
  }
}

void printSample() {
  ImuReading reading{};
  const bool imuValid = imuReady && readImu(reading);
  const bool gpsValid = gps.location.isValid() && gps.location.age() < 2000;

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

    printSample();
  }
}
