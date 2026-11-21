#pragma once

#include <Arduino.h>

namespace config {
constexpr uint32_t kSerialBaud = 460800;

constexpr int kI2cSdaPin = 21;
constexpr int kI2cSclPin = 22;

constexpr int kGpsRxPin = 16;
constexpr int kGpsTxPin = 17;
constexpr uint32_t kGpsBaud = 9600;

constexpr uint32_t kSamplePeriodMicros = 10000;
}
