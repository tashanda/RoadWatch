
#include "imu.h"

#include <Adafruit_BNO055.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>

#include "config.h"

namespace {
Adafruit_BNO055 sensor(55, 0x28);
}

bool beginImu() {
  Wire.begin(config::kI2cSdaPin, config::kI2cSclPin);

  if (!sensor.begin()) {
    return false;
  }

  sensor.setExtCrystalUse(true);
  return true;
}

bool readImu(ImuReading& reading) {
  imu::Vector<3> accel =
      sensor.getVector(Adafruit_BNO055::VECTOR_ACCELEROMETER);

  imu::Vector<3> gyro =
      sensor.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);

  reading.accelX = accel.x();
  reading.accelY = accel.y();
  reading.accelZ = accel.z();

  // BNO055 gyroscope readings are in rad/s.
  reading.gyroX = gyro.x();
  reading.gyroY = gyro.y();
  reading.gyroZ = gyro.z();

  return true;
}
