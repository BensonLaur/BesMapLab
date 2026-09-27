const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const crlf = text => text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');

function write(name, text) {
  const destination = path.join(root, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, crlf(text));
}

function build() {
  // A separate realm loads the official browser bundles without npm dependencies.
  const context = vm.createContext({});
  for (const name of ['d3', 'topojson-client', 'topojson-server', 'topojson-simplify']) {
    vm.runInContext(read(`vendor/${name}.min.js`), context, { filename: name });
  }
  const { d3, topojson } = context;
  const labels = JSON.parse(read('data/label-positions.zh-CN.json'));
  const overrides = { CHN: '中国', RUS: '俄罗斯', COD: '刚果（金）', KOR: '韩国', USA: '美国' };
  const countries = JSON.parse(read('data/ne_50m_admin_0_countries.geojson'));
  const lakes = JSON.parse(read('data/ne_50m_lakes.geojson'));
  countries.features.forEach((feature, index) => {
    const properties = feature.properties;
    const name = overrides[properties.ADM0_A3] || properties.NAME_ZH || properties.NAME;
    feature.id = `${properties.ADM0_A3}-${index}`;
    feature.properties = {
      name, code: properties.ADM0_A3,
      point: labels[name] || [properties.LABEL_X, properties.LABEL_Y],
      label: Object.hasOwn(labels, name), color: properties.MAPCOLOR7,
      antarctica: properties.CONTINENT === 'Antarctica'
    };
  });
  lakes.features.forEach(feature => { feature.properties = {}; });
  const input = { countries, lakes };
  for (const collection of Object.values(input)) {
    for (const feature of collection.features) {
      const polygons = feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const coordinates of polygons) {
        // D3's spherical ring convention differs from common GeoJSON producers.
        if (d3.geoArea({ type: 'Polygon', coordinates }) > 2 * Math.PI) {
          coordinates.forEach(ring => ring.reverse());
        }
      }
    }
  }
  const detail = topojson.topology(input, 1e6);
  // Shared arcs must be simplified together so adjacent borders stay coincident.
  const weighted = topojson.presimplify(detail);
  const motion = topojson.quantize(topojson.simplify(weighted, topojson.quantile(weighted, 0.18)), 1e6);
  const manifest = JSON.parse(read('data/sources.json'));
  const notices = [read('LICENSE'), read('THIRD_PARTY_NOTICES.md'),
    ...manifest.vendor.map(item => `${item.package} ${item.version}\n${read(item.licensePath)}`)].join('\n\n');
  const replacements = {
    __STYLES__: read('src/styles.css'), __APP__: read('src/map.js'),
    __D3__: read('vendor/d3.min.js'), __PROJECTIONS__: read('vendor/d3-geo-projection.min.js'),
    __TOPOJSON__: read('vendor/topojson-client.min.js'),
    __DETAIL__: JSON.stringify(detail), __MOTION__: JSON.stringify(motion),
    __LICENSE_NOTICES__: notices.replace(/--/g, '—')
  };
  let html = read('src/index.template.html');
  for (const [token, content] of Object.entries(replacements)) {
    // Prevent data or library text from prematurely closing an inline script.
    html = html.replace(token, () => content.replace(/<\/script/gi, '<\\/script'));
  }
  return { html: crlf(html), detail, motion };
}

if (require.main === module) {
  const result = build();
  if (process.argv.includes('--check')) {
    if (read('index.html') !== result.html) throw new Error('index.html is stale; run npm run build');
    console.log('Standalone page matches its sources.');
  } else {
    write('index.html', result.html);
    write('build/detail.topo.json', JSON.stringify(result.detail) + '\n');
    write('build/motion.topo.json', JSON.stringify(result.motion) + '\n');
    console.log(`Built index.html (${Buffer.byteLength(result.html)} bytes).`);
  }
}

module.exports = { root, read, write, build };
