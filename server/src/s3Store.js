const { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const PART_SIZE = 8 * 1024 * 1024; // 8 MB parts (S3 min 5 MB except last)

function useS3() {
  return !!(
    process.env.S3_ENDPOINT
    && process.env.S3_ACCESS_KEY_ID
    && process.env.S3_SECRET_ACCESS_KEY
    && process.env.S3_BUCKET
  );
}

function s3Bucket() {
  return String(process.env.S3_BUCKET || '');
}

let client;
function getClient() {
  if (!useS3()) throw new Error('S3/R2 is not configured');
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: String(process.env.S3_ENDPOINT || '').replace(/\/$/, ''),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true') !== 'false',
    });
  }
  return client;
}

function isS3Key(value) {
  return typeof value === 'string' && value.startsWith('s3://');
}

function stripS3Prefix(value) {
  return String(value || '').replace(/^s3:\/\//, '');
}

function toS3Ref(key) {
  return `s3://${key}`;
}

async function createMultipartUpload({ key, contentType }) {
  const out = await getClient().send(new CreateMultipartUploadCommand({
    Bucket: s3Bucket(),
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  }));
  return {
    uploadId: out.UploadId,
    key,
    partSize: PART_SIZE,
  };
}

async function presignUploadPart({ key, uploadId, partNumber }) {
  const command = new UploadPartCommand({
    Bucket: s3Bucket(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  const url = await getSignedUrl(getClient(), command, { expiresIn: 3600 });
  return { url, partNumber };
}

async function completeMultipartUpload({ key, uploadId, parts }) {
  const sorted = (parts || [])
    .map((p) => ({
      ETag: String(p.etag || p.ETag || '').replace(/"/g, ''),
      PartNumber: Number(p.partNumber || p.PartNumber),
    }))
    .filter((p) => p.PartNumber > 0 && p.ETag)
    .sort((a, b) => a.PartNumber - b.PartNumber)
    .map((p) => ({ ETag: `"${p.ETag}"`, PartNumber: p.PartNumber }));

  await getClient().send(new CompleteMultipartUploadCommand({
    Bucket: s3Bucket(),
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: sorted },
  }));
  return toS3Ref(key);
}

async function abortMultipartUpload({ key, uploadId }) {
  try {
    await getClient().send(new AbortMultipartUploadCommand({
      Bucket: s3Bucket(),
      Key: key,
      UploadId: uploadId,
    }));
  } catch (_) {}
}

async function deleteS3Object(keyOrRef) {
  const key = stripS3Prefix(keyOrRef);
  if (!key) return;
  try {
    await getClient().send(new DeleteObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
    }));
  } catch (err) {
    console.warn('s3 delete failed:', err.message);
  }
}

async function headS3Object(keyOrRef) {
  const key = stripS3Prefix(keyOrRef);
  const out = await getClient().send(new HeadObjectCommand({
    Bucket: s3Bucket(),
    Key: key,
  }));
  return {
    size: Number(out.ContentLength || 0),
    contentType: out.ContentType || 'application/octet-stream',
  };
}

async function getSignedDownloadUrl(keyOrRef, expiresIn = 300) {
  const key = stripS3Prefix(keyOrRef);
  const publicBase = String(process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
  if (publicBase) {
    return `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  const url = await getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: s3Bucket(), Key: key }),
    { expiresIn },
  );
  return url;
}

module.exports = {
  useS3,
  PART_SIZE,
  isS3Key,
  stripS3Prefix,
  toS3Ref,
  createMultipartUpload,
  presignUploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  deleteS3Object,
  headS3Object,
  getSignedDownloadUrl,
};
