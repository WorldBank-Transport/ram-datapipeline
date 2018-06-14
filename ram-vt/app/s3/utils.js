'use strict';
import fs from 'fs';
import Promise from 'bluebird';
import s3, { bucket } from './';

// Get s3 file to file.
export function fGetFile (file, dest) {
  return new Promise((resolve, reject) => {
    s3.fGetObject(bucket, file, dest, (err) => {
      if (err) {
        return reject(err);
      }
      return resolve(dest);
    });
  });
}

// Put file.
export function putFile (name, filepath) {
  return new Promise((resolve, reject) => {
    s3.fPutObject(bucket, name, filepath, 'application/octet-stream', (err, etag) => {
      if (err) {
        return reject(err);
      }
      return resolve(etag);
    });
  });
}

export function listObjects (bucket, objPrefix = '') {
  return new Promise((resolve, reject) => {
    var objects = [];
    var stream = s3.listObjectsV2(bucket, objPrefix, true);
    stream.on('data', obj => {
      objects.push(obj);
    });
    stream.on('error', err => {
      return reject(err);
    });
    stream.on('end', () => {
      return resolve(objects);
    });
  });
}

export function removeObject (bucket, name) {
  return new Promise((resolve, reject) => {
    s3.removeObject(bucket, name, err => {
      if (err) {
        return reject(err);
      }
      return resolve();
    });
  });
}

export function removeDir (dir) {
  return listObjects(bucket, dir)
    .catch(err => {
      if (err.code === 'NoSuchBucket') {
        return [];
      }
      throw err;
    })
    .then(objects => Promise.map(objects, o => removeObject(bucket, o.name), { concurrency: 10 }));
}

// Put directory
export function putDir (sourceDir, destDir) {
  let files = getLocalFilesInDir(sourceDir);
  return Promise.map(files, file => {
    let newName = file.replace(sourceDir, destDir);
    return putFile(newName, file);
  }, { concurrency: 10 });
}

export function getLocalFilesInDir (dir) {
  const files = fs.readdirSync(dir);

  return files.reduce((acc, file) => {
    let name = dir + '/' + file;
    if (fs.statSync(name).isDirectory()) {
      acc = acc.concat(getLocalFilesInDir(name));
    } else {
      acc.push(name);
    }

    return acc;
  }, []);
}
