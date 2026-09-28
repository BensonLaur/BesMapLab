const assert = require('node:assert/strict');

module.exports = async ({ send, evaluate, click, screenshot, delay, report }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`(() => {
    BesMapI18n.change({ ui: 'zh-Hans', map: 'follow' });
    for (const id of ['layers-defaults', 'layers-close', 'language-close']) document.getElementById(id).click();
  })()`);
  const snapshot = `(() => {
    const svg = document.getElementById('map'), view = svg.viewBox.baseVal;
    const label = document.querySelector('.country-label[data-code="NGA"]');
    const point = new DOMPoint(+label.getAttribute('x'), +label.getAttribute('y')).matrixTransform(svg.getScreenCTM());
    const projection = BesMapProjections.create(svg.dataset.projection).rotate([-Number(svg.dataset.centralLongitude), 0, 0]);
    const tickErrors = [...document.querySelectorAll('.coordinate-label')].map(element => {
      const line = element.previousElementSibling, p = line.getPointAtLength(line.getTotalLength() / 2);
      const location = projection.invert([p.x, p.y]), axis = element.dataset.axis;
      const delta = location[axis === 'longitude' ? 0 : 1] - Number(element.dataset.value);
      return Math.abs(axis === 'longitude' ? ((delta + 540) % 360) - 180 : delta);
    });
    return { view: [view.x, view.y, view.width, view.height], central: Number(svg.dataset.centralLongitude),
      outline: document.getElementById('outline').getAttribute('d'), outlineY: document.getElementById('outline').getBoundingClientRect().y,
      paths: [...document.querySelectorAll('.country')].map(element => element.getAttribute('d')),
      labelPoint: { x: point.x, y: point.y }, labelY: label.getAttribute('y'),
      font: parseFloat(getComputedStyle(label).fontSize) * svg.getScreenCTM().a,
      selected: document.querySelector('.country.selected')?.dataset.code,
      headingY: document.querySelector('.heading').getBoundingClientRect().y,
      zoom: document.getElementById('zoom').textContent, tickError: Math.max(0, ...tickErrors), ticks: tickErrors.length };
  })()`;
  async function focus(id, zoom) {
    await evaluate(`(() => {
      const select = document.getElementById('projection-select'); select.value = '${id}';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('reset').click();
      document.querySelector('.country[data-code="NGA"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    })()`);
    await delay(80);
    const point = (await evaluate(snapshot)).labelPoint;
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: -Math.log(zoom) / .0015 });
    await delay(60);
  }
  async function drag(dx, dy, shift = false) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 500, button: 'left', clickCount: 1, modifiers: shift ? 8 : 0 });
    for (let i = 1; i <= 4; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800 + dx * i / 4, y: 500 + dy * i / 4,
        button: 'left', buttons: 1, modifiers: shift ? 8 : 0 });
      await delay(20);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800 + dx, y: 500 + dy,
      button: 'left', clickCount: 1, modifiers: shift ? 8 : 0 });
    await delay(50);
  }
  function near(actual, expected, message, tolerance = .01) { assert(Math.abs(actual - expected) < tolerance, `${message}: ${actual} vs ${expected}`); }
  function checkVertical(before, after, dy) {
    near(after.labelPoint.y - before.labelPoint.y, dy, 'Label must follow the vertical drag in screen pixels');
    near(after.outlineY - before.outlineY, dy, 'World outline must translate with the contents');
    assert.deepEqual(after.paths, before.paths, 'Vertical drag must preserve projected geography');
    assert.equal(after.outline, before.outline); assert.equal(after.labelY, before.labelY);
    assert.equal(after.central, before.central); assert.equal(after.view[0], before.view[0]);
    assert.deepEqual(after.view.slice(2), before.view.slice(2)); assert.equal(after.zoom, before.zoom);
    assert.equal(after.headingY, before.headingY); assert.equal(after.selected, before.selected);
    near(after.font, before.font, 'Label size must stay fixed');
    assert(after.ticks > 0 && after.tickError < .001);
  }
  report.dragging = [];
  for (const id of ['robinson', 'equalEarth', 'mercator']) {
    const zoom = id === 'equalEarth' ? 15.75 : 6.4;
    await focus(id, zoom);
    const before = await evaluate(snapshot);
    await screenshot(`drag-${id}-before.png`);
    await drag(0, -140);
    const up = await evaluate(snapshot);
    await screenshot(`drag-${id}-vertical.png`);
    checkVertical(before, up, -140);
    await drag(0, 140);
    const restored = await evaluate(snapshot);
    checkVertical(up, restored, 140);
    near(restored.view[1], before.view[1], 'Up then down should restore the view');
    await drag(100, 0);
    const horizontal = await evaluate(snapshot);
    assert.deepEqual(horizontal.view, before.view, 'Pure horizontal drag must keep its existing view transform');
    assert.notEqual(horizontal.central, before.central);
    await focus(id, zoom);
    await drag(100, -100);
    const diagonal = await evaluate(snapshot);
    near(diagonal.central, horizontal.central, 'Diagonal dragging must retain the same horizontal rotation');
    near(diagonal.labelPoint.y - before.labelPoint.y, -100, 'Diagonal drag vertical component');
    assert.equal(diagonal.view[0], before.view[0]); assert.equal(diagonal.zoom, before.zoom);
    assert(diagonal.ticks > 0 && diagonal.tickError < .001);
    const shiftBefore = diagonal;
    await drag(-80, 60, true);
    const shifted = await evaluate(snapshot);
    assert.equal(shifted.central, shiftBefore.central, 'Shift drag must remain free panning');
    near(shifted.labelPoint.x - shiftBefore.labelPoint.x, -80, 'Shift pan horizontal movement');
    near(shifted.labelPoint.y - shiftBefore.labelPoint.y, 60, 'Shift pan vertical movement');
    report.dragging.push({ projection: id, zoom: before.zoom, verticalPixels: -140, diagonalRotationMatches: true });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await focus('equalEarth', 8);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touchBefore = await evaluate(snapshot);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 450, id: 1 }] });
  for (let i = 1; i <= 4; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 450 - 20 * i, id: 1 }] });
    await delay(20);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(100);
  checkVertical(touchBefore, await evaluate(snapshot), -80);
  await screenshot('drag-touch-vertical.png');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await click('#reset');
  assert.equal(await evaluate('document.getElementById("zoom").textContent'), '100%');
  assert.equal(await evaluate('document.querySelectorAll(".country.selected").length'), 0);
  report.dragTouch = { verticalPixels: -80, selectionPreserved: true, reset: true };
};
