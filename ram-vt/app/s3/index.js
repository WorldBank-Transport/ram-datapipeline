'use strict';
import * as Minio from 'minio';
import Http from 'http';
import Https from 'https';

import { getAWSInstanceCredentials } from '../utils/aws';

const {
  STORAGE_HOST,
  STORAGE_PORT,
  STORAGE_ENGINE,
  STORAGE_ACCESS_KEY,
  STORAGE_SECRET_KEY,
  STORAGE_BUCKET,
  STORAGE_REGION
} = process.env;

export const bucket = STORAGE_BUCKET;
export const region = STORAGE_REGION;

/**
 * Initializes the minio s3 client depending on the engine and credentials
 * source in use. Needs to be a promise because it may rely on asynchronously
 * fetched credentials.
 *
 * @returns Minio Client
 */
export default async function S3 () {
  let minioClient;
  let agent;

  switch (STORAGE_ENGINE) {
    case 'minio':
      minioClient = new Minio.Client({
        endPoint: STORAGE_HOST,
        port: parseInt(STORAGE_PORT),
        secure: false,
        accessKey: STORAGE_ACCESS_KEY,
        secretKey: STORAGE_SECRET_KEY
      });
      agent = Http.globalAgent;
      break;
    case 's3':
      let credentials;
      if (!STORAGE_ACCESS_KEY && !STORAGE_SECRET_KEY) {
        // If we're using a S3 storage engine but no accessKey and secretKey
        // are set up, we assume that it is being run from a EC2 instance and
        // will try to get the credentials through the url. We're not throwing
        // any error if it fails because that is checked on startup.
        // See app/index.js
        const AWSInstanceCredentials = await getAWSInstanceCredentials();
        credentials = {
          accessKey: AWSInstanceCredentials.accessKey,
          secretKey: AWSInstanceCredentials.secretKey,
          sessionToken: AWSInstanceCredentials.sessionToken
        };
      } else {
        credentials = {
          accessKey: STORAGE_ACCESS_KEY,
          secretKey: STORAGE_SECRET_KEY
        };
      }

      minioClient = new Minio.Client({
        endPoint: 's3.amazonaws.com',
        ...credentials
      });
      agent = Https.globalAgent;
      break;
    default:
      throw new Error('Invalid storage engine. Use s3 or minio');
  }

  // Temp fix for https://github.com/minio/minio-js/issues/641
  minioClient.agent = agent;

  return minioClient;
}
