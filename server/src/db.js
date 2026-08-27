const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function useBlobDb() {
  const flag = process.env.USE_BLOB_DB;
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  const hasMysql = !!(process.env.DATABASE_URL || process.env.MYSQL_URL);
  // On Vercel, never try localhost MySQL — use JSON DB (KV, Blob, or memory).
  if (process.env.VERCEL && !hasMysql) return true;
  const hasKv = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
  return !!(process.env.VERCEL && (hasKv || hasBlob) && !hasMysql);
}

let query;
let expireStaleRequests;
let clearDoneForOwner = null;
let purgeChatForRequests = null;
let pool = null;
let init = async () => true;

if (useBlobDb()) {
  const blobDb = require('./blobDb');
  query = blobDb.query;
  expireStaleRequests = blobDb.expireStaleRequests;
  clearDoneForOwner = blobDb.clearDoneForOwner;
  purgeChatForRequests = blobDb.purgeChatForRequests;
  init = blobDb.init;
  pool = null;
  console.log(process.env.KV_REST_API_URL ? 'Using Redis JSON database' : 'Using Blob JSON database');
} else {
  function createPool() {
    const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
    if (databaseUrl) {
      return mysql.createPool({
        uri: databaseUrl,
        waitForConnections: true,
        connectionLimit: 10,
        namedPlaceholders: true,
        dateStrings: true,
      });
    }
    return mysql.createPool({
      host: process.env.DB_HOST || process.env.MYSQL_HOST || '127.0.0.1',
      user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
      password: process.env.DB_PASS || process.env.MYSQL_PASSWORD || process.env.MYSQL_PASS || '',
      database: process.env.DB_NAME || process.env.MYSQL_DATABASE || process.env.MYSQL_DB || 'shrees_extractions',
      port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      dateStrings: true,
    });
  }

  pool = createPool();

  query = async function mysqlQuery(sql, params) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  };

  expireStaleRequests = async function mysqlExpire() {
    // Wipe chats for sessions that just ended, then mark them done.
    await query(
      `DELETE cm FROM chat_messages cm
       INNER JOIN access_requests ar ON ar.id = cm.access_request_id
       WHERE (ar.status = 'pending' AND ar.password_expires_at < NOW())
          OR (ar.status = 'unlocked' AND ar.unlock_expires_at IS NOT NULL AND ar.unlock_expires_at < NOW())`,
    );
    await query(
      `UPDATE access_requests
       SET status = 'expired'
       WHERE status = 'pending' AND password_expires_at < NOW()`,
    );
    await query(
      `UPDATE access_requests
       SET status = 'used'
       WHERE status = 'unlocked' AND unlock_expires_at IS NOT NULL AND unlock_expires_at < NOW()`,
    );
  };

  purgeChatForRequests = async function mysqlPurgeChat(requestIds) {
    const ids = (requestIds || []).map(Number).filter((n) => n > 0);
    if (!ids.length) return { affectedRows: 0 };
    let total = 0;
    for (const id of ids) {
      const result = await query('DELETE FROM chat_messages WHERE access_request_id = :requestId', { requestId: id });
      total += Number((result && result.affectedRows) || 0);
    }
    return { affectedRows: total };
  };

  init = async function mysqlInit() {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    return true;
  };
}

module.exports = {
  pool,
  query,
  expireStaleRequests,
  clearDoneForOwner,
  purgeChatForRequests,
  init,
  useBlobDb,
};
