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
  const labels = JSON.parse(read('data/region-labels.json'));
  const styles = JSON.parse(read('data/region-styles.json'));
  const locales = JSON.parse(read('locales/manifest.json'));
  const messages = Object.fromEntries(locales.map(locale => [locale.id, JSON.parse(read(`locales/${locale.id}.json`))]));
  const regions = {};
  const oceans = JSON.parse(read('data/ocean-names.json'));
  const overrides = JSON.parse(read('data/name-overrides.json'));
  const countries = JSON.parse(read('data/ne_50m_admin_0_countries.geojson'));
  const colors = new Map(countries.features.map(feature => [feature.properties.ADM0_A3, feature.properties.MAPCOLOR7]));
  const lakes = JSON.parse(read('data/ne_50m_lakes.geojson'));
  const maritimeIndicators = JSON.parse(read('data/ne_50m_admin_0_boundary_lines_maritime_indicator.geojson'));
  const maritimeChina = JSON.parse(read('data/ne_50m_admin_0_boundary_lines_maritime_indicator_chn.geojson'));
  countries.features.forEach(feature => {
    const properties = feature.properties;
    const code = properties.ADM0_A3;
    const display = overrides[code] || {};
    regions[code] = Object.fromEntries(locales.map(locale => [locale.id,
      display[locale.id] || properties[locale.field] || display.en || properties.NAME_EN || properties.NAME]));
    feature.id = code;
    feature.properties = {
      code,
      point: labels[code]?.point || [properties.LABEL_X, properties.LABEL_Y],
      label: labels[code]?.label || false, labelRank: properties.LABELRANK,
      color: colors.get(styles[code]?.colorFrom) ?? properties.MAPCOLOR7,
      antarctica: properties.CONTINENT === 'Antarctica'
    };
  });
  for (const collection of [lakes, maritimeIndicators, maritimeChina]) {
    collection.features.forEach(feature => { feature.properties = {}; });
  }
  const input = { countries, lakes, maritimeIndicators, maritimeChina };
  // Only polygon rings need winding correction; maritime lines must remain open.
  for (const collection of [countries, lakes]) {
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
    __STYLES__: read('src/styles.css'), __APP__: read('src/i18n.js') + '\n' + read('src/projections.js') + '\n' + read('src/map.js'),
    __D3__: read('vendor/d3.min.js'), __PROJECTIONS__: read('vendor/d3-geo-projection.min.js'),
    __TOPOJSON__: read('vendor/topojson-client.min.js'),
    __I18N__: JSON.stringify({ locales, messages, regions, oceans }),
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
