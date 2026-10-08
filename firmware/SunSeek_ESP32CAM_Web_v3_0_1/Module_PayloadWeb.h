#pragma once
#include "Config_Payload.h"
#include "Module_Camera.h"
#include "Module_Storage.h"
#include "SD_MMC.h"
#include "System_PayloadState.h"
#include "esp_http_server.h"
#include <Arduino.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>
static httpd_handle_t _http = nullptr;

// Read-only camera data may be read only by the deployed Ground Station.
// UART continues to be the sole command interface.
inline bool webCors(httpd_req_t *r) {
  const size_t length = httpd_req_get_hdr_value_len(r, "Origin");
  if (length == 0)
    return true; // Board-native pages / same-origin requests.
  char origin[192] = {0};
  if (length >= sizeof(origin) ||
      httpd_req_get_hdr_value_str(r, "Origin", origin, sizeof(origin)) !=
          ESP_OK)
    return false;
  if (strcmp(origin, "https://mut-x-km-ground-station-web.vercel.app") != 0 &&
      strcmp(origin, "http://localhost:8080") != 0 &&
      strcmp(origin, "http://127.0.0.1:8080") != 0)
    return false;
  httpd_resp_set_hdr(r, "Access-Control-Allow-Origin", origin);
  httpd_resp_set_hdr(r, "Vary", "Origin");
  httpd_resp_set_hdr(r, "Access-Control-Allow-Methods", "GET, OPTIONS");
  httpd_resp_set_hdr(r, "Access-Control-Allow-Private-Network", "true");
  httpd_resp_set_hdr(r, "Access-Control-Max-Age", "600");
  return true;
}
inline esp_err_t webForbidden(httpd_req_t *r) {
  httpd_resp_set_status(r, "403 Forbidden");
  return httpd_resp_send(r, "ORIGIN_NOT_ALLOWED", HTTPD_RESP_USE_STRLEN);
}
inline esp_err_t hOptions(httpd_req_t *r) {
  if (!webCors(r))
    return webForbidden(r);
  httpd_resp_set_status(r, "204 No Content");
  return httpd_resp_send(r, nullptr, 0);
}
inline String webDecodeName(const char *value) {
  String output;
  for (size_t i = 0; value[i]; ++i) {
    if (value[i] == '%' && value[i + 1] && value[i + 2]) {
      char hex[3] = {value[i + 1], value[i + 2], 0};
      if (!isxdigit(hex[0]) || !isxdigit(hex[1]))
        return "";
      char c = (char)strtol(hex, nullptr, 16);
      if (!c || c == '\r' || c == '\n')
        return "";
      output += c;
      i += 2;
    } else
      output += value[i];
  }
  return output;
}

