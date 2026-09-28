const assert = require('node:assert/strict');

module.exports = async ({ send, evaluate, click, screenshot, delay, report }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 650, height: 820, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => {
    BesMapI18n.change({ ui: 'zh-Hans', map: 'follow' });
    document.getElementById('layers-defaults').click();
    document.getElementById('layers-close').click();
    document.getElementById('language-close').click();
  })()`);
  const visible = codes => evaluate(`(() => {
    return ${JSON.stringify(codes)}.map(code => {
      const label = document.querySelector('.country-label[data-code="' + code + '"]');
      const box = label.getBoundingClientRect(), matrix = label.getScreenCTM();
      return { code, name: label.textContent, visible: box.width > 0 && box.right > 0 && box.left < innerWidth
        && box.bottom > 0 && box.top < innerHeight, selected: label.classList.contains('selected'),
        font: parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.a, matrix.b) };
    });
  })()`);
  async function focus(point, zoom) {
    await click('#reset');
    const start = await evaluate(`(() => {
      const svg = document.getElementById('map');
      const projection = BesMapProjections.create(svg.dataset.projection);
      const p = new DOMPoint(...projection(${JSON.stringify(point)})).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    })()`);
    // Pan and wheel only: selecting a country would hide the old eligibility bug.
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1, modifiers: 8 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 325, y: 410, button: 'left', buttons: 1, modifiers: 8 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 325, y: 410, button: 'left', clickCount: 1, modifiers: 8 });
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 325, y: 410, deltaX: 0, deltaY: -Math.log(zoom) / .0015 });
    await delay(100);
    assert.equal(await evaluate('document.querySelectorAll(".country.selected").length'), 0);
  }
  report.zoomLabels = [];
  for (const id of ['robinson', 'equalEarth', 'mercator']) {
    await evaluate(`(() => {
      const select = document.getElementById('projection-select'); select.value = '${id}';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await click('#reset');
    assert((await visible(['LAO', 'KHM'])).every(label => !label.visible), 'Overview should retain its sparse labels');
    await focus([104, 16], 20.09);
    const southeastAsia = await visible(['LAO', 'KHM', 'THA', 'VNM']);
    await screenshot(`zoom-labels-${id}-southeast-asia.png`);
    assert(southeastAsia.every(label => label.visible && !label.selected),
      `Unselected regions should appear when enlarged (${id}): ${JSON.stringify(southeastAsia)}`);
    assert(southeastAsia.every(label => Math.abs(label.font - 10.5) < .01));
    await evaluate(`BesMapI18n.change({ map: 'en' })`);
    assert((await visible(['LAO', 'KHM'])).every(label => label.visible), 'Language changes must retain eligible labels');
    await evaluate(`BesMapI18n.change({ map: 'follow' })`);
    await click('#layers-toggle'); await click('[data-layer="countryLabels"]'); await click('#layers-close');
    assert((await visible(['LAO', 'KHM'])).every(label => !label.visible), 'Layer switch still controls zoomed labels');
    await click('#layers-toggle'); await click('[data-layer="countryLabels"]'); await click('#layers-close');
    assert((await visible(['LAO', 'KHM'])).every(label => label.visible));
    await focus([125, 37], 5.21);
    const korea = await visible(['PRK', 'KOR']);
    await screenshot(`zoom-labels-${id}-korea.png`);
    assert(korea.every(label => label.visible && !label.selected), `Korean labels at regional zoom: ${JSON.stringify(korea)}`);
    await focus([88, 28], 10);
    const himalayas = await visible(['NPL', 'BTN']);
    assert(himalayas.every(label => label.visible && !label.selected), `Himalayan labels: ${JSON.stringify(himalayas)}`);
    report.zoomLabels.push({ projection: id, southeastAsia, korea, himalayas });
  }
  await click('#reset');
};
