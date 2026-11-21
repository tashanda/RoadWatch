#pragma once

#include <Arduino.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef ROADWATCH_WIFI_SSID
#define ROADWATCH_WIFI_SSID ""
#endif

#ifndef ROADWATCH_WIFI_PASSWORD
#define ROADWATCH_WIFI_PASSWORD ""
#endif

#ifndef ROADWATCH_BACKEND_URL
#define ROADWATCH_BACKEND_URL ""
#endif

#ifndef ROADWATCH_DEVICE_TOKEN
#define ROADWATCH_DEVICE_TOKEN ""
#endif

#ifndef ROADWATCH_BACKEND_ROOT_CA
#define ROADWATCH_BACKEND_ROOT_CA ""
#endif

namespace config {
constexpr uint32_t kSerialBaud = 460800;

constexpr int kI2cSdaPin = 21;
constexpr int kI2cSclPin = 22;

constexpr int kGpsRxPin = 16;
constexpr int kGpsTxPin = 17;
constexpr uint32_t kGpsBaud = 9600;

constexpr uint32_t kSamplePeriodMicros = 10000;

constexpr const char* kWifiSsid = ROADWATCH_WIFI_SSID;
constexpr const char* kWifiPassword = ROADWATCH_WIFI_PASSWORD;
constexpr const char* kBackendUrl = ROADWATCH_BACKEND_URL;
constexpr const char* kDeviceToken = ROADWATCH_DEVICE_TOKEN;
constexpr const char* kBackendRootCa = ROADWATCH_BACKEND_ROOT_CA;
constexpr const char* kDeviceId = "roadwatch-esp32-01";
constexpr uint32_t kWifiReconnectIntervalMs = 15000;
constexpr uint32_t kHttpTimeoutMs = 5000;
constexpr uint8_t kUploadRetryLimit = 5;
}
