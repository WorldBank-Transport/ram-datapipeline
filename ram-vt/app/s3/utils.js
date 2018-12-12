'use strict';
import fs from 'fs-extra';
import Promise from 'bluebird';
import S3, { bucket } from './';

// Get s3 file to file.
export function fGetFile (file, dest) {
  return new Promise(async (resolve, reject) => {
    const s3 = await S3();
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
  return new Promise(async (resolve, reject) => {
    const s3 = await S3();
    s3.fPutObject(bucket, name, filepath, 'application/octet-stream', (err, etag) => {
      if (err) {
        return reject(err);
      }
      return resolve(etag);
    });
  });
}

export function listObjects (bucket, objPrefix = '') {
  return new Promise(async (resolve, reject) => {
    var objects = [];
    const s3 = await S3();
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
  return new Promise(async (resolve, reject) => {
    const s3 = await S3();
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
export async function putDir (sourceDir, destDir) {
  let files = await getLocalFilesInDir(sourceDir);
  return Promise.map(files, file => {
    let newName = file.replace(sourceDir, destDir);
    return putFile(newName, file);
  }, { concurrency: 10 });
}

export async function getLocalFilesInDir (dir) {
  const files = await fs.readdir(dir);

  return Promise.reduce(files, async (acc, file) => {
    const name = dir + '/' + file;
    const stats = await fs.stat(name);

    return stats.isDirectory()
      ? acc.concat(await getLocalFilesInDir(name))
      : acc.concat(name);
  }, []);
}
