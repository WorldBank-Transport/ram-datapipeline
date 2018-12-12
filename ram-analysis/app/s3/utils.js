'use strict';
import S3, { bucket } from './';

// Proxy of removeObject function, assuming the bucket.
export function removeFile (file) {
  return new Promise(async (resolve, reject) => {
    const s3 = await S3();
    s3.removeObject(bucket, file, err => {
      if (err) {
        return reject(err);
      }
      return resolve();
    });
  });
}

// Get file.
export function getFile (file) {
  return new Promise(async (resolve, reject) => {
    const s3 = await S3();
    s3.getObject(bucket, file, (err, dataStream) => {
      if (err) {
        return reject(err);
      }
      return resolve(dataStream);
    });
  });
}

// Get file content.
export function getFileContents (file) {
  return new Promise(async (resolve, reject) => {
    const s3 = await S3();
    s3.getObject(bucket, file, (err, dataStream) => {
      if (err) return reject(err);

      var data = '';
      dataStream.on('data', chunk => (data += chunk));
      dataStream.on('end', () => resolve(data));
      dataStream.on('error', () => reject(err));
    });
  });
}

// Get file content in JSON.
export async function getJSONFileContents (file) {
  const result = await getFileContents(file);
  return JSON.parse(result);
}

// Get file and write to disk.
export function writeFile (file, destination) {
  return new Promise(async (resolve, reject) => {
    const s3 = await S3();
    s3.fGetObject(bucket, file, destination, err => {
      if (err) {
        return reject(err);
      }
      return resolve();
    });
  });
}

// Put file.
export function putFile (file, data) {
  return new Promise(async (resolve, reject) => {
    const s3 = await S3();
    s3.putObject(bucket, file, data, (err, etag) => {
      if (err) {
        return reject(err);
      }
      return resolve(etag);
    });
  });
}
