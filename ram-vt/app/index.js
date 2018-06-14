'use strict';
import path from 'path';
import fs from 'fs-extra';
import { exec } from 'child_process';
import Promise from 'bluebird';

import {
  fGetFile,
  removeDir as removeS3Dir,
  putDir as putS3Dir
} from './s3/utils';
import config from './config';
import AppLogger from './utils/app-logger';

const {
  PROJECT_ID: projId,
  SCENARIO_ID: scId,
  CONVERSION_DIR,
  VT_TYPE: vtType,
  SOURCE_FILE: sourceFile
} = process.env;
const WORK_DIR = path.resolve(CONVERSION_DIR, `p${projId}s${scId}`);

const DEBUG = config.debug;
const logger = AppLogger({ output: DEBUG });

try {
  fs.mkdirSync(WORK_DIR);
} catch (e) {
  if (e.code !== 'EEXIST') {
    throw e;
  }
}

// Promisify functions.
const emptyDir = Promise.promisify(fs.emptyDir);

const geojsonName = `p${projId}s${scId}-${vtType}.geojson`;
const tilesFolderName = `p${projId}s${scId}-${vtType}-tiles`;
const geojsonFilePath = path.resolve(WORK_DIR, geojsonName);
const tilesFolderPath = path.resolve(WORK_DIR, tilesFolderName);

  // Clean up phase.
stepCleanUp()
  // From storage to geoJSON.
  .then(() => stepToGeoJSON(sourceFile, geojsonFilePath))
  // From the geoJSON to vector tiles.
  .then(() => stepVectorTiles(geojsonFilePath, tilesFolderPath, vtType))
  // Upload result.
  .then(() => stepUploadStorage(tilesFolderPath, vtType));

// Remove files from s3 and local if they exist.
function stepCleanUp () {
  logger.log('Clean files...');
  return Promise.all([
    emptyDir(WORK_DIR),
    // Clean S3 directory
    removeS3Dir(`scenario-${scId}/tiles/${vtType}`)
  ])
  .then(() => logger.log('Clean files... done'));
}

function stepToGeoJSON (source, destGeoJSON) {
  const osmName = `p${projId}s${scId}-${vtType}.osm`;
  const osmFilePath = path.resolve(WORK_DIR, osmName);

  switch (vtType) {
    case 'road-network':
      logger.log('Downloading/Converting rn to geoJSON...');
      // Download osm file.
      return fGetFile(source, osmFilePath)
        .then(() => osmToGeoJSON(osmFilePath, destGeoJSON))
        .then(() => destGeoJSON)
        .then(() => logger.log('Downloading/Converting rn to geoJSON... done'));
    case 'admin-bounds':
      logger.log('Downloading admin-bounds...');
      // The data is already in geoJSON format.
      // Download from S3.
      return fGetFile(source, destGeoJSON)
      .then(() => destGeoJSON)
      .then(() => logger.log('Downloading admin-bounds... done'));
  }
}

function stepVectorTiles (sourceGeoJSON, destTiles, vtType) {
  return generateVT(sourceGeoJSON, destTiles, vtType)
    .then(() => destTiles);
}

function stepUploadStorage (sourceTiles, vtType) {
  logger.log('Uploading tiles to s3...');
  let dest;
  switch (vtType) {
    case 'road-network':
      dest = `scenario-${scId}/tiles/${vtType}`;
      break;
    case 'admin-bounds':
      dest = `project-${projId}/tiles/${vtType}`;
      break;
  }

  return putS3Dir(sourceTiles, dest)
    .then(() => logger.log('Uploading tiles to s3... done'));
}

/**
 * Runs osmtogeojson.
 * Calls osmtogeojson
 * @param  {sourceOSM} The path for the source file
 * @param  {distGeoJSON} The path for the dist file
 *
 * @return {Promise}
 */
function osmToGeoJSON (sourceOSM, distGeoJSON) {
  return new Promise((resolve, reject) => {
    logger.group('osmToGeoJSON').log('Generation started');
    let time = Date.now();
    exec(`node --max_old_space_size=8192 ${config.osmtogeojson} ${sourceOSM} > ${distGeoJSON}`, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr));
      logger.group('osmToGeoJSON').log('Completed in', (Date.now() - time) / 1000, 'seconds');
      return resolve(stdout);
    });
  });
}

/**
 * Generated the vector tiles.
 * Calls tippecanoe to generate the tiles.
 * @param  {string} dir Directory where the needed files are.
 *                      Expects a profile.lua and a road-network.osm
 * @return {Promise}
 */
function generateVT (sourceGeoJSON, distDir, layerName) {
  return new Promise((resolve, reject) => {
    logger.group('generateVT').log('Generation started');
    let time = Date.now();
    exec(`${config.tippecanoe} -l ${layerName} -e ${distDir} ${sourceGeoJSON}`, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr));
      logger.group('generateVT').log('Completed in', (Date.now() - time) / 1000, 'seconds');
      return resolve(stdout);
    });
  });
}
