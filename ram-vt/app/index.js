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

// Promisify functions.
const emptyDir = Promise.promisify(fs.emptyDir);

const geojsonName = `p${projId}s${scId}-${vtType}.geojson`;
const tilesFolderName = `p${projId}s${scId}-${vtType}-tiles`;
const geojsonFilePath = path.resolve(WORK_DIR, geojsonName);
const tilesFolderPath = path.resolve(WORK_DIR, tilesFolderName);

async function main () {
  try {
    try {
      await fs.mkdir(WORK_DIR);
    } catch (e) {
      if (e.code !== 'EEXIST') {
        throw e;
      }
    }
    // Clean up phase.
    await stepCleanUp();
    // From storage to geoJSON.
    await stepToGeoJSON(sourceFile, geojsonFilePath);
    // From the geoJSON to vector tiles.
    await stepVectorTiles(geojsonFilePath, tilesFolderPath, vtType);
    // Upload result.
    await stepUploadStorage(tilesFolderPath, vtType);
  } catch (error) {
    console.log('error', error);
    process.exit(1);
  }
}

// GO
main();

// Remove files from s3 and local if they exist.
async function stepCleanUp () {
  logger.log('Clean files...');
  await Promise.all([
    emptyDir(WORK_DIR),
    // Clean S3 directory.
    removeS3Dir(`scenario-${scId}/tiles/${vtType}`)
  ]);
  logger.log('Clean files... done');
}

async function stepToGeoJSON (source, destGeoJSON) {
  switch (vtType) {
    case 'road-network':
      logger.log('Downloading/Converting rn to geoJSON...');
      const osmName = `p${projId}s${scId}-${vtType}.osm`;
      const osmFilePath = path.resolve(WORK_DIR, osmName);
      // Download osm file.
      await fGetFile(source, osmFilePath);
      await osmToGeoJSON(osmFilePath, destGeoJSON);
      logger.log('Downloading/Converting rn to geoJSON... done');
      break;
    case 'admin-bounds':
      logger.log('Downloading admin-bounds...');
      // The data is already in geoJSON format.
      // Download from S3.
      await fGetFile(source, destGeoJSON);
      logger.log('Downloading admin-bounds... done');
      break;
  }
}

async function stepVectorTiles (sourceGeoJSON, destTiles, vtType) {
  await generateVT(sourceGeoJSON, destTiles, vtType);
}

async function stepUploadStorage (sourceTiles, vtType) {
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

  await putS3Dir(sourceTiles, dest);
  logger.log('Uploading tiles to s3... done');
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
    exec(`${config.tippecanoe} -l ${layerName} -e ${distDir} -zg --drop-densest-as-needed ${sourceGeoJSON}`, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr));
      logger.group('generateVT').log('Completed in', (Date.now() - time) / 1000, 'seconds');
      return resolve(stdout);
    });
  });
}
