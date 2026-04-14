const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const connectDB = require('./config/database');
const { initializeFirebase } = require('./config/firebase');

const app = express();
const PORT = process.env.PORT || 3000;

// Account deletion page — needs its own CSP to allow Firebase CDN scripts
// Mount before helmet() so the global CSP doesn't block it
const privacyPolicyRoutes = require('./routes/privacyPolicy');
app.use('/privacy-policy', privacyPolicyRoutes);

const accountDeletionRoutes = require('./routes/accountDeletion');
app.use('/account/delete', helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.gstatic.com'],
      connectSrc: ["'self'", 'https://*.googleapis.com', 'https://*.firebaseio.com', 'https://identitytoolkit.googleapis.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}), accountDeletionRoutes);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Connect to MongoDB
connectDB();

// Initialize Firebase Admin (required for verifying ID tokens in auth middleware)
initializeFirebase();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// API Routes
const API_VERSION = process.env.API_VERSION || 'v1';
const sessionRoutes = require('./routes/sessions');
const remediationRoutes = require('./routes/remediation');
const curriculumRoutes = require('./routes/curriculum');
const tutorRoutes = require('./routes/tutor');
const userRoutes = require('./routes/users');
app.use(`/api/sessions`, sessionRoutes);
app.use(`/api/remediation`, remediationRoutes);
app.use(`/api/curriculum`, curriculumRoutes);
app.use(`/api/tutor`, tutorRoutes);
app.use(`/api/users`, userRoutes);

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500,
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Route not found', status: 404 } });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

module.exports = app;
