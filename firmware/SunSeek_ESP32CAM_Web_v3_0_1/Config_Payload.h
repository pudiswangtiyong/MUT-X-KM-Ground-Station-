#pragma once
// ============================================================
// SunSeek ESP32-CAM Payload v3.0 — USER / WORKSHOP CONFIG
// Safe to edit for normal workshop deployment.
// ============================================================
#define PAYLOAD_WIFI_AP_MODE       1
#define PAYLOAD_WIFI_SSID          "SUNSEEK-PAYLOAD"
#define PAYLOAD_WIFI_PASSWORD      "sunseek01"   // >= 8 chars
#define PAYLOAD_STA_SSID           "YOUR_WIFI"
#define PAYLOAD_STA_PASSWORD       "YOUR_PASSWORD"
#define PAYLOAD_UART_BAUD          115200
#define PAYLOAD_HTTP_PORT          80
#define PAYLOAD_IMAGE_PREFIX       "/IMG_"
#define PAYLOAD_STREAM_DEFAULT_ON  0
#define PAYLOAD_STREAM_FRAME_MS    80
