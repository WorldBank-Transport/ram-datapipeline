'use strict';
import path from 'path';
import { exec, fork } from 'child_process';
import fs from 'fs';
import async from 'async';
import json2csv from 'json2csv';
import kebabCase from 'lodash.kebabcase';

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

try {
  fs.mkdirSync(WORK_DIR);
} catch (e) {
  if (e.code !== 'EEXIST') {
    throw e;
  }
}

logger.log('Max running processes set at', config.cpus);

// Allow loading an operation through a given id.
// This is useful when the app starts an operation that this worker has to use.
// It's good to show the user feedback because there's some delay between the
// time the worker is triggered to the moment it actually starts.
//
// If the id is given load the operation and handle it from there,
// otherwise create a new one.
let operationExecutor;
if (isNaN(operationId)) {
  operationExecutor = operation.start('generate-analysis', projId, scId);
} else {
  operationExecutor = operation.loadById(operationId);
}

operationExecutor
// Start by loading the info on all the project and scenario files needed
// for the results processing.
.then(() => fetchFilesInfo(projId, scId))
.then(files => {
  // Write files used by osm2osrm to disk.
  return Promise.all([
    writeFile(files.profile.path, `${WORK_DIR}/profile.lua`),
    writeFile(files['road-network'].path, `${WORK_DIR}/road-network.osm`)
  ])
  .then(() => operation.log(opCodes.OP_OSRM, {message: 'osm2osrm processing started'}))
  // Create orsm files and cleanup.
  .then(() => osm2osrm(WORK_DIR))
  .then(() => osm2osrmCleanup(WORK_DIR))
  .then(() => operation.log(opCodes.OP_OSRM, {message: 'osm2osrm processing finished'}))
  // Pass the files for the next step.
  .then(() => files);
})
.then(files => {
  let result = {
    // origins,
    // pois,
    // selectedAA
  };

  // Load the pois.
  let pois = files.poi;
  let types = Object.keys(pois);
  let loaded = {};

  return Promise.all(types.map(k => getJSONFileContents(pois[k].path)))
    .then(data => {
      types.forEach((type, idx) => {
        loaded[type] = data[idx];
      });
      // Replace the raw poi with the loaded ones.
      result.pois = loaded;
    })
    .then(() => Promise.all([
      getJSONFileContents(files.origins.path),
      db('scenarios_settings').select('value').where('key', 'admin_areas').where('scenario_id', scId).first()
    ]))
    .then(data => {
      result.origins = data[0];
      result.selectedAA = JSON.parse(data[1].value);

      return result;
    });
})
.then(res => {
  let {origins, pois, selectedAA} = res;

  // Get selected adminAreas.
  return db('projects_aa')
    .select('*')
    .where('project_id', projId)
    .whereIn('id', selectedAA)
    .then(aa => {
      // Convert admin areas to featureCollection.
      let adminAreasFC = {
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
            type: o.geometry.length === 1 ? 'Polygon' : 'MultiPolygon',
            coordinates: o.geometry
          }
        }))
      };

      return {origins, pois, adminAreasFC};
    });
})
.then(res => {
  let {origins, pois, adminAreasFC} = res;

  var timeMatrixTasks = adminAreasFC.features.map(area => {
    const data = {
      adminArea: area,
      origins: origins,
      pois,
      maxSpeed: 120,
      maxTime: 3600
    };
    return createTimeMatrixTask(data, `${WORK_DIR}/road-network.osrm`);
  });

  // createTimeMatrixTask need to be executed in parallel with a limit because
  // they spawn new processes. Use async but Promisify to continue chain.
  let timeMatrixRunner = new Promise((resolve, reject) => {
    let time = Date.now();
    async.parallelLimit(timeMatrixTasks, config.cpus, (err, adminAreasData) => {
      if (err) return reject(err);
      logger.log('Processed', timeMatrixTasks.length, 'admin areas in', (Date.now() - time) / 1000, 'seconds');
      return resolve(adminAreasData);
    });
  });

  return operation.log(opCodes.OP_ROUTING, {message: 'Routing started', count: timeMatrixTasks.length})
    .then(() => timeMatrixRunner)
    .then(adminAreasData => operation.log(opCodes.OP_ROUTING, {message: 'Routing complete'}).then(() => adminAreasData));
})
.then(adminAreasData => {
  let processedJson = adminAreasData.map(result => {
    return {
      id: result.adminArea.id,
      name: result.adminArea.name,
      results: result.json
    };
  });

  return saveScenarioFile('results-all', 'all', processedJson, projId, scId)
    .then(() => adminAreasData);
})
// S3 storage.
.then(adminAreasData => {
  logger.group('s3').log('Storing files');
  let putFilesTasks = adminAreasData.map(o => saveScenarioFile('results', `${o.adminArea.id}-${kebabCase(o.adminArea.name)}`, o.csv, projId, scId));

  return operation.log(opCodes.OP_RESULTS, {message: 'Storing results'})
    .then(() => Promise.all(putFilesTasks))
    .then(() => operation.log(opCodes.OP_RESULTS, {message: 'Storing results complete'}))
    .then(() => {
      logger.group('s3').log('Storing files complete');
      // Pass it along.
      return adminAreasData;
    });
})
// File storage
.then(adminAreasData => {
  logger.log('Writing result CSVs');
  adminAreasData.forEach(o => {
    let name = `results--${o.adminArea.id}-${kebabCase(o.adminArea.name)}.csv`;
    fs.writeFileSync(`${WORK_DIR}/${name}`, o.csv);
  });

  logger.log('Done writing result CSVs');
})
// Update generation time.
.then(() => db('scenarios_settings')
  .update({value: (new Date())})
  .where('scenario_id', scId)
  .where('key', 'res_gen_at')
)
.then(() => operation.log(opCodes.OP_RESULTS_FILES, {message: 'Files written'}))
.then(() => operation.log(opCodes.OP_SUCCESS, {message: 'Operation complete'}))
.then(() => operation.finish())
.then(() => logger.toFile(`${WORK_DIR}/process.log`))
.then(() => process.exit(0))
.catch(err => {
  console.log('err', err);
  let eGroup = logger.group('error');
  if (err.message) {
    eGroup.log(err.message);
    eGroup.log(err.stack);
  } else {
    eGroup.log(err);
  }
  logger.toFile(`${WORK_DIR}/process.log`);
  operation.log(opCodes.OP_ERROR, {error: err.message || err})
    .then(() => operation.finish())
    .then(() => process.exit(1), () => process.exit(1));
});

