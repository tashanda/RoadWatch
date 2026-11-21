#pragma once

#include <stdint.h>

struct ImuReading {
  float accelX;
  float accelY;
  float accelZ;
  float gyroX;
  float gyroY;
  float gyroZ;
  float quaternionW;
  float quaternionX;
  float quaternionY;
  float quaternionZ;
  float rollDegrees;
  float pitchDegrees;
  float headingDegrees;
  uint8_t calibrationSystem;
  uint8_t calibrationAccelerometer;
  uint8_t calibrationGyroscope;
  bool orientationValid;
};

bool beginImu();
bool readImu(ImuReading& reading);
