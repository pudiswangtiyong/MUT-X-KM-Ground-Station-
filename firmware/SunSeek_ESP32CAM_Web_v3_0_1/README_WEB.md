# ESP32-CAM Web firmware v3.0.1

Target: AI Thinker ESP32-CAM / OV2640. Do not upload to the ESP32-S3 TTC board.
Based on the provided SunSeek ESP32-CAM Payload v3.0 source. UART commands and camera/SD pins are preserved.

## One-time board update

Open SunSeek_ESP32CAM_Web_v3_0_1.ino in the existing Arduino IDE. Select AI Thinker ESP32-CAM (esp32:esp32:esp32cam) and the camera's USB/serial port. Upload using your board's normal bootloader procedure. Afterwards boot normally, with the TTC UART wiring restored. A merged binary is included for existing ESP32 flashing tools (write address 0x0, ESP32 only).

## Use from Vercel without a computer relay

1. Open https://mut-x-km-ground-station-web.vercel.app/ in current desktop Chrome/Edge (142+ with Local Network Access support).
2. Connect TTC via BLE as usual, then connect the computer's Wi-Fi to SUNSEEK-PAYLOAD (default password sunseek01). Keep the already loaded page open when that Wi-Fi has no internet.
3. Click DATA LINK CONNECT and allow the site's Local network access prompt. Allow the OS browser local-network permission if requested.
4. No IP entry: discovery uses TTC PAYLOAD_IP, saved address, AP gateway 192.168.4.1, then sunseek-cam.local / sunseek.local.
5. Live View and Capture still require the TTC/UART command path. SD card must be ready for capture and saved images.

No Python or local relay is needed for the Vercel page. Older browsers without Local Network Access support can still use the existing localhost relay version.

## Changes / validation

- CORS for the exact production Ground Station origin and localhost:8080; no wildcard or credential access.
- CORS on status, image list, image, stream, and error responses; OPTIONS preflight.
- mDNS sunseek-cam.local, web_cors=true capability in /status.
- Decode URL-encoded SD image names, including %2FIMG_001.JPG.
- Compiled using installed ESP32 core 3.3.12, AI Thinker ESP32-CAM target.
- Not flashed or tested on hardware. Compilation and mocked browser tests do not verify Wi-Fi, RF, camera, SD, or UART wiring.
