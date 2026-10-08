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
          height: 1000
        }
      }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.plotPaints = 0;
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function(...args) {
        if (['plotCanvas', 'opPlotCanvas'].includes(this.canvas.id)) window.plotPaints++;
        return fill.apply(this, args)
      }
    });
    await page.goto('http://localhost:8080');
    await page.click('#demoBtn');
    await page.click('[data-page="competition"]');
    const hiddenPaints = await page.evaluate(() => window.plotPaints);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.plotPaints), hiddenPaints);
    await page.selectOption('#missionDuration', 'custom');
    await page.fill('#missionMinutes', '2');
    await page.fill('#missionSeconds', '35');
    assert.equal(await page.textContent('#missionCountdown'), '02:35');
    await page.click('#prepareMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionReady').textContent.includes(
      'MISSION READY'));
    assert.equal(await page.textContent('#opTimer'), '00:00.000');
    await page.fill('#missionSeconds', '36');
    assert.match(await page.textContent('#missionReady'), /NOT PREPARED/);
    await page.fill('#missionMinutes', '0');
    await page.fill('#missionSeconds', '0');
    assert.equal(await page.textContent('#missionCountdown'), '--:--');
    await page.click('#prepareMissionBtn');
    assert.match(await page.textContent('#toast'), /1.*60/);
    await page.fill('#missionMinutes', '60');
    await page.fill('#missionSeconds', '1');
    assert.equal(await page.textContent('#missionCountdown'), '--:--');
    await page.fill('#missionMinutes', '1.5');
    await page.fill('#missionSeconds', '1');
    assert.match(await page.textContent('#durationError'), /0–60/);
    await page.fill('#missionMinutes', '0');
    await page.fill('#missionSeconds', '1');
    await page.click('#prepareMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionReady').textContent.includes(
      'MISSION READY'));
    await page.click('#startMissionBtn');
    assert(await page.locator('#missionMinutes').isDisabled());
    assert(await page.locator('#compRows input').first().isDisabled());
    await page.waitForFunction(() => document.querySelector('#missionState').textContent ===
      'TIMEOUT', {}, {
        timeout: 5000
      });
    assert.equal(await page.textContent('#missionCountdown'), '00:00');
    assert.equal(await page.textContent('#opTimer'), '00:01.000');
    assert.equal(await page.locator('.thumb').count(), 0);
    assert(!await page.locator('#missionMinutes').isDisabled());
    await page.fill('#missionSeconds', '10');
    await page.click('#prepareMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionReady').textContent.includes(
      'MISSION READY'));
    assert.equal(await page.textContent('#opTimer'), '00:00.000');
    await page.click('#startMissionBtn');
    await page.click('#abortMissionBtn');
    await page.click('#abortMissionBtn');
    await page.waitForTimeout(1000);
    assert.notEqual(await page.textContent('#missionState'), 'COMPLETE');
    const stoppedTime = await page.textContent('#opTimer');
    await page.waitForTimeout(350);
    assert.equal(await page.textContent('#opTimer'), stoppedTime);
    await page.selectOption('#missionDuration', '3600');
    assert.equal(await page.textContent('#missionCountdown'), '60:00');
    await page.selectOption('#missionDuration', 'custom');
    await page.fill('#missionMinutes', '2');
    await page.fill('#missionSeconds', '35');
    await page.click('#prepareMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionReady').textContent.includes(
      'MISSION READY'));
    await page.screenshot({
      path: 'preview-competition-duration.png',
      fullPage: true
    });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'PASS: custom minutes/seconds, changed-setting invalidation, zero/overflow/fraction validation, 1-second timeout with stop, settings lock/unlock, repeated Abort, frozen stopped timer, Prepare reset, 60-minute preset'
      );
  } finally {
    await browser.close()
  }
})().catch(e => {
  console.error(e);
  process.exit(1)
});
