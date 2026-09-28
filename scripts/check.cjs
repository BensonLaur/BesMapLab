const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { root, read, build } = require('./build.cjs');

const ignored = new Set(['.git', 'build', 'node_modules', 'coverage']);
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : [filename];
  });
}

let checked = 0;
for (const filename of files(root)) {
  if (/\.(png|jpg|ico)$/i.test(filename)) continue;
  const content = fs.readFileSync(filename, 'utf8');
  assert(!/(?<!\r)\n|\r(?!\n)/.test(content), `Mixed or non-CRLF line endings: ${filename}`);
  if (/\.(js|cjs)$/.test(filename)) {
    execFileSync(process.execPath, ['--check', filename], { stdio: 'pipe', windowsHide: true });
  }
  checked++;
}
const manifest = JSON.parse(read('data/sources.json'));
for (const entry of [...manifest.data, ...manifest.vendor]) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, entry.path))).digest('hex');
  assert.equal(digest, entry.sha256, `Source checksum changed: ${entry.path}`);
  if (entry.licensePath) assert(fs.existsSync(path.join(root, entry.licensePath)));
}
const { html, detail, motion } = build();
assert.equal(read('index.html'), html, 'Generated page is stale. Run npm run build.');
assert(!/__(D3|PROJECTIONS|TOPOJSON|DETAIL|MOTION|I18N|STYLES|APP|LICENSE_NOTICES)__/.test(html));
assert(!/<script[^>]+src\s*=|<link[^>]+rel=["']stylesheet|<image\b/i.test(html), 'Standalone page must contain its runtime and vector data');
assert.equal(detail.objects.countries.geometries.length, 242);
assert.equal(motion.objects.countries.geometries.length, 242);
assert.deepEqual(detail.objects.countries.geometries.map(f => f.id), motion.objects.countries.geometries.map(f => f.id));
for (const topology of [detail, motion]) {
  assert.equal(topology.objects.maritimeIndicators.geometries.length, 205);
  assert.equal(topology.objects.maritimeChina.geometries.length, 9);
  for (const layer of ['maritimeIndicators', 'maritimeChina']) {
    assert(topology.objects[layer].geometries.every(feature => feature.type === 'LineString'));
  }
}
assert(motion.arcs.reduce((n, arc) => n + arc.length, 0) < detail.arcs.reduce((n, arc) => n + arc.length, 0));
const locales = JSON.parse(read('locales/manifest.json'));
assert.equal(locales.length, 18);
assert.equal(new Set(locales.map(locale => locale.id)).size, locales.length);
const english = JSON.parse(read('locales/en.json'));
const keys = Object.keys(english).sort();
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
for (const locale of locales) {
  assert.equal(Intl.getCanonicalLocales(locale.id)[0], locale.id);
  assert.equal(locale.dir, ['ar', 'ur'].includes(locale.id) ? 'rtl' : 'ltr');
  const dictionary = JSON.parse(read(`locales/${locale.id}.json`));
  assert.deepEqual(Object.keys(dictionary).sort(), keys, `Incomplete dictionary: ${locale.id}`);
  for (const key of keys) {
    assert(typeof dictionary[key] === 'string' && dictionary[key].trim(), `${locale.id}: empty ${key}`);
    assert(!dictionary[key].includes('\uFFFD'), `${locale.id}: invalid Unicode`);
    assert.deepEqual(placeholders(dictionary[key]), placeholders(english[key]), `${locale.id}: placeholders in ${key}`);
  }
}
for (const match of read('src/index.template.html').matchAll(/data-i18n(?:-aria-label|-title)?="([^"]+)"/g)) {
  assert(Object.hasOwn(english, match[1]), `Unknown template message: ${match[1]}`);
}
const source = JSON.parse(read('data/ne_50m_admin_0_countries.geojson'));
const codes = new Set(source.features.map(feature => feature.properties.ADM0_A3));
assert.equal(codes.size, 242, 'Region codes must uniquely identify all source features');
const names = JSON.parse(read('data/name-overrides.json'));
const styles = JSON.parse(read('data/region-styles.json'));
const labels = JSON.parse(read('data/region-labels.json'));
for (const code of new Set([...Object.keys(names), ...Object.keys(styles), ...Object.keys(labels)])) {
  assert(codes.has(code), `Unknown configured region: ${code}`);
}
for (const label of Object.values(labels)) {
  assert.equal(label.point.length, 2);
  assert(label.point.every(Number.isFinite) && Math.abs(label.point[0]) <= 180 && Math.abs(label.point[1]) <= 90);
  assert.equal(typeof label.label, 'boolean');
}
assert.equal(labels.MNG.label, true, 'Code-based labels restore the formerly mismatched Mongolia name');
for (const style of Object.values(styles)) assert(codes.has(style.colorFrom));
const payload = JSON.parse(html.match(/<script id="i18n-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
assert.equal(Object.keys(payload.regions).length, 242);
assert.equal(Object.keys(payload.oceans).length, 5);
for (const locale of locales) {
  assert(names.TWN[locale.id], `Taiwan display override required for ${locale.id}`);
  assert.equal(payload.regions.TWN[locale.id], names.TWN[locale.id]);
  for (const feature of source.features) {
    assert(feature.properties[locale.field], `Missing Natural Earth name: ${locale.field}`);
    assert(payload.regions[feature.properties.ADM0_A3][locale.id]?.trim());
  }
  for (const names of Object.values(payload.oceans)) assert(names[locale.id]?.trim());
}
console.log(`Checked ${checked} text files, source checksums, syntax, topology, 18 dictionaries, 242 multilingual regions, and reproducible offline build.`);
