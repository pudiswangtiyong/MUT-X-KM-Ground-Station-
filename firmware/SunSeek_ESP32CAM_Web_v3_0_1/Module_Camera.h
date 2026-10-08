#pragma once
#include <Arduino.h>
#include "esp_camera.h"
#include "Config_Camera.h"

// AI Thinker ESP32-CAM + OV2640 pin map
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

static bool _cameraReady=false;
inline bool cameraModuleReady(){ return _cameraReady; }
inline bool cameraModuleBegin(){
  camera_config_t c={};
  c.ledc_channel=LEDC_CHANNEL_0; c.ledc_timer=LEDC_TIMER_0;
  c.pin_d0=Y2_GPIO_NUM; c.pin_d1=Y3_GPIO_NUM; c.pin_d2=Y4_GPIO_NUM; c.pin_d3=Y5_GPIO_NUM;
  c.pin_d4=Y6_GPIO_NUM; c.pin_d5=Y7_GPIO_NUM; c.pin_d6=Y8_GPIO_NUM; c.pin_d7=Y9_GPIO_NUM;
  c.pin_xclk=XCLK_GPIO_NUM; c.pin_pclk=PCLK_GPIO_NUM; c.pin_vsync=VSYNC_GPIO_NUM; c.pin_href=HREF_GPIO_NUM;
  c.pin_sccb_sda=SIOD_GPIO_NUM; c.pin_sccb_scl=SIOC_GPIO_NUM; c.pin_pwdn=PWDN_GPIO_NUM; c.pin_reset=RESET_GPIO_NUM;
  c.xclk_freq_hz=PAYLOAD_XCLK_HZ; c.pixel_format=PIXFORMAT_JPEG;
  c.frame_size=PAYLOAD_FRAME_SIZE; c.jpeg_quality=PAYLOAD_JPEG_QUALITY;
  c.fb_count=psramFound()?2:1; c.grab_mode=CAMERA_GRAB_LATEST;
  c.fb_location=psramFound()?CAMERA_FB_IN_PSRAM:CAMERA_FB_IN_DRAM;
  _cameraReady=(esp_camera_init(&c)==ESP_OK); return _cameraReady;
}
inline camera_fb_t* cameraModuleGetFrame(){ return _cameraReady?esp_camera_fb_get():nullptr; }
inline void cameraModuleReturnFrame(camera_fb_t* fb){ if(fb) esp_camera_fb_return(fb); }
