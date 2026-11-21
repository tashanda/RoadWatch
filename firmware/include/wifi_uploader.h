#pragma once

#include <Arduino.h>

bool beginWifiUploader();
bool queueCandidate(
    const char* sensorSummary,
    bool gpsValid,
    double latitude,
    double longitude,
    const char* severity = nullptr,
    const char* eventType = nullptr
);
uint32_t uploadFailureCount();
