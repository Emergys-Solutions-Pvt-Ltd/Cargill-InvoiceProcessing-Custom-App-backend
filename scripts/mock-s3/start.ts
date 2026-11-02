import { MockS3Server } from './mock-s3-server.js';

/**
 * Local mock S3:  npm run mock:s3
 * Env: MOCK_S3_PORT (default 4030), MOCK_S3_BUCKET (default latam-invoice-attachments).
 * Backend .env for local development against it:
 *   STORAGE_PROVIDER=s3
 *   S3_BUCKET=latam-invoice-attachments
 *   S3_ENDPOINT=http://localhost:4030
 *   S3_FORCE_PATH_STYLE=true
 *   S3_ACCESS_KEY_ID=MOCKS3ACCESSKEY
 *   S3_SECRET_ACCESS_KEY=mock-s3-secret-key
 * Objects live in memory only (lost on restart).
 */
const main = async () => {
  const bucket = process.env.MOCK_S3_BUCKET ?? 'latam-invoice-attachments';
  const server = await new MockS3Server({ port: Number(process.env.MOCK_S3_PORT ?? 4030), buckets: [bucket] }).start();
  console.log(`Mock S3 listening on ${server.url} (bucket ${bucket}, access key ${server.accessKeyId})`);
};

void main();
