/* SunSeek ESP32-CAM Payload Firmware v3.0
   Target: AI Thinker ESP32-CAM + OV2640 + microSD
   Control plane: UART0 (GPIO3 RX / GPIO1 TX)
   Data plane: Wi-Fi / HTTP
   File policy: Config_* user editable; Module_* developer extension; System_* core.
*/
#include "Config_Payload.h"
#include "Config_Camera.h"
#include "System_Payload.h"
void setup(){payloadSystemBegin();}
void loop(){payloadSystemUpdate();delay(2);}
