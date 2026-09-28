const BesMapI18n = (() => {
  'use strict';
  const data = JSON.parse(document.getElementById('i18n-data').textContent);
  const locales = data.locales;
  const byId = new Map(locales.map(locale => [locale.id, locale]));
  const storageKey = 'besmaplab.language.v1';
  function resolve(tag) {
    if (typeof tag !== 'string') return null;
    const parts = tag.toLowerCase().replace(/_/g, '-').split('-');
    if (parts[0] === 'zh') {
      const script = parts.find(part => part === 'hans' || part === 'hant');
      const traditional = script ? script === 'hant' : parts.some(part => ['tw', 'hk', 'mo'].includes(part));
      return byId.has(traditional ? 'zh-Hant' : 'zh-Hans') ? (traditional ? 'zh-Hant' : 'zh-Hans') : null;
    }
    return byId.has(parts[0]) ? parts[0] : null;
  }
  let saved = {}, persistent = true;
  try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; }
  catch { persistent = false; /* file:// and privacy settings can restrict storage. */ }
  const query = new URL(location.href).searchParams;
  let ui = resolve(query.get('lang')) || resolve(saved.ui)
    || (navigator.languages || [navigator.language]).map(resolve).find(Boolean) || 'en';
  const mapChoice = value => value === 'follow' ? value : resolve(value);
  let map = mapChoice(query.get('mapLang')) || mapChoice(saved.map) || 'follow';
  const listeners = new Set();
  function text(key, parameters = {}, locale = ui) {
    const message = data.messages[locale]?.[key] ?? data.messages.en[key] ?? key;
    return message.replace(/\{(\w+)\}/g, (token, name) => parameters[name] ?? token);
  }
  const mapLanguage = () => map === 'follow' ? ui : map;
  function regionName(code) { return data.regions[code]?.[mapLanguage()] || data.regions[code]?.en || code; }
  function oceanName(code) { return data.oceans[code]?.[mapLanguage()] || data.oceans[code]?.en || code; }
  function applyDocument() {
    document.documentElement.lang = ui;
    document.documentElement.dir = byId.get(ui).dir;
    document.title = text('app.title');
    document.querySelector('meta[name="description"]').content = text('app.description');
    for (const attribute of ['text', 'aria-label', 'title']) {
      const marker = attribute === 'text' ? 'data-i18n' : `data-i18n-${attribute}`;
      for (const element of document.querySelectorAll(`[${marker}]`)) {
        const value = text(element.getAttribute(marker));
        if (attribute === 'text') element.textContent = value;
        else element.setAttribute(attribute, value);
      }
    }
  }
  function change(next = {}) {
    ui = resolve(next.ui) || ui;
    map = mapChoice(next.map) || map;
    try { localStorage.setItem(storageKey, JSON.stringify({ ui, map })); persistent = true; }
    catch { persistent = false; }
    // Keep explicit URL choices in sync, otherwise reload could undo a manual selection.
    try {
      const url = new URL(location.href);
      url.searchParams.set('lang', ui); url.searchParams.set('mapLang', map);
      history.replaceState(null, '', url);
    } catch { /* Language selection also works where local-file history is restricted. */ }
    applyDocument();
    for (const listener of listeners) listener();
  }
  applyDocument();
  return { locales, resolve, text, regionName, oceanName, change,
    get ui() { return ui; }, get map() { return map; }, get mapLanguage() { return mapLanguage(); },
    get persistent() { return persistent; }, metadata: id => byId.get(id),
    subscribe: listener => listeners.add(listener) };
})();
