#pragma once
#include <Arduino.h>
#include "Module_Camera.h"
#include "Module_Storage.h"
#include "Module_PayloadWeb.h"
#include "System_PayloadInterface.h"
inline void payloadSystemBegin(){payloadInterfaceBegin();delay(1000);payloadSendLine("BOOT,SUNSEEK_PAYLOAD_V3.0");cameraModuleBegin();storageModuleBegin();payloadWebBegin();payloadSendLine(String("PAYLOAD,")+(payloadReady()?"READY":"NOT_READY"));payloadSendLine("WIFI_IP,"+payloadIP());payloadSendLine(payloadStatusLine());}
inline void payloadSystemUpdate(){payloadInterfaceUpdate();}
