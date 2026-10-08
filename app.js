'use strict';
(() => {
  const elements = new Map();
  const $ = id => {
      if (!elements.has(id)) elements.set(id, document.getElementById(id));
      return elements.get(id)
    },
    SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const localRelayAvailable = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!localRelayAvailable) {
    const notice = document.createElement('p');
    notice.className = 'connectionHint';
    notice.textContent =
      'DIRECT CAMERA · ใช้ Chrome/Edge รุ่นปัจจุบัน เชื่อม Wi-Fi SUNSEEK-PAYLOAD แล้วกด DATA LINK CONNECT และอนุญาต Local network access · กล้องต้องใช้เฟิร์มแวร์ที่รองรับ Web CORS';
    const firmwareLink = document.createElement('a');
    firmwareLink.href = '/esp32cam-web-firmware.zip';
    firmwareLink.textContent = ' ดาวน์โหลดเฟิร์มแวร์ ESP32-CAM สำหรับเว็บ';
    firmwareLink.download = 'SunSeek_ESP32CAM_Web_v3_0_1.zip';
    notice.appendChild(firmwareLink);
    document.querySelector('header').insertAdjacentElement('afterend', notice);
  }
  let logRenderTimer = null,
    plotDirty = true,
    prepareController = null;
  const textCache = new Map();

  function setText(id, value) {
    if (textCache.get(id) !== value) {
      $(id).textContent = value;
      textCache.set(id, value)
    }
  }

  function checkCancelled(signal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Error('ABORTED')
  }

  function storeSample(sample) {
    history.push(sample);
    while (history.length > 2400 || history[0]?.time < sample.time - 120000) history.shift();
    if (logging) records.push(sample);
    plotDirty = true
  }

  let awaiting = null,
    lastAngle = 0,
    lastImage = '',
    captureBusy = false;
  let demo = false,
    device, rx, decoder = new TextDecoder(),
    buffer = '',
    base = '',
    wifi = false,
    connecting = false,
    bleConnecting = false,
    queue = Promise.resolve(),
    lastTelemetry = 0,
    paused = false,
    logging = false,
    records = [],
    logs = [],
    history = [],
    images = [],
    live = new Map(),
    job = null,
    prepared = null,
    hostHint = '',
    discoveryId = 0;
  const tele = {
    ref: 'SUN',
    valid: null,
    gyro: null,
    mag: null,
    sun: null,
    current: null,
    target: null,
    error: null,
    rate: null,
    rw: null,
    active: null
  };
  // One-time removal of existing saved profiles, requested by the user.
  const PROFILE_RESET_VERSION = '2026-10-08-clear-all';
  let profiles = {};
  try {
    if (localStorage.getItem('sunseek.profiles.reset') !== PROFILE_RESET_VERSION) {
      localStorage.setItem('sunseek.profiles', '{}');
      localStorage.setItem('sunseek.profiles.reset', PROFILE_RESET_VERSION);
    }
    profiles = validateProfiles(JSON.parse(localStorage.getItem('sunseek.profiles'))) || {};
  } catch {}
  const opTargets = [{
      angle: 0,
      tol: 2,
      hold: 2,
      action: 'NONE'
    }],
    compTargets = [{
      angle: 0,
      tol: 3,
      hold: 2,
      action: 'CAPTURE'
    }];

  function toast(s) {
    $('toast').textContent = s;
    $('toast').style.display = 'block';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $('toast').style.display = 'none', 5500)
  }

  function log(s) {
    logs.push({
      time: new Date().toISOString(),
      message: s
    });
    if (logs.length > 1500) logs.shift();
    if (logRenderTimer === null) logRenderTimer = setTimeout(() => {
      logRenderTimer = null;
      renderLogs()
    }, 100)
  }

  function renderLogs() {
    const f = $('logFilter').value;
    const text = logs.filter(x => f === 'ALL' || x.message.includes(f)).map(x =>
      `[${new Date(x.time).toLocaleTimeString()}] ${x.message}`).join('\n');
    if ($('ttcLog').getClientRects().length) setText('ttcLog', text);
    if ($('eventLog').getClientRects().length) setText('eventLog', text);
    if ($('autoScroll').checked) {
      $('ttcLog').scrollTop = $('ttcLog').scrollHeight;
      $('eventLog').scrollTop = $('eventLog').scrollHeight
    }
  }

  function download(data, name, type = 'text/plain') {
    const u = URL.createObjectURL(new Blob([data], {
        type
      })),
      a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000)
  }

  function bleOk() {
    return demo || !!(rx && device?.gatt.connected)
  }

  function invalidate() {
    prepared = null;
    $('missionReady').textContent = '○ NOT PREPARED';
    if ($('opActivity').textContent === 'READY') $('opActivity').textContent = 'NOT PREPARED'
  }

  function resetTele() {
    lastAngle = 0;
    for (const k of Object.keys(tele))
      if (k !== 'ref') tele[k] = null;
    lastTelemetry = 0;
    updateUI()
  }

  function setBle(ok) {
    $('ttcStatus').textContent = ok ? (demo ? 'TTC • SIMULATED' : 'TTC • CONNECTED') : 'TTC • DISCONNECTED';
    $('ttcStatus').className = 'linkStatus ' + (ok ? 'ok' : '');
    $('bleConnectBtn').textContent = ok ? 'DISCONNECT' : 'CONNECT';
    if (!ok) {
      resetTele();
      invalidate()
    }
    updateUI()
  }

  function setWifi(ok) {
    wifi = ok;
    $('wifiStatus').textContent = ok ? (demo ? 'DATA LINK • SIMULATED' : 'DATA LINK • CONNECTED') :
      'DATA LINK • DISCONNECTED';
    $('wifiStatus').className = 'linkStatus ' + (ok ? 'ok' : '');
    $('wifiConnectBtn').textContent = ok ? 'DISCONNECT' : 'CONNECT';
    $('payloadState').textContent = 'PAYLOAD LINK ' + (ok ? 'ON' : 'OFF');
    $('payloadState').className = ok ? 'on' : 'off';
    if (!ok) invalidate();
    $('footerStatus').textContent = demo ? 'SIMULATION · no hardware commands' : ok ?
      'Camera data link ready' : 'Awaiting spacecraft connection'
  }
  async function send(command, signal) {
    checkCancelled(signal);
    if (new TextEncoder().encode(command).length > 239) throw Error('BLE command exceeds 239 bytes');
    if (!command.trim() || /[\r\n]/.test(command)) throw Error('คำสั่งต้องเป็นหนึ่งบรรทัด');
    if (!bleOk()) throw Error('เชื่อมต่อ TTC ก่อน');
    if (demo) {
      log('TX SIM > ' + command);
      simulateCommand(command);
      return
    }
    const writer = rx,
      connection = device;
    const task = queue.catch(() => {}).then(async () => {
      checkCancelled(signal);
      if (rx !== writer || device !== connection || !connection.gatt.connected) throw Error(
        'TTC connection changed');
      const bytes = new TextEncoder().encode(command + '\n');
      // Finish a started newline-framed command atomically; cancelling halfway would corrupt the next STOP line.
      for (let i = 0; i < bytes.length; i += 20) {
        if (rx !== writer || !connection.gatt.connected) throw Error('TTC disconnected');
        const b = bytes.slice(i, i + 20);
        if (writer.properties.write) await writer.writeValueWithResponse(b);
        else await writer.writeValueWithoutResponse(b)
      }
      log('TX > ' + command)
    });
    queue = task;
    await task
  }
  async function connectBle() {
    if (bleConnecting) return;
    if (device?.gatt.connected) {
      await abort('TTC disconnect');
      device.gatt.disconnect();
      return
    }
    if (demo) {
      await toggleDemo();
      return
    }
    if (!window.isSecureContext || !navigator.bluetooth) throw Error(
      'เปิดด้วย Chrome/Edge ผ่าน localhost หรือ HTTPS เพื่อใช้ Web Bluetooth');
    bleConnecting = true;
    let candidate;
    try {
      candidate = await navigator.bluetooth.requestDevice({
        filters: [{
          services: [SERVICE]
        }, {
          namePrefix: 'SUNSEEK'
        }],
        optionalServices: [SERVICE]
      });
      device = candidate;
      buffer = '';
      decoder = new TextDecoder();
      device.addEventListener('gattserverdisconnected', () => {
        rx = null;
        setBle(false);
        abort('TTC disconnected');
        log('EVT TTC disconnected')
      });
      const server = await device.gatt.connect(),
        service = await server.getPrimaryService(SERVICE);
      rx = await service.getCharacteristic(RX);
      const tx = await service.getCharacteristic(TX);
      await tx.startNotifications();
      tx.addEventListener('characteristicvaluechanged', e => {
        buffer += decoder.decode(e.target.value, {
          stream: true
        });
        if (buffer.length > 16384) {
          buffer = '';
          log('ERR oversized BLE frame');
          return
        }
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        lines.forEach(parse)
      });
      setBle(true);
      log('EVT TTC connected ' + device.name);
      await send('TM_RATE,5');
      await send('TM_STREAM,ALL,ON');
      await send('TM_STREAM,ADCS,ON');
      await send('STATUS');
      await send('PAYLOAD_STATUS')
    } catch (e) {
      rx = null;
      candidate?.gatt?.disconnect();
      setBle(false);
      throw e
    } finally {
      bleConnecting = false
    }
  }

  function parse(line) {
    line = line.trim();
    if (!line) return;
    log('RX < ' + line);
    const p = line.split(',').map(x => x.trim()),
      type = p[0].toUpperCase();
    const num = (k, v) => {
      if (v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v))) {
        tele[k] = Number(v);
        return true
      }
      return false
    };
    const fields = {};
    for (let i = 1; i + 1 < p.length; i += 2) fields[p[i].toUpperCase()] = p[i + 1];
    let telemetry = true;
    if (type === 'ACK' && awaiting && p[1] === awaiting.key) {
      awaiting.resolve(line)
    }
    if (type === 'ERR') {
      if (awaiting) awaiting.reject(Error(line));
      toast(line)
    }
    if (type === 'PAYLOAD' && p[1] === 'ACK' && awaiting?.key === p[2]) awaiting.resolve(line);
    if (type === 'PAYLOAD' && p[1] === 'ERR') {
      if (awaiting) awaiting.reject(Error(line));
      toast(line)
    }
    if (type === 'PAYLOAD' && p[1] === 'IMAGE_READY') {
      lastImage = p[2];
      if (awaiting?.key === 'IMAGE_READY') awaiting.resolve(p[2])
    }
    if (type === 'TM') {
      const map = {
        SUN_ANGLE: 'sun',
        MAG_HEADING: 'mag',
        GYRO_Z: 'rate',
        BODY_RATE: 'rate',
        RW_CMD: 'rw',
        TARGET: 'target',
        POINTING_ERROR: 'error',
        EST_ANGLE: 'current',
        EST_FILTERED: 'filtered',
        SUN_NDV: 'ndv',
        MAG_X: 'magX',
        MAG_Y: 'magY',
        MAG_Z: 'magZ',
        GYRO_X: 'gyroX',
        GYRO_Y: 'gyroY'
      };
      telemetry = false;
      for (const [key, dest] of Object.entries(map))
        if (fields[key] !== undefined) {
          telemetry = num(dest, fields[key]) || telemetry
        } if (fields.EST_VALID !== undefined) tele.valid = fields.EST_VALID === '1';
      if (fields.EST_ANGLE !== undefined && String(fields.EST_ANGLE).trim() !== '' && Number.isFinite(
          Number(fields.EST_ANGLE))) lastAngle = Date.now();
      if (fields.ADCS_REFERENCE) tele.ref = fields.ADCS_REFERENCE;
      if (fields.ADCS_MODE) tele.active = fields.ADCS_MODE === 'AUTO';
      if (fields.PAYLOAD_IP && fields.PAYLOAD_IP !== '0.0.0.0') {
        try {
          hostHint = normalizeBase(fields.PAYLOAD_IP)
        } catch {}
      }
      if (fields.LAST_IMAGE && fields.LAST_IMAGE !== '---') lastImage = fields.LAST_IMAGE;
    } else if (type === 'P1') {
      num('current', p[1]);
      num('target', p[2]);
      num('error', p[3])
    } else if (type === 'P2') {
      num('rate', p[1]);
      num('rw', p[2]);
      if (p[4] === '0' || p[4] === '1') tele.active = p[4] === '1'
    } else if (type === 'P3') {
      tele.ref = p[1] || tele.ref
    } else if (type === 'Q') {
      num('gyro', p[1]);
      num('mag', p[2]);
      num('sun', p[3])
    } else if (type === 'SENS') {
      num('mag', p[10]);
      num('gyro', p[13]);
      num('rate', p[14]);
      num('sun', p[15])
    } else if (type === 'CTRL') {
      tele.ref = fields.REF || tele.ref;
      for (const [k, v] of Object.entries({
          current: fields.ANGLE,
          target: fields.TARGET,
          error: fields.ERROR,
          rate: fields.RATE,
          rw: fields.RW
        })) num(k, v);
      if (fields.ACTIVE !== undefined) tele.active = fields.ACTIVE === '1'
    } else {
      telemetry = false;
      if (type === 'WIFI' && p[1]) {
        try {
          hostHint = normalizeBase(p.slice(1).join(','));
          log('EVT Camera address received via BLE')
        } catch {
          log('ERR invalid WIFI address')
        }
      }
    }
    if (telemetry) {
      lastTelemetry = Date.now();
      const sample = {
        time: lastTelemetry,
        ...tele
      };
      storeSample(sample)
    }
  }

  function fmt(v, d = 2, s = '°') {
    return Number.isFinite(v) ? v.toFixed(d) + s : '—'
  }

  function updateUI() {
    for (const [id, k, s] of [
        ['eSun', 'sun', '°'],
        ['eHeading', 'mag', '°'],
        ['eRate', 'rate', '°/s'],
        ['oGyro', 'sun', '°'],
        ['oMag', 'mag', '°'],
        ['oRate', 'rate', '°/s'],
        ['oError', 'error', '°'],
        ['normalCurrent', 'current', '°'],
        ['normalTarget', 'target', '°'],
        ['normalError', 'error', '°'],
        ['normalRw', 'rw', '%']
      ]) setText(id, fmt(tele[k], 2, s));
    setText('oRef', tele.ref);
    $('normalState').textContent = Date.now() - lastTelemetry > 3000 ? 'STALE' : tele.active === null ?
      'UNKNOWN' : tele.active ? 'POINTING' : 'IDLE';
    const fresh = Date.now() - lastTelemetry < 3000;
    for (const [id, label] of [
        ['sensorState', 'SENSOR'],
        ['actuatorState', 'ACTUATOR']
      ]) {
      const text = id === 'sensorState' ? (fresh ? 'LIVE' : 'UNKNOWN') : (fresh && tele.active !== null ? (
        tele.active ? 'ACTIVE' : 'IDLE') : 'UNKNOWN');
      $(id).textContent = label + ' ' + text;
      $(id).className = fresh ? 'on' : ''
    }
    if ($('estAngle')) {
      for (const [id, k] of [
          ['estAngle', 'current'],
          ['estFiltered', 'filtered'],
          ['estRate', 'rate']
        ]) setText(id, fmt(tele[k]));
      $('estRef').textContent = tele.ref;
      $('estValid').textContent = tele.valid === null ? 'UNKNOWN' : tele.valid ? 'VALID' : 'INVALID'
    }
    document.querySelector('#operation .ready').textContent = tele.active === null ?
      '○ CONTROLLER NOT VERIFIED' : tele.active ? '● CONTROLLER ACTIVE' : '○ CONTROLLER IDLE'
  }
  // Draw only visible charts, using one bounded history pass for scale.
  function draw(c) {
    const rect = c.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1,
      w = rect.width,
      h = rect.height;
    const width = Math.round(w * ratio),
      height = Math.round(h * ratio);
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
    const ctx = c.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#081321';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '11px monospace';
    const keys = [...document.querySelectorAll('.plotCheck:checked')].map(x => x.value);
    const colors = {
      rate: '#62d9f2',
      heading: '#51e6a5',
      sun: '#ffc766',
      error: '#f48ca5',
      current: '#a59bff',
      filtered: '#d2b9ef',
      rw: '#ff9867',
      ndv: '#7de2c1',
      magX: '#ff99ca',
      magY: '#67c4ff',
      magZ: '#b9cf7b',
      gyroX: '#f6c19d',
      gyroY: '#bea5ff'
    };
    const columns = Math.max(1, Math.floor((w - 55) / 115)),
      legendRows = Math.ceil(keys.length / columns);
    const chartHeight = Math.max(60, h - 35 - legendRows * 18),
      end = Date.now(),
      span = +$('plotWindow').value * 1000;
    const data = history.filter(x => x.time > end - span);
    let min = 0,
      max = 1;
    for (const sample of data)
      for (const key of keys) {
        const value = sample[key];
        if (Number.isFinite(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value)
        }
      }
    const pad = (max - min) * .1;
    min -= pad;
    max += pad;
    ctx.fillStyle = '#58718c';
    ctx.fillText(max.toFixed(1), 3, 18);
    ctx.fillText(min.toFixed(1), 3, chartHeight + 20);
    for (let i = 0; i < 5; i++) {
      const y = 20 + i * chartHeight / 4;
      ctx.strokeStyle = '#21364c';
      ctx.beginPath();
      ctx.moveTo(48, y);
      ctx.lineTo(w - 15, y);
      ctx.stroke()
    }
    if (!data.length) ctx.fillText('AWAITING TELEMETRY', Math.max(50, w / 2 - 65), chartHeight / 2);
    for (const key of keys) {
      ctx.strokeStyle = colors[key];
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (const sample of data) {
        if (!Number.isFinite(sample[key])) {
          started = false;
          continue
        }
        const x = 48 + (sample.time - (end - span)) / span * (w - 63),
          y = 20 + (max - sample[key]) / (max - min) * chartHeight;
        if (started) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        started = true
      }
      ctx.stroke();
    }
    keys.forEach((key, i) => {
      ctx.fillStyle = colors[key];
      ctx.fillText(key.toUpperCase(), 55 + (i % columns) * 115, chartHeight + 38 + Math.floor(i /
        columns) * 18)
    });
  }

  function drawAll() {
    draw($('plotCanvas'));
    draw($('opPlotCanvas'));
    plotDirty = false
  }

  function normalizeBase(value) {
    const u = new URL(/^https?:\/\//.test(value) ? value : 'http://' + value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u
      .search || u.hash) throw Error('ใช้ชื่อ host หรือ origin เท่านั้น');
    return u.origin
  }

  function api(path, origin = base) {
    if (!origin) throw Error('เชื่อมต่อกล้องก่อน');
    const u = new URL(path, origin + '/');
    if (u.origin !== new URL(origin).origin) throw Error('Endpoint ต้องอยู่บนบอร์ดกล้องเดียวกัน');
    if (!localRelayAvailable) {
      const host = u.hostname;
      const octets = host.split('.').map(Number);
      const privateIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) && octets.every(n => n >= 0 && n <= 255) &&
        (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
      if (!privateIPv4 && !host.endsWith('.local')) throw Error('กล้องต้องอยู่ในเครือข่ายภายใน');
      return u.href;
    }
    return '/camera?' + new URLSearchParams({
      host: u.hostname,
      path: u.pathname + u.search
    })
  }
  async function fetchBoard(path, options = {}, origin = base) {
    const r = await fetch(api(path, origin), {
      ...options,
      ...(!localRelayAvailable ? {
        mode: 'cors',
        credentials: 'omit',
        targetAddressSpace: 'local'
      } : {}),
      cache: 'no-store',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(4500)]) :
        AbortSignal.timeout(4500)
    });
    if (!r.ok) throw Error('Camera HTTP ' + r.status);
    return r
  }
  async function connectWifi() {
    if (connecting) return;
    if (wifi) {
      await abort('Camera disconnect');
      stopAll();
      base = '';
      setWifi(false);
      return
    }
    if (demo) {
      setWifi(true);
      return
    }
    connecting = true;
    const id = ++discoveryId;
    $('wifiStatus').textContent = 'DATA LINK • DISCOVERING';
    try {
      const candidates = [hostHint, $('boardHost').value.trim(), localStorage.getItem('sunseek.host'),
        'http://192.168.4.1', 'http://sunseek.local', 'http://sunseek-cam.local'
      ].filter(Boolean);
      let found = '';
      for (const candidate of [...new Set(candidates)]) {
        if (id !== discoveryId) return;
        try {
          const origin = normalizeBase(candidate),
            r = await fetchBoard($('statusEndpoint').value, {}, origin),
            status = await r.json();
          if (!status || typeof status !== 'object' || typeof status.camera !== 'boolean') throw Error(
            'Invalid status');
          found = origin;
          break
        } catch (e) {
          log('EVT Discovery ' + candidate + ' · ' + e.message)
        }
      }
      if (!found) throw Error(
        localRelayAvailable ?
        'ไม่พบกล้อง: เชื่อม Wi-Fi SUNSEEK-PAYLOAD และตรวจ /status กับ UART payload' :
        'เชื่อมกล้องไม่ได้: เชื่อม Wi-Fi SUNSEEK-PAYLOAD, อนุญาต Local network access ใน Chrome/Edge และใช้เฟิร์มแวร์กล้อง Web CORS (v3.0 เดิมไม่มี CORS)'
        );
      if (id !== discoveryId) return;
      base = found;
      localStorage.setItem('sunseek.host', base);
      setWifi(true);
      log('EVT Wi-Fi camera connected ' + base);
      toast('Camera link connected')
    } catch (e) {
      setWifi(false);
      throw e
    } finally {
      connecting = false
    }
  }

  function liveIds(id) {
    return id === 'cameraImg' ? ['cameraPlaceholder', 'camStatus'] : ['compCameraPlaceholder',
      'compCamStatus'
    ]
  }

  function stopLive(id) {
    const state = live.get(id);
    if (state) {
      if (state.url) URL.revokeObjectURL(state.url);
      state.cancelled = true;
      clearTimeout(state.timer);
      state.controller?.abort()
    }
    live.delete(id);
    const img = $(id);
    img.onload = img.onerror = null;
    img.removeAttribute('src');
    img.style.display = 'none';
    const [ph, st] = liveIds(id);
    $(ph).style.display = 'block';
    $(st).textContent = 'CAMERA • STOPPED';
    $('compLiveBtn').textContent = '▶ START LIVE VIEW'
  }

  function stopAll() {
    for (const id of [...live.keys()]) stopLive(id)
  }

  function demoImage() {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 520;
    const x = c.getContext('2d');
    x.fillStyle = '#040e1b';
    x.fillRect(0, 0, 900, 520);
    const g = x.createRadialGradient(450, 300, 10, 450, 300, 210);
    g.addColorStop(0, '#226d83');
    g.addColorStop(.85, '#104752');
    g.addColorStop(1, '#0b1b30');
    x.fillStyle = g;
    x.beginPath();
    x.arc(450, 300, 190, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = '#71d4b466';
    for (let i = 0; i < 6; i++) {
      x.beginPath();
      x.ellipse(450, 300, 185, 25 + i * 27, 0, 0, Math.PI * 2);
      x.stroke()
    }
    x.fillStyle = '#83e8f2';
    x.font = '16px monospace';
    x.fillText('SUNSEEK / SIMULATED PAYLOAD', 30, 40);
    x.fillText(new Date().toISOString(), 30, 480);
    x.fillText('TARGET ' + fmt(tele.current), 600, 480);
    return c.toDataURL('image/png')
  }

  function startLiveImpl(id) {
    if (!wifi) throw Error('เชื่อมต่อ DATA LINK ก่อน');
    stopLive(id);
    const img = $(id),
      [ph, st] = liveIds(id),
      state = {
        cancelled: false
      };
    live.set(id, state);
    $(st).textContent = 'CAMERA • CONNECTING';
    img.onload = () => {
      if (state.cancelled) return;
      img.style.display = 'block';
      $(ph).style.display = 'none';
      $(st).textContent = demo ? 'SIMULATED PAYLOAD' : 'CAMERA • LIVE'
    };
    img.onerror = () => {
      stopLive(id);
      $(st).textContent = 'CAMERA • ERROR';
      $(ph).textContent = 'ไม่พบภาพ · ตรวจ Stream endpoint';
      log('ERR Camera image load failed')
    };
    if (!demo && $('cameraMode').value === 'mjpeg') {
      img.crossOrigin = localRelayAvailable ? null : 'anonymous';
      img.src = api($('streamEndpoint').value);
      return
    }
    const tick = async () => {
      try {
        if (state.cancelled) return;
        img.src = demoImage();
        state.timer = setTimeout(tick, 500)
      } catch (e) {
        stopLive(id);
        $(st).textContent = 'CAMERA • ERROR';
        log('ERR ' + e.message)
      }
    };
    tick();
    if (id === 'compCameraImg') $('compLiveBtn').textContent = '■ STOP LIVE VIEW'
  }
  async function captureImpl(signal, defer = false) {
    if (!wifi) throw Error('เชื่อมต่อกล้องก่อน');
    let blob, boardName = '';
    if (demo) {
      blob = await (await fetch(demoImage())).blob()
    } else {
      if (!bleOk()) throw Error('CAPTURE ต้องใช้ TTC BLE');
      await stopPayloadStream(signal);
      const name = await request('CAPTURE', 'IMAGE_READY', 6500, signal);
      boardName = name;
      checkCancelled(signal);
      if (defer) return {
        boardName: name,
        angle: tele.current,
        time: new Date().toISOString()
      };
      const image = await fetchBoard('/image?name=' + encodeURIComponent(name), {
        signal
      });
      blob = await image.blob();
      if (!blob.type.startsWith('image/')) throw Error('กล้องไม่ได้ส่งไฟล์ภาพ')
    }
    checkCancelled(signal);
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
    checkCancelled(signal);
    const im = {
      boardName,
      url: URL.createObjectURL(blob),
      blob,
      label: 'OBS-' + String(images.length + 1).padStart(2, '0'),
      angle: tele.current,
      time: new Date().toISOString()
    };
    images.push(im);
    renderImages();
    log('EVT Capture saved ' + im.label);
    return im
  }

  function showImage(im, id = 'compCameraImg') {
    stopLive(id);
    $(id).src = im.url;
    $(id).style.display = 'block';
    const [ph, st] = liveIds(id);
    $(ph).style.display = 'none';
    $(st).textContent = im.label + ' · ' + fmt(im.angle)
  }

  function renderImages() {
    $('imageStrip').replaceChildren();
    for (const im of images) {
      const b = document.createElement('button');
      b.className = 'thumb';
      const image = document.createElement('img');
      image.src = im.url;
      image.alt = im.label;
      b.append(image, document.createTextNode(im.label + ' ' + fmt(im.angle, 1)));
      b.onclick = () => {
        showImage(im);
        $('imageCount').textContent = im.label + ' · ' + im.time;
        const a = document.createElement('a');
        a.href = im.url;
        a.download = im.label + (im.blob.type === 'image/png' ? '.png' : '.jpg');
        a.textContent = 'DOWNLOAD';
        a.className = 'btn';
        $('imageCount').append(' ', a)
      };
      $('imageStrip').append(b)
    }
    $('imageCount').textContent = images.length + ' images · click to inspect / download'
  }

  function renderRows(id, targets) {
    $(id).replaceChildren();
    targets.forEach((t, i) => {
      const tr = document.createElement('tr'),
        no = document.createElement('td');
      no.textContent = i + 1;
      tr.append(no);
      for (const [key, step, min, max] of [
          ['angle', 1, -90, 359],
          ['tol', .5, .1, 30],
          ['hold', .5, 0, 60]
        ]) {
        const td = document.createElement('td'),
          wrap = document.createElement('div');
        wrap.className = 'stepper';
        const input = document.createElement('input');
        input.type = 'number';
        input.value = t[key];
        input.step = step;
        input.min = min;
        input.max = max;
        const change = () => {
          t[key] = input.valueAsNumber;
          invalidate()
        };
        input.oninput = change;
        for (const sign of [-1, 1]) {
          const b = document.createElement('button');
          b.className = 'btn';
          b.textContent = sign < 0 ? '−' : '+';
          b.type = 'button';
          b.onclick = () => {
            input.value = Math.min(max, Math.max(min, (Number.isFinite(t[key]) ? t[key] : 0) + step *
              sign));
            change()
          };
          if (sign < 0) wrap.append(b, input);
          else wrap.append(b)
        }
        td.append(wrap);
        tr.append(td)
      }
      const td = document.createElement('td'),
        sel = document.createElement('select');
      for (const val of ['NONE', 'CAPTURE']) {
        const o = new Option(val, val);
        sel.add(o)
      }
      sel.value = t.action;
      sel.onchange = () => {
        t.action = sel.value;
        invalidate()
      };
      td.append(sel);
      tr.append(td);
      const del = document.createElement('td'),
        b = document.createElement('button');
      b.className = 'btn danger';
      b.textContent = '×';
      b.setAttribute('aria-label', 'Delete target ' + (i + 1));
      b.onclick = () => {
        targets.splice(i, 1);
        renderRows(id, targets);
        invalidate()
      };
      del.append(b);
      tr.append(del);
      $(id).append(tr)
    })
  }

  function validateTargets(targets, ref) {
    if (targets.length > 10) throw Error('สูงสุด 10 เป้าหมาย');
    if (!targets.length) throw Error('เพิ่มเป้าหมายอย่างน้อยหนึ่งรายการ');
    for (const t of targets)
      if (!Number.isFinite(t.angle) || (ref === 'MAG' ? (t.angle < 0 || t.angle >= 360) : Math.abs(t
          .angle) > 90) || !Number.isFinite(t.tol) || t.tol < .1 || t.tol > 30 || !Number.isFinite(t
          .hold) || t.hold < 0 || t.hold > 60) throw Error(
        'ตรวจ SUN −90…90° / MAG 0…359°, Tolerance 0.1…30°, Hold 0…60s')
  }

  function signature(comp) {
    return JSON.stringify({
      comp,
      config: currentConfig($(comp ? 'missionProfile' : 'opProfile').value),
      filter: $('filterEnabled').checked,
      fusion: $('fusionEnabled').checked,
      type: $('filterType').value,
      strength: $('filterStrength').value,
      transfer: $('transferMode').value,
      targets: comp ? compTargets : opTargets,
      profile: $(comp ? 'missionProfile' : 'opProfile').value,
      kp: $('kpInput').value,
      kd: $('kdInput').value,
      duration: comp ? missionDurationSeconds() : 300
    })
  }

  function missionDurationSeconds() {
    const value = $('missionDuration').value;
    const minutes = $('missionMinutes').valueAsNumber,
      seconds = $('missionSeconds').valueAsNumber;
    if (value === 'custom' && (!Number.isInteger(minutes) || !Number.isInteger(seconds) || minutes < 0 ||
        minutes > 60 || seconds < 0 || seconds > 59)) throw Error('ระบุเวลาเป็นนาที 0–60 และวินาที 0–59');
    const total = value === 'custom' ? minutes * 60 + seconds : Number(value);
    if (!Number.isInteger(total) || total < 1 || total > 3600) throw Error(
      'ระยะภารกิจต้องอยู่ระหว่าง 1 วินาทีถึง 60 นาที');
    return total;
  }

  function formatCountdown(seconds) {
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
  }

  function formatElapsed(ms) {
    return String(Math.floor(ms / 60000)).padStart(2, '0') + ':' + String(Math.floor(ms / 1000) % 60)
      .padStart(2, '0') + '.' + String(Math.floor(ms) % 1000).padStart(3, '0')
  }

  function durationChanged() {
    $('customDuration').classList.toggle('hidden', $('missionDuration').value !== 'custom');
    invalidate();
    try {
      $('durationError').textContent = '';
      $('missionCountdown').textContent = formatCountdown(missionDurationSeconds())
    } catch (e) {
      $('durationError').textContent = e.message;
      $('missionCountdown').textContent = '--:--'
    }
  }

  function resetMissionTime(comp) {
    $('opTimer').textContent = '00:00.000';
    if (comp) $('missionCountdown').textContent = formatCountdown(missionDurationSeconds());
    else {
      try {
        $('missionCountdown').textContent = formatCountdown(missionDurationSeconds())
      } catch {}
    }
  }

  function lockMissionSettings(locked) {
    for (const selector of ['#compRows input', '#compRows select', '#compRows button',
        '#opMissionRows input', '#opMissionRows select', '#opMissionRows button', '#missionDuration',
        '#missionMinutes', '#missionSeconds', '#missionProfile', '#opProfile', '#profileSelect',
        '#missionName', '#transferMode', '#kpInput', '#kdInput', '#maWindow', '#gyroWeight', '#fusionRef',
        '#filterEnabled', '#fusionEnabled', '#filterType', '#filterStrength', '#opAddTarget',
        '#compAddTarget', '#opPrepare', '#prepareMissionBtn', '#opRun', '#startMissionBtn',
        '#manageProfiles', '#saveProfile', '#saveAsProfile', '#clearProfiles', '#importProfiles',
        '#engRef', '#engApplyRef', '#engZero', '#applyFusionBtn', '#loadOpProfile', '#autoMode',
        '#testAutoBtn', '#rwApply', '#rwInput', '#rawCmd', '#sendRawBtn', '#sensorApply', '#tmRate',
        '#streamSUN', '#streamMAG', '#streamGYRO', '#streamADCS'
      ]) {
      document.querySelectorAll(selector).forEach(element => element.disabled = locked);
    }
  }
  let cameraRotation = -90;

  function fitCameraImage(img) {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const frame = img.closest('.camera');
    const sideways = cameraRotation === -90;
    const availableWidth = sideways ? frame.clientHeight : frame.clientWidth;
    const availableHeight = sideways ? frame.clientWidth : frame.clientHeight;
    if (!availableWidth || !availableHeight) return;
    const scale = Math.min(availableWidth / img.naturalWidth, availableHeight / img.naturalHeight);
    img.style.width = img.naturalWidth * scale + 'px';
    img.style.height = img.naturalHeight * scale + 'px';
  }

  function updateCameraRotation() {
    document.querySelectorAll('.camera').forEach(frame => {
      frame.style.setProperty('--camera-rotation', cameraRotation + 'deg');
      fitCameraImage(frame.querySelector('img'));
    });
    document.querySelectorAll('.cameraRotate').forEach(button => {
      button.setAttribute('aria-pressed', String(cameraRotation === -90));
      button.textContent = cameraRotation === -90 ? 'ROTATION −90° · RESET 0°' : '↶ ROTATE −90°';
    });
  }
  for (const frame of document.querySelectorAll('.camera')) {
    const img = frame.querySelector('img');
    img.addEventListener('load', () => fitCameraImage(img));
    new ResizeObserver(() => fitCameraImage(img)).observe(frame);
  }
  async function ready(comp) {
    if (job || prepareController) throw Error('มีภารกิจหรือการเตรียมกำลังทำงาน');
    if (!bleOk()) throw Error('เชื่อมต่อ TTC ก่อน');
    if (Date.now() - lastAngle > 3000) throw Error('รอ estimator telemetry ล่าสุดจากบอร์ดก่อน');
    if (tele.valid === false) throw Error('Estimator ยังไม่พร้อม');
    if (comp) missionDurationSeconds();
    const name = $(comp ? 'missionProfile' : 'opProfile').value,
      targets = comp ? compTargets : opTargets;
    validateTargets(targets, currentConfig(name).ref);
    if ((comp || targets.some(t => t.action === 'CAPTURE')) && !wifi) throw Error(
      'เชื่อม DATA LINK ก่อน');
    if (!Number.isFinite(tele.current)) throw Error('ยังไม่มีข้อมูลมุมปัจจุบัน');
    invalidate();
    const controller = new AbortController();
    prepareController = controller;
    lockMissionSettings(true);
    stage('PREPARING', comp);
    try {
      if (!comp && name) saveProfile(name);
      else if (comp) loadProfile(name);
      await applyConfig(name, controller.signal);
      checkCancelled(controller.signal);
      resetMissionTime(comp);
      stage('READY', comp);
      prepared = signature(comp);
      $('missionReady').textContent = '● MISSION READY';
      $('opActivity').textContent = 'READY';
      toast('Prepared · telemetry and target settings validated');
    } catch (e) {
      stage(e.message === 'ABORTED' ? 'ABORTED' : 'NOT READY', comp);
      throw e;
    } finally {
      prepareController = null;
      lockMissionSettings(false)
    }
  }

  function stage(s, comp) {
    $(comp ? 'missionState' : 'opActivity').textContent = s;
    if (comp) $('stageLine').textContent = ['READY', 'ACQUIRE', 'STABILIZE', 'CAPTURE', 'COMPLETE'].map(k =>
      (s === k ? '● ' : s === 'COMPLETE' ? '✓ ' : '○ ') + k).join(' — ')
  }
  async function abort(reason = 'ABORTED') {
    prepareController?.abort(Error('ABORTED'));
    if (awaiting) awaiting.reject(Error('ABORTED'));
    if (job) {
      job.controller.abort(Error('ABORTED'));
      stage(reason.toUpperCase(), job.comp)
    }
    invalidate();
    if (bleOk()) try {
      await send('MISSION_ABORT');
      await send('RW_STOP')
    } catch (e) {
      log('ERR STOP failed ' + e.message)
    }
    log('EVT ' + reason)
  }
  async function execute(comp) {
    if (job || awaiting || prepareController) throw Error('ภารกิจหรือคำสั่งกำลังทำงาน');
    if (prepared !== signature(comp)) throw Error('กด PREPARE หลังเปลี่ยนค่าก่อน');
    pendingImages = [];
    const targets = structuredClone(comp ? compTargets : opTargets);
    const controller = new AbortController(),
      start = performance.now(),
      duration = comp ? missionDurationSeconds() : 300,
      reference = currentConfig($(comp ? 'missionProfile' : 'opProfile').value).ref,
      transfer = $('transferMode').value;
    job = {
      controller,
      comp
    };
    lockMissionSettings(true);
    prepared = null;
    const guard = () => {
      checkCancelled(controller.signal);
      if (performance.now() - start >= duration * 1000) throw Error('TIMEOUT');
      if (!bleOk()) throw Error('TTC LOST');
      if (tele.valid === false) throw Error('ESTIMATOR INVALID');
      if (Date.now() - lastAngle > 3000) throw Error('ESTIMATOR TELEMETRY LOST')
    };
    const updateTimer = () => {
      const elapsed = Math.min(performance.now() - start, duration * 1000);
      $('opTimer').textContent = formatElapsed(elapsed);
      $('missionCountdown').textContent = formatCountdown(Math.max(0, Math.ceil(duration - elapsed /
        1000)))
    };
    updateTimer();
    const tick = setInterval(updateTimer, 100),
      deadline = setTimeout(() => controller.abort(Error('TIMEOUT')), duration * 1000);
    try {
      if (wifi) await stopPayloadStream(controller.signal);
      for (let i = 0; i < targets.length; i++) {
        guard();
        const t = targets[i];
        stage('ACQUIRE', comp);
        await request('ADCS_MODE,MANUAL', undefined, 3500, controller.signal);
        guard();
        await request('SET_TARGET,' + t.angle.toFixed(1), undefined, 3500, controller.signal);
        guard();
        await request('ADCS_MODE,AUTO', undefined, 3500, controller.signal);
        guard();
        let since = null;
        const lockDeadline = performance.now() + Math.max(60000, t.hold * 1000 + 1000);
        while (true) {
          guard();
          const error = reference === 'MAG' ? Math.abs(((tele.current - t.angle + 540) % 360) - 180) :
            Math.abs(tele.current - t.angle);
          if (error <= t.tol) {
            if (since === null) {
              since = performance.now();
              stage('STABILIZE', comp)
            }
            if (performance.now() - since >= t.hold * 1000) break
          } else {
            since = null;
            stage('ACQUIRE', comp)
          }
          if (performance.now() > lockDeadline) throw Error('TARGET LOCK TIMEOUT');
          await sleep(100)
        }
        guard();
        if (t.action === 'CAPTURE') {
          stage('CAPTURE', comp);
          const im = await capture(controller.signal, comp && transfer === 'end');
          guard();
          if (comp && transfer === 'end') pendingImages.push(im);
          else showImage(im)
        }
      }
      if (pendingImages.length) {
        await request('RW_STOP', undefined, 3500, controller.signal);
        for (const im of pendingImages) {
          guard();
          if (!im.blob) {
            const blob = await (await fetchBoard('/image?name=' + encodeURIComponent(im.boardName), {
              signal: controller.signal
            })).blob();
            const bitmap = await createImageBitmap(blob);
            bitmap.close();
            guard();
            Object.assign(im, {
              blob,
              url: URL.createObjectURL(blob),
              label: 'OBS-' + String(images.length + 1).padStart(2, '0')
            });
            images.push(im)
          }
        }
        renderImages();
        showImage(pendingImages.at(-1));
        pendingImages = []
      }
      guard();
      await request('RW_STOP', undefined, 3500, controller.signal);
      guard();
      stage('COMPLETE', comp);
      log('EVT Mission complete ' + $('missionName').value);
      toast('Mission complete')
    } catch (e) {
      stage(e.message, comp);
      if (bleOk()) try {
        await send('MISSION_ABORT');
        await send('RW_STOP')
      } catch {}
      log('ERR Mission ' + e.message);
      toast('Mission ' + e.message)
    } finally {
      updateTimer();
      clearInterval(tick);
      clearTimeout(deadline);
      job = null;
      pendingImages = [];
      lockMissionSettings(false);
      invalidate()
    }
  }

  function validateProfiles(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length > 100) return null;
    const out = {};
    for (const [name, v] of Object.entries(p)) {
      if (!name || name.length > 60 || !v || !['SUN', 'MAG'].includes(v.ref) || ![v.kp, v.kd, v.window, v
          .weight
        ].every(Number.isFinite) || v.kp < 0 || v.kp > 20 || v.kd < 0 || v.kd > 20 || v.window < 1 || v
        .window > 500 || !Number.isInteger(v.window) || v.weight < 0 || v.weight > 1) return null;
      Object.defineProperty(out, name, {
        value: {
          ref: v.ref,
          kp: v.kp,
          kd: v.kd,
          window: v.window,
          weight: v.weight
        },
        enumerable: true,
        writable: true,
        configurable: true
      })
    }
    return out
  }

  function currentConfig(name) {
    const saved = profiles[name];
    if (saved) return saved;
    return {
      ref: $('fusionRef').value,
      kp: +$('kpInput').value,
      kd: +$('kdInput').value,
      window: +$('maWindow').value,
      weight: +$('gyroWeight').value
    }
  }

  function refreshProfiles() {
    for (const id of ['profileSelect', 'opProfile', 'missionProfile']) {
      const sel = $(id),
        old = sel.value;
      sel.replaceChildren();
      if (!Object.keys(profiles).length) sel.add(new Option('No saved profiles · current settings', ''));
      Object.keys(profiles).forEach(name => sel.add(new Option(name, name)));
      if (profiles[old]) sel.value = old
    }
    localStorage.setItem('sunseek.profiles', JSON.stringify(profiles))
  }

  function loadProfile(name) {
    if (!name) {
      invalidate();
      return
    }
    const p = profiles[name];
    if (!p) throw Error('Unknown profile');
    $('kpInput').value = p.kp;
    $('kdInput').value = p.kd;
    $('maWindow').value = p.window;
    $('gyroWeight').value = p.weight;
    $('fusionRef').value = p.ref;
    $('engRef').value = p.ref;
    invalidate();
    toast('Loaded ' + name + ' · local settings');
    log('EVT Loaded profile ' + name)
  }

  function saveProfile(name) {
    if (!name?.trim()) throw Error('ใช้ SAVE AS เพื่อตั้งชื่อโปรไฟล์ใหม่');
    if (job) throw Error('หยุดภารกิจก่อน');
    const p = {
      ref: $('fusionRef').value,
      kp: +$('kpInput').value,
      kd: +$('kdInput').value,
      window: +$('maWindow').value,
      weight: +$('gyroWeight').value
    };
    if (!validateProfiles({
        [name]: p
      })) throw Error('ค่าของ Profile ไม่ถูกต้อง');
    Object.defineProperty(profiles, name, {
      value: p,
      enumerable: true,
      writable: true,
      configurable: true
    });
    refreshProfiles();
    $('opProfile').value = name;
    invalidate();
    toast('Saved ' + name)
  }

  function manageProfiles() {
    $('profileList').replaceChildren();
    if (!Object.keys(profiles).length) {
      const empty = document.createElement('p');
      empty.className = 'small';
      empty.textContent = 'ไม่มีโปรไฟล์ที่บันทึกไว้';
      $('profileList').append(empty)
    }
    for (const name of Object.keys(profiles)) {
      const div = document.createElement('div');
      div.className = 'profileEntry';
      const label = document.createElement('span');
      label.textContent = name + ' · ' + profiles[name].ref;
      const b = document.createElement('button');
      b.className = 'btn danger';
      b.textContent = 'DELETE';
      b.onclick = () => {
        if (job) return toast('หยุดภารกิจก่อนแก้โปรไฟล์');
        delete profiles[name];
        refreshProfiles();
        invalidate();
        manageProfiles()
      };
      div.append(label, b);
      $('profileList').append(div)
    }
    if (!$('profileDialog').open) $('profileDialog').showModal()
  }

  function simulateCommand(c) {
    const p = c.split(',');
    if (p[0] === 'ADCS_REFERENCE') tele.ref = p[1];
    if (p[0] === 'SET_TARGET') {
      tele.target = +p[1]
    }
    if (c === 'ADCS_MODE,AUTO') tele.active = true;
    if (c === 'ADCS_MODE,MANUAL') tele.active = false;
    if (p[0] === 'RW_STOP') {
      tele.active = false;
      tele.target = tele.current
    }
    if (p[0] === 'ZERO') {
      tele.current = 0;
      tele.target = 0
    }
    log('RX SIM < ACK,' + c)
  }
  async function toggleDemo() {
    if (job || prepareController) await abort('Mode changed');
    ++discoveryId;
    stopAll();
    if (device?.gatt.connected) device.gatt.disconnect();
    rx = null;
    demo = !demo;
    resetTele();
    history = [];
    document.body.classList.toggle('demo', demo);
    $('modeLabel').textContent = demo ? 'SIMULATION · NO HARDWARE' : 'HARDWARE MODE';
    $('demoBtn').textContent = demo ? 'EXIT SIMULATOR' : '◇ SIMULATOR';
    if (demo) Object.assign(tele, {
      valid: true,
      current: -25,
      target: -25,
      rate: 0,
      rw: 0,
      gyro: -25,
      mag: 335,
      sun: -25,
      error: 0,
      active: false
    });
    setBle(demo);
    setWifi(demo);
    invalidate();
    log('EVT ' + (demo ? 'Simulator enabled' : 'Hardware mode'));
    drawAll()
  }
  async function request(command, key = command.split(',')[0], timeout = 3500, signal) {
    checkCancelled(signal);
    if (demo) {
      await send(command, signal);
      return key === 'IMAGE_READY' ? '/SIM.JPG' : 'ACK,' + command
    }
    if (awaiting) throw Error('รอคำสั่งก่อนหน้าให้เสร็จก่อน');
    if (signal?.aborted) throw Error('ABORTED');
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          awaiting = null;
          fn(value)
        },
        onAbort = () => finish(reject, signal.reason instanceof Error ? signal.reason : Error(
          'ABORTED')),
        timer = setTimeout(() => finish(reject, Error('ACK timeout: ' + command)), timeout);
      const pending = {
        key,
        resolve: v => finish(resolve, v),
        reject: e => finish(reject, e)
      };
      awaiting = pending;
      signal?.addEventListener('abort', onAbort, {
        once: true
      });
      send(command, signal).catch(e => {
        if (awaiting === pending) pending.reject(e)
      })
    })
  }
  async function applyConfig(name, signal) {
    checkCancelled(signal);
    const strength = $('filterStrength').valueAsNumber;
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw Error(
      'Filter strength ต้องอยู่ระหว่าง 0–1');
    if (job) throw Error('หยุดภารกิจก่อนแก้ config');
    const p = currentConfig(name);
    if (!validateProfiles({
        current: p
      })) throw Error('ค่าตั้งค่าไม่ถูกต้อง');
    await request('ADCS_MODE,MANUAL', undefined, 3500, signal);
    checkCancelled(signal);
    await request('ADCS_STRATEGY,REACTION', undefined, 3500, signal);
    checkCancelled(signal);
    await request('ADCS_REFERENCE,' + p.ref, undefined, 3500, signal);
    checkCancelled(signal);
    await request('ADCS_TUNE,' + p.kp + ',' + p.kd + ',0', undefined, 3500, signal);
    checkCancelled(signal);
    await request('ESTIMATOR_FILTER_ENABLE,' + ($('filterEnabled').checked ? 'ON' : 'OFF'), undefined,
      3500, signal);
    checkCancelled(signal);
    await request('ESTIMATOR_FILTER_TYPE,' + $('filterType').value, undefined, 3500, signal);
    checkCancelled(signal);
    await request('ESTIMATOR_FILTER,' + $('filterStrength').value, undefined, 3500, signal);
    checkCancelled(signal);
    await request('ESTIMATOR_MA_WINDOW,' + p.window, undefined, 3500, signal);
    checkCancelled(signal);
    await request('ESTIMATOR_FUSION,' + ($('fusionEnabled').checked ? 'ON' : 'OFF'), undefined, 3500,
      signal);
    checkCancelled(signal);
    await request('ESTIMATOR_GYRO_WEIGHT,' + p.weight, undefined, 3500, signal);
    checkCancelled(signal);
    await request('ADCS_PREPARE', undefined, 3500, signal);
    checkCancelled(signal)
  }
  async function stopPayloadStream(signal) {
    checkCancelled(signal);
    stopAll();
    if (bleOk()) await request('PAYLOAD_STREAM_STOP', 'STREAM_STOP', 3500, signal);
    checkCancelled(signal);
    await sleep(200)
  }
  async function startLive(id) {
    if (job || prepareController) throw Error('หยุดภารกิจก่อนเปิด Live View');
    if (!wifi) throw Error('เชื่อม DATA LINK ก่อน');
    if (!demo) {
      if (job) throw Error('หยุดภารกิจก่อนเปิด Live View');
      await stopPayloadStream();
      await request('PAYLOAD_STREAM_START', 'STREAM_START');
      await sleep(250)
    }
    startLiveImpl(id);
    if (id === 'compCameraImg') $('compLiveBtn').textContent = '■ STOP LIVE VIEW'
  }
  async function capture(signal, defer = false) {
    if (captureBusy) throw Error('กำลังรับภาพอยู่');
    captureBusy = true;
    try {
      return await captureImpl(signal, defer)
    } finally {
      captureBusy = false
    }
  }
  async function refreshBoardImages() {
    if (demo) return renderImages();
    if (!wifi) throw Error('เชื่อม DATA LINK ก่อน');
    await stopPayloadStream();
    const list = await (await fetchBoard('/images')).json();
    if (!Array.isArray(list)) throw Error('Invalid image list');
    for (const item of list) {
      if (typeof item.name !== 'string' || images.some(x => x.boardName === item.name)) continue;
      const blob = await (await fetchBoard('/image?name=' + encodeURIComponent(item.name))).blob();
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
      images.push({
        blob,
        url: URL.createObjectURL(blob),
        boardName: item.name,
        label: item.name,
        angle: null,
        time: new Date().toISOString()
      })
    }
    renderImages();
    toast('Loaded ' + list.length + ' images from SD card')
  }
  let pendingImages = [];
  new ResizeObserver(() => {
    if (!paused) drawAll()
  }).observe($('engineering'));
  window.addEventListener('beforeunload', () => {
    if (bleOk() && !demo) {
      send('MISSION_ABORT').catch(() => {});
      send('RW_STOP').catch(() => {})
    }
  });

  function bind(id, fn) {
    $(id).onclick = async () => {
      try {
        await fn()
      } catch (e) {
        log('ERR ' + e.message);
        toast(e.message)
      }
    }
  }
  for (const [selector, attr, pageSelector, className] of [
      ['.tab', 'page', '.page', 'active'],
      ['.subtab', 'sub', '.subpage', 'hidden'],
      ['.viewTab', 'view', '.viewPage', 'hidden']
    ]) document.querySelectorAll(selector).forEach(b => b.onclick = () => {
    document.querySelectorAll(selector).forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll(pageSelector).forEach(p => p.classList.toggle(className, className ===
      'active' ? p.id === b.dataset[attr] : p.id !== b.dataset[attr]));
    drawAll();
    renderLogs()
  });
  bind('bleConnectBtn', connectBle);
  bind('wifiConnectBtn', connectWifi);
  bind('demoBtn', toggleDemo);
  bind('settingsBtn', () => $('settingsPanel').classList.toggle('hidden'));
  document.querySelectorAll('.cmdBtn').forEach(button => button.onclick = () => {
    const command = button.dataset.cmd;
    (command === 'RW_STOP' ? abort('RW STOP') : send(command)).catch(e => toast(e.message));
  });
  bind('sendRawBtn', () => {
    const command = $('rawCmd').value.trim();
    if (['STOP', 'RW_STOP', 'MISSION_ABORT'].includes(command)) return abort(command);
    if (job || prepareController) throw Error('หยุดภารกิจก่อนส่งคำสั่งควบคุม');
    return send(command);
  });
  $('rawCmd').onkeydown = e => {
    if (e.key === 'Enter') $('sendRawBtn').click()
  };
  bind('engApplyRef', () => request('ADCS_REFERENCE,' + $('engRef').value));
  bind('engZero', () => request('SET_TARGET,0'));
  bind('applyFusionBtn', async () => {
    if ($('opProfile').value) saveProfile($('opProfile').value);
    await applyConfig($('opProfile').value);
    toast('Filter / Fusion applied · board ACK received')
  });
  bind('loadOpProfile', async () => {
    loadProfile($('opProfile').value);
    await applyConfig($('opProfile').value)
  });
  bind('saveProfile', () => {
    if (job) throw Error('หยุดภารกิจก่อน');
    saveProfile($('opProfile').value)
  });
  bind('saveAsProfile', () => {
    if (job) throw Error('หยุดภารกิจก่อน');
    const name = prompt('Profile name');
    if (name?.trim()) saveProfile(name.trim())
  });
  bind('manageProfiles', manageProfiles);
  bind('closeProfiles', () => $('profileDialog').close());
  bind('clearProfiles', () => {
    if (job) throw Error('หยุดภารกิจก่อนแก้โปรไฟล์');
    profiles = {};
    refreshProfiles();
    invalidate();
    manageProfiles();
    toast('ลบโปรไฟล์ทั้งหมดแล้ว')
  });
  bind('exportProfiles', () => download(JSON.stringify(profiles, null, 2), 'sunseek-profiles.json',
    'application/json'));
  $('importProfiles').onchange = async e => {
    try {
      if (job) throw Error('หยุดภารกิจก่อน');
      const file = e.target.files[0];
      if (!file) return;
      const p = validateProfiles(JSON.parse(await file.text()));
      if (!p) throw Error('Invalid profile JSON');
      profiles = p;
      refreshProfiles();
      invalidate();
      manageProfiles()
    } catch (err) {
      toast(err.message)
    } finally {
      e.target.value = ''
    }
  };
  bind('manualMode', async () => {
    if (job || prepareController) await abort('MANUAL');
    await request('ADCS_MODE,MANUAL')
  });
  bind('autoMode', async () => {
    if (job) throw Error('หยุดภารกิจก่อน');
    await applyConfig($('opProfile').value);
    toast('PD configuration applied')
  });
  bind('testAutoBtn', async () => {
    if (job) throw Error('ภารกิจกำลังทำงาน');
    await applyConfig($('opProfile').value);
    await request('SET_TARGET,30');
    await request('ADCS_MODE,AUTO');
    toast('AUTO target 30° · acknowledged')
  });
  bind('abortAutoBtn', () => abort());
  bind('opPrepare', () => ready(false));
  bind('prepareMissionBtn', () => ready(true));
  bind('opRun', () => execute(false));
  bind('startMissionBtn', () => execute(true));
  bind('opAbort', () => abort());
  bind('abortMissionBtn', () => abort());
  for (const [id, targets, rows] of [
      ['opAddTarget', opTargets, 'opMissionRows'],
      ['compAddTarget', compTargets, 'compRows']
    ]) bind(id, () => {
    if (job) throw Error('หยุดภารกิจก่อน');
    targets.push({
      angle: 0,
      tol: 2,
      hold: 2,
      action: rows === 'compRows' ? 'CAPTURE' : 'NONE'
    });
    renderRows(rows, targets);
    invalidate()
  });
  for (const id of ['rotateCameraBtn', 'compRotateCameraBtn']) bind(id, () => {
    cameraRotation = cameraRotation === -90 ? 0 : -90;
    updateCameraRotation()
  });
  bind('startLiveBtn', () => startLive('cameraImg'));
  bind('stopLiveBtn', stopPayloadStream);
  bind('compLiveBtn', () => live.has('compCameraImg') ? stopPayloadStream() : startLive('compCameraImg'));
  bind('captureBtn', async () => {
    if (job) throw Error('ภารกิจกำลังทำงาน');
    showImage(await capture(), 'cameraImg')
  });
  bind('compCaptureBtn', async () => {
    if (job) throw Error('ภารกิจกำลังทำงาน');
    showImage(await capture())
  });
  bind('refreshImagesBtn', () => {
    if (job || prepareController) throw Error('หยุดภารกิจก่อนโหลดภาพ');
    return refreshBoardImages()
  });
  bind('clearPlotBtn', () => {
    history = [];
    drawAll()
  });
  bind('pausePlotBtn', () => {
    paused = !paused;
    $('pausePlotBtn').textContent = paused ? 'RESUME' : 'PAUSE';
    if (!paused) drawAll()
  });
  document.querySelectorAll('.plotCheck').forEach(x => x.onchange = drawAll);
  $('plotWindow').onchange = drawAll;
  bind('startLogBtn', () => {
    records = [];
    logging = true;
    $('startLogBtn').disabled = true;
    $('stopLogBtn').disabled = false;
    log('EVT Telemetry logging started')
  });
  bind('stopLogBtn', () => {
    logging = false;
    $('startLogBtn').disabled = false;
    $('stopLogBtn').disabled = true;
    const keys = ['time', 'ref', 'current', 'target', 'error', 'rate', 'rw', 'sun', 'mag', 'gyro'];
    download(keys.join(',') + '\n' + records.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(
      ',')).join('\n'), 'telemetry-' + Date.now() + '.csv', 'text/csv');
    log('EVT Exported ' + records.length + ' samples')
  });
  bind('clearLogBtn', () => {
    logs = [];
    renderLogs()
  });
  bind('exportLogBtn', () => download(logs.map(x => x.time + ' ' + x.message).join('\n'), 'ttc-log.txt'));
  $('logFilter').onchange = renderLogs;
  bind('testCameraBtn', async () => {
    if (!wifi) await connectWifi();
    else if (!demo) await fetchBoard($('statusEndpoint').value);
    toast('Camera status reachable')
  });
  bind('openCameraUrlBtn', async () => {
    if (demo) throw Error('Simulator ไม่มี stream URL');
    await request('PAYLOAD_STREAM_START', 'STREAM_START');
    window.open(api($('streamEndpoint').value), '_blank', 'noopener')
  });
  for (const id of ['missionDuration', 'missionMinutes', 'missionSeconds']) $(id).addEventListener('input',
    durationChanged);
  for (const id of ['kpInput', 'kdInput', 'missionDuration', 'missionProfile', 'opProfile', 'missionName',
      'filterEnabled', 'filterType', 'filterStrength', 'fusionEnabled', 'transferMode', 'fusionRef',
      'maWindow', 'gyroWeight'
    ]) $(id).addEventListener('change', invalidate);
  $('profileSelect').onchange = () => loadProfile($('profileSelect').value);
  bind('rwApply', async () => {
    if (job) throw Error('หยุดภารกิจก่อน');
    const value = +$('rwInput').value;
    if (!Number.isFinite(value) || value < -100 || value > 100) throw Error('RW −100…100');
    await request('ADCS_MODE,MANUAL');
    await request('ADCS_STRATEGY,REACTION');
    await request('RW,' + value)
  });
  bind('sensorApply', async () => {
    const rate = $('tmRate').valueAsNumber;
    if (!Number.isInteger(rate) || rate < 1 || rate > 20) throw Error(
      'Telemetry rate ต้องเป็นจำนวนเต็ม 1–20 Hz');
    if (job || prepareController) throw Error('หยุดภารกิจก่อน');
    for (const key of ['SUN', 'MAG', 'GYRO', 'ADCS']) await request('TM_STREAM,' + key + ',' + ($(
      'stream' + key).checked ? 'ON' : 'OFF'));
    await request('TM_RATE,' + $('tmRate').value)
  });
  bind('sensorSnapshot', () => request('TM_SNAPSHOT,ALL'));
  bind('missionStatus', () => send('MISSION_STATUS'));
  setInterval(() => {
    if (demo) {
      if (tele.active) {
        const delta = ((tele.target - tele.current + 540) % 360) - 180,
          step = Math.sign(delta) * Math.min(Math.abs(delta), 2);
        tele.current += step;
        tele.rate = step * 10;
        tele.rw = step * 20;
        if (Math.abs(delta) < .1) tele.rate = 0
      } else {
        tele.rate = 0;
        tele.rw = 0
      }
      tele.error = ((tele.target - tele.current + 540) % 360) - 180;
      tele.gyro = tele.current;
      tele.sun = tele.current;
      tele.mag = (tele.current + 360) % 360;
      lastAngle = lastTelemetry = Date.now();
      const sample = {
        time: lastTelemetry,
        ...tele
      };
      storeSample(sample)
    }
    updateUI();
    if (!paused && plotDirty) drawAll();
    setText('clock', new Date().toLocaleTimeString('en-GB') + ' LOCAL')
  }, 100);
  updateCameraRotation();
  refreshProfiles();
  loadProfile($('opProfile').value);
  renderRows('opMissionRows', opTargets);
  renderRows('compRows', compTargets);
  renderImages();
  setBle(false);
  setWifi(false);
  drawAll();
  log('EVT Ground Station ready · ESP32-S3 TTC / ESP32-CAM');
})();
