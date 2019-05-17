'use strict';
import path from 'path';
import { exec, fork } from 'child_process';
import fs from 'fs';
import async from 'async';
import json2csv from 'json2csv';

import config from './config';
import { writeFile, getJSONFileContents, putFile } from './s3/utils';
import db from './db';
import Operation from './utils/operation';
import AppLogger from './utils/app-logger';
import * as opCodes from './utils/operation-codes';

const { PROJECT_ID: projId, SCENARIO_ID: scId, CONVERSION_DIR: conversionDir } = process.env;
const operationId = parseInt(process.env.OPERATION_ID);
const WORK_DIR = path.resolve(conversionDir, `p${projId}s${scId}`);

const DEBUG = config.debug;
const logger = AppLogger({ output: DEBUG });
const operation = new Operation(db);

// Needs to be global, so it can be decreased.
var totalAdminAreasToProcess = 0;

try {
  fs.mkdirSync(WORK_DIR);
} catch (e) {
  if (e.code !== 'EEXIST') {
    throw e;
  }
}

logger.log('Max running processes set at', config.cpus);

async function main () {
  try {
    // Allow loading an operation through a given id.
    // This is useful when the app starts an operation that this worker has to use.
    // It's good to show the user feedback because there's some delay between the
    // time the worker is triggered to the moment it actually starts.
    //
    // If the id is given load the operation and handle it from there,
    // otherwise create a new one.
    if (isNaN(operationId)) {
      await operation.start('generate-analysis', projId, scId);
    } else {
      await operation.loadById(operationId);
    }

    const files = await fetchFilesInfo(projId, scId);
    // Write files used by osm2osrm to disk.
    await Promise.all([
      writeFile(files.profile.path, `${WORK_DIR}/profile.lua`),
      writeFile(files['road-network'].path, `${WORK_DIR}/road-network.osm`)
    ]);

    await operation.log(opCodes.OP_OSRM, {message: 'osm2osrm processing started'});
    // Create orsm files and cleanup.
    await osm2osrm(WORK_DIR);
    await osm2osrmCleanup(WORK_DIR);
    await operation.log(opCodes.OP_OSRM, {message: 'osm2osrm processing finished'});

    // Fetch the remaining needed data.
    const [origins, pois, adminAreasFC] = await Promise.all([
      fetchOrigins(projId),
      fetchPoi(projId, scId),
      fetchAdminAreas(projId, scId)
    ]);
    logger.log('Data fetched');

    totalAdminAreasToProcess = adminAreasFC.features.length;

    const timeMatrixTasks = adminAreasFC.features.map(area => {
      const data = {
        adminArea: area,
        origins: origins,
        pois,
        maxSpeed: 120,
        maxTime: 3600 / 2
      };
      return createTimeMatrixTask(data, `${WORK_DIR}/road-network.osrm`);
    });
    logger.log('Tasks created');

    // createTimeMatrixTask need to be executed in parallel with a limit because
    // they spawn new processes. Use async but Promisify to continue chain.
    await operation.log(opCodes.OP_ROUTING, {message: 'Routing started', count: timeMatrixTasks.length});
    const adminAreasData = await new Promise((resolve, reject) => {
      let time = Date.now();
      async.parallelLimit(timeMatrixTasks, config.cpus, (err, adminAreasData) => {
        if (err) return reject(err);
        logger.log('Processed', timeMatrixTasks.length, 'admin areas in', (Date.now() - time) / 1000, 'seconds');
        return resolve(adminAreasData);
      });
    });
    await operation.log(opCodes.OP_ROUTING, {message: 'Routing complete'});

    // DB storage.
    let results = [];
    let resultsPois = [];
    adminAreasData.forEach(aa => {
      aa.json.forEach(o => {
        results.push({
          scenario_id: scId,
          project_id: projId,
          origin_id: o.id,
          project_aa_id: aa.adminArea.id
        });

        let pois = Object.keys(o.poi).map(k => ({
          type: k,
          time: o.poi[k] === null ? null : Math.round(o.poi[k])
        }));
        // Will be flattened later.
        // The array is constructed in this way so we can match the index of the
        // results array and attribute the correct id.
        resultsPois.push(pois);
      });
    });

    await db.transaction(async function (trx) {
      const ids = await trx.batchInsert('results', results)
        .returning('id');

      // Add ids to the resultsPoi and flatten the array in the process.
      let flat = [];
      resultsPois.forEach((resPoi, rexIdx) => {
        resPoi.forEach(poi => {
          poi.result_id = ids[rexIdx];
          flat.push(poi);
        });
      });
      await trx.batchInsert('results_poi', flat);
    });

    // S3 storage.
    logger.group('s3').log('Storing files');

    await operation.log(opCodes.OP_RESULTS, {message: 'Storing results'});
    await Promise.all([
      // Generate a csv with all the results.
      saveScenarioFile('results-csv', 'all-csv', generateCSV(adminAreasData), projId, scId),
      // Generate a JSON file with all results.
      saveScenarioFile('results-json', 'all-json', generateJSON(adminAreasData), projId, scId),
      // For all admin areas combined, results are stored in GeoJSON format.
      saveScenarioFile('results-geojson', 'all-geojson', generateGeoJSON(adminAreasData), projId, scId)
    ]);
    await operation.log(opCodes.OP_RESULTS, {message: 'Storing results complete'});
    logger.group('s3').log('Storing files complete');

    // Update generation time.
    await db('scenarios_settings')
      .update({value: new Date()})
      .where('scenario_id', scId)
      .where('key', 'res_gen_at');

    await operation.log(opCodes.OP_RESULTS_FILES, {message: 'Files written'});
    await operation.log(opCodes.OP_SUCCESS, {message: 'Operation complete'});
    await operation.finish();

    logger.toFile(`${WORK_DIR}/process.log`);
    process.exit(0);

  // Error handling.
  } catch (err) {
    const eGroup = logger.group('fatal-error');
    if (err.message) {
      eGroup.log(err.message);
      eGroup.log(err.stack);
      eGroup.log(err.details || 'No additional details');
    } else {
      eGroup.log(err);
    }
    logger.toFile(`${WORK_DIR}/process.log`);

    try {
      await operation.log(opCodes.OP_ERROR, {error: err.message || err});
      await operation.finish();
      process.exit(1);
    } catch (error) {
      // If it errors again exit.
      // This is especially important in the case of DB errors.
      eGroup.log('Error saving error');
      process.exit(1);
    }
  }
}

