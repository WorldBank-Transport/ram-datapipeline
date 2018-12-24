'use strict';
import fs from 'fs-extra';
import Promise from 'bluebird';
import S3, { bucket } from './';

// Get s3 file to file.
export async function fGetFile (file, dest) {
  const s3 = await S3();
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
export async function putFile (name, filepath) {
  const s3 = await S3();
  return new Promise((resolve, reject) => {
    s3.fPutObject(bucket, name, filepath, 'application/octet-stream', (err, etag) => {
      if (err) {
        return reject(err);
      }
      return resolve(etag);
    });
  });
}

export async function listObjects (bucket, objPrefix = '') {
  const s3 = await S3();
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

export async function removeObject (bucket, name) {
  const s3 = await S3();
  return new Promise((resolve, reject) => {
    s3.removeObject(bucket, name, err => {
      if (err) {
        return reject(err);
      }
      return resolve();
    });
  });
}

export async function removeDir (dir) {
  let objects = [];
  try {
    objects = await listObjects(bucket, dir);
  } catch (err) {
    if (err.code === 'NoSuchBucket') {
      return [];
    }
    throw err;
  }
  return Promise.map(objects, o => removeObject(bucket, o.name), { concurrency: 10 });
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
