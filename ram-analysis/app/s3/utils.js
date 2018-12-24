'use strict';
import S3, { bucket } from './';

// Proxy of removeObject function, assuming the bucket.
export async function removeFile (file) {
  const s3 = await S3();
  return new Promise((resolve, reject) => {
    s3.removeObject(bucket, file, err => {
      if (err) {
        return reject(err);
      }
      return resolve();
    });
  });
}

// Get file.
export async function getFile (file) {
  const s3 = await S3();
  return new Promise((resolve, reject) => {
    s3.getObject(bucket, file, (err, dataStream) => {
      if (err) {
        return reject(err);
      }
      return resolve(dataStream);
    });
  });
}

// Get file content.
export async function getFileContents (file) {
  const s3 = await S3();
  return new Promise((resolve, reject) => {
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
export async function writeFile (file, destination) {
  const s3 = await S3();
  return new Promise((resolve, reject) => {
    s3.fGetObject(bucket, file, destination, err => {
      if (err) {
        return reject(err);
      }
      return resolve();
    });
  });
}

// Put file.
export async function putFile (file, data) {
  const s3 = await S3();
  return new Promise((resolve, reject) => {
    s3.putObject(bucket, file, data, (err, etag) => {
      if (err) {
        return reject(err);
      }
      return resolve(etag);
    });
  });
}
