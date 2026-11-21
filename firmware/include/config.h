#pragma once

#include <Arduino.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#include "backend_root_ca.h"

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

#ifndef ROADWATCH_BNO055_ADDRESS
#define ROADWATCH_BNO055_ADDRESS 0x28
#endif

#ifndef ROADWATCH_DETECTOR_DEBUG
#define ROADWATCH_DETECTOR_DEBUG 0
#endif

#ifndef ROADWATCH_DIAGNOSTIC_MODE
#define ROADWATCH_DIAGNOSTIC_MODE 0
#endif

namespace config {

constexpr uint32_t kSerialBaud = 460800;

constexpr int kI2cSdaPin = 25;
constexpr int kI2cSclPin = 33;
constexpr uint8_t kBno055Address = ROADWATCH_BNO055_ADDRESS;
constexpr bool kDetectorDebug = ROADWATCH_DETECTOR_DEBUG != 0;
constexpr bool kNetworkDiagnosticMode = ROADWATCH_DIAGNOSTIC_MODE != 0;

constexpr int kGpsRxPin = 16;
constexpr int kGpsTxPin = 17;
constexpr uint32_t kGpsBaud = 9600;

constexpr uint32_t kSamplePeriodMicros = 10000;

constexpr const char* kWifiSsid = ROADWATCH_WIFI_SSID;
constexpr const char* kWifiPassword = ROADWATCH_WIFI_PASSWORD;
constexpr const char* kBackendUrl = ROADWATCH_BACKEND_URL;
constexpr const char* kDeviceToken = ROADWATCH_DEVICE_TOKEN;
constexpr const char* kBackendRootCa = kBackendRootCaPem;
constexpr const char* kDeviceId = "roadwatch-esp32-01";
constexpr uint32_t kWifiReconnectIntervalMs = 15000;
constexpr uint32_t kHttpTimeoutMs = 5000;
constexpr uint8_t kUploadRetryLimit = 5;
constexpr uint32_t kUploadRetryDelayMs = 30000;
}
