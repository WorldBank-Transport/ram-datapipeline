// only ES5 is allowed in this file
require('@babel/register')();

// Perform check of env variables.
const globalVars = [
  'DB_URI',
  'PROJECT_ID',
  'SCENARIO_ID',
  'STORAGE_HOST',
  'STORAGE_PORT',
  'STORAGE_ENGINE',
  'STORAGE_BUCKET',
  'STORAGE_REGION'
].filter(v => !process.env[v]);

if (globalVars.length) {
  throw new Error(`Missing env vars on ram-analysis: ${globalVars.join(', ')}`);
}

if (process.env['STORAGE_ENGINE'] === 'minio') {
  let missing = [
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY'
  ].filter(v => !process.env[v]);

  if (missing.length) {
    throw new Error(`Missing env vars on ram-analysis: ${missing.join(', ')}`);
  }
}

// ^ END CHECKS

// load the server
require('./app/index.js');
