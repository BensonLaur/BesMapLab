(() => {
  'use strict';
  const svg = document.getElementById('map');
  const viewport = document.getElementById('viewport');
  const meter = document.getElementById('zoom');
  const status = document.getElementById('selection');
  const longitude = document.getElementById('longitude');
  const base = { w: 1728, h: 972 };
  const view = { x: 0, y: 0, w: base.w, h: base.h };
  const state = { central: 0, selected: null };
  const palette = ['#dfe4de', '#d0dfd7', '#ead9bb', '#d8d5e7', '#cadde8', '#ecd4cf', '#e2e4c8', '#c6dfd4'];
  let fitSize, animation = 0, pendingDraw = 0, drag = null, suppressClick = false;
  const pointers = new Map();
  let pinch = null;

  function decode(id) {
    const topology = JSON.parse(document.getElementById(id).textContent);
    return { countries: topojson.feature(topology, topology.objects.countries).features,
             lakes: topojson.feature(topology, topology.objects.lakes) };
  }
  const detail = decode('detail-data');
  const motion = decode('motion-data');
  const projection = d3.geoRobinson().precision(.35).fitExtent([[64, 98], [1664, 854]], { type: 'Sphere' });
  const path = d3.geoPath(projection).digits(3);
  const outlinePath = path({ type: 'Sphere' });
  // Keep the world outline and projection scale fixed while only longitude rotates.
  for (const id of ['ocean', 'outline', 'clip-outline']) document.getElementById(id).setAttribute('d', outlinePath);
  const graticule = d3.geoGraticule().step([30, 30])();
  const countries = d3.select('#countries').selectAll('path').data(detail.countries).join('path')
    .attr('class', 'country').attr('data-code', f => f.properties.code)
    .attr('data-id', f => f.id).attr('data-name', f => f.properties.name)
    .attr('fill', f => f.properties.antarctica ? '#e3e9e9' : palette[f.properties.color] || palette[0]);
  countries.append('title').text(f => f.properties.name);
  const labels = d3.select('#country-labels').selectAll('text').data(detail.countries).join('text')
    .attr('class', 'country-label').attr('data-code', f => f.properties.code).attr('data-id', f => f.id)
    .text(f => f.properties.name);
  const oceans = d3.select('#ocean-labels').selectAll('text').data([
    { name: '太平洋', point: [-150, 0] }, { name: '大西洋', point: [-33, 1] },
    { name: '印度洋', point: [76, -29] }, { name: '北冰洋', point: [0, 78] },
    { name: '南大洋', point: [0, -63] }
  ]).join('text').attr('class', 'ocean-label').text(d => d.name);

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
  function fitDimensions() {
    const ratio = Math.max(1, viewport.clientWidth) / Math.max(1, viewport.clientHeight);
    const w = Math.max(base.w, base.h * ratio);
    return { w, h: w / ratio };
  }
  function zoomLevel() { return fitSize.w / view.w; }
  function renderView() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    meter.textContent = `${Math.round(zoomLevel() * 100)}%`;
  }
  function fitView() {
    fitSize = fitDimensions();
    view.w = fitSize.w; view.h = fitSize.h;
    view.x = (base.w - view.w) / 2; view.y = (base.h - view.h) / 2;
    renderView();
  }
  function draw(full = false) {
    projection.rotate([-state.central, 0, 0]);
    const data = full ? detail : motion;
    const elements = countries.nodes();
    for (let i = 0; i < elements.length; i++) elements[i].setAttribute('d', path(data.countries[i]) || '');
    document.getElementById('lakes').setAttribute('d', path(data.lakes) || '');
    document.getElementById('grid').setAttribute('d', path(graticule));
    labels.each(function(f) {
      const visible = f.properties.label || state.selected === f.id;
      this.style.display = visible ? '' : 'none';
      if (!visible) return;
      const [x, y] = projection(f.properties.point);
      this.setAttribute('x', x); this.setAttribute('y', y);
    });
    oceans.each(function(d) {
      const [x, y] = projection(d.point);
      this.setAttribute('x', x); this.setAttribute('y', y);
    });
    const central = wrap(state.central);
    longitude.textContent = `中央经线 ${Math.abs(central).toFixed(1)}°${central > .05 ? 'E' : central < -.05 ? 'W' : ''}`;
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
  function selectCountry(feature) {
    stopMotion();
    state.selected = feature.id;
    countries.classed('selected', d => d.id === feature.id);
    labels.classed('selected', d => d.id === feature.id);
    status.hidden = false; status.textContent = feature.properties.name;
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
  function reset() {
    stopMotion(); state.central = 0; state.selected = null;
    countries.classed('selected', false); labels.classed('selected', false);
    status.hidden = true; fitView(); draw(true);
  }
  document.getElementById('zoom-in').addEventListener('click', () => zoomCenter(1.6));
  document.getElementById('zoom-out').addEventListener('click', () => zoomCenter(1 / 1.6));
  document.getElementById('reset').addEventListener('click', reset);
  window.addEventListener('keydown', event => {
    if (event.key === '+' || event.key === '=') zoomCenter(1.6);
    else if (event.key === '-' || event.key === '_') zoomCenter(1 / 1.6);
    else if (event.key === '0') reset();
  });
  window.addEventListener('resize', () => {
    const zoom = zoomLevel(), x = view.x + view.w / 2, y = view.y + view.h / 2;
    fitSize = fitDimensions(); view.w = fitSize.w / zoom; view.h = fitSize.h / zoom;
    view.x = x - view.w / 2; view.y = y - view.h / 2; renderView();
  });
  fitView(); draw(true);
})();