// Start!
main();

//
// Execution code ends here. From here on there are the helper functions
// used in the script.
// -------------------------------------
// This is just a little separation.
//

async function fetchFilesInfo (projId, scId) {
  const [profile, rn] = await Promise.all([
    db('projects_files')
      .select('*')
      .whereIn('type', ['profile'])
      .where('project_id', projId)
      .first(),
    db('scenarios_files')
      .select('*')
      .whereIn('type', ['road-network'])
      .where('project_id', projId)
      .where('scenario_id', scId)
      .first()
  ]);

  return {
    'profile': profile,
    'road-network': rn
  };
}

async function fetchOrigins (projId) {
  const origins = await db('projects_origins')
    .select(
      'projects_origins.id',
      'projects_origins.name',
      'projects_origins.coordinates',
      'projects_origins_indicators.key',
      'projects_origins_indicators.value'
    )
    .innerJoin('projects_origins_indicators', 'projects_origins.id', 'projects_origins_indicators.origin_id')
    .where('project_id', projId);

  // Group by indicators.
  let indGroup = {};
  origins.forEach(o => {
    let hold = indGroup[o.id];
    if (!hold) {
      hold = {
        id: o.id,
        name: o.name,
        coordinates: o.coordinates
      };
    }
    hold[o.key] = o.value;
    indGroup[o.id] = hold;
  });

  return {
    type: 'FeatureCollection',
    features: Object.keys(indGroup).map(k => {
      let props = Object.assign({}, indGroup[k]);
      delete props.coordinates;
      return {
        type: 'Feature',
        properties: props,
        geometry: {
          type: 'Point',
          coordinates: indGroup[k].coordinates
        }
      };
    })
  };

  // Convert origins to featureCollection.
  // TODO: Use this once the results are returned from the db.
  // return {
  //   type: 'FeatureCollection',
  //   features: origins.map(o => ({
  //     type: 'Feature',
  //     properties: {
  //       id: o.id,
  //       name: o.name
  //     },
  //     geometry: {
  //       type: 'Point',
  //       coordinates: o.coordinates
  //     }
  //   }))
  // };
}

