#include "wifi_uploader.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <time.h>

#include <cmath>
#include <cstring>

#include "config.h"

namespace {
constexpr UBaseType_t kQueueLength = 8;
constexpr size_t kSummaryLength = 256;
constexpr uint32_t kTimeSyncEpoch = 1609459200;

struct QueuedEvent {
  char eventId[37];
  char timestamp[25];
  char summary[kSummaryLength];
  char severity[8];
  char eventType[20];
  double latitude;
  double longitude;
  float impactMagnitudeMps2;
  uint32_t createdAtMs;
  bool gpsValid;
  bool classified;
  bool impactMagnitudeValid;
};

QueueHandle_t uploadQueue = nullptr;
uint32_t failedUploads = 0;
portMUX_TYPE uploadStatsMux = portMUX_INITIALIZER_UNLOCKED;
uint32_t lastWifiAttempt = 0;
bool wifiAttempted = false;
bool timeSyncStarted = false;

bool configured() {
  const bool hasWifiSsid = std::strlen(config::kWifiSsid) > 0;
  const bool hasWifiPassword = std::strlen(config::kWifiPassword) > 0;
  const bool hasBackendUrl = std::strlen(config::kBackendUrl) > 0;
  const bool backendUsesHttps =
      hasBackendUrl && std::strncmp(config::kBackendUrl, "https://", 8) == 0;
  const bool hasDeviceToken = std::strlen(config::kDeviceToken) > 0;
  const bool hasRootCa = std::strlen(config::kBackendRootCa) > 0;

  if (!hasWifiSsid) Serial.println("[net] missing Wi-Fi SSID configuration");
  if (!hasWifiPassword) Serial.println("[net] missing Wi-Fi password configuration");
  if (!hasBackendUrl) Serial.println("[net] missing backend URL configuration");
  if (hasBackendUrl && !backendUsesHttps) {
    Serial.println("[net] backend URL must use HTTPS");
  }
  if (!hasDeviceToken) Serial.println("[net] missing device token configuration");
  if (!hasRootCa) Serial.println("[net] missing TLS root CA configuration");

  return hasWifiSsid && hasWifiPassword && backendUsesHttps &&
      hasDeviceToken && hasRootCa;
}

bool systemTimeIsValid() {
  return time(nullptr) >= static_cast<time_t>(kTimeSyncEpoch);
}

String makeEndpoint(const char* path) {
  String endpoint(config::kBackendUrl);
  while (endpoint.endsWith("/")) {
    endpoint.remove(endpoint.length() - 1);
  }
  endpoint += path;
  return endpoint;
}

void logHttpResult(
    const char* operation,
    int statusCode,
    WiFiClientSecure& secureClient) {
  if (statusCode >= 0) {
    Serial.printf("[net] %s HTTP %d\n", operation, statusCode);
    return;
  }

  char tlsError[160] = {};
  const int tlsErrorCode = secureClient.lastError(tlsError, sizeof(tlsError));
  const String transportError = HTTPClient::errorToString(statusCode);
  Serial.printf(
      "[net] %s transport error %d (%s); TLS error %d (%s)\n",
      operation,
      statusCode,
      transportError.c_str(),
      tlsErrorCode,
      tlsError);
}

void startTimeSync() {
  if (timeSyncStarted) return;
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  timeSyncStarted = true;
  Serial.println("[net] SNTP sync started");
}

void runConnectivityDiagnostics() {
  Serial.println("[diag] starting read-only health and no-record auth checks");

  WiFiClientSecure healthClient;
  healthClient.setCACert(config::kBackendRootCa);
  HTTPClient healthRequest;
  healthRequest.setTimeout(config::kHttpTimeoutMs);
  if (!healthRequest.begin(healthClient, makeEndpoint("/api/health"))) {
    Serial.println("[diag] could not initialize HTTPS health request");
  } else {
    const int healthStatus = healthRequest.GET();
    logHttpResult("GET /api/health", healthStatus, healthClient);
    healthRequest.end();
  }

  WiFiClientSecure authClient;
  authClient.setCACert(config::kBackendRootCa);
  HTTPClient authRequest;
  authRequest.setTimeout(config::kHttpTimeoutMs);
  if (!authRequest.begin(authClient, makeEndpoint("/api/device-events"))) {
    Serial.println("[diag] could not initialize HTTPS device-event request");
    return;
  }

  authRequest.addHeader("Content-Type", "application/json");
  authRequest.addHeader("X-Device-Token", config::kDeviceToken);
  const int authStatus = authRequest.POST("{");
  if (authStatus == 400) {
    Serial.println(
        "[diag] device token accepted; deliberately malformed JSON rejected; "
        "no event was stored");
  } else if (authStatus == 401) {
    Serial.println("[diag] device token rejected with HTTP 401");
  } else if (authStatus == 403) {
    Serial.println("[diag] device request forbidden with HTTP 403");
  } else if (authStatus == 503) {
    Serial.println("[diag] backend device ingestion is not configured (HTTP 503)");
  } else {
    logHttpResult("POST /api/device-events diagnostic", authStatus, authClient);
  }
  authRequest.end();
}

void logWifiConnected() {
  Serial.print("[net] Wi-Fi connected; local IP=");
  Serial.println(WiFi.localIP());
}

void makeEventId(char* output, size_t outputLength) {
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));
  bytes[6] = static_cast<uint8_t>((bytes[6] & 0x0F) | 0x40);
  bytes[8] = static_cast<uint8_t>((bytes[8] & 0x3F) | 0x80);
  snprintf(
      output,
      outputLength,
      "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
      bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
      bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
  );
}

