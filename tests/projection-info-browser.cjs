const assert = require('node:assert/strict');

module.exports = async ({ send, evaluate, click, screenshot, delay, report }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`(() => {
    BesMapI18n.change({ ui: 'zh-Hans', map: 'follow' });
    for (const id of ['layers-defaults', 'layers-close', 'language-close', 'reset']) document.getElementById(id).click();
    const select = document.getElementById('projection-select'); select.value = 'robinson';
    select.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('reset').click();
  })()`);
  await delay(100);
  const snapshot = `(() => {
    const svg = document.getElementById('map'), v = svg.viewBox.baseVal;
    const rect = document.getElementById('viewport').getBoundingClientRect();
    const label = document.querySelector('.country-label[data-code="USA"]');
    const point = new DOMPoint(+label.getAttribute('x'), +label.getAttribute('y')).matrixTransform(svg.getScreenCTM());
    return { center: [v.x + v.width / 2, v.y + v.height / 2], view: [v.x, v.y, v.width, v.height],
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      zoom: document.getElementById('zoom').textContent, central: svg.dataset.centralLongitude,
      selected: document.querySelector('.country.selected')?.dataset.code, point: { x: point.x, y: point.y },
      open: !document.getElementById('projection-info').hidden };
  })()`;
  const near = (a, b, message) => assert(Math.abs(a - b) < .02, `${message}: ${a} vs ${b}`);
  const sameCamera = (a, b) => {
    a.center.forEach((value, i) => near(value, b.center[i], 'Reader must preserve camera center'));
    assert.equal(a.zoom, b.zoom); assert.equal(a.central, b.central); assert.equal(a.selected, b.selected);
  };
  assert.equal((await evaluate(snapshot)).open, false, 'Introduction starts closed');
  await screenshot('intro-closed.png');
  await click('#projection-info-toggle'); await delay(100);
  const opened = await evaluate(snapshot);
  assert(opened.rect.x > 300 && opened.rect.width < 1300, 'Desktop reader must reserve its own space');
  assert.equal(await evaluate('document.activeElement.id'), 'projection-info-close');
  await screenshot('intro-desktop.png');
  const outlines = [];
  for (const id of ['robinson', 'equalEarth', 'mercator']) {
    await evaluate(`(() => {
      const select = document.getElementById('projection-select'); select.value = '${id}';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const content = await evaluate(`(() => ({
      id: document.getElementById('projection-info').dataset.projection,
      title: document.getElementById('projection-info-title').textContent,
      text: document.getElementById('projection-info-geometry').textContent,
      outline: document.getElementById('intro-outline').getAttribute('d'),
      grid: document.getElementById('intro-grid').getAttribute('d'),
      history: !document.getElementById('projection-info-history').hidden
    }))()`);
    assert.equal(content.id, id); assert(content.title.length && content.text.length > 30);
    assert(content.grid && !/NaN|Infinity/.test(content.grid));
    assert.equal(content.history, id === 'robinson'); outlines.push(content.outline);
  }
  assert.equal(new Set(outlines).size, 3, 'Each diagram must use its actual projection');
  await screenshot('intro-mercator.png');
  // The reader and existing layer panel control one persisted grid preference.
  await evaluate(`document.getElementById('projection-info-grid').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-layer="grid"]').checked`), false);
  assert.equal(await evaluate(`document.getElementById('grid').style.display`), 'none');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('besmaplab.layers.v1')).grid`), false);
  await evaluate(`document.querySelector('[data-layer="grid"]').click()`);
  assert.equal(await evaluate(`document.getElementById('projection-info-grid').checked`), true);

  await click('#projection-info-close'); await delay(100);
  await evaluate(`document.querySelector('.country[data-code="USA"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await delay(80); await click('#zoom-in'); await click('#zoom-in');
  const before = await evaluate(snapshot);
  await click('#projection-info-toggle'); await delay(100);
  const docked = await evaluate(snapshot); sameCamera(before, docked);
  await click('#zoom-in');
  const zoomed = await evaluate(snapshot);
  docked.center.forEach((v, i) => near(v, zoomed.center[i], 'Buttons zoom around remaining map center'));
  assert.notEqual(zoomed.zoom, docked.zoom);
  await evaluate(`document.querySelector('.country[data-code="USA"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await delay(80);
  const centered = await evaluate(snapshot);
  near(centered.point.x, centered.rect.x + centered.rect.width / 2, 'Click centers in remaining map area');
  assert.equal(centered.zoom, zoomed.zoom);
  // Real mouse drag exercises coordinate conversion with a nonzero viewport origin.
  const x = centered.rect.x + centered.rect.width / 2, y = centered.rect.height / 2;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 65, y: y + 40, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 65, y: y + 40, button: 'left', clickCount: 1 });
  await delay(80);
  const dragged = await evaluate(snapshot);
  assert.notEqual(dragged.central, centered.central);
  near(dragged.view[1] - centered.view[1], -40 * centered.view[3] / centered.rect.height, 'Vertical pan follows screen pixels');
  const readerScroll = await evaluate(`(() => {
    const reader = document.getElementById('projection-info-body'); reader.scrollTop = reader.scrollHeight;
    return reader.scrollTop;
  })()`);
  assert(readerScroll > 50, 'Long reader content must be scrollable');
  await screenshot('intro-reading.png');
  await click('#projection-info-close'); await delay(100); sameCamera(dragged, await evaluate(snapshot));
  assert.equal(await evaluate('document.activeElement.id'), 'projection-info-toggle');

  await click('#projection-info-toggle');
  const cameraBeforeLanguage = await evaluate(snapshot);
  const locales = await evaluate('BesMapI18n.locales.map(locale => locale.id)');
  for (const locale of locales) {
    await evaluate(`BesMapI18n.change({ ui: '${locale}', map: 'en' })`);
    await delay(30);
    const translated = await evaluate(`(() => {
      const info = document.getElementById('projection-info');
      const titleBox = document.querySelector('.intro-header').getBoundingClientRect();
      const headingBox = document.querySelector('.heading').getBoundingClientRect();
      return { text: document.getElementById('projection-info-geometry').textContent,
        expected: BesMapI18n.text('intro.mercator.geometry'), map: document.querySelector('.country-label[data-code="USA"]').textContent,
        fits: info.scrollWidth <= info.clientWidth + 1, overlap: headingBox.bottom > titleBox.top,
        dir: document.documentElement.dir, x: document.getElementById('viewport').getBoundingClientRect().x };
    })()`);
    assert.equal(translated.text, translated.expected); assert.equal(translated.map, 'United States');
    assert(translated.fits, `${locale}: reader must not overflow horizontally`);
    assert(!translated.overlap, `${locale}: heading must not overlap article title`);
    if (translated.dir === 'rtl') assert.equal(translated.x, 0, 'RTL reader docks on the right');
    sameCamera(cameraBeforeLanguage, await evaluate(snapshot));
    if (locale === 'ar') await screenshot('intro-arabic.png');
  }
  await evaluate(`BesMapI18n.change({ ui: 'zh-Hans', map: 'follow' }); document.getElementById('reset').click();
    document.getElementById('projection-info-body').scrollTop = 0`);
  for (const size of [{ width: 390, height: 844 }, { width: 700, height: 400 }]) {
    await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: true });
    await delay(150);
    const layout = await evaluate(`(() => {
      const map = document.getElementById('viewport').getBoundingClientRect();
      const panel = document.getElementById('projection-info').getBoundingClientRect();
      const button = document.getElementById('projection-info-close').getBoundingClientRect();
      const zoom = document.getElementById('zoom-in'), zoomBox = zoom.getBoundingClientRect();
      return { mapBottom: map.bottom, top: panel.top, width: panel.width, closeBottom: button.bottom,
        zoomReachable: zoom.contains(document.elementFromPoint(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2)),
        pageWidth: document.documentElement.scrollWidth, readerHeight: document.getElementById('projection-info-body').clientHeight };
    })()`);
    near(layout.top, layout.mapBottom, 'Mobile introduction must be below map');
    assert.equal(layout.width, size.width); assert.equal(layout.pageWidth, size.width);
    assert(layout.zoomReachable, 'Short-screen toolbar must not cover zoom controls');
    assert(layout.closeBottom < size.height && layout.readerHeight > 100);
    await screenshot(size.width === 390 ? 'intro-mobile.png' : 'intro-short-screen.png');
  }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  assert.equal((await evaluate(snapshot)).open, false);
  await send('Page.reload'); await delay(500);
  assert.equal((await evaluate(snapshot)).open, false, 'Reading panel stays opt-in on reload');
  report.projectionIntroduction = { projections: 3, languages: locales.length, cameraPreserved: true,
    gridSynced: true, offline: true, desktopAndMobile: true, keyboard: true };
};
