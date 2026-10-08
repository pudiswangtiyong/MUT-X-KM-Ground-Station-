const {
  chromium
} = require('playwright');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  const page = await browser.newPage({
    viewport: {
      width: 1600,
      height: 1000
    }
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8080');
  await page.click('[data-page="competition"]');
  await page.click('#startMissionBtn');
  await page.waitForTimeout(300);
  if (await page.textContent('#missionState') === 'COMPLETE') throw Error(
    'Disconnected mission completed');
  await page.click('#demoBtn');
  await page.waitForTimeout(300);
  await page.click('#prepareMissionBtn');
  await page.waitForTimeout(300);
  await page.click('#startMissionBtn');
  await page.waitForFunction(() => document.querySelector('#missionState').textContent ===
  'COMPLETE', {}, {
    timeout: 15000
  });
  if (await page.locator('.thumb').count() !== 1) throw Error('No capture');
  await page.click('#compLiveBtn');
  await page.waitForTimeout(500);
  await page.screenshot({
    path: require('node:path').resolve(__dirname, '../preview-competition.png'),
    fullPage: true
  });
  await page.click('#compLiveBtn');
  await page.click('#prepareMissionBtn');
  await page.click('#startMissionBtn');
  await page.waitForTimeout(250);
  await page.click('#abortMissionBtn');
  await page.waitForTimeout(3500);
  if (await page.textContent('#missionState') === 'COMPLETE') throw Error('Aborted mission completed');
  await page.click('[data-page="engineering"]');
  await page.click('#pausePlotBtn');
  if (await page.textContent('#pausePlotBtn') !== 'RESUME') throw Error('Pause failed');
  await page.click('#pausePlotBtn');
  await page.click('#startLogBtn');
  await page.waitForTimeout(400);
  const download = page.waitForEvent('download');
  await page.click('#stopLogBtn');
  await download;
  await page.screenshot({
    path: require('node:path').resolve(__dirname, '../preview-engineering.png'),
    fullPage: true
  });
  await page.setViewportSize({
    width: 390,
    height: 844
  });
  await page.waitForTimeout(100);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(
    'Mobile horizontal overflow');
  await page.screenshot({
    path: require('node:path').resolve(__dirname, '../preview-mobile.png'),
    fullPage: true
  });
  if (errors.length) throw Error(errors.join('\n'));
  console.log(
    'PASS: disconnected guard, prepare, complete, capture, live, abort, plots, CSV, responsive renders; no page errors'
    );
  await browser.close()
})().catch(e => {
  console.error(e);
  process.exit(1)
});
