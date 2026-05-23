require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const config = require('./src/config');
const webhookRoutes = require('./src/routes/webhook');
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

// Initialize DB on startup
const db = require('./src/db');
db.getDb(); // Triggers migration

const app = express();

// Logging
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// CORS
app.use(cors());

// Parse JSON — must come before routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/webhook/telnyx', webhookRoutes);
app.use('/api', apiRoutes);
app.use('/admin/api', adminRoutes);

// Admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    env: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
  console.log(`\n✓ Token Plan Onboarding Server started`);
  console.log(`  Environment : ${config.nodeEnv}`);
  console.log(`  Port        : ${config.port}`);
  console.log(`  Base URL    : ${config.baseUrl}`);
  console.log(`  Webhook URL : ${config.baseUrl}/webhook/telnyx`);
  console.log(`  Frontend    : ${config.baseUrl}/`);
  console.log(`  Admin       : ${config.baseUrl}/admin`);
  console.log(`  Health      : ${config.baseUrl}/health\n`);
});

module.exports = app;
