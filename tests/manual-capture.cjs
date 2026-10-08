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
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:8080');
    await page.click('#demoBtn');
    await page.click('[data-page="operation"]');
    await page.click('#opCaptureQuick');
    await page.waitForFunction(() => document.querySelector('#camStatus').textContent.includes('OBS-01'));
    assert(await page.locator('#liveView').isVisible());
    await page.locator('#opMissionRows input').nth(0).fill('0');
    await page.locator('#opMissionRows input').nth(1).fill('30');
    await page.locator('#opMissionRows input').nth(2).fill('5');
    await page.click('#opPrepare');
    await page.waitForFunction(() => document.querySelector('#opActivity').textContent === 'READY');
    await page.click('#opRun');
    await page.waitForTimeout(300);
    await page.click('#captureBtn');
    await page.waitForFunction(() => document.querySelector('#camStatus').textContent.includes('OBS-02'));
    assert.notEqual(await page.textContent('#opActivity'), 'ABORTED');
    await page.click('#opAbort');
    await page.waitForTimeout(250);
    await page.click('[data-page="competition"]');
    await page.click('#compCaptureBtn');
    await page.waitForFunction(() => document.querySelector('#compCamStatus').textContent.includes(
      'OBS-03'));
    await page.locator('#compRows input').nth(1).fill('30');
    await page.locator('#compRows input').nth(2).fill('5');
    await page.click('#prepareMissionBtn');
    await page.waitForFunction(() => document.querySelector('#missionReady').textContent.includes(
      'MISSION READY'));
    await page.click('#startMissionBtn');
    await page.waitForTimeout(300);
    await page.click('#compCaptureBtn');
    await page.waitForFunction(() => document.querySelector('#compCamStatus').textContent.includes(
      'OBS-04'));
    await page.click('#abortMissionBtn');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.thumb').count(), 4);
    assert(await page.locator('#compCaptureBtn').isEnabled());
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'PASS: Operation quick capture opens image view, idle capture in both modes, queued capture during both missions, abort restores buttons'
      );
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1)
});
