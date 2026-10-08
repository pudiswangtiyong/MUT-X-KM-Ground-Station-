#pragma once
#include <Arduino.h>
#include "Config_Payload.h"
#include "System_PayloadCommand.h"
static String _rx;
inline void payloadInterfaceBegin(){Serial.begin(PAYLOAD_UART_BAUD);_rx.reserve(96);}
inline void payloadInterfaceUpdate(){while(Serial.available()){char c=(char)Serial.read();if(c=='\n'||c=='\r'){if(_rx.length()){payloadProcessCommand(_rx);_rx="";}}else if(_rx.length()<95)_rx+=c;}}