bool timestampNow(char* output, size_t outputLength) {
  const time_t now = time(nullptr);
  if (!systemTimeIsValid()) {
    return false;
  }
  struct tm utcTime;
  gmtime_r(&now, &utcTime);
  return strftime(output, outputLength, "%Y-%m-%dT%H:%M:%SZ", &utcTime) > 0;
}

bool timestampForEvent(const QueuedEvent& event, char* output, size_t outputLength) {
  if (event.timestamp[0] != '\0') {
    strlcpy(output, event.timestamp, outputLength);
    return true;
  }

  const time_t now = time(nullptr);
  if (!systemTimeIsValid()) return false;
  const uint32_t elapsedMs = millis() - event.createdAtMs;
  const time_t eventTime = now - static_cast<time_t>(elapsedMs / 1000);
  struct tm utcTime;
  gmtime_r(&eventTime, &utcTime);
  return strftime(output, outputLength, "%Y-%m-%dT%H:%M:%SZ", &utcTime) > 0;
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    startTimeSync();
    return true;
  }

  const uint32_t now = millis();
  if (wifiAttempted && now - lastWifiAttempt < config::kWifiReconnectIntervalMs) {
    return false;
  }
  lastWifiAttempt = now;
  wifiAttempted = true;
  Serial.println("[net] attempting Wi-Fi connection");
  WiFi.mode(WIFI_STA);
  WiFi.begin(config::kWifiSsid, config::kWifiPassword);
  for (uint8_t attempt = 0; attempt < 20; ++attempt) {
    if (WiFi.status() == WL_CONNECTED) {
      logWifiConnected();
      startTimeSync();
      return true;
    }
    vTaskDelay(pdMS_TO_TICKS(500));
  }
  Serial.printf("[net] Wi-Fi connection timed out; status=%d\n", WiFi.status());
  return false;
}

