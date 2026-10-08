#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include "Config_Payload.h"
#include "Module_Camera.h"
#include "Module_Storage.h"
static volatile bool _streamEnabled=(PAYLOAD_STREAM_DEFAULT_ON!=0);
inline bool payloadStreamEnabled(){return _streamEnabled;}
inline void payloadSetStreamEnabled(bool v){_streamEnabled=v;}
inline bool payloadWifiReady(){return WiFi.getMode()==WIFI_AP || WiFi.status()==WL_CONNECTED;}
inline bool payloadReady(){return cameraModuleReady() && payloadWifiReady();}
inline String payloadIP(){return PAYLOAD_WIFI_AP_MODE?WiFi.softAPIP().toString():WiFi.localIP().toString();}
inline String payloadStatusLine(){String s="STATUS,";s+=payloadReady()?"READY":"NOT_READY";s+=",CAMERA,"+String(cameraModuleReady()?"OK":"ERR");s+=",STORAGE,"+String(storageModuleReady()?"OK":"ERR");s+=",WIFI,"+String(payloadWifiReady()?"READY":"NOT_READY");s+=",IP,"+payloadIP();s+=",STREAM,"+String(payloadStreamEnabled()?"ON":"OFF");s+=",IMAGE_COUNT,"+String(storageImageCount());s+=",LAST_IMAGE,"+storageLastImage();return s;}
