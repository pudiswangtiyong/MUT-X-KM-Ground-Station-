const {
  chromium
} = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  });
  try {
    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 1100
      }
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Mimic pre-existing user profiles before the requested one-time deletion.
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('sunseek.profiles', JSON.stringify({
          'OLD': {
            ref: 'SUN',
            kp: 3.6,
            kd: .5,
            window: 5,
            weight: .22
          }
        }));
        sessionStorage.setItem('seeded', '1')
      }
    });
    await page.goto('http://localhost:8080');
    assert.equal(await page.evaluate(() => localStorage.getItem('sunseek.profiles')), '{}');
    assert.equal(await page.locator('#opProfile').inputValue(), '');
    await page.reload();
    assert.equal(await page.evaluate(() => localStorage.getItem('sunseek.profiles')), '{}');
    await page.click('#demoBtn');
    await page.waitForTimeout(200);
    await page.click('[data-page="competition"]');
    await page.click('#prepareMissionBtn');
    await page.waitForTimeout(150);
    assert.equal(await page.textContent('#opTimer'), '00:00.000');
    await page.click('#startMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionState').textContent ===
      'COMPLETE', {}, {
        timeout: 15000
      });
    assert.notEqual(await page.textContent('#opTimer'), '00:00.000');
    const geometry = await page.locator('#compCameraImg').evaluate(img => {
      const a = img.getBoundingClientRect(),
        b = img.parentElement.getBoundingClientRect(),
        reticle = img.parentElement.querySelector('.cameraCrosshair span').getBoundingClientRect();
      return {
        fits: a.width <= b.width + 1 && a.height <= b.height + 1,
        centered: Math.abs(reticle.x + reticle.width / 2 - (b.x + b.width / 2)) < 1 && Math.abs(
          reticle.y + reticle.height / 2 - (b.y + b.height / 2)) < 1,
        pointer: getComputedStyle(img.parentElement.querySelector('.cameraCrosshair')).pointerEvents,
        rotation: img.parentElement.style.getPropertyValue('--camera-rotation')
      }
    });
    assert(geometry.fits);
    assert(geometry.centered);
    assert.equal(geometry.pointer, 'none');
    assert.equal(geometry.rotation, '-90deg');
    await page.click('#compRotateCameraBtn');
    assert.equal(await page.locator('#compRotateCameraBtn').getAttribute('aria-pressed'), 'false');
    await page.click('#compRotateCameraBtn');
    assert.equal(await page.locator('#compRotateCameraBtn').getAttribute('aria-pressed'), 'true');
    await page.selectOption('#missionDuration', '180');
    await page.click('#prepareMissionBtn');
    await page.waitForTimeout(150);
    assert.equal(await page.textContent('#opTimer'), '00:00.000');
    assert.equal(await page.textContent('#missionCountdown'), '03:00');
    assert.equal(await page.textContent('#missionState'), 'READY');
    await page.click('[data-page="operation"]');
    await page.click('#opPrepare');
    await page.waitForTimeout(100);
    assert.equal(await page.textContent('#opTimer'), '00:00.000');
    await page.click('[data-page="engineering"]');
    await page.click('#manageProfiles');
    assert.match(await page.textContent('#profileList'), /ไม่มีโปรไฟล์/);
    await page.click('#closeProfiles');
    await page.click('[data-page="operation"]');
    page.once('dialog', dialog => dialog.accept('NEW PROFILE'));
    await page.click('#saveAsProfile');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#opProfile').inputValue(), 'NEW PROFILE');
    await page.reload();
    assert.equal(await page.locator('#opProfile').inputValue(), 'NEW PROFILE');
    await page.click('#manageProfiles');
    await page.click('#clearProfiles');
    assert.equal(await page.evaluate(() => localStorage.getItem('sunseek.profiles')), '{}');
    await page.click('#closeProfiles');
    await page.reload();
    assert.equal(await page.locator('#opProfile').inputValue(), '');
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.click('[data-page="competition"]');
    await page.screenshot({
      path: 'preview-camera-controls.png',
      fullPage: true
    });
    console.log(
      'PASS: profile deletion persists without reseeding, settings work without saved profiles, Save As persists until deleted, centered crosshair, fitted −90° display and toggle, Prepare resets elapsed timer and selected countdown in both mission views'
      );
  } finally {
    await browser.close()
  }
})().catch(e => {
  console.error(e);
  process.exit(1)
});