bool postEvent(const QueuedEvent& event) {
  WiFiClientSecure secureClient;
  secureClient.setCACert(config::kBackendRootCa);

  HTTPClient http;
  http.setTimeout(config::kHttpTimeoutMs);
  if (!http.begin(secureClient, makeEndpoint("/api/device-events"))) {
    Serial.println("[net] could not initialize HTTPS event request");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", config::kDeviceToken);

  JsonDocument document;
  document["event_id"] = event.eventId;
  document["device_id"] = config::kDeviceId;
  char timestamp[25];
  if (!timestampForEvent(event, timestamp, sizeof(timestamp))) {
    http.end();
    return false;
  }
  document["timestamp"] = timestamp;
  document["sensor_summary"] = event.summary;
  document["source"] = "esp32_sensor";
  document["status"] = "unverified";
  if (event.impactMagnitudeValid) {
    document["impact_magnitude"] = event.impactMagnitudeMps2;
  } else {
    document["impact_magnitude"] = nullptr;
  }
  if (event.gpsValid) {
    document["latitude"] = event.latitude;
    document["longitude"] = event.longitude;
  } else {
    document["latitude"] = nullptr;
    document["longitude"] = nullptr;
  }
  if (event.classified) {
    document["severity"] = event.severity;
    document["event_type"] = event.eventType;
  } else {
    document["severity"] = nullptr;
    document["event_type"] = nullptr;
  }
  String body;
  serializeJson(document, body);
  const int statusCode = http.POST(body);
  logHttpResult("POST /api/device-events", statusCode, secureClient);
  http.end();
  return statusCode == HTTP_CODE_OK || statusCode == HTTP_CODE_ACCEPTED;
}

void uploaderTask(void*) {
  QueuedEvent event{};
  bool hasPendingEvent = false;
  bool diagnosticsRun = false;
  bool clockWaitLogged = false;
  bool clockReadyLogged = false;
  uint32_t lastClockWaitLog = 0;
  while (true) {
    if (!connectWifi()) {
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    if (!systemTimeIsValid()) {
      const uint32_t now = millis();
      if (!clockWaitLogged || now - lastClockWaitLog >= 5000) {
        Serial.println("[net] waiting for valid SNTP time before HTTPS");
        clockWaitLogged = true;
        lastClockWaitLog = now;
      }
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    if (!clockReadyLogged) {
      Serial.println("[net] system time is valid");
      clockReadyLogged = true;
    }

    if (config::kNetworkDiagnosticMode) {
      if (!diagnosticsRun) {
        runConnectivityDiagnostics();
        diagnosticsRun = true;
      }
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    if (!hasPendingEvent) {
      if (xQueueReceive(uploadQueue, &event, pdMS_TO_TICKS(1000)) != pdTRUE) {
        continue;
      }
      hasPendingEvent = true;
    }

    if (WiFi.status() != WL_CONNECTED) {
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    bool delivered = false;
    for (uint8_t attempt = 0; attempt < config::kUploadRetryLimit; ++attempt) {
      if (WiFi.status() == WL_CONNECTED && postEvent(event)) {
        delivered = true;
        break;
      }
      if (attempt + 1 < config::kUploadRetryLimit) {
        const uint32_t exponentialBackoff = 1000UL << attempt;
        const uint32_t backoffMs =
            exponentialBackoff < 16000UL ? exponentialBackoff : 16000UL;
        vTaskDelay(pdMS_TO_TICKS(backoffMs));
      }
    }
    if (!delivered) {
      portENTER_CRITICAL(&uploadStatsMux);
      ++failedUploads;
      portEXIT_CRITICAL(&uploadStatsMux);
      vTaskDelay(pdMS_TO_TICKS(config::kUploadRetryDelayMs));
    } else {
      hasPendingEvent = false;
    }
  }
}
}

bool beginWifiUploader() {
  if (!configured()) {
    return false;
  }
  if (uploadQueue == nullptr) {
    uploadQueue = xQueueCreate(kQueueLength, sizeof(QueuedEvent));
    if (uploadQueue == nullptr) {
      Serial.println("[net] could not allocate event queue");
      return false;
    }
  }
  const BaseType_t taskCreated = xTaskCreatePinnedToCore(
      uploaderTask,
      "roadwatch-uploader",
      8192,
      nullptr,
      1,
      nullptr,
      0);
  if (taskCreated != pdPASS) {
    Serial.println("[net] could not start uploader task");
    return false;
  }
  return true;
}

bool queueCandidate(
    const char* sensorSummary,
    bool gpsValid,
    double latitude,
    double longitude,
    const char* severity,
    const char* eventType,
    float impactMagnitudeMps2
) {
  QueuedEvent event{};
  if (uploadQueue == nullptr || sensorSummary == nullptr ||
      std::strlen(sensorSummary) == 0 ||
      std::strlen(sensorSummary) >= kSummaryLength) {
    return false;
  }
  const bool classified = severity != nullptr && eventType != nullptr;
  if ((severity == nullptr) != (eventType == nullptr)) {
    return false;
  }
  if (classified &&
      (std::strlen(severity) >= sizeof(event.severity) ||
       std::strlen(eventType) >= sizeof(event.eventType))) {
    return false;
  }
  if (gpsValid &&
      (!std::isfinite(latitude) || !std::isfinite(longitude) ||
       latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)) {
    return false;
  }
  if (
      !std::isfinite(impactMagnitudeMps2) ||
      (impactMagnitudeMps2 < 0.0f && impactMagnitudeMps2 != -1.0f)) {
    return false;
  }

  makeEventId(event.eventId, sizeof(event.eventId));
  timestampNow(event.timestamp, sizeof(event.timestamp));
  event.createdAtMs = millis();
  strlcpy(event.summary, sensorSummary, sizeof(event.summary));
  if (classified) {
    strlcpy(event.severity, severity, sizeof(event.severity));
    strlcpy(event.eventType, eventType, sizeof(event.eventType));
  }
  event.latitude = latitude;
  event.longitude = longitude;
  event.gpsValid = gpsValid;
  event.classified = classified;
  event.impactMagnitudeValid = impactMagnitudeMps2 >= 0.0f;
  event.impactMagnitudeMps2 =
      event.impactMagnitudeValid ? impactMagnitudeMps2 : 0.0f;
  return xQueueSend(uploadQueue, &event, 0) == pdTRUE;
}

uint32_t uploadFailureCount() {
  portENTER_CRITICAL(&uploadStatsMux);
  const uint32_t result = failedUploads;
  portEXIT_CRITICAL(&uploadStatsMux);
  return result;
}
