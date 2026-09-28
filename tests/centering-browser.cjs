const assert = require('node:assert/strict');

module.exports = async ({ send, evaluate, click, screenshot, delay, report }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => {
    BesMapI18n.change({ ui: 'zh-Hans', map: 'follow' });
    for (const id of ['layers-defaults', 'layers-close', 'language-close']) document.getElementById(id).click();
  })()`);
  const snapshot = `(() => {
    const svg = document.getElementById('map'), view = svg.viewBox.baseVal;
    const label = document.querySelector('.country-label[data-code="USA"]');
    const point = new DOMPoint(+label.getAttribute('x'), +label.getAttribute('y')).matrixTransform(svg.getScreenCTM());
    return { view: [view.x, view.y, view.width, view.height], central: Number(svg.dataset.centralLongitude),
      point: { x: point.x, y: point.y }, centerX: document.getElementById('viewport').getBoundingClientRect().width / 2,
      selected: document.querySelector('.country.selected')?.dataset.code,
      font: parseFloat(getComputedStyle(label).fontSize) * svg.getScreenCTM().a,
      zoom: document.getElementById('zoom').textContent, detail: svg.dataset.detail };
  })()`;
  function near(actual, expected, message, tolerance = .02) {
    assert(Math.abs(actual - expected) < tolerance, `${message}: ${actual} vs ${expected}`);
  }
  async function motion(reduce) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  }
  async function setup(id, zoom = 3.86) {
    await motion(true);
    await evaluate(`(() => {
      const select = document.getElementById('projection-select'); select.value = '${id}';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('reset').click();
      document.querySelector('.country[data-code="JPN"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    })()`);
    await delay(80);
    const { point } = await evaluate(snapshot);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: -Math.log(zoom) / .0015 });
    await delay(80);
    return evaluate(snapshot);
  }
  function checkCentered(before, after) {
    near(after.point.x, after.centerX, 'Selected reference meridian must reach the visible viewport center');
    near(after.point.y, before.point.y, 'Click must preserve the vertical screen position');
    assert.deepEqual(after.view.slice(1), before.view.slice(1), 'Click must preserve zoom and vertical pan');
    assert.equal(after.zoom, before.zoom); assert.equal(after.selected, 'USA'); assert.equal(after.detail, 'full');
    near(after.font, before.font, 'Label font must keep its screen size');
    near(after.central, -101, 'Rotation must still finish at the region reference longitude');
  }
  report.centering = [];
  for (const id of ['robinson', 'equalEarth', 'mercator']) {
    const before = await setup(id);
    assert(Math.abs(before.point.x - before.centerX) > 50, 'Regression must start with an off-center zoom');
    await screenshot(`center-${id}-before.png`);
    const animated = id === 'robinson';
    await motion(!animated);
    await click('.country-label[data-code="USA"]');
    if (animated) {
      const samples = [];
      for (let i = 0; i < 4; i++) { await delay(110); samples.push(await evaluate(snapshot)); }
      assert(new Set(samples.map(s => s.central)).size > 2, 'Existing rotation must remain animated');
      assert(new Set(samples.map(s => s.view[0])).size > 2, 'Camera must pan smoothly with rotation');
      const delta = ((-101 - before.central + 540) % 360) - 180;
      const targetX = 864 - before.view[2] / 2;
      for (const sample of samples) {
        assert.deepEqual(sample.view.slice(1), before.view.slice(1));
        const rotationProgress = (((sample.central - before.central + 540) % 360) - 180) / delta;
        const panProgress = (sample.view[0] - before.view[0]) / (targetX - before.view[0]);
        near(panProgress, rotationProgress, 'Rotation and horizontal pan must share the same easing', .00001);
      }
      await delay(550);
    } else await delay(80);
    const after = await evaluate(snapshot);
    checkCentered(before, after);
    await screenshot(`center-${id}-after.png`);
    report.centering.push({ projection: id, zoom: after.zoom, screenX: after.point.x, screenY: after.point.y, animated });
  }
  // Recenter the same country after Shift panning: the camera must move even with zero rotation.
  await motion(true);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 500, button: 'left', clickCount: 1, modifiers: 8 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 940, y: 560, button: 'left', buttons: 1, modifiers: 8 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 940, y: 560, button: 'left', clickCount: 1, modifiers: 8 });
  await delay(80);
  const panned = await evaluate(snapshot);
  await click('.country-label[data-code="USA"]'); await delay(80);
  checkCentered(panned, await evaluate(snapshot));

  // A wheel gesture must take control from a running click animation without a later snap.
  await setup('robinson'); await motion(false);
  await click('.country-label[data-code="USA"]'); await delay(200);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1000, y: 500, deltaX: 0, deltaY: -160 });
  await delay(80); const interrupted = await evaluate(snapshot);
  await delay(900); const settled = await evaluate(snapshot);
  assert.deepEqual(settled.view, interrupted.view, 'Zoom must not be overwritten by an old camera animation');
  assert.equal(settled.central, interrupted.central); assert.equal(settled.detail, 'full');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobileBefore = await setup('equalEarth', 8);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...mobileBefore.point, id: 1 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(100);
  checkCentered(mobileBefore, await evaluate(snapshot));
  await screenshot('center-mobile-after.png');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  report.centeringGestures = { sameCountryAfterPan: true, wheelInterrupts: true, touchCenters: true };
};
