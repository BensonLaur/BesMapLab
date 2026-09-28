const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let browser, socket, profile;
async function launchBrowser() {
  const candidates = [process.env.BROWSER_PATH,
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  const executable = candidates.find(filename => fs.existsSync(filename));
  if (!executable) throw new Error('Set BROWSER_PATH to a Chrome, Edge, or Chromium executable.');
  fs.mkdirSync(output, { recursive: true });
  profile = fs.mkdtempSync(path.join(output, 'browser-profile-'));
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-extensions',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=1600,900', 'about:blank'],
    { stdio: 'ignore', windowsHide: true });
  let launchError;
  browser.on('error', error => { launchError = error; });
  const activePort = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 120; attempt++) {
    if (launchError) throw launchError;
    if (fs.existsSync(activePort)) {
      const port = Number(fs.readFileSync(activePort, 'utf8').split(/\r?\n/)[0]);
      if (port > 0) return `http://127.0.0.1:${port}`;
    }
    await delay(100);
  }
  throw new Error('Browser did not start its local debugging endpoint.');
}

(async () => {
  const endpoint = await launchBrowser();
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const target = targets.find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (!entry) return;
      if (message.error) entry.reject(message.error); else entry.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw result.exceptionDetails;
    return result.result.value;
  }
  async function screenshot(name) {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'));
  }
  async function click(selector) {
    const point = await evaluate(`(() => {
      const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function tap(selector) {
    const point = await evaluate(`(() => {
      const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await delay(80);
  }
  async function selectProjection(id) {
    await evaluate(`(() => {
      const select = document.getElementById('projection-select');
      select.value = ${JSON.stringify(id)}; select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }
  await send('Runtime.enable');
  await send('Page.enable');
  // Enforce that opening the file needs no network resources.
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.join(root, 'index.html')).href + '?lang=zh-Hans' });
  await delay(1200);
  const focusedSuite = process.argv.includes('--drag-only') ? './drag-browser.cjs'
    : process.argv.includes('--center-only') ? './centering-browser.cjs'
    : process.argv.includes('--labels-only') ? './zoom-labels-browser.cjs' : null;
  if (focusedSuite) {
    const report = { errors };
    await require(focusedSuite)({ send, evaluate, click, screenshot, delay, report });
    console.log(JSON.stringify(report));
    assert.equal(errors.length, 0);
    await send('Browser.close'); socket.close(); return;
  }
  const snapshotExpression = `(() => {
    const label = document.querySelector('.country-label[data-code="CHN"]');
    const usa = document.querySelector('.country-label[data-code="USA"]');
    const box = label.getBoundingClientRect();
    return { longitude: +document.getElementById('map').dataset.centralLongitude,
      x: +label.getAttribute('x'), y: +label.getAttribute('y'),
      usaX: +usa.getAttribute('x'), outline: document.getElementById('outline').getAttribute('d'),
      viewBox: document.getElementById('map').getAttribute('viewBox'),
      clickX: box.x + box.width / 2, clickY: box.y + box.height / 2,
      countries: document.querySelectorAll('.country').length,
      maritime: ['maritime-indicators', 'maritime-china'].map(id => {
        const paths = [...document.querySelectorAll('#' + id + ' path')];
        return { count: paths.length, geometry: paths.map(p => p.getAttribute('d')).join(''),
          open: paths.every(p => !/[zZ]|NaN|Infinity/.test(p.getAttribute('d') || '')) };
      }),
      rasterImages: document.querySelectorAll('svg image').length };
  })()`;
  const labelMetricsExpression = `(() => {
    const selectors = { country: '.country-label[data-code="CHN"]',
      taiwan: '.country-label[data-code="TWN"]', ocean: '.ocean-label' };
    return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const element = document.querySelector(selector), box = element.getBoundingClientRect();
      const style = getComputedStyle(element), matrix = element.getScreenCTM();
      return [name, { width: box.width, height: box.height,
        font: parseFloat(style.fontSize) * Math.hypot(matrix.a, matrix.b),
        halo: parseFloat(style.strokeWidth) * Math.hypot(matrix.a, matrix.b) }];
    }));
  })()`;
  function assertFixedLabels(reference, actual, names = ['country', 'ocean'], glyphTolerance = .5) {
    for (const name of names) {
      assert(Math.abs(reference[name].font - actual[name].font) < .05, 'Label screen font size changed');
      for (const dimension of ['width', 'height']) {
        // A crowded label may be hidden; selected labels are checked explicitly below.
        if (!reference[name].width || !actual[name].width) continue;
        assert(Math.abs(reference[name][dimension] - actual[name][dimension]) < glyphTolerance,
          `${name} label ${dimension} changed on screen: ${reference[name][dimension]} -> ${actual[name][dimension]}`);
      }
      if (name !== 'ocean') assert(Math.abs(reference[name].halo - actual[name].halo) < .05, 'Label halo changed on screen');
    }
  }
  const coordinateMetricsExpression = `(() => {
    const map = document.getElementById('map');
    const projection = BesMapProjections.create(map.dataset.projection)
      .rotate([-Number(map.dataset.centralLongitude), 0, 0]);
    const elements = [...document.querySelectorAll('.coordinate-label')];
    const roundTripErrors = elements.map(element => {
      const tick = element.previousElementSibling, point = tick.getPointAtLength(tick.getTotalLength() / 2);
      const location = projection.invert([point.x, point.y]);
      const axis = element.dataset.axis, value = Number(element.dataset.value);
      const delta = location[axis === 'longitude' ? 0 : 1] - value;
      return Math.abs(axis === 'longitude' ? ((delta + 540) % 360) - 180 : delta);
    });
    return { longitudeStep: +map.dataset.longitudeStep, latitudeStep: +map.dataset.latitudeStep,
      axes: [...new Set(elements.map(element => element.dataset.axis))].sort(),
      labels: elements.map(element => element.textContent),
      maxError: Math.max(0, ...roundTripErrors),
      font: elements.length ? parseFloat(getComputedStyle(elements[0]).fontSize) * elements[0].getScreenCTM().a : 0,
      gridValid: !/NaN|Infinity/.test(document.getElementById('grid').getAttribute('d')) };
  })()`;
  function assertCoordinates(metrics) {
    assert.deepEqual(metrics.axes, ['latitude', 'longitude']);
    assert(metrics.gridValid && metrics.maxError < .001, 'Coordinate ticks must match projected geographic positions');
    assert(Math.abs(metrics.font - 10) < .01, 'Coordinate labels must retain a fixed screen size');
  }
  const before = await evaluate(snapshotExpression);
  const overviewCoordinates = await evaluate(coordinateMetricsExpression);
  assertCoordinates(overviewCoordinates);
  const chinaAnchor = await evaluate(`(() => {
    const label = document.querySelector('.country-label[data-code="CHN"]');
    const point = new DOMPoint(+label.getAttribute('x'), +label.getAttribute('y')).matrixTransform(label.getScreenCTM());
    return { x: point.x, y: point.y };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...chinaAnchor });
  const pointerCoordinates = await evaluate(`({ ...document.getElementById('coordinate-readout').dataset })`);
  assert(Math.abs(+pointerCoordinates.longitude - 104) < .01 && Math.abs(+pointerCoordinates.latitude - 35) < .01,
    'Pointer coordinates should match the China label location: ' + JSON.stringify(pointerCoordinates));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  assert.equal(await evaluate('document.getElementById("coordinate-readout").dataset.longitude'), undefined,
    'The area outside the map must not produce geographic coordinates');
  const initialLabelMetrics = await evaluate(labelMetricsExpression);
  assert(before.maritime.every(layer => layer.open && layer.geometry.length > 0));
  assert.deepEqual(before.maritime.map(layer => layer.count), [205, 9]);
  await screenshot('rotating-overview.png');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.clickX, y: before.clickY, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.clickX, y: before.clickY, button: 'left', clickCount: 1 });
  const animationSamples = await evaluate(`new Promise(resolve => {
    const samples = [], start = performance.now();
    function sample(now) { samples.push(+document.getElementById('map').dataset.centralLongitude);
      if(now - start < 1200) requestAnimationFrame(sample); else resolve(samples); }
    requestAnimationFrame(sample);
  })`);
  const centered = await evaluate(snapshotExpression);
  assertCoordinates(await evaluate(coordinateMetricsExpression));
  await screenshot('rotating-china-centered.png');
  await evaluate("document.getElementById('reset').click()");
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 780, y: 440 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 780, y: 440, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 16; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 780 - i * 34, y: 440, button: 'left', buttons: 1 });
    await delay(20);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 236, y: 440, button: 'left', clickCount: 1 });
  await delay(250);
  const rotated = await evaluate(snapshotExpression);
  assert(rotated.maritime.every((layer, i) => layer.open && layer.geometry !== before.maritime[i].geometry),
    'Both maritime layers should be reprojected while the world rotates');
  await screenshot('rotating-wrap.png');
  const report = {
    countries: before.countries, rasterImages: before.rasterImages,
    centerLongitude: centered.longitude, chinaX: centered.x, chinaVerticalChange: centered.y - before.y,
    outlineFixedOnClick: before.outline === centered.outline,
    viewBoxFixedOnClick: before.viewBox === centered.viewBox,
    animationStates: new Set(animationSamples).size,
    dragLongitude: rotated.longitude, usaBeforeX: before.usaX, usaAfterX: rotated.usaX,
    outlineFixedOnDrag: before.outline === rotated.outline,
    viewBoxFixedOnDrag: before.viewBox === rotated.viewBox,
    maritimeCounts: before.maritime.map(layer => layer.count),
    overviewCoordinates, pointerCoordinates,
    errors
  };
  await evaluate("document.getElementById('reset').click()");
  const anchorBefore = await evaluate(`(() => {
    const p = new DOMPoint(975, 590).matrixTransform(document.getElementById('map').getScreenCTM().inverse());
    return [p.x, p.y];
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 975, y: 590, deltaX: 0, deltaY: -1800 });
  await delay(250);
  const anchorAfter = await evaluate(`(() => {
    const p = new DOMPoint(975, 590).matrixTransform(document.getElementById('map').getScreenCTM().inverse());
    return [p.x, p.y];
  })()`);
  report.zoomAnchorError = Math.hypot(anchorAfter[0] - anchorBefore[0], anchorAfter[1] - anchorBefore[1]);
  report.zoomMeter = await evaluate("document.getElementById('zoom').textContent");
  report.labelsAtOverview = initialLabelMetrics;
  report.labelsAtZoom = await evaluate(labelMetricsExpression);
  assertFixedLabels(initialLabelMetrics, report.labelsAtZoom);
  await screenshot('rotating-zoom.png');
  await evaluate("document.getElementById('reset').click()");
  report.resetZoom = await evaluate("document.getElementById('zoom').textContent");
  assertFixedLabels(initialLabelMetrics, await evaluate(labelMetricsExpression));
  assert.equal(before.countries, 242);
  assert.equal(before.rasterImages, 0);
  assert.equal(before.viewBox, centered.viewBox);
  assert.equal(before.viewBox, rotated.viewBox);
  assert.equal(before.outline, rotated.outline);
  assert.equal(await evaluate("document.title"), 'BesMapLab · 地图实验室');
  // Selecting Taiwan must preserve independent regions while keeping the selected label small.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`document.querySelector('.country[data-code="TWN"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await delay(100);
  report.regionNames = await evaluate(`['CHN', 'TWN', 'HKG', 'MAC'].map(code => {
    const element = document.querySelector('.country[data-code="' + code + '"]');
    return { code, name: element.dataset.name, title: element.querySelector('title').textContent,
      fill: getComputedStyle(element).fill,
      selected: element.classList.contains('selected') };
  })`);
  assert.deepEqual(report.regionNames.map(region => region.name), ['中国', '台湾', '香港', '澳门']);
  assert(report.regionNames.every(region => region.name === region.title));
  assert.equal(new Set(report.regionNames.map(region => region.fill)).size, 1, 'China, Taiwan, Hong Kong and Macao should share a fill color');
  assert.deepEqual(report.regionNames.filter(region => region.selected).map(region => region.code), ['TWN']);
  assert.equal(await evaluate('document.getElementById("selection").textContent'), '台湾');
  const selectedLabelMetrics = await evaluate(labelMetricsExpression);
  const taiwanCenter = await evaluate(`(() => {
    const box = document.querySelector('.country-label[data-code="TWN"]').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...taiwanCenter, deltaX: 0, deltaY: -10000 });
  await delay(100);
  assert.equal(await evaluate('document.getElementById("zoom").textContent'), '6400%');
  report.labelsAtMaximumZoom = await evaluate(labelMetricsExpression);
  report.coordinatesAtMaximumZoom = await evaluate(coordinateMetricsExpression);
  assertCoordinates(report.coordinatesAtMaximumZoom);
  assert(report.coordinatesAtMaximumZoom.longitudeStep < overviewCoordinates.longitudeStep
    && report.coordinatesAtMaximumZoom.latitudeStep < overviewCoordinates.latitudeStep, 'Zoom should refine grid spacing');
  assert(report.labelsAtMaximumZoom.taiwan.width > 0, 'Selected Taiwan label must remain visible');
  assertFixedLabels(selectedLabelMetrics, report.labelsAtMaximumZoom, ['country', 'taiwan', 'ocean']);
  await screenshot('taiwan-fixed-label-64x.png');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...taiwanCenter, deltaX: 0, deltaY: 10000 });
  await delay(100);
  assert.equal(await evaluate('document.getElementById("zoom").textContent'), '50%');
  assertFixedLabels(selectedLabelMetrics, await evaluate(labelMetricsExpression), ['country', 'taiwan', 'ocean']);
  await evaluate('document.getElementById("reset").click()');
  // Inspect the full China supplement enlarged after rotation.
  await evaluate(`document.querySelector('.country[data-code="CHN"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await delay(100);
  const seaCenter = await evaluate(`(() => {
    const box = document.getElementById('maritime-china').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...seaCenter, deltaX: 0, deltaY: -500 });
  await delay(100);
  await screenshot('maritime-regional.png');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...seaCenter, deltaX: 0, deltaY: -600 });
  await delay(100);
  await screenshot('maritime-south-china-sea.png');
  // Move the opposite longitude to the center so the supplement crosses the map seam.
  await evaluate('document.getElementById("reset").click()');
  await evaluate(`document.querySelector('.country[data-code="COL"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await delay(100);
  const seam = await evaluate(snapshotExpression);
  assert(seam.maritime.every(layer => layer.open && layer.geometry.length > 0));
  assertCoordinates(await evaluate(coordinateMetricsExpression));
  await screenshot('maritime-seam.png');
  await evaluate('document.getElementById("reset").click()');
  const layerTargets = { countryLabels: 'country-labels', oceanLabels: 'ocean-labels', grid: 'grid',
    coordinates: 'coordinate-labels', maritime: 'maritime-indicators', maritimeChina: 'maritime-china' };
  const layerStateExpression = `Object.fromEntries([...document.querySelectorAll('[data-layer]')].map(input => [input.dataset.layer, input.checked]))`;
  await click('#layers-toggle');
  assert.equal(await evaluate('document.getElementById("layers-toggle").getAttribute("aria-expanded")'), 'true');
  await screenshot('layers-desktop.png');
  for (const [key, id] of Object.entries(layerTargets)) {
    await click(`[data-layer="${key}"]`);
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('${id}')).display`), 'none');
    await click(`[data-layer="${key}"]`);
    assert.notEqual(await evaluate(`getComputedStyle(document.getElementById('${id}')).display`), 'none');
  }
  // Saving a mixed selection must survive a reload and the separate view-reset action.
  for (const key of ['countryLabels', 'grid', 'maritime']) await click(`[data-layer="${key}"]`);
  const savedLayers = await evaluate(layerStateExpression);
  await send('Page.reload'); await delay(500);
  assert.deepEqual(await evaluate(layerStateExpression), savedLayers);
  await click('#reset');
  assert.deepEqual(await evaluate(layerStateExpression), savedLayers);
  await click('#layers-toggle');
  await click('#layers-defaults');
  assert(Object.values(await evaluate(layerStateExpression)).every(Boolean));
  // Native switch keyboard interaction and Escape should preserve focus and map position.
  const longitudeBeforePanelKeys = await evaluate('document.getElementById("map").dataset.centralLongitude');
  await evaluate('document.querySelector("[data-layer=grid]").focus()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  assert.equal((await evaluate(layerStateExpression)).grid, false);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate('document.getElementById("layers-panel").hidden'), true);
  assert.equal(await evaluate('document.activeElement.id'), 'layers-toggle');
  assert.equal(await evaluate('document.getElementById("map").dataset.centralLongitude'), longitudeBeforePanelKeys);
  await click('#layers-toggle'); await click('#layers-defaults'); await click('#layers-close');
  report.layerPreferences = { independentSwitches: 6, savedAcrossReload: true, viewResetPreservesLayers: true, keyboard: true };
  // A narrow viewport should retain access to controls and avoid page overflow.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(200);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  report.mobileLabels = await evaluate(`(() => {
    const elements = [...document.querySelectorAll('.country-label, .ocean-label')];
    const boxes = elements.filter(element => getComputedStyle(element).display !== 'none')
      .map(element => ({ name: element.textContent, ...element.getBoundingClientRect().toJSON() }))
      .filter(box => box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight);
    const overlaps = boxes.flatMap((box, i) => boxes.slice(i + 1).filter(other => box.left < other.right
      && box.right > other.left && box.top < other.bottom && box.bottom > other.top).map(other => [box.name, other.name]));
    return { visible: boxes.length, overlaps };
  })()`);
  await screenshot('mobile-overview.png');
  assertCoordinates(await evaluate(coordinateMetricsExpression));
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await tap('#layers-toggle');
  const mobilePanel = await evaluate(`(() => {
    const box = document.getElementById('layers-panel').getBoundingClientRect();
    return { left: box.left, right: box.right, bottom: box.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
  })()`);
  assert(mobilePanel.left >= 0 && mobilePanel.right <= mobilePanel.viewportWidth && mobilePanel.bottom <= mobilePanel.viewportHeight);
  await screenshot('layers-mobile.png');
  await tap('[data-layer="oceanLabels"]');
  assert.equal(await evaluate('getComputedStyle(document.getElementById("ocean-labels")).display'), 'none');
  await tap('#layers-defaults'); await tap('#layers-close');
  assert(report.mobileLabels.visible > 0 && !report.mobileLabels.overlaps.length,
    'Mobile labels should remain readable without overlap: ' + JSON.stringify(report.mobileLabels));
  // Different viewport transforms can shift glyph hinting by a fractional pixel.
  assertFixedLabels(initialLabelMetrics, await evaluate(labelMetricsExpression), ['country', 'ocean'], 1);
  await evaluate('document.getElementById("zoom-in").click()');
  assertFixedLabels(initialLabelMetrics, await evaluate(labelMetricsExpression), ['country', 'ocean'], 1);
  // A short phone viewport must allow scrolling to the final control.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 360, deviceScaleFactor: 1, mobile: true });
  await tap('#layers-toggle');
  await evaluate('document.getElementById("layers-defaults").scrollIntoView({ block: "end" })');
  const defaultsVisible = await evaluate(`(() => {
    const box = document.getElementById('layers-defaults').getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight;
  })()`);
  assert(defaultsVisible, 'All layer controls must remain reachable on short screens');
  await screenshot('layers-short-screen.png');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  // Corrupt or unavailable browser storage should never stop offline rendering.
  await evaluate(`localStorage.setItem('besmaplab.layers.v1', '{broken')`);
  await send('Page.reload'); await delay(500);
  assert(Object.values(await evaluate(layerStateExpression)).every(Boolean));
  const blockedStorage = await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable in test'); } });` });
  await send('Page.reload'); await delay(500);
  await click('#layers-toggle'); await click('[data-layer="maritime"]');
  await selectProjection('equalEarth');
  assert.equal(await evaluate('document.getElementById("map").dataset.projection'), 'equalEarth');
  assert.equal(await evaluate('getComputedStyle(document.getElementById("maritime-indicators")).display'), 'none');
  assert.equal(await evaluate('document.getElementById("preference-status").textContent'), '设置仅在本次访问有效');
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockedStorage.identifier });
  await send('Page.reload'); await delay(500);
  await click('#layers-toggle'); await click('#layers-defaults'); await click('#layers-close');
  report.layerPreferences.touch = true; report.layerPreferences.shortScreen = true; report.layerPreferences.storageFallback = true;
  // Projection switches keep geographic focus and layer choices while changing geometry.
  await selectProjection('robinson');
  await click('#reset');
  await evaluate('document.getElementById("projection-select").focus()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  assert.equal(await evaluate('document.getElementById("map").dataset.projection'), 'equalEarth', 'Projection selector must work from the keyboard');
  await selectProjection('robinson');
  await click('#layers-toggle'); await click('[data-layer="maritime"]'); await click('#layers-close');
  await evaluate(`document.querySelector('.country[data-code="TWN"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await delay(100);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 410, deltaX: 0, deltaY: -1100 });
  const focusExpression = `(() => {
    const map = document.getElementById('map'), view = map.viewBox.baseVal;
    const p = BesMapProjections.create(map.dataset.projection).rotate([-Number(map.dataset.centralLongitude), 0, 0]);
    return { point: p.invert([view.x + view.width / 2, view.y + view.height / 2]),
      central: +map.dataset.centralLongitude, selected: document.querySelector('.country.selected')?.dataset.code,
      zoom: document.getElementById('zoom').textContent, projection: map.dataset.projection };
  })()`;
  const focusBefore = await evaluate(focusExpression);
  for (const id of ['equalEarth', 'mercator', 'robinson']) {
    await selectProjection(id);
    const current = await evaluate(focusExpression);
    assert.equal(current.selected, 'TWN'); assert.equal(current.central, focusBefore.central); assert.equal(current.zoom, focusBefore.zoom);
    assert(Math.hypot(current.point[0] - focusBefore.point[0], current.point[1] - focusBefore.point[1]) < .0001,
      'Projection switch must preserve the geographic center of a zoomed view');
    assert.equal((await evaluate(layerStateExpression)).maritime, false);
    assertCoordinates(await evaluate(coordinateMetricsExpression));
    assertFixedLabels(initialLabelMetrics, await evaluate(labelMetricsExpression), ['country', 'ocean'], 1);
  }
  await selectProjection('equalEarth'); await send('Page.reload'); await delay(500);
  assert.equal(await evaluate('document.getElementById("projection-select").value'), 'equalEarth');
  await click('#reset');
  assert.equal(await evaluate('document.getElementById("map").dataset.projection'), 'equalEarth');
  assert.equal((await evaluate(layerStateExpression)).maritime, false);
  await click('#layers-toggle'); await click('#layers-defaults'); await click('#layers-close');
  report.projections = [];
  const geometryHealthExpression = `(() => {
    const paths = [...document.querySelectorAll('#map path')];
    return paths.every(element => !/NaN|Infinity/.test(element.getAttribute('d') || ''));
  })()`;
  for (const id of ['robinson', 'equalEarth', 'mercator']) {
    await selectProjection(id); await click('#reset');
    const full = await evaluate(snapshotExpression);
    await evaluate(`document.querySelector('.country[data-code="CHN"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await delay(100);
    const china = await evaluate(snapshotExpression);
    assert.equal(china.longitude, 104); assert.equal(china.x, 864);
    assert.equal(china.outline, full.outline); assert.equal(china.y, full.y);
    assertCoordinates(await evaluate(coordinateMetricsExpression));
    assert.equal(await evaluate(geometryHealthExpression), true);
    await screenshot(`projection-${id}.png`);
    // Horizontal dragging, date-line clipping and maritime lines use the current projection.
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 440, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800 - i * 40, y: 440, button: 'left', buttons: 1 });
      await delay(20);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 480, y: 440, button: 'left', clickCount: 1 });
    await delay(100);
    const dragResult = await evaluate(snapshotExpression);
    assert.notEqual(dragResult.longitude, china.longitude); assert.equal(dragResult.outline, full.outline);
    assert(dragResult.maritime.every(layer => layer.open && layer.geometry.length));
    assertCoordinates(await evaluate(coordinateMetricsExpression));
    await screenshot(`projection-${id}-rotated.png`);
    await click('#reset');
    await evaluate(`document.querySelector('.country[data-code="CHN"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await delay(100);
    const zoomPoint = await evaluate(`(() => {
      const label = document.querySelector('.country-label[data-code="CHN"]');
      const p = new DOMPoint(+label.getAttribute('x'), +label.getAttribute('y')).matrixTransform(label.getScreenCTM());
      return { x: p.x, y: p.y };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...zoomPoint, deltaX: 0, deltaY: -10000 });
    assert.equal(await evaluate('document.getElementById("zoom").textContent'), '6400%');
    assertCoordinates(await evaluate(coordinateMetricsExpression));
    assertFixedLabels(initialLabelMetrics, await evaluate(labelMetricsExpression), ['ocean']);
    assert.equal(await evaluate(geometryHealthExpression), true);
    await screenshot(`projection-${id}-zoom.png`);
    const measurement = await evaluate(`(() => {
      const projection = BesMapProjections.create('${id}'), path = d3.geoPath(projection), bounds = path.bounds({ type: 'Sphere' });
      const circle = lat => d3.geoCircle().center([0, lat]).radius(2).precision(.5)();
      return { id: '${id}', width: bounds[1][0] - bounds[0][0], height: bounds[1][1] - bounds[0][1],
        sameAreaRatio: path.area(circle(60)) / path.area(circle(0)), outline: document.getElementById('outline').getAttribute('d') };
    })()`);
    report.projections.push(measurement);
  }
  assert.equal(new Set(report.projections.map(item => item.outline)).size, 3, 'Each projection must have a distinct world outline');
  assert(Math.abs(report.projections.find(item => item.id === 'equalEarth').sameAreaRatio - 1) < .001, 'Equal Earth should preserve equal geographic areas');
  const mercator = report.projections.find(item => item.id === 'mercator');
  assert(Math.abs(mercator.width - mercator.height) < .001 && mercator.sameAreaRatio > 3.9, 'Mercator should use a square extent and enlarge high latitudes');
  for (const item of report.projections) delete item.outline;
  await click('#reset');
  assert.equal(await evaluate(`(() => {
    const p = BesMapProjections.create('mercator');
    return !document.getElementById('ocean').isPointInFill(new DOMPoint(...p([0, 89])));
  })()`), true, 'Mercator must clip latitudes outside its visible limit');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const id of ['equalEarth', 'mercator']) {
    await selectProjection(id); await click('#reset');
    assertCoordinates(await evaluate(coordinateMetricsExpression));
    assert.equal(await evaluate(`(() => {
      const box = document.getElementById('projection-select').getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
    })()`), true);
    await screenshot(`projection-${id}-mobile.png`);
  }
  await evaluate(`localStorage.setItem('besmaplab.projection.v1', 'unknown-projection')`);
  await send('Page.reload'); await delay(500);
  assert.equal(await evaluate('document.getElementById("map").dataset.projection'), 'robinson');
  await require('./i18n-browser.cjs')({ send, evaluate, click, screenshot, delay, report,
    fileURL: pathToFileURL(path.join(root, 'index.html')).href });
  await require('./zoom-labels-browser.cjs')({ send, evaluate, click, screenshot, delay, report });
  await require('./drag-browser.cjs')({ send, evaluate, click, screenshot, delay, report });
  await require('./centering-browser.cjs')({ send, evaluate, click, screenshot, delay, report });
  fs.writeFileSync(path.join(output, 'map-validation.json'), JSON.stringify(report, null, 2).replace(/\n/g, '\r\n'));
  console.log(JSON.stringify(report));
  await send('Browser.close');
  socket.close();
  if (errors.length || Math.abs(centered.x - 864) > .01 || Math.abs(centered.y - before.y) > .01 || before.outline !== centered.outline || rotated.usaX < before.usaX || new Set(animationSamples).size < 3 || report.zoomAnchorError > .001 || report.resetZoom !== '100%') process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (browser && browser.exitCode === null) {
    // This is the dedicated child launched above, never a user's browser session.
    browser.kill();
    for (let i = 0; i < 30 && browser.exitCode === null; i++) await delay(100);
  }
  if (profile && path.dirname(path.resolve(profile)) === path.resolve(output)
      && path.basename(profile).startsWith('browser-profile-')) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch { console.warn('Test browser profile remains under build/; it is ignored by Git.'); }
  }
});