async function fetchPoi (projId, scId) {
  const files = await db('scenarios_files')
    .select('*')
    .where('type', 'poi')
    .where('project_id', projId)
    .where('scenario_id', scId);

  const fileData = await Promise.all(files.map(f => getJSONFileContents(f.path)));
  // Index pois by subtype.
  return files.reduce((acc, file, idx) => (
    {...acc, [file.subtype]: fileData[idx]}
  ), {});
}

const arrayDepth = (arr) => Array.isArray(arr) ? arrayDepth(arr[0]) + 1 : 0;
const getGeometryType = (geometry) => {
  switch (arrayDepth(geometry)) {
    case 3:
      return 'Polygon';
    case 4:
      return 'MultiPolygon';
    default:
      throw new Error('Malformed coordinates array. Expected Polygon or MultiPolygon.');
  }
};

async function fetchAdminAreas (projId, scId) {
  const aaSettings = await db('scenarios_settings')
    .select('value')
    .where('key', 'admin_areas')
    .where('scenario_id', scId)
    .first();

  const selectedAA = JSON.parse(aaSettings.value);
  // Get selected adminAreas.
  const aa = await db('projects_aa')
    .select('*')
    .where('project_id', projId)
    .whereIn('id', selectedAA);

  // Convert admin areas to featureCollection.
  return {
    type: 'FeatureCollection',
    features: aa.map(o => ({
      type: 'Feature',
      properties: {
        id: o.id,
        name: o.name,
        type: o.type,
        project_id: o.project_id
      },
      geometry: {
        type: getGeometryType(o.geometry),
        coordinates: o.geometry
      }
    }))
  };
}

/**
 * Runs the osm 2 osrm conversion.
 * Calls a bash script with all the instruction located at
 * ../scripts/osm2osrm.sh
 * @param  {string} dir Directory where the needed files are.
 *                      Expects a profile.lua and a road-network.osm
 * @return {Promise}
 */
function osm2osrm (dir) {
  return new Promise((resolve, reject) => {
    logger.group('OSRM').log('Generation started');
    let osm2osrmTime = Date.now();
    let bin = path.resolve(__dirname, '../scripts/osm2osrm.sh');
    exec(`bash ${bin} -d ${dir}`, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr));
      logger.group('OSRM').log('Completed in', (Date.now() - osm2osrmTime) / 1000, 'seconds');
      return resolve(stdout);
    });
  });
}

/**
 * Cleanup after the osm2osrm.
 * @param  {string} dir Directory where the files are.
 * @return {Promise}
 */
function osm2osrmCleanup (dir) {
  return new Promise((resolve, reject) => {
    let globs = [
      'road-network.osm',
      // 'road-network.osrm.*',
      'stxxl*',
      '.stxxl',
      'profile.lua',
      'lib'
    ].map(g => `${dir}/${g}`).join(' ');

    exec(`rm -f ${globs}`, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr));
      return resolve(stdout);
    });
  });
}

// Store all the created processes.
let runningProcesses = [];

function createTimeMatrixTask (data, osrmFile) {
  return (callback) => {
    const taskLogger = logger.group(data.adminArea.properties.name);
    const beginTime = Date.now();
    let processData = {
      id: 2,
      poi: data.pois,
      gridSize: 30,
      origins: data.origins,
      osrmFile: osrmFile,
      maxTime: data.maxTime,
      maxSpeed: data.maxSpeed,
      adminArea: data.adminArea
    };
    let remainingSquares = null;
    let processError = null;

    const cETA = fork(path.resolve(__dirname, 'calculateETA.js'));
    runningProcesses.push(cETA);

    cETA.send(processData);
    cETA.on('message', function (msg) {
      switch (msg.type) {
        case 'error':
          processError = msg;
          break;
        case 'debug':
          taskLogger.log('debug', msg.data);
          break;
        case 'status':
          taskLogger.log('status', msg.data);
          break;
        case 'squarecount':
          remainingSquares = msg.data;
          taskLogger.log('total squares', msg.data);
          break;
        case 'square':
          remainingSquares--;
          taskLogger.log('square processed', msg.data, 'Remaining', remainingSquares);
          // Emit status?
          break;
        case 'done':
          let calculationTime = (Date.now() - beginTime) / 1000;
          taskLogger.log('Total routing time', calculationTime);
          let result = msg.data;
          let json = null;

          if (!result.length) {
            // Result may be empty if in the work area there are no origins.
            taskLogger.log('No results returned');
            json = [];
          } else {
            taskLogger.log(`Results returned for ${result.length} origins`);
            json = result;
          }

          const finish = () => {
            cETA.disconnect();
            return callback(null, {
              adminArea: data.adminArea.properties,
              json
            });
          };

          // Error or not, we finish the process.
          operation.log(opCodes.OP_ROUTING_AREA, {
            message: 'Routing complete',
            adminArea: data.adminArea.properties.name,
            remaining: --totalAdminAreasToProcess
          })
          .then(() => finish(), () => finish());

          // break;
      }
    });

    cETA.on('exit', (code) => {
      if (code !== 0) {
        // Stop everything if one of the processes errors.
        runningProcesses.forEach(p => p.kill());
        let error;
        if (processError) {
          error = new Error(`calculateETA exited with error - ${processError.data}`);
          error.stack = processError.stack;
          error.details = processError.details;
        } else {
          error = new Error(`calculateETA exited with error - unknown`);
        }
        error.code = code;
        return callback(error);
      }
    });
  };
}

