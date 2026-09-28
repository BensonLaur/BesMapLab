const BesMapProjections = (() => {
  'use strict';
  // Keep projection choices separate from geographic data and display-name overrides.
  const definitions = {
    robinson: {
      latitudeLimit: 90,
      factory: () => d3.geoRobinson()
    },
    equalEarth: {
      latitudeLimit: 90,
      factory: () => d3.geoEqualEarth()
    },
    mercator: {
      latitudeLimit: Math.atan(Math.sinh(Math.PI)) * 180 / Math.PI,
      factory: () => d3.geoMercator()
    }
  };
  function create(id) {
    // Mercator keeps D3's square clip (about ±85.051°); fitting the poles is unbounded.
    return definitions[id].factory().precision(.35).fitExtent([[64, 98], [1664, 854]], { type: 'Sphere' });
  }
  return { definitions, create };
})();
