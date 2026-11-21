#include "imu.h"

#include <Adafruit_BNO055.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>

#include "config.h"

namespace {
Adafruit_BNO055 sensor(55, config::kBno055Address);
}

bool beginImu() {
  Wire.begin(config::kI2cSdaPin, config::kI2cSclPin);
  if (!sensor.begin()) return false;
  sensor.setExtCrystalUse(true);
  return true;
}

bool readImu(ImuReading& reading) {
  const imu::Vector<3> acceleration =
      sensor.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
  const imu::Vector<3> gyroscope =
      sensor.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  const imu::Vector<3> euler =
      sensor.getVector(Adafruit_BNO055::VECTOR_EULER);
  const imu::Quaternion orientation = sensor.getQuat();
  uint8_t magnetometerCalibration = 0;
  sensor.getCalibration(
      &reading.calibrationSystem,
      &reading.calibrationGyroscope,
      &reading.calibrationAccelerometer,
      &magnetometerCalibration);

  reading.accelX = acceleration.x();
  reading.accelY = acceleration.y();
  reading.accelZ = acceleration.z();
  reading.gyroX = gyroscope.x();
  reading.gyroY = gyroscope.y();
  reading.gyroZ = gyroscope.z();
  reading.quaternionW = orientation.w();
  reading.quaternionX = orientation.x();
  reading.quaternionY = orientation.y();
  reading.quaternionZ = orientation.z();
  reading.headingDegrees = euler.x();
  reading.rollDegrees = euler.y();
  reading.pitchDegrees = euler.z();

  const float quaternionNorm =
      reading.quaternionW * reading.quaternionW +
      reading.quaternionX * reading.quaternionX +
      reading.quaternionY * reading.quaternionY +
      reading.quaternionZ * reading.quaternionZ;
  reading.orientationValid =
      quaternionNorm > 0.5f &&
      reading.calibrationAccelerometer >= 2 &&
      reading.calibrationGyroscope >= 2;
  return true;
}
