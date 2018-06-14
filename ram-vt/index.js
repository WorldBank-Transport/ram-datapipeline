// only ES5 is allowed in this file
require('babel-register')({
  presets: [ 'es2015' ]
});

// Perform check of env variables.
var missing = [
  'PROJECT_ID',
  'SCENARIO_ID',
  'VT_TYPE',
  'SOURCE_FILE',
  'STORAGE_HOST',
  'STORAGE_PORT',
  'STORAGE_ENGINE',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'STORAGE_BUCKET',
  'STORAGE_REGION'
].filter(v => !process.env[v]);

if (missing.length) {
  throw new Error(`Missing env vars on ram-vt: ${missing.join(', ')}`);
}

if (['road-network', 'admin-bounds'].indexOf(process.env['VT_TYPE']) === -1) {
  throw new Error(`Invalid VT_TYPE. Expected: (road-network|admin-bounds)`);
}

// ^ END CHECKS

// load the server
require('./app/index.js');
