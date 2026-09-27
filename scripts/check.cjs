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
assert(!/__(D3|PROJECTIONS|TOPOJSON|DETAIL|MOTION|STYLES|APP|LICENSE_NOTICES)__/.test(html));
assert(!/<script[^>]+src\s*=|<link[^>]+rel=["']stylesheet|<image\b/i.test(html), 'Standalone page must contain its runtime and vector data');
assert.equal(detail.objects.countries.geometries.length, 242);
assert.equal(motion.objects.countries.geometries.length, 242);
assert.deepEqual(detail.objects.countries.geometries.map(f => f.id), motion.objects.countries.geometries.map(f => f.id));
assert(motion.arcs.reduce((n, arc) => n + arc.length, 0) < detail.arcs.reduce((n, arc) => n + arc.length, 0));
console.log(`Checked ${checked} text files, source checksums, syntax, topology, and reproducible offline build.`);
