#include "imu.h"

#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>

#include "config.h"

namespace {
Adafruit_MPU6050 sensor;
}

bool beginImu() {
  Wire.begin(config::kI2cSdaPin, config::kI2cSclPin);
  if (!sensor.begin()) {
    return false;
  }

  sensor.setAccelerometerRange(MPU6050_RANGE_8_G);
  sensor.setGyroRange(MPU6050_RANGE_500_DEG);
  sensor.setFilterBandwidth(MPU6050_BAND_21_HZ);
  return true;
}

bool readImu(ImuReading& reading) {
  sensors_event_t acceleration;
  sensors_event_t gyroscope;
  sensors_event_t temperature;
  sensor.getEvent(&acceleration, &gyroscope, &temperature);

  reading.accelX = acceleration.acceleration.x;
  reading.accelY = acceleration.acceleration.y;
  reading.accelZ = acceleration.acceleration.z;
  reading.gyroX = gyroscope.gyro.x;
  reading.gyroY = gyroscope.gyro.y;
  reading.gyroZ = gyroscope.gyro.z;
  return true;
}