inline esp_err_t webSendText(httpd_req_t *r, const char *type, const String &s,
                             int code = 200) {
  if (!webCors(r))
    return webForbidden(r);
  httpd_resp_set_type(r, type);
  if (code == 400)
    httpd_resp_set_status(r, "400 Bad Request");
  if (code == 404)
    httpd_resp_set_status(r, "404 Not Found");
  if (code == 503)
    httpd_resp_set_status(r, "503 Service Unavailable");
  return httpd_resp_send(r, s.c_str(), s.length());
}
inline String webStatusJson() {
  String s = "{";
  s += "\"ready\":" + String(payloadReady() ? "true" : "false");
  s += ",\"camera\":" + String(cameraModuleReady() ? "true" : "false");
  s += ",\"storage\":" + String(storageModuleReady() ? "true" : "false");
  s += ",\"wifi\":" + String(payloadWifiReady() ? "true" : "false");
  s += ",\"stream\":\"" + String(payloadStreamEnabled() ? "ON" : "OFF") + "\"";
  s += ",\"image_count\":" + String(storageImageCount());
  s += ",\"last_image\":\"" + storageLastImage() + "\"";
  s += ",\"last_image_size\":" + String((unsigned long)storageLastImageSize());
  s += "}";
  return s;
}
inline esp_err_t hStatus(httpd_req_t *r) {
  String s = webStatusJson();
  s.remove(s.length() - 1);
  s += ",\"web_cors\":true}";
  return webSendText(r, "application/json", s);
}
inline esp_err_t hImages(httpd_req_t *r) {
  if (!storageModuleReady())
    return webSendText(r, "application/json",
                       "{\"error\":\"STORAGE_NOT_READY\"}", 503);
  String s = "[";
  bool first = true;
  File root = SD_MMC.open("/");
  if (root) {
    File f = root.openNextFile();
    while (f) {
      String n = f.name(), u = n;
      u.toUpperCase();
      if (!f.isDirectory() && u.endsWith(".JPG")) {
        if (!first)
          s += ",";
        if (!n.startsWith("/"))
          n = "/" + n;
        s += "{\"name\":\"" + n +
             "\",\"size\":" + String((unsigned long)f.size()) + "}";
        first = false;
      }
      f = root.openNextFile();
    }
  }
  s += "]";
  return webSendText(r, "application/json", s);
}
inline esp_err_t hImage(httpd_req_t *r) {
  if (!webCors(r))
    return webForbidden(r);
  if (!storageModuleReady())
    return webSendText(r, "text/plain", "STORAGE_NOT_READY", 503);
  char q[160] = {0}, name[128] = {0};
  if (httpd_req_get_url_query_str(r, q, sizeof(q)) != ESP_OK ||
      httpd_query_key_value(q, "name", name, sizeof(name)) != ESP_OK)
    return webSendText(r, "text/plain", "BAD_REQUEST", 400);
  String p = webDecodeName(name);
  if (p.length() == 0)
    return webSendText(r, "text/plain", "INVALID_IMAGE_NAME", 400);
  if (!p.startsWith("/"))
    p = "/" + p;
  String u = p;
  u.toUpperCase();
  if (p.indexOf("..") >= 0 || !u.endsWith(".JPG"))
    return webSendText(r, "text/plain", "INVALID_IMAGE_NAME", 400);
  File f = SD_MMC.open(p, FILE_READ);
  if (!f)
    return webSendText(r, "text/plain", "IMAGE_NOT_FOUND", 404);
  httpd_resp_set_type(r, "image/jpeg");
  uint8_t b[1024];
  while (f.available()) {
    size_t n = f.read(b, sizeof(b));
    if (httpd_resp_send_chunk(r, (const char *)b, n) != ESP_OK) {
      f.close();
      return ESP_FAIL;
    }
  }
  f.close();
  return httpd_resp_send_chunk(r, nullptr, 0);
}
inline esp_err_t hStream(httpd_req_t *r) {
  if (!webCors(r))
    return webForbidden(r);
  if (!cameraModuleReady())
    return webSendText(r, "text/plain", "CAMERA_NOT_READY", 503);
  if (!payloadStreamEnabled())
    return webSendText(r, "text/plain", "STREAM_OFF", 503);
  httpd_resp_set_type(r, "multipart/x-mixed-replace;boundary=frame");
  while (payloadStreamEnabled()) {
    camera_fb_t *fb = cameraModuleGetFrame();
    if (!fb) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }
    char head[96];
    int n = snprintf(
        head, sizeof(head),
        "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
        (unsigned)fb->len);
    esp_err_t e = httpd_resp_send_chunk(r, head, n);
    if (e == ESP_OK)
      e = httpd_resp_send_chunk(r, (const char *)fb->buf, fb->len);
    if (e == ESP_OK)
      e = httpd_resp_send_chunk(r, "\r\n", 2);
    cameraModuleReturnFrame(fb);
    if (e != ESP_OK)
      break;
    vTaskDelay(pdMS_TO_TICKS(PAYLOAD_STREAM_FRAME_MS));
  }
  return httpd_resp_send_chunk(r, nullptr, 0);
}
inline esp_err_t hRoot(httpd_req_t *r) {
  String h = "<!doctype html><html><body><h2>SunSeek Payload "
             "v3.0</h2><p>Engineering / fallback interface</p><p><a "
             "href='/status'>Status</a> | <a href='/images'>Images</a> | <a "
             "href='/stream'>Live Stream</a></p><p>STREAM must be ON. Use "
             "Serial/OBC command STREAM_START.</p></body></html>";
  return webSendText(r, "text/html", h);
}
inline void payloadWebBegin() {
#if PAYLOAD_WIFI_AP_MODE
  WiFi.mode(WIFI_AP);
  WiFi.softAP(PAYLOAD_WIFI_SSID, PAYLOAD_WIFI_PASSWORD);
#else
  WiFi.mode(WIFI_STA);
  WiFi.begin(PAYLOAD_STA_SSID, PAYLOAD_STA_PASSWORD);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000)
    delay(100);
#endif
  MDNS.begin("sunseek-cam");
  MDNS.addService("http", "tcp", PAYLOAD_HTTP_PORT);
  httpd_config_t c = HTTPD_DEFAULT_CONFIG();
  c.server_port = PAYLOAD_HTTP_PORT;
  c.max_uri_handlers = 16;
  c.uri_match_fn = httpd_uri_match_wildcard;
  if (httpd_start(&_http, &c) == ESP_OK) {
    httpd_uri_t a = {.uri = "/status",
                     .method = HTTP_GET,
                     .handler = hStatus,
                     .user_ctx = nullptr};
    httpd_register_uri_handler(_http, &a);
    httpd_uri_t b = {.uri = "/images",
                     .method = HTTP_GET,
                     .handler = hImages,
                     .user_ctx = nullptr};
    httpd_register_uri_handler(_http, &b);
    httpd_uri_t d = {.uri = "/image",
                     .method = HTTP_GET,
                     .handler = hImage,
                     .user_ctx = nullptr};
    httpd_register_uri_handler(_http, &d);
    httpd_uri_t e = {.uri = "/stream",
                     .method = HTTP_GET,
                     .handler = hStream,
                     .user_ctx = nullptr};
    httpd_register_uri_handler(_http, &e);
    httpd_uri_t f = {
        .uri = "/", .method = HTTP_GET, .handler = hRoot, .user_ctx = nullptr};
    httpd_register_uri_handler(_http, &f);
    httpd_uri_t pre = {.uri = "/*",
                       .method = HTTP_OPTIONS,
                       .handler = hOptions,
                       .user_ctx = nullptr};
    httpd_register_uri_handler(_http, &pre);
  }
}
