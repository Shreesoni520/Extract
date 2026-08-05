// Require express here so Vercel detects the Express framework entrypoint.
const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'server', '.env') });
const { createApp } = require('./server/src/app');

// Keep a reference so bundlers don't tree-shake the express import.
void express;

module.exports = createApp();
