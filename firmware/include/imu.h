#pragma once

struct ImuReading {
  float accelX;
  float accelY;
  float accelZ;
  float gyroX;
  float gyroY;
  float gyroZ;
};

bool beginImu();
bool readImu(ImuReading& reading);
