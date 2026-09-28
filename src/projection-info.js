const BesMapProjectionInfo = (() => {
  'use strict';
  const panel = document.getElementById('projection-info');
  const toggle = document.getElementById('projection-info-toggle');
  const close = document.getElementById('projection-info-close');
  const reader = document.getElementById('projection-info-body');
  const grid = document.getElementById('projection-info-grid');
  const sources = {
    robinson: 'https://doc.esri.com/en/arcgis-pro/latest/help/mapping/properties/robinson.html',
    equalEarth: 'https://doc.esri.com/en/arcgis-pro/latest/help/mapping/properties/equal-earth.html',
    mercator: 'https://doc.esri.com/en/arcgis-pro/latest/help/mapping/properties/mercator.html'
  };
  let current, resizeMap;
  function setOpen(open, restoreFocus = false) {
    panel.hidden = !open;
    document.body.classList.toggle('intro-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    resizeMap();
    if (open) close.focus({ preventScroll: true });
    else if (restoreFocus) toggle.focus({ preventScroll: true });
  }
  function update(id) {
    const changed = current !== id;
    current = id;
    panel.dataset.projection = id;
    document.getElementById('projection-info-title').textContent = BesMapI18n.text(`projection.${id}.name`);
    for (const field of ['lead', 'geometry', 'tradeoff', 'use', 'observe']) {
      document.getElementById(`projection-info-${field}`).textContent = BesMapI18n.text(`intro.${id}.${field}`);
    }
    document.getElementById('projection-info-reference').href = sources[id];
    document.getElementById('projection-info-history').hidden = id !== 'robinson';
    // A separate, unrotated projection illustrates the construction without moving the map.
    const projection = BesMapProjections.definitions[id].factory().precision(.15)
      .fitExtent([[8, 8], [292, 158]], { type: 'Sphere' });
    const path = d3.geoPath(projection);
    document.getElementById('intro-outline').setAttribute('d', path({ type: 'Sphere' }));
    document.getElementById('intro-grid').setAttribute('d', path(d3.geoGraticule().step([30, 30])()));
    document.getElementById('intro-equator').setAttribute('d', path({ type: 'LineString',
      coordinates: d3.range(-180, 181, 2).map(lon => [lon, 0]) }));
    if (changed) reader.scrollTop = 0;
  }
  function init({ projection, onResize, onGridChange }) {
    resizeMap = onResize;
    const heading = document.querySelector('.heading');
    // Translated projection summaries can wrap to different heights above the reader.
    new ResizeObserver(() => document.body.style.setProperty('--intro-heading-bottom',
      `${heading.getBoundingClientRect().bottom + 12}px`)).observe(heading);
    toggle.addEventListener('click', () => setOpen(panel.hidden));
    close.addEventListener('click', () => setOpen(false, true));
    grid.addEventListener('change', () => onGridChange(grid.checked));
    BesMapI18n.subscribe(() => update(current));
    update(projection);
  }
  return { init, update, setOpen, get open() { return !panel.hidden; },
    setGrid: checked => { grid.checked = checked; } };
})();
