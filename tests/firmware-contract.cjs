const {
  chromium
} = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      let notify, buffer = '',
        current = -20,
        target = -20,
        active = false,
        reference = 'SUN';
      window.sent = [];
      window.mockStale = false;
      window.mockReject = '';
      window.mockCaptureFail = false;
      const emit = s => {
        const bytes = new TextEncoder().encode(s + '\n');
        notify?.({
          target: {
            value: new DataView(bytes.buffer)
          }
        })
      };
      const rx = {
        properties: {
          write: true
        },
        writeValueWithResponse: async bytes => {
          buffer += new TextDecoder().decode(bytes);
          while (buffer.includes('\n')) {
            const i = buffer.indexOf('\n'),
              command = buffer.slice(0, i);
            buffer = buffer.slice(i + 1);
            window.sent.push(command);
            const parts = command.split(',');
            setTimeout(() => {
              if (window.mockReject === parts[0]) return emit('ERR,MOCK_REJECT');
              if (command === 'ADCS_MODE,AUTO') active = true;
              if (command === 'ADCS_MODE,MANUAL' || command === 'RW_STOP') active = false;
              if (parts[0] === 'SET_TARGET') target = +parts[1];
              if (parts[0] === 'ADCS_REFERENCE') reference = parts[1];
              emit('ACK,' + command);
              if (command === 'PAYLOAD_STREAM_STOP') emit('PAYLOAD,ACK,STREAM_STOP');
              if (command === 'PAYLOAD_STREAM_START') emit('PAYLOAD,ACK,STREAM_START');
              if (command === 'CAPTURE' && !window.mockCaptureHang) emit(window
                .mockCaptureFail ?
                'PAYLOAD,ERR,CAPTURE_FAILED' : 'PAYLOAD,IMAGE_READY,/IMG_001.JPG,42');
              if (command === 'PAYLOAD_STATUS') emit(
                'TM,CAMERA,READY,PAYLOAD_WIFI,READY,PAYLOAD_IP,192.168.4.1')
            }, 10)
          }
        }
      };
      const tx = {
        startNotifications: async () => {},
        addEventListener: (name, handler) => notify = handler
      };
      const device = {
        name: 'SUNSEEK-MOCK',
        addEventListener: () => {},
        gatt: {
          connected: false,
          connect: async () => {
            device.gatt.connected = true;
            return {
              getPrimaryService: async () => ({
                getCharacteristic: async id => id.includes('0002') ? rx : tx
              })
            }
          },
          disconnect: () => device.gatt.connected = false
        }
      };
      Object.defineProperty(navigator, 'bluetooth', {
        value: {
          requestDevice: async () => device
        }
      });
      setInterval(() => {
        if (!device.gatt.connected) return;
        if (active) current += Math.sign(target - current) * Math.min(Math.abs(target - current),
          5);
        if (window.mockStale) emit('TM,EST_ANGLE,NaN');
        if (!window.mockStale) {
          emit('TM,EST_RAW,' + current + ',EST_FILTERED,' + current + ',EST_ANGLE,' + current);
          emit('TM,EST_FUSION,ON,EST_GYRO_WEIGHT,0.22,EST_VALID,1')
        }
        emit('TM,ADCS_MODE,' + (active ? 'AUTO' : 'MANUAL') + ',ADCS_REFERENCE,' + reference +
          ',TARGET,' + target + ',POINTING_ERROR,' + (target - current) + ',GYRO_Z,0,RW_CMD,0');
        emit('TM,SUN_ANGLE,' + current + ',MAG_HEADING,320')
      }, 100)
    });
    const png = require('node:fs').readFileSync(require('node:path').join(__dirname, 'payload.png'));
    await page.route('**/camera?*', route => {
      const path = new URL(route.request().url()).searchParams.get('path');
      if (path === '/status') return route.fulfill({
        json: {
          ready: true,
          camera: true,
          storage: true,
          wifi: true
        }
      });
      if (path.startsWith('/image?')) return route.fulfill({
        contentType: 'image/png',
        body: png
      });
      if (path === '/images') return route.fulfill({
        json: [{
          name: '/IMG_001.JPG',
          size: 42
        }]
      });
      return route.fulfill({
        status: 503,
        body: 'STREAM_OFF'
      })
    });
    await page.goto('http://localhost:8080');
    await page.click('#bleConnectBtn');
    await page.waitForTimeout(400);
    assert.match(await page.textContent('#ttcStatus'), /CONNECTED/);
    await page.click('#wifiConnectBtn');
    await page.waitForTimeout(300);
    assert.match(await page.textContent('#wifiStatus'), /CONNECTED/);
    await page.click('[data-page="competition"]');
    await page.selectOption('#transferMode', 'end');
    await page.fill('#compRows input[type=number]:nth-match(1)', '10').catch(async () => {
      await page.locator('#compRows input').nth(0).fill('10')
    });
    await page.locator('#compRows input').nth(2).fill('0.2');
    await page.click('#compAddTarget');
    await page.locator('#compRows tr').nth(1).locator('input').nth(0).fill('-5');
    await page.locator('#compRows tr').nth(1).locator('input').nth(2).fill('0.2');
    await page.click('#prepareMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionReady').textContent.includes(
      'MISSION READY'));
    await page.click('#startMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionState').textContent ===
      'COMPLETE', {}, {
        timeout: 10000
      }).catch(async e => {
      console.log((await page.textContent('#ttcLog')).split('\n').filter(x => !x.includes(
        'RX < TM')).join('\n'));
      console.log(await page.textContent('#missionState'));
      throw e
    });
    assert.equal(await page.locator('.thumb').count(), 2);
    let sent = await page.evaluate(() => window.sent);
    assert(sent.includes('SET_TARGET,10.0'));
    assert(sent.includes('SET_TARGET,-5.0'));
    assert(sent.includes('ADCS_TUNE,3.6,0.5,0'));
    assert(sent.includes('ESTIMATOR_MA_WINDOW,5'));
    assert(sent.includes('CAPTURE'));
    assert(!sent.some(c => /^(REF,|POINT,|POINT_STOP|TEL_RATE|SPEED,)/.test(c)));
    await page.evaluate(() => window.mockCaptureFail = true);
    await page.click('#compCaptureBtn');
    await page.waitForTimeout(300);
    assert.match(await page.textContent('#toast'), /CAPTURE_FAILED/);
    assert.equal(await page.locator('.thumb').count(), 2);
    await page.evaluate(() => {
      window.mockCaptureFail = false;
      window.mockReject = 'ADCS_TUNE'
    });
    await page.click('#prepareMissionBtn');
    await page.waitForTimeout(300);
    assert.match(await page.textContent('#toast'), /MOCK_REJECT/);
    assert.match(await page.textContent('#missionReady'), /NOT PREPARED/);
    await page.evaluate(() => {
      window.mockReject = '';
      window.mockStale = true
    });
    await page.waitForTimeout(3400);
    await page.click('#prepareMissionBtn');
    await page.waitForTimeout(100);
    assert.match(await page.textContent('#toast'), /telemetry/);
    await page.evaluate(() => {
      window.mockStale = false;
      window.mockCaptureHang = true;
    });
    await page.waitForTimeout(200);
    await page.selectOption('#missionDuration', 'custom');
    await page.fill('#missionMinutes', '0');
    await page.fill('#missionSeconds', '1');
    await page.selectOption('#transferMode', 'each');
    await page.locator('#compRows input').nth(0).fill('-5');
    await page.locator('#compRows input').nth(2).fill('0');
    await page.click('#prepareMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionReady').textContent.includes(
      'MISSION READY'));
    const capturesBefore = await page.evaluate(() => window.sent.filter(c => c === 'CAPTURE').length);
    await page.click('#startMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionState').textContent ===
      'TIMEOUT', {}, {
        timeout: 5000
      });
    assert.equal(await page.evaluate(() => window.sent.filter(c => c === 'CAPTURE').length),
      capturesBefore + 1);
    assert.equal(await page.evaluate(() => window.sent.at(-1)), 'RW_STOP');
    assert.equal(await page.locator('.thumb').count(), 2);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'PASS: firmware BLE framing, ACK configuration, flat TM parser, automatic IP discovery, capture via BLE and HTTP file, payload error, ACK rejection, stale estimator guard'
    );
  } finally {
    await browser.close()
  }
})().catch(e => {
  console.error(e);
  process.exit(1)
});
