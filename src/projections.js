const BesMapProjections = (() => {
  'use strict';
  // Keep projection choices separate from geographic data and display-name overrides.
  const definitions = {
    robinson: {
      label: 'Robinson · 罗宾逊', name: '罗宾逊投影', latitudeLimit: 90,
      description: '形状与面积折中，适合世界概览。',
      factory: () => d3.geoRobinson()
    },
    equalEarth: {
      label: 'Equal Earth · 等地球', name: '等地球投影', latitudeLimit: 90,
      description: '保持面积比例，便于比较地区大小。',
      factory: () => d3.geoEqualEarth()
    },
    mercator: {
      label: 'Mercator · 墨卡托', name: '墨卡托投影', latitudeLimit: Math.atan(Math.sinh(Math.PI)) * 180 / Math.PI,
      description: '保持局部角度，高纬面积放大；显示至南北纬约 85°。',
      factory: () => d3.geoMercator()
    }
  };
  function create(id) {
    // Mercator keeps D3's square clip (about ±85.051°); fitting the poles is unbounded.
    return definitions[id].factory().precision(.35).fitExtent([[64, 98], [1664, 854]], { type: 'Sphere' });
  }
  return { definitions, create };
})();