/**
 * Stores a scenario file to the storage engine and updates the database.
 * @param  {object} data   Object with data to store and admin area properties.
 * @param  {number} projId Project id.
 * @param  {number} scId   Scenario id.
 * @return {Promise}
 */
async function saveScenarioFile (type, name, data, projId, scId) {
  const fileName = `results_${name}_${Date.now()}`;
  const filePath = `scenario-${scId}/${fileName}`;
  const fileData = {
    name: fileName,
    type: type,
    path: filePath,
    project_id: projId,
    scenario_id: scId,
    created_at: new Date(),
    updated_at: new Date()
  };

  logger.group('s3').log('Saving file', filePath);
  const contents = typeof data === 'string' ? data : JSON.stringify(data);
  await putFile(filePath, contents);
  await db('scenarios_files')
    .returning('*')
    .insert(fileData);
  await db('projects')
    .update({ updated_at: new Date() })
    .where('id', projId);
}

/**
 * Generates a GeoJSON FeatureCollection from the results
 * @param   {object} data   Object with data to store
 * @return  {FeatureCollection}
 */
function generateGeoJSON (data) {
  // Flatten the results array
  const jsonResults = [].concat.apply([], data.map(o => o.json));
  return {
    type: 'FeatureCollection',
    features: jsonResults.map(r => {
      let ft = {
        type: 'Feature',
        properties: {
          id: r.id,
          name: r.name,
          pop: r.population
        },
        geometry: {
          type: 'Point',
          coordinates: [r.lon, r.lat]
        }
      };
      for (let poiType in r.poi) {
        ft.properties[`eta-${poiType}`] = r.poi[poiType];
      }
      return ft;
    })
  };
}

/**
 * Generates a JSON file from the results
 * @param   {object} data   Object with data to store
 * @return  {object}
 */
function generateJSON (data) {
  return data.map(o => {
    return {
      id: o.adminArea.id,
      name: o.adminArea.name,
      results: o.json
    };
  });
}

/**
 * Generates a CSV file from the results
 * @param   {object} data   Object with data to store
 * @return  {string}
 */
function generateCSV (data) {
  // Merge all the results together.
  const results = data.reduce((acc, o) => {
    if (o.json.length) {
      const items = o.json.map(item => {
        item['admin_area'] = o.adminArea.name;
        return item;
      });
      return acc.concat(items);
    }
    return acc;
  }, []);

  if (!results.length) {
    return 'The analysis didn\'t produce any results';
  }

  // Prepare the csv.
  // To form the fields array for json2csv convert from:
  // {
  //  prop1: 'prop1',
  //  prop2: 'prop2',
  //  poi: {
  //    poiName: 'poi-name'
  //  },
  //  prop3: 'prop3'
  // }
  // to
  // [prop1, prop2, prop3, poi.poiName]
  //
  // Poi fields as paths for nested objects.
  const poiFields = Object.keys(results[0].poi).map(o => `poi.${o}`);

  // Get other fields, exclude poi and include new poi.
  const fields = Object.keys(results[0])
    .filter(o => o !== 'poi')
    .concat(poiFields);

  return json2csv({ data: results, fields: fields });
}
