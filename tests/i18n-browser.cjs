const assert = require('node:assert/strict');

module.exports = async ({ send, evaluate, click, screenshot, delay, report, fileURL }) => {
  const locales = await evaluate('BesMapI18n.locales');
  async function choose(selector, value) {
    await evaluate(`(() => {
      const select = document.querySelector(${JSON.stringify(selector)});
      select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await delay(30);
  }
  const snapshot = `(() => ({
    projection: document.getElementById('map').dataset.projection,
    central: document.getElementById('map').dataset.centralLongitude,
    view: document.getElementById('map').getAttribute('viewBox'),
    paths: [...document.querySelectorAll('.country')].map(element => element.getAttribute('d')),
    selected: document.querySelector('.country.selected')?.dataset.code,
    layers: [...document.querySelectorAll('[data-layer]')].map(element => element.checked)
  }))()`;
  const labelHealth = `(() => {
    const boxes = [...document.querySelectorAll('.country-label, .ocean-label')]
      .filter(element => getComputedStyle(element).display !== 'none' && getComputedStyle(element.parentNode).display !== 'none')
      .map(element => ({ name: element.textContent, ...element.getBoundingClientRect().toJSON() }))
      .filter(box => box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight);
    const overlaps = boxes.flatMap((box, i) => boxes.slice(i + 1).filter(other => box.left < other.right
      && box.right > other.left && box.top < other.bottom && box.bottom > other.top).map(other => [box.name, other.name]));
    return { visible: boxes.length, overlaps };
  })()`;
  const panelHealth = `(() => {
    const panel = document.querySelector('#language-panel:not([hidden]), #layers-panel:not([hidden])');
    const box = panel.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
      && panel.scrollWidth <= panel.clientWidth && document.documentElement.scrollWidth <= innerWidth;
  })()`;
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('#reset');
  await choose('#projection-select', 'equalEarth');
  await evaluate(`document.querySelector('.country[data-code="TWN"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await delay(100);
  await click('#zoom-in');
  const before = await evaluate(snapshot);
  report.languages = [];
  for (const locale of locales) {
    await choose('#interface-language', locale.id);
    assert.deepEqual(await evaluate(snapshot), before, 'Translation must preserve geometry and exploration state');
    const state = await evaluate(`(() => ({
      lang: document.documentElement.lang, dir: document.documentElement.dir,
      mapLang: document.getElementById('country-labels').getAttribute('lang'),
      taiwan: document.querySelector('.country[data-code="TWN"]').dataset.name,
      selection: document.getElementById('selection').textContent,
      count: document.querySelectorAll('#interface-language option').length,
      empty: [...document.querySelectorAll('.country-label, .ocean-label')].some(element => !element.textContent.trim()),
      title: document.title
    }))()`);
    assert.equal(state.lang, locale.id); assert.equal(state.dir, locale.dir);
    assert.equal(state.mapLang, locale.id); assert.equal(state.selection, state.taiwan);
    assert.equal(state.count, locales.length); assert(!state.empty);
    const health = await evaluate(labelHealth);
    assert(health.visible > 0 && !health.overlaps.length, `${locale.id}: ${JSON.stringify(health)}`);
    if (['zh-Hans', 'en', 'de', 'ar'].includes(locale.id)) {
      await click('#language-toggle');
      assert(await evaluate(panelHealth)); await screenshot(`language-${locale.id}.png`);
      await click('#language-close');
    }
    report.languages.push({ id: locale.id, dir: state.dir, taiwan: state.taiwan, visible: health.visible });
  }
  await choose('#interface-language', 'ar');
  await choose('#map-language', 'en');
  assert.deepEqual(await evaluate(snapshot), before);
  assert.equal(await evaluate('document.documentElement.dir'), 'rtl');
  assert.equal(await evaluate('document.getElementById("country-labels").getAttribute("direction")'), 'ltr');
  assert.equal(await evaluate('document.getElementById("selection").textContent'), 'Taiwan');
  // Native keyboard selection must not trigger map shortcuts; Escape returns focus.
  await click('#language-toggle');
  await evaluate('document.getElementById("map-language").focus()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
  assert.equal(await evaluate('BesMapI18n.map'), 'follow');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate('document.activeElement.id'), 'language-toggle');
  await choose('#map-language', 'en');
  await send('Page.reload'); await delay(500);
  assert.equal(await evaluate('BesMapI18n.ui'), 'ar');
  assert.equal(await evaluate('BesMapI18n.map'), 'en');
  await send('Page.navigate', { url: fileURL }); await delay(500);
  assert.equal(await evaluate('BesMapI18n.ui'), 'ar', 'Saved preference should beat browser language');
  assert.equal(await evaluate('BesMapI18n.map'), 'en');
  await choose('#map-language', 'follow');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const id of ['ar', 'de', 'hi', 'bn', 'ur'].filter(id => locales.some(locale => locale.id === id))) {
    await choose('#interface-language', id);
    await click('#reset');
    const health = await evaluate(labelHealth);
    assert(health.visible > 0 && !health.overlaps.length, `Mobile ${id}: ${JSON.stringify(health)}`);
    await click('#language-toggle');
    assert(await evaluate(panelHealth)); await screenshot(`language-${id}-mobile.png`);
    await click('#layers-toggle');
    assert(await evaluate('document.getElementById("language-panel").hidden'));
    assert(await evaluate(panelHealth)); await screenshot(`layers-${id}-mobile.png`);
    await click('#layers-close');
  }
  // Language matching and fallback are tested on actual fresh page loads.
  await evaluate(`localStorage.removeItem('besmaplab.language.v1')`);
  const browserLanguages = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'languages', { value: ['zz-ZZ', 'de-AT', 'en-US'] });`
  });
  await send('Page.navigate', { url: fileURL + '?lang=unknown' }); await delay(500);
  assert.equal(await evaluate('BesMapI18n.ui'), 'de');
  await send('Page.navigate', { url: fileURL + '?lang=ar&mapLang=en' }); await delay(500);
  assert.equal(await evaluate('BesMapI18n.ui'), 'ar');
  assert.equal(await evaluate('BesMapI18n.mapLanguage'), 'en');
  await choose('#interface-language', 'de');
  await send('Page.reload'); await delay(500);
  assert.equal(await evaluate('BesMapI18n.ui'), 'de', 'Manual selection must update an explicit URL');
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: browserLanguages.identifier });
  const unsupported = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'languages', { value: ['zz-ZZ'] }); Object.defineProperty(window, 'localStorage', { get() { throw new Error('No storage'); } });`
  });
  await send('Page.navigate', { url: fileURL }); await delay(500);
  assert.equal(await evaluate('BesMapI18n.ui'), 'en');
  await choose('#interface-language', 'ar');
  assert.equal(await evaluate('BesMapI18n.ui'), 'ar');
  assert.equal(await evaluate('BesMapI18n.persistent'), false);
  assert.equal(await evaluate('document.getElementById("language-status").textContent'), await evaluate('BesMapI18n.text("preferences.temporary")'));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: unsupported.identifier });
  if (locales.some(locale => locale.id === 'zh-Hant')) {
    for (const tag of ['zh-TW', 'zh-HK', 'zh-Hant-CN']) {
      await send('Page.navigate', { url: fileURL + '?lang=' + tag }); await delay(400);
      assert.equal(await evaluate('BesMapI18n.ui'), 'zh-Hant');
    }
    await send('Page.navigate', { url: fileURL + '?lang=zh-Hans-HK' }); await delay(400);
    assert.equal(await evaluate('BesMapI18n.ui'), 'zh-Hans');
  }
  report.languageChecks = { offline: true, statePreserved: true, independentLabels: true,
    keyboard: true, mobilePanels: true, urlSavedBrowserPriority: true, storageFallback: true };
};
