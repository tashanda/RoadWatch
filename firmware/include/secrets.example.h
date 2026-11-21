#pragma once

// Copy to secrets.h locally and replace with your own network/service settings.
// Never commit secrets.h or put real credentials in this example.
#define ROADWATCH_WIFI_SSID ""
#define ROADWATCH_WIFI_PASSWORD ""
#define ROADWATCH_BACKEND_URL "https://your-roadwatch.vercel.app"
#define ROADWATCH_DEVICE_TOKEN ""
// Set to 1 to emit BNO055 calibration and detector samples at the debug rate.
#define ROADWATCH_DETECTOR_DEBUG 0
// Set to 1 for a no-record Wi-Fi/TLS/API check; it suppresses event uploads.
#define ROADWATCH_DIAGNOSTIC_MODE 0