function fetchFilesInfo (projId, scId) {
  return Promise.all([
    db('projects_files')
      .select('*')
      .whereIn('type', ['profile', 'origins'])
      .where('project_id', projId),
    db('scenarios_files')
      .select('*')
      .whereIn('type', ['poi', 'road-network'])
      .where('project_id', projId)
      .where('scenario_id', scId)
  ])
  .then(files => {
    // Merge scenario and project files and convert the files array
    // into an object indexed by type.
    let obj = {};
    files
      .reduce((acc, f) => acc.concat(f), [])
      .forEach(o => {
        // Special handling for pois.
        if (o.type === 'poi') {
          if (!obj['poi']) {
            obj['poi'] = {};
          }
          obj['poi'][o.subtype] = o;
        } else {
          obj[o.type] = o;
        }
      });
    return obj;
  });
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

    exec(`rm ${globs}`, (error, stdout, stderr) => {
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
          // Build csv file.
          let result = msg.data;

          if (!result.length) {
            // Result may be empty if in the work area there are no origins.
            taskLogger.log('No results returned');
            return callback(null, {
              adminArea: data.adminArea.properties,
              csv: 'error\nThere are no results for this admin area',
              json: {}
            });
          }
          taskLogger.log(`Results returned for ${result.length} origins`);

          // Prepare the csv.
          // To form the fields array for json2csv convert from:
          // {
          //  prop1: 'prop1',
          //  prop2: 'prop2',
          //  poi: {
          //    poiName: 'poi-name'
          //  },
          //  nearest: 'nearest'
          // }
          // to
          // [prop1, prop2, poi.poiName, nearest]
          //
          // Poi fields as paths for nested objects.
          let poiFields = Object.keys(data.pois);
          poiFields = poiFields.map(o => `poi.${o}`);

          // Other fields, except poi
          let fields = Object.keys(result[0]);
          let poiIdx = fields.indexOf('poi');
          poiIdx !== -1 && fields.splice(poiIdx, 1);

          // Concat.
          fields = fields.concat(poiFields);

          let csv = json2csv({ data: result, fields: fields });

          const finish = () => {
            cETA.disconnect();
            return callback(null, {
              adminArea: data.adminArea.properties,
              csv,
              json: result
            });
          };

          // Error or not, we finish the process.
          operation.log(opCodes.OP_ROUTING_AREA, {message: 'Routing complete', adminArea: data.adminArea.properties.name})
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
function saveScenarioFile (type, name, data, projId, scId) {
  const fileName = `results_${name}_${Date.now()}`;
  const filePath = `scenario-${scId}/${fileName}`;
  const fileData = {
    name: fileName,
    type: type,
    path: filePath,
    project_id: projId,
    scenario_id: scId,
    created_at: (new Date()),
    updated_at: (new Date())
  };

  logger.group('s3').log('Saving file', filePath);

  let contents = type === 'results' ? data : JSON.stringify(data);
  return putFile(filePath, contents)
    .then(() => db('scenarios_files')
      .returning('*')
      .insert(fileData)
      .then(() => db('projects')
        .update({
          updated_at: (new Date())
        })
        .where('id', projId)
      )
    );
}
