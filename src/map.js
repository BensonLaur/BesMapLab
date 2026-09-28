(() => {
  'use strict';
  const i18n = BesMapI18n;
  const t = i18n.text;
  const nameOf = feature => i18n.regionName(feature.properties.code);
  const svg = document.getElementById('map');
  const viewport = document.getElementById('viewport');
  const meter = document.getElementById('zoom');
  const status = document.getElementById('selection');
  const longitude = document.getElementById('longitude');
  const base = { w: 1728, h: 972 };
  const view = { x: 0, y: 0, w: base.w, h: base.h };
  const state = { central: 0, selected: null, projection: 'robinson' };
  const projectionStorageKey = 'besmaplab.projection.v1';
  const projectionSelect = document.getElementById('projection-select');
  for (const id of Object.keys(BesMapProjections.definitions)) {
    projectionSelect.add(new Option(t(`projection.${id}.name`), id));
  }
  const layerDefaults = { countryLabels: true, oceanLabels: true, grid: true, coordinates: true, maritime: true, maritimeChina: true };
  const layerStorageKey = 'besmaplab.layers.v1';
  const layers = { ...layerDefaults };
  let preferencesSaved = true;
  try {
    const saved = JSON.parse(localStorage.getItem(layerStorageKey));
    for (const key of Object.keys(layers)) if (typeof saved?.[key] === 'boolean') layers[key] = saved[key];
  } catch { preferencesSaved = false; /* Storage restrictions must not disable the map. */ }
  try {
    const saved = localStorage.getItem(projectionStorageKey);
    if (Object.hasOwn(BesMapProjections.definitions, saved)) state.projection = saved;
  } catch { preferencesSaved = false; }
  const palette = ['#dfe4de', '#d0dfd7', '#ead9bb', '#d8d5e7', '#cadde8', '#ecd4cf', '#e2e4c8', '#c6dfd4'];
  let fitSize, animation = 0, pendingDraw = 0, drag = null, suppressClick = false;
  const pointers = new Map();
  let pinch = null, cursor = null, coordinateBoxes = [];

  function decode(id) {
    const topology = JSON.parse(document.getElementById(id).textContent);
    return { countries: topojson.feature(topology, topology.objects.countries).features,
             lakes: topojson.feature(topology, topology.objects.lakes),
             maritimeIndicators: topojson.feature(topology, topology.objects.maritimeIndicators).features,
             maritimeChina: topojson.feature(topology, topology.objects.maritimeChina).features };
  }
  const detail = decode('detail-data');
  const motion = decode('motion-data');
  let projection = BesMapProjections.create(state.projection);
  const path = d3.geoPath(projection).digits(3);
  let worldBounds;
  function projectionDefinition() { return BesMapProjections.definitions[state.projection]; }
  function configureProjection() {
    projection.rotate([-state.central, 0, 0]); path.projection(projection);
    const outlinePath = path({ type: 'Sphere' });
    // Only a projection switch changes the world outline; longitude rotation keeps it fixed.
    for (const id of ['ocean', 'outline', 'clip-outline']) document.getElementById(id).setAttribute('d', outlinePath);
    worldBounds = path.bounds({ type: 'Sphere' });
    projectionSelect.value = state.projection;
    document.getElementById('projection-note').textContent = t(`projection.${state.projection}.description`);
    document.getElementById('projection-source').textContent = t(`projection.${state.projection}.name`);
    svg.dataset.projection = state.projection;
  }
  configureProjection();
  const countries = d3.select('#countries').selectAll('path').data(detail.countries).join('path')
    .attr('class', 'country').attr('data-code', f => f.properties.code)
    .attr('data-id', f => f.id).attr('data-name', nameOf)
    .attr('fill', f => f.properties.antarctica ? '#e3e9e9' : palette[f.properties.color] || palette[0]);
  countries.append('title').text(nameOf);
  const maritimeIndicators = d3.select('#maritime-indicators').selectAll('path').data(detail.maritimeIndicators).join('path')
    .attr('class', 'maritime-line');
  const maritimeChina = d3.select('#maritime-china').selectAll('path').data(detail.maritimeChina).join('path')
    .attr('class', 'maritime-line maritime-china-line');
  const labels = d3.select('#country-labels').selectAll('text').data(detail.countries).join('text')
    .attr('class', 'country-label').attr('data-code', f => f.properties.code).attr('data-id', f => f.id)
    .text(nameOf);
  const oceans = d3.select('#ocean-labels').selectAll('text').data([
    { code: 'pacific', point: [-150, 0] }, { code: 'atlantic', point: [-33, 1] },
    { code: 'indian', point: [76, -29] }, { code: 'arctic', point: [0, 78] },
    { code: 'southern', point: [0, -63] }
  ]).join('text').attr('class', 'ocean-label').text(d => i18n.oceanName(d.code));

  const measurementCache = new Map();
  const measureSvg = d3.select(document.body).append('svg').attr('aria-hidden', 'true')
    .attr('width', 1).attr('height', 1).style('position', 'fixed').style('visibility', 'hidden').style('pointer-events', 'none');
  const measureText = measureSvg.append('text').attr('text-anchor', 'middle');
  let mapFont;
  function measureLabel(text, ocean, selected) {
    const key = `${i18n.mapLanguage}|${ocean}|${selected}|${text}`;
    if (!measurementCache.has(key)) {
      // Measure shaped glyphs at screen size, outside the map's zoom transform.
      // Character counts do not predict Arabic joining, CJK widths or fallback fonts.
      measureText.style('font-family', mapFont).style('font-size', ocean ? '18px' : '10.5px')
        .style('font-weight', selected ? '600' : '400').attr('dominant-baseline', ocean ? 'auto' : 'middle')
        .attr('lang', i18n.mapLanguage).attr('direction', i18n.metadata(i18n.mapLanguage).dir).text(text);
      const { x, y, width, height } = measureText.node().getBBox();
      measurementCache.set(key, { x, y, width, height });
    }
    return measurementCache.get(key);
  }
  const languagePanel = document.getElementById('language-panel');
  const languageToggle = document.getElementById('language-toggle');
  const interfaceLanguage = document.getElementById('interface-language');
  const mapLanguage = document.getElementById('map-language');
  mapLanguage.add(new Option(t('language.follow'), 'follow'));
  for (const locale of i18n.locales) {
    for (const select of [interfaceLanguage, mapLanguage]) {
      const option = new Option(locale.name, locale.id);
      option.lang = locale.id; option.dir = locale.dir; select.add(option);
    }
  }
  function updateLongitude() {
    const central = wrap(state.central);
    // Isolate coordinates so RTL sentences cannot reverse the E/W numeric run.
    longitude.textContent = t('longitude', { value: `\u2066${Math.abs(central).toFixed(1)}°${central > .05 ? 'E' : central < -.05 ? 'W' : ''}\u2069` });
  }
  function applyLanguage() {
    interfaceLanguage.value = i18n.ui; mapLanguage.value = i18n.map;
    mapLanguage.options[0].textContent = t('language.follow');
    const current = document.getElementById('language-current');
    current.textContent = i18n.metadata(i18n.ui).name; current.dir = i18n.metadata(i18n.ui).dir;
    languageToggle.title = `${t('language.button')}: ${current.textContent}`;
    for (const option of projectionSelect.options) option.textContent = t(`projection.${option.value}.name`);
    document.getElementById('projection-note').textContent = t(`projection.${state.projection}.description`);
    document.getElementById('projection-source').textContent = t(`projection.${state.projection}.name`);
    countries.attr('data-name', nameOf).select('title').text(nameOf);
    labels.text(nameOf); oceans.text(d => i18n.oceanName(d.code));
    for (const group of ['country-labels', 'ocean-labels']) {
      const element = document.getElementById(group);
      element.setAttribute('lang', i18n.mapLanguage); element.setAttribute('direction', i18n.metadata(i18n.mapLanguage).dir);
    }
    status.lang = i18n.mapLanguage; status.dir = i18n.metadata(i18n.mapLanguage).dir;
    const selected = detail.countries.find(feature => feature.id === state.selected);
    if (selected) status.textContent = nameOf(selected);
    mapFont = getComputedStyle(labels.node()).fontFamily;
    measurementCache.clear(); updateLongitude();
    document.getElementById('preference-status').textContent = t(preferencesSaved ? 'preferences.saved' : 'preferences.temporary');
    document.getElementById('language-status').textContent = t(i18n.persistent ? 'preferences.saved' : 'preferences.temporary');
  }
  i18n.subscribe(() => { applyLanguage(); drawGraticule(); layoutLabels(); updateCoordinates(); });
  interfaceLanguage.addEventListener('change', () => i18n.change({ ui: interfaceLanguage.value }));
  mapLanguage.addEventListener('change', () => i18n.change({ map: mapLanguage.value }));
  function setLanguagePanel(open, restoreFocus = false) {
    if (open) setPanel(false);
    languagePanel.hidden = !open; languageToggle.setAttribute('aria-expanded', open);
    if (restoreFocus) languageToggle.focus();
    drawGraticule(); layoutLabels();
  }
  languageToggle.addEventListener('click', () => setLanguagePanel(languagePanel.hidden));
  document.getElementById('language-close').addEventListener('click', () => setLanguagePanel(false, true));
  document.addEventListener('pointerdown', event => {
    if (!languagePanel.hidden && !languagePanel.contains(event.target) && !languageToggle.contains(event.target)) setLanguagePanel(false);
  });

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
  function fitDimensions() {
    const ratio = Math.max(1, viewport.clientWidth) / Math.max(1, viewport.clientHeight);
    // A square Mercator world needs less horizontal padding than an oval world on phones.
    const worldWidth = worldBounds[1][0] - worldBounds[0][0];
    const w = Math.max(worldWidth + 128, base.h * ratio);
    return { w, h: w / ratio };
  }
  function zoomLevel() { return fitSize.w / view.w; }
  function renderView() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    // Convert fixed screen-pixel text and halos to SVG units after zoom or resize.
    svg.style.setProperty('--label-scale', view.w / Math.max(1, viewport.clientWidth));
    // Use the actual screen scale so dense line fragments also recede on narrow screens.
    const seaDetail = clamp((viewport.clientWidth / view.w - .9) / 3.5, 0, 1);
    const seaEmphasis = seaDetail * seaDetail * (3 - 2 * seaDetail);
    svg.style.setProperty('--maritime-opacity', .16 + .36 * seaEmphasis);
    svg.style.setProperty('--maritime-china-opacity', .4 + .32 * seaEmphasis);
    meter.textContent = `${Math.round(zoomLevel() * 100)}%`;
    drawGraticule();
    layoutLabels();
    updateCoordinates();
  }
  function fitView() {
    fitSize = fitDimensions();
    view.w = fitSize.w; view.h = fitSize.h;
    view.x = (base.w - view.w) / 2; view.y = (base.h - view.h) / 2;
    renderView();
  }
  function overlayBoxes() {
    return [...document.querySelectorAll('.heading, .longitude, .selection, .controls, .map-toolbar, .layers-panel, .language-panel, .hint, .source')]
      .map(element => element.getBoundingClientRect()).filter(box => box.width && box.height)
      .map(box => ({ left: box.left - 5, right: box.right + 5, top: box.top - 5, bottom: box.bottom + 5 }));
  }
  function overlaps(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
  function formatDegrees(value, axis, decimals = 0) {
    const rounded = +Math.abs(value).toFixed(decimals);
    const suffix = rounded === 0 || (axis === 'longitude' && rounded === 180) ? ''
      : axis === 'longitude' ? (value < 0 ? 'W' : 'E') : (value < 0 ? 'S' : 'N');
    return `${rounded.toFixed(decimals)}°${suffix}`;
  }
  function drawGraticule() {
    const width = viewport.clientWidth, height = viewport.clientHeight, scale = width / view.w;
    const coordinateGroup = d3.select('#coordinate-labels');
    const grid = document.getElementById('grid');
    coordinateBoxes = [];
    if (!layers.grid && !layers.coordinates) return;
    const top = Math.max(view.y, worldBounds[0][1]), bottom = Math.min(view.y + view.h, worldBounds[1][1]);
    if (top >= bottom || view.x >= worldBounds[1][0] || view.x + view.w <= worldBounds[0][0]) {
      grid.setAttribute('d', ''); coordinateGroup.selectAll('*').remove(); return;
    }
    const center = wrap(state.central), centerX = projection.translate()[0];
    const topLat = projection.invert([centerX, top])[1], bottomLat = projection.invert([centerX, bottom])[1];
    const middleLat = (topLat + bottomLat) / 2;
    // All three projections keep latitude independent of longitude. Use unwrapped longitudes
    // around the central meridian so zooming across the date line cannot skip ticks.
    function unitsPerLongitude(latitude) {
      return Math.abs(projection([wrap(center + 90), latitude])[0] - centerX) / 90;
    }
    const latitudes = [topLat, bottomLat, clamp(0, bottomLat, topLat)];
    const leftDelta = Math.max(-180, Math.min(...latitudes.map(lat => (view.x - centerX) / unitsPerLongitude(lat))));
    const rightDelta = Math.min(180, Math.max(...latitudes.map(lat => (view.x + view.w - centerX) / unitsPerLongitude(lat))));
    if (leftDelta >= rightDelta) { grid.setAttribute('d', ''); coordinateGroup.selectAll('*').remove(); return; }
    const steps = [.1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 90];
    const longitudePixels = unitsPerLongitude(middleLat) * scale;
    const latitudeLimit = projectionDefinition().latitudeLimit - .001;
    const sampleSouth = Math.max(-latitudeLimit, middleLat - .25), sampleNorth = Math.min(latitudeLimit, middleLat + .25);
    const latitudePixels = Math.abs(projection([center, sampleSouth])[1] - projection([center, sampleNorth])[1])
      * scale / (sampleNorth - sampleSouth);
    const lonStep = steps.find(step => step * longitudePixels >= 80) || 90;
    const latStep = steps.find(step => step * latitudePixels >= (width < 600 ? 50 : 75)) || 90;
    svg.dataset.longitudeStep = lonStep; svg.dataset.latitudeStep = latStep;
    function ticks(from, to, step) {
      return d3.range(Math.ceil((from - 1e-7) / step), Math.floor((to + 1e-7) / step) + 1).map(n => +(n * step).toFixed(6));
    }
    function samples(from, to) { return [...d3.range(from, to, 2), to]; }
    const meridians = ticks(center + leftDelta, center + rightDelta, lonStep);
    const parallels = ticks(Math.max(-89.999, bottomLat), Math.min(89.999, topLat), latStep);
    const lines = meridians.map(lon => samples(bottomLat, topLat).map(lat => [wrap(lon), lat]));
    // Parallel samples preserve constant latitude; their sparse endpoints alone would
    // be interpreted by D3 as great-circle arcs and bow away from the correct latitude.
    for (const lat of parallels) lines.push(samples(center + Math.max(-179.9999, leftDelta),
      center + Math.min(179.9999, rightDelta)).map(lon => [wrap(lon), lat]));
    grid.setAttribute('d', path({ type: 'MultiLineString', coordinates: lines }) || '');
    if (!layers.coordinates) return;
    const occupied = overlayBoxes(), items = [];
    function add(axis, value, x, y, anchor, tick) {
      const text = formatDegrees(value, axis, (axis === 'longitude' ? lonStep : latStep) < 1 ? 1 : 0);
      const textWidth = text.length * 6.3 + 6;
      const left = anchor === 'end' ? x - textWidth : anchor === 'start' ? x : x - textWidth / 2;
      const box = { left, right: left + textWidth, top: y - 9, bottom: y + 9 };
      if (box.left < 5 || box.right > width - 5 || box.top < 5 || box.bottom > height - 5
          || occupied.some(other => overlaps(box, other))) return;
      occupied.push(box); coordinateBoxes.push(box);
      items.push({ axis, value, text, x: view.x + x / scale, y: view.y + y / scale, anchor,
        tick: tick.map(([sx, sy]) => [view.x + sx / scale, view.y + sy / scale]) });
    }
    const tickY = Math.max(88, (worldBounds[0][1] - view.y) * scale);
    if (tickY < height - 40 && view.y + tickY / scale <= worldBounds[1][1]) {
      const tickLat = projection.invert([centerX, view.y + tickY / scale])[1];
      for (const lon of [...meridians].sort((a, b) => Math.abs(a - center) - Math.abs(b - center))) {
        const x = (projection([wrap(lon), tickLat])[0] - view.x) * scale;
        add('longitude', wrap(lon), x, tickY - 11, 'middle', [[x, tickY - 3], [x, tickY + 3]]);
      }
    }
    for (const lat of parallels) {
      const y = (projection([center, lat])[1] - view.y) * scale;
      const edge = (centerX - 180 * unitsPerLongitude(lat) - view.x) * scale;
      const outside = edge >= 62, x = outside ? edge - 9 : 17, tickX = Math.max(8, edge);
      add('latitude', lat, x, y, outside ? 'end' : 'start', [[tickX - 3, y], [tickX + 3, y]]);
    }
    const marks = coordinateGroup.selectAll('g').data(items, d => `${d.axis}-${d.value}`).join(enter => {
      const group = enter.append('g');
      group.append('path').attr('class', 'coordinate-tick');
      group.append('text').attr('class', 'coordinate-label');
      return group;
    });
    marks.select('text').attr('x', d => d.x).attr('y', d => d.y).attr('text-anchor', d => d.anchor)
      .attr('data-axis', d => d.axis).attr('data-value', d => d.value).text(d => d.text);
    marks.select('path').attr('d', d => `M${d.tick[0].join(',')}L${d.tick[1].join(',')}`);
  }
  function updateCoordinates() {
    const readout = document.getElementById('coordinate-readout');
    if (!layers.coordinates) return;
    let location;
    if (cursor) {
      const point = mapPoint(cursor.x, cursor.y);
      if (document.getElementById('ocean').isPointInFill(point)) location = projection.invert([point.x, point.y]);
    }
    if (!location || !location.every(Number.isFinite)) {
      readout.textContent = t('coordinates.idle'); readout.dir = i18n.metadata(i18n.ui).dir;
      delete readout.dataset.longitude; delete readout.dataset.latitude;
    } else {
      const lon = wrap(location[0]), lat = location[1];
      readout.dir = 'ltr';
      readout.textContent = `${formatDegrees(lon, 'longitude', 2)} · ${formatDegrees(lat, 'latitude', 2)}`;
      readout.dataset.longitude = lon; readout.dataset.latitude = lat;
    }
  }
  function layoutLabels() {
    const scale = viewport.clientWidth / view.w;
    const overview = zoomLevel() < 1.5;
    const candidates = [];
    function place(element, point, metrics, priority) {
      if (Math.abs(point[1]) > projectionDefinition().latitudeLimit) { element.style.display = 'none'; return; }
      const [x, y] = projection(point);
      element.setAttribute('x', x); element.setAttribute('y', y);
      const screenX = (x - view.x) * scale, screenY = (y - view.y) * scale;
      candidates.push({ element, priority, left: screenX + metrics.x - 3, right: screenX + metrics.x + metrics.width + 3,
        top: screenY + metrics.y - 3, bottom: screenY + metrics.y + metrics.height + 3 });
    }
    labels.each(function(f) {
      const selected = state.selected === f.id;
      // The curated subset is only for the overview. Zoomed regions must all enter
      // collision layout; otherwise omitted names can never appear without a click.
      if (!layers.countryLabels || (overview && !f.properties.label && !selected)) { this.style.display = 'none'; return; }
      place(this, f.properties.point, measureLabel(this.textContent, false, selected),
        selected ? -1 : f.properties.labelRank || 6);
    });
    if (layers.oceanLabels) oceans.each(function(d) { place(this, d.point, measureLabel(this.textContent, true, false), 0); });
    // Fixed-size text needs screen-space spacing. Selection wins, then upstream label rank.
    const obstacles = [...coordinateBoxes, ...overlayBoxes()], occupied = [];
    for (const box of candidates.sort((a, b) => a.priority - b.priority)) {
      const onScreen = box.right > 0 && box.left < viewport.clientWidth && box.bottom > 0 && box.top < viewport.clientHeight;
      const crowded = occupied.some(other => overlaps(box, other));
      const visible = !onScreen || (!obstacles.some(other => overlaps(box, other)) && (box.priority < 0 || !crowded));
      box.element.style.display = visible ? '' : 'none';
      if (visible && onScreen) occupied.push(box);
    }
  }
  function draw(full = false) {
    projection.rotate([-state.central, 0, 0]);
    const data = full ? detail : motion;
    const elements = countries.nodes();
    for (let i = 0; i < elements.length; i++) elements[i].setAttribute('d', path(data.countries[i]) || '');
    document.getElementById('lakes').setAttribute('d', path(data.lakes) || '');
    // These short, sparse lines keep full detail while rotating and share D3's seam clipping.
    maritimeIndicators.attr('d', path);
    maritimeChina.attr('d', path);
    drawGraticule();
    layoutLabels();
    updateCoordinates();
    const central = wrap(state.central);
    updateLongitude();
    svg.dataset.centralLongitude = central;
    svg.dataset.detail = full ? 'full' : 'motion';
  }
  function queueDraw() {
    if (!pendingDraw) pendingDraw = requestAnimationFrame(() => { pendingDraw = 0; draw(); });
  }
  function stopMotion() {
    cancelAnimationFrame(animation); animation = 0;
    cancelAnimationFrame(pendingDraw); pendingDraw = 0;
  }
  function changeProjection(id) {
    if (!Object.hasOwn(BesMapProjections.definitions, id) || id === state.projection) return;
    stopMotion();
    const captures = [...pointers.keys()];
    pointers.clear(); drag = null; pinch = null; viewport.classList.remove('dragging');
    for (const pointerId of captures) if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    const center = new DOMPoint(view.x + view.w / 2, view.y + view.h / 2);
    let anchor = document.getElementById('ocean').isPointInFill(center) ? projection.invert([center.x, center.y]) : null;
    if (!anchor || !anchor.every(Number.isFinite)) {
      anchor = detail.countries.find(feature => feature.id === state.selected)?.properties.point || [wrap(state.central), 0];
    }
    const zoom = zoomLevel();
    state.projection = id;
    projection = BesMapProjections.create(id); configureProjection();
    fitSize = fitDimensions(); view.w = fitSize.w / zoom; view.h = fitSize.h / zoom;
    // Preserve geographic focus, not old projected x/y. Mercator cannot include the poles.
    const latitudeLimit = projectionDefinition().latitudeLimit - 1e-6;
    const point = projection([anchor[0], clamp(anchor[1], -latitudeLimit, latitudeLimit)]);
    view.x = point[0] - view.w / 2; view.y = point[1] - view.h / 2;
    try { localStorage.setItem(projectionStorageKey, id); preferencesSaved = true; }
    catch { preferencesSaved = false; }
    document.getElementById('preference-status').textContent = t(preferencesSaved ? 'preferences.saved' : 'preferences.temporary');
    renderView(); draw(true);
  }
  projectionSelect.addEventListener('change', event => changeProjection(event.target.value));
  function selectCountry(feature) {
    stopMotion();
    state.selected = feature.id;
    countries.classed('selected', d => d.id === feature.id);
    labels.classed('selected', d => d.id === feature.id);
    status.hidden = false; status.textContent = nameOf(feature);
    const from = state.central;
    const delta = wrap(feature.properties.point[0] - from);
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
    const started = performance.now();
    function frame(now) {
      const t = duration ? clamp((now - started) / duration, 0, 1) : 1;
      state.central = from + delta * (t * t * (3 - 2 * t));
      draw(t === 1);
      animation = t < 1 ? requestAnimationFrame(frame) : 0;
    }
    animation = requestAnimationFrame(frame);
  }
  function selectFromClick(event, feature) {
    if (!suppressClick && event.detail < 2) selectCountry(feature);
  }
  countries.on('click', selectFromClick);
  labels.on('click', selectFromClick);

  function mapPoint(clientX, clientY) {
    return new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
  }
  function zoomAt(clientX, clientY, factor) {
    const rect = svg.getBoundingClientRect();
    const fx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const fy = clamp((clientY - rect.top) / rect.height, 0, 1);
    const x = view.x + fx * view.w, y = view.y + fy * view.h;
    const next = clamp(zoomLevel() * factor, .5, 64);
    view.w = fitSize.w / next; view.h = fitSize.h / next;
    view.x = x - fx * view.w; view.y = y - fy * view.h;
    renderView();
  }
  function zoomCenter(factor) { zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor); }
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * unit * .0015));
  }, { passive: false });
  viewport.addEventListener('dblclick', event => {
    event.preventDefault(); stopMotion(); draw(true);
    zoomAt(event.clientX, event.clientY, event.shiftKey ? .5 : 2);
  });
  function startDrag(event) {
    const point = mapPoint(event.clientX, event.clientY);
    const location = projection.invert([point.x, point.y]);
    const latitude = clamp(location?.[1] || 0, -80, 80);
    const a = projection([state.central, latitude]);
    const b = projection([state.central + 1, latitude]);
    drag = { x: event.clientX, y: event.clientY, mapX: point.x, central: state.central,
             perDegree: Math.abs(b[0] - a[0]) || 4, pan: event.shiftKey,
             viewX: view.x, viewY: view.y, moved: false };
  }
  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stopMotion();
    cursor = { x: event.clientX, y: event.clientY }; updateCoordinates();
    if (!pointers.size) suppressClick = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) startDrag(event);
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), midpoint: [(a.x + b.x) / 2, (a.y + b.y) / 2] };
      suppressClick = true;
    }
  });
  viewport.addEventListener('pointermove', event => {
    cursor = { x: event.clientX, y: event.clientY }; updateCoordinates();
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, distance / Math.max(1, pinch.distance));
      pinch.distance = distance;
      return;
    }
    if (!drag || pointers.size !== 1) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { viewport.setPointerCapture(event.pointerId); drag.moved = true; }
    suppressClick = true; viewport.classList.add('dragging');
    if (drag.pan) {
      view.x = drag.viewX - dx * view.w / viewport.clientWidth;
      view.y = drag.viewY - dy * view.h / viewport.clientHeight;
      renderView();
    } else {
      const point = mapPoint(event.clientX, event.clientY);
      state.central = drag.central - (point.x - drag.mapX) / drag.perDegree;
      queueDraw();
    }
  });
  function release(event) {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size === 0) {
      stopMotion(); draw(true); drag = null; pinch = null;
      viewport.classList.remove('dragging');
      setTimeout(() => { suppressClick = false; }, 0);
    } else if (pointers.size === 1) {
      const [point] = [...pointers.values()];
      startDrag({ clientX: point.x, clientY: point.y, shiftKey: false });
      pinch = null;
    }
  }
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);
  viewport.addEventListener('lostpointercapture', release);
  viewport.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse' && !pointers.size) { cursor = null; updateCoordinates(); }
  });
  function reset() {
    stopMotion(); state.central = 0; state.selected = null;
    countries.classed('selected', false); labels.classed('selected', false);
    status.hidden = true; fitView(); draw(true);
  }
  document.getElementById('zoom-in').addEventListener('click', () => zoomCenter(1.6));
  document.getElementById('zoom-out').addEventListener('click', () => zoomCenter(1 / 1.6));
  document.getElementById('reset').addEventListener('click', reset);
  const layerPanel = document.getElementById('layers-panel');
  const layerToggle = document.getElementById('layers-toggle');
  function setPanel(open, restoreFocus = false) {
    if (open) setLanguagePanel(false);
    layerPanel.hidden = !open; layerToggle.setAttribute('aria-expanded', open);
    if (restoreFocus) layerToggle.focus();
    drawGraticule(); layoutLabels();
  }
  function applyLayers(save = false) {
    const targets = { countryLabels: 'country-labels', oceanLabels: 'ocean-labels', grid: 'grid',
      coordinates: 'coordinate-labels', maritime: 'maritime-indicators', maritimeChina: 'maritime-china' };
    for (const [key, id] of Object.entries(targets)) {
      document.getElementById(id).style.display = layers[key] ? '' : 'none';
      layerPanel.querySelector(`[data-layer="${key}"]`).checked = layers[key];
    }
    document.getElementById('coordinate-readout').hidden = !layers.coordinates;
    if (save) {
      try { localStorage.setItem(layerStorageKey, JSON.stringify(layers)); preferencesSaved = true; }
      catch { preferencesSaved = false; }
    }
    document.getElementById('preference-status').textContent = t(preferencesSaved ? 'preferences.saved' : 'preferences.temporary');
    drawGraticule(); layoutLabels(); updateCoordinates();
  }
  layerToggle.addEventListener('click', () => setPanel(layerPanel.hidden));
  document.getElementById('layers-close').addEventListener('click', () => setPanel(false, true));
  layerPanel.addEventListener('change', event => {
    const key = event.target.dataset.layer;
    if (Object.hasOwn(layers, key)) { layers[key] = event.target.checked; applyLayers(true); }
  });
  document.getElementById('layers-defaults').addEventListener('click', () => {
    Object.assign(layers, layerDefaults); applyLayers(true);
  });
  document.addEventListener('pointerdown', event => {
    if (!layerPanel.hidden && !layerPanel.contains(event.target) && !layerToggle.contains(event.target)) setPanel(false);
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !layerPanel.hidden) { setPanel(false, true); return; }
    if (event.key === 'Escape' && !languagePanel.hidden) { setLanguagePanel(false, true); return; }
    if (event.target.closest('#layers-panel, #language-panel, input, select, textarea, [contenteditable]')) return;
    if (event.key === '+' || event.key === '=') zoomCenter(1.6);
    else if (event.key === '-' || event.key === '_') zoomCenter(1 / 1.6);
    else if (event.key === '0') reset();
  });
  window.addEventListener('resize', () => {
    const zoom = zoomLevel(), x = view.x + view.w / 2, y = view.y + view.h / 2;
    fitSize = fitDimensions(); view.w = fitSize.w / zoom; view.h = fitSize.h / zoom;
    view.x = x - view.w / 2; view.y = y - view.h / 2; renderView();
  });
  applyLanguage();
  fitView(); applyLayers(); draw(true);
  document.fonts.ready.then(() => { measurementCache.clear(); layoutLabels(); });
  document.fonts.addEventListener('loadingdone', () => { measurementCache.clear(); layoutLabels(); });
})();
