# Verification — 8 October 2026

Passed in headless Google Chrome against http://localhost:8080:

- Simulator: disconnected mission rejected, Prepare / Run / Complete, generated capture, Live View, abort without later false Complete, plot pause/resume, CSV download, desktop/mobile renders, mobile without horizontal page overflow, no JavaScript page errors.
- Firmware contract mock: Nordic UART framed BLE writes, v3.0.7 ADCS / estimator commands and ACK handling, flat TM parsing, PAYLOAD_IP discovery, two-target mission with deferred image transfer, CAPTURE through BLE and IMAGE_READY before HTTP download, payload capture failure, configuration ERR rejection, stale estimator rejection, no JavaScript page errors.
- JavaScript syntax and Python server/launcher compilation passed.

Hardware has not been connected or flashed during these tests. BLE RF, UART wiring, motors, sensors, SD card, camera image quality and hardware timing remain unverified. Tests use the command and telemetry formats from the provided firmware; they are not a hardware certification.

Run with `npm test` after installing Playwright and starting `python3 server.py`. Mock tests never send commands to a real board.

Additional passed checks: persisted deletion of existing profiles without automatic presets, configuration with no saved profiles, new named profiles surviving reload until deleted, centered aim reticle, fitted −90° camera rotation and 0° toggle, and Prepare resetting elapsed time and selected countdown. Firmware contract regression passed with empty profiles.


Recheck / optimization regression passed:

- Custom Competition minutes/seconds (1–3600 seconds), live countdown, preset 60 minutes; rejects zero, overflow, fractional inputs.
- Changing time invalidates Prepare; settings locked during Prepare/Run and restored afterward.
- One-second mission timeout stops the controller; timeout while waiting for IMAGE_READY also cancels capture and sends RW_STOP without adding an image.
- Repeated Abort cannot produce later Complete; elapsed timer freezes and Prepare resets it to zero.
- Hidden plots are not painted; malformed EST_ANGLE=NaN does not refresh estimator freshness.
- All four browser suites passed with no page errors after the final transport changes.
- Three Python relay contract checks passed: valid private-board endpoints, rejected invalid destinations/paths, and blocked redirects. JavaScript syntax and server/launcher compilation passed.

These tests validate behavior and reduced rendering work; they do not measure performance on a connected board.


Direct hosted-camera update:

- Firmware-contract suite passed from a mocked HTTPS production origin with direct http://192.168.4.1/status and /image requests, CORS responses, BLE capture, rejected ACKs, and mission timeout. No /camera relay requests were used.
- ESP32-CAM Web v3.0.1 compiled for esp32:esp32:esp32cam with installed ESP32 core 3.3.12 (1,139,819 bytes program, 60,508 bytes global data).
- Tests mock networking and BLE. Real browser Local Network Access permission, hardware Wi-Fi, flash/upload, SD and UART remain unverified.
