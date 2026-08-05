const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createApp } = require('./app');
const { init, useBlobDb } = require('./db');

const PORT = Number(process.env.PORT || 3000);

async function main() {
  try {
    await init();
    console.log(useBlobDb() ? 'Blob DB ready' : `MySQL connected: ${process.env.DB_NAME || 'shrees_extractions'}`);
  } catch (err) {
    console.error('Database init failed:', err.message);
    process.exit(1);
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Shree's Extractions server running at http://localhost:${PORT}/`);
  });
}

main();
