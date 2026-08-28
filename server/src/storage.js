const fs = require('fs');
const path = require('path');
const { put, del } = require('@vercel/blob');
const {
  useKv,
  saveFileChunks,
  readFileChunks,
  readFileRange,
  getFileMeta,
  deleteFileChunks,
  isKvUrl,
} = require('./kvStore');
const {
  useS3,
  isS3Key,
  deleteS3Object,
  getSignedDownloadUrl,
  headS3Object,
} = require('./s3Store');
const { MAX_UPLOAD_BYTES, KV_UPLOAD_MAX_BYTES } = require('./utils');

function useBlob() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function uploadRoot() {
  const configured = process.env.UPLOAD_DIR || '../uploads';
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(__dirname, '..', configured);
}

function isRemoteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function blobUploadsEnabled() {
  // Hobby Blob is currently unavailable on this account (store deleted / quota).
  // Keep Redis as the live upload path (1 GB). R2/S3 unlocks the 5 GB ceiling.
  return useBlob() && String(process.env.USE_BLOB_UPLOADS || '') === '1';
}

function effectiveMaxUploadBytes() {
  if (useS3()) return MAX_UPLOAD_BYTES; // 5 GB with R2/S3
  if (blobUploadsEnabled()) return MAX_UPLOAD_BYTES;
  if (useKv()) return Math.min(MAX_UPLOAD_BYTES, KV_UPLOAD_MAX_BYTES); // 1 GB via Redis
  return MAX_UPLOAD_BYTES;
}

function storageMode() {
  if (useS3()) return 's3';
  if (blobUploadsEnabled()) return 'blob';
  if (useKv()) return 'kv';
  return 'local';
}

async function saveFile(bufferOrPath, { filename, contentType, folder } = {}) {
  const body = Buffer.isBuffer(bufferOrPath)
    ? bufferOrPath
    : fs.readFileSync(bufferOrPath);
  const pathname = folder ? `${folder}/${filename}` : filename;

  // Prefer object storage (S3/R2) for large, smooth media.
  if (useS3()) {
    // Small server-side saves still go through KV/local helpers below when S3
    // multipart isn't used. For avatars etc., fall through to Blob/KV/local.
  }

  if (useKv()) {
    const kvName = await saveFileChunks(pathname, body, contentType);
    return {
      kind: 'kv',
      url: null,
      pathname,
      filename: kvName,
    };
  }

  if (blobUploadsEnabled()) {
    const blob = await put(pathname, body, {
      access: 'public',
      contentType: contentType || 'application/octet-stream',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return {
      kind: 'blob',
      url: blob.url,
      pathname: blob.pathname || pathname,
      filename: blob.url,
    };
  }

  const root = uploadRoot();
  const destDir = folder ? path.join(root, folder) : root;
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, filename);
  fs.writeFileSync(destPath, body);

  return {
    kind: 'local',
    url: null,
    pathname,
    filename,
    path: destPath,
  };
}

async function readFile(itemOrFilename) {
  const filename = typeof itemOrFilename === 'string'
    ? itemOrFilename
    : (itemOrFilename && (itemOrFilename.blob_url || itemOrFilename.filename));

  if (!filename) {
    throw new Error('No filename');
  }

  if (isS3Key(filename)) {
    const signed = await getSignedDownloadUrl(filename, 300);
    const res = await fetch(signed);
    if (!res.ok) throw new Error(`Failed to fetch S3 file: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return {
      kind: 's3',
      buffer: Buffer.from(arrayBuffer),
      url: signed,
      contentType: res.headers.get('content-type') || null,
    };
  }

  if (isKvUrl(filename)) {
    const file = await readFileChunks(filename);
    return {
      kind: 'kv',
      buffer: file.buffer,
      url: null,
      contentType: file.contentType,
    };
  }

  if (isRemoteUrl(filename)) {
    const res = await fetch(filename);
    if (!res.ok) {
      throw new Error(`Failed to fetch remote file: ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      kind: 'blob',
      buffer: Buffer.from(arrayBuffer),
      url: filename,
      contentType: res.headers.get('content-type') || null,
    };
  }

  const filePath = path.join(uploadRoot(), filename);
  if (!fs.existsSync(filePath)) {
    throw new Error('File not found');
  }
  return {
    kind: 'local',
    path: filePath,
    buffer: null,
    url: null,
  };
}

async function deleteFile(filenameOrUrl) {
  if (!filenameOrUrl) return;

  if (isS3Key(filenameOrUrl)) {
    await deleteS3Object(filenameOrUrl);
    return;
  }

  if (isKvUrl(filenameOrUrl)) {
    await deleteFileChunks(filenameOrUrl);
    return;
  }

  if (isRemoteUrl(filenameOrUrl)) {
    try {
      await del(filenameOrUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch (err) {
      console.warn('blob delete failed:', err.message);
    }
    return;
  }

  const filePath = path.isAbsolute(filenameOrUrl)
    ? filenameOrUrl
    : path.join(uploadRoot(), filenameOrUrl);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('local delete failed:', err.message);
  }
}

module.exports = {
  useBlob,
  useKv,
  useS3,
  uploadRoot,
  isRemoteUrl,
  isS3Key,
  saveFile,
  readFile,
  readFileRange,
  getFileMeta,
  deleteFile,
  getSignedDownloadUrl,
  headS3Object,
  effectiveMaxUploadBytes,
  storageMode,
};
