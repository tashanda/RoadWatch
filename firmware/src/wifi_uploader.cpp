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
  bool gpsValid;
  bool classified;
};

QueueHandle_t uploadQueue = nullptr;
uint32_t failedUploads = 0;
portMUX_TYPE uploadStatsMux = portMUX_INITIALIZER_UNLOCKED;
uint32_t lastWifiAttempt = 0;
bool wifiAttempted = false;
bool timeSyncStarted = false;

bool configured() {
  return std::strlen(config::kWifiSsid) > 0 &&
      std::strlen(config::kBackendUrl) > 0 &&
      std::strncmp(config::kBackendUrl, "https://", 8) == 0 &&
      std::strlen(config::kDeviceToken) > 0 &&
      std::strlen(config::kBackendRootCa) > 0;
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
  if (now < static_cast<time_t>(kTimeSyncEpoch)) {
    return false;
  }
  struct tm utcTime;
  gmtime_r(&now, &utcTime);
  return strftime(output, outputLength, "%Y-%m-%dT%H:%M:%SZ", &utcTime) > 0;
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!timeSyncStarted) {
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
      timeSyncStarted = true;
    }
    return true;
  }

  const uint32_t now = millis();
  if (wifiAttempted && now - lastWifiAttempt < config::kWifiReconnectIntervalMs) {
    return false;
  }
  lastWifiAttempt = now;
  wifiAttempted = true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(config::kWifiSsid, config::kWifiPassword);
  for (uint8_t attempt = 0; attempt < 20; ++attempt) {
    if (WiFi.status() == WL_CONNECTED) {
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
      timeSyncStarted = true;
      return true;
    }
    vTaskDelay(pdMS_TO_TICKS(500));
  }
  return false;
}

bool postEvent(const QueuedEvent& event) {
  WiFiClientSecure secureClient;
  secureClient.setCACert(config::kBackendRootCa);

  HTTPClient http;
  String endpoint(config::kBackendUrl);
  while (endpoint.endsWith("/")) {
    endpoint.remove(endpoint.length() - 1);
  }
  endpoint += "/api/device-events";
  http.setTimeout(config::kHttpTimeoutMs);
  if (!http.begin(secureClient, endpoint)) {
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", config::kDeviceToken);

  JsonDocument document;
  document["event_id"] = event.eventId;
  document["device_id"] = config::kDeviceId;
  document["timestamp"] = event.timestamp;
  document["sensor_summary"] = event.summary;
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
  http.end();
  return statusCode == HTTP_CODE_OK || statusCode == HTTP_CODE_ACCEPTED;
}

void uploaderTask(void*) {
  QueuedEvent event{};
  while (true) {
    if (!connectWifi()) {
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    if (xQueueReceive(uploadQueue, &event, pdMS_TO_TICKS(1000)) != pdTRUE) {
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
      return false;
    }
  }
  return xTaskCreatePinnedToCore(
             uploaderTask,
             "roadwatch-uploader",
             8192,
             nullptr,
             1,
             nullptr,
             0
         ) == pdPASS;
}

bool queueCandidate(
    const char* sensorSummary,
    bool gpsValid,
    double latitude,
    double longitude,
    const char* severity,
    const char* eventType
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

  makeEventId(event.eventId, sizeof(event.eventId));
  if (!timestampNow(event.timestamp, sizeof(event.timestamp))) {
    return false;
  }
  strlcpy(event.summary, sensorSummary, sizeof(event.summary));
  if (classified) {
    strlcpy(event.severity, severity, sizeof(event.severity));
    strlcpy(event.eventType, eventType, sizeof(event.eventType));
  }
  event.latitude = latitude;
  event.longitude = longitude;
  event.gpsValid = gpsValid;
  event.classified = classified;
  return xQueueSend(uploadQueue, &event, 0) == pdTRUE;
}

uint32_t uploadFailureCount() {
  portENTER_CRITICAL(&uploadStatsMux);
  const uint32_t result = failedUploads;
  portEXIT_CRITICAL(&uploadStatsMux);
  return result;
}
