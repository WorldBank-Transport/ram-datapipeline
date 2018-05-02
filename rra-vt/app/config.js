'use strict';

var config = {
  debug: true,
  osmtogeojson: '/usr/local/bin/osmtogeojson',
  tippecanoe: '/usr/local/bin/tippecanoe'
};

let local = {};
try {
  local = require('../local');
} catch (e) {}

Object.keys(config).forEach(k => {
  if (local[k]) config[k] = local[k];
});

export default config;
