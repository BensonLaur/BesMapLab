const assert = require('node:assert/strict');

module.exports = async ({ send, evaluate, click, screenshot, delay, report }) => {
  const snapshot = `(() => ({
    projection: document.getElementById('map').dataset.projection,
    central: document.getElementById('map').dataset.centralLongitude,
    selected: document.querySelector('.country.selected')?.dataset.code,
    view: document.getElementById('map').getAttribute('viewBox'),
    layers: [...document.querySelectorAll('[data-layer]')].map(input => input.checked)
  }))()`;
  async function imageLoaded() {
    return evaluate(`(async () => {
      const image = document.getElementById('support-image');
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    })()`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`BesMapI18n.change({ ui: 'zh-Hans', map: 'follow' })`);
  await evaluate(`(() => {
    const select = document.getElementById('projection-select');
    select.value = 'equalEarth'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await click('#zoom-in');
  const before = await evaluate(snapshot);
  assert.equal(await evaluate(`document.getElementById('support-dialog').open`), false);
  assert.equal(await evaluate(`document.getElementById('support-image').hasAttribute('src')`), false);
  await click('#support-toggle');
  assert.equal(await evaluate(`document.getElementById('support-dialog').open`), true);
  assert.equal(await evaluate(`document.activeElement.id`), 'support-close');
  assert.deepEqual(await imageLoaded(), [1266, 1749]);
  assert.equal(await evaluate(`document.getElementById('support-payee').textContent.includes('Benson(**城)')`), true);
  assert.equal(await evaluate(`document.querySelector('[data-support-method="wechat"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`fetch(document.getElementById('support-open-image').href).then(response => response.blob()).then(blob => blob.size)`), 165920);
  await screenshot('support-desktop.png');
  await click('[data-support-method="alipay"]');
  assert.deepEqual(await imageLoaded(), [1080, 1680]);
  assert.equal(await evaluate(`document.getElementById('support-payee').textContent.includes('Bes软件')`), true);
  assert.equal(await evaluate(`document.querySelector('[data-support-method="alipay"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`document.getElementById('support-save-image').download`), 'BesMapLab-alipay.png');
  assert.equal(await evaluate(`fetch(document.getElementById('support-save-image').href).then(response => response.blob()).then(blob => blob.size)`), 484562);
  assert.deepEqual(await evaluate(snapshot), before, 'Payment choices must leave the map unchanged');
  await click('#support-close');
  assert.equal(await evaluate(`document.getElementById('support-dialog').open`), false);
  assert.equal(await evaluate(`document.activeElement.id`), 'support-toggle');

  await click('#projection-info-toggle');
  await click('#support-toggle');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await delay(30);
  assert.equal(await evaluate(`document.getElementById('support-dialog').open`), false);
  assert.equal(await evaluate(`BesMapProjectionInfo.open`), true, 'Escape must only close the topmost dialog');
  assert.equal(await evaluate(`document.activeElement.id`), 'support-toggle');
  await click('#projection-info-close');
  assert.deepEqual(await evaluate(snapshot), before);

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(80);
  await click('#support-toggle');
  assert.deepEqual(await imageLoaded(), [1266, 1749]);
  assert.equal(await evaluate(`(() => {
    const box = document.getElementById('support-dialog').getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  })()`), true);
  await screenshot('support-mobile.png');
  const locales = await evaluate('BesMapI18n.locales');
  for (const locale of locales) {
    await evaluate(`BesMapI18n.change({ ui: ${JSON.stringify(locale.id)} })`);
    assert.equal(await evaluate(`document.getElementById('support-title').textContent`),
      await evaluate(`BesMapI18n.text('support.title')`));
    assert.equal(await evaluate(`document.getElementById('support-image').alt.includes('Benson(**城)')`), true);
    assert.equal(await evaluate(`document.getElementById('support-dialog').scrollWidth <= document.getElementById('support-dialog').clientWidth`), true, `${locale.id}: dialog overflow`);
  }
  await evaluate(`BesMapI18n.change({ ui: 'ar' })`);
  assert.equal(await evaluate(`document.documentElement.dir`), 'rtl');
  await screenshot('support-rtl-mobile.png');
  await click('#support-close');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 600, deviceScaleFactor: 1, mobile: true });
  await click('#support-toggle');
  assert.equal(await evaluate(`(() => {
    const box = document.getElementById('support-dialog').getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  })()`), true);
  await screenshot('support-320.png');
  await evaluate(`document.getElementById('support-open-image').scrollIntoView({ block: 'nearest' })`);
  await click('#support-open-image');
  await delay(100);
  const targets = await send('Target.getTargets');
  const originalImage = targets.targetInfos.find(target => target.type === 'page' && target.url.startsWith('blob:'));
  assert(originalImage, 'Open original must create a local image tab');
  await send('Target.closeTarget', { targetId: originalImage.targetId });
  await click('#support-close');
  report.support = { offlineImages: true, desktop: true, mobile: true, rtl: true,
    languages: locales.length, mapPreserved: true, escapeFocus: true };
};
