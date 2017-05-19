'use strict';
import * as Minio from 'minio';

var minioClient;
const {
  STORAGE_HOST,
  STORAGE_PORT,
  STORAGE_ENGINE,
  STORAGE_ACCESS_KEY,
  STORAGE_SECRET_KEY,
  STORAGE_BUCKET,
  STORAGE_REGION
} = process.env;

switch (STORAGE_ENGINE) {
  case 'minio':
    minioClient = new Minio.Client({
      endPoint: STORAGE_HOST,
      port: parseInt(STORAGE_PORT),
      secure: false,
      accessKey: STORAGE_ACCESS_KEY,
      secretKey: STORAGE_SECRET_KEY
    });
    break;
  case 's3':
    minioClient = new Minio.Client({
      endPoint: 's3.amazonaws.com',
      accessKey: STORAGE_ACCESS_KEY,
      secretKey: STORAGE_SECRET_KEY
    });
    break;
  default:
    throw new Error('Invalid storage engine. Use s3 or minio');
}

export default minioClient;

export const bucket = STORAGE_BUCKET;
export const region = STORAGE_REGION;
