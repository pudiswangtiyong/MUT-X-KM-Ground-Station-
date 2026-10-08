const { mkdirSync, copyFileSync } = require('node:fs');
mkdirSync('dist', { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js']) {
  copyFileSync(name, `dist/${name}`);
}
copyFileSync('firmware/SunSeek_ESP32CAM_Web_v3_0_1.zip', 'dist/esp32cam-web-firmware.zip');
