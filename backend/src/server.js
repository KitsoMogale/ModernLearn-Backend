const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const connectDB = require('./config/database');
const { initializeFirebase } = require('./config/firebase');

// Import routes
const subjectRoutes = require('./routes/subject.routes');
const topicRoutes = require('./routes/topic.routes');
const levelRoutes = require('./routes/level.routes');
const clusterRoutes = require('./routes/cluster.routes');
const nodeRoutes = require('./routes/node.routes');
const questionRoutes = require('./routes/question.routes');
const userRoutes = require('./routes/user.routes');
const diagnosticRoutes = require('./routes/diagnostic.routes');
const learningPathRoutes = require('./routes/learningPath.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Connect to MongoDB
connectDB();

// Initialize Firebase Admin
initializeFirebase();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// API Routes
const API_VERSION = process.env.API_VERSION || 'v1';
app.use(`/api/${API_VERSION}/subjects`, subjectRoutes);
app.use(`/api/${API_VERSION}/topics`, topicRoutes);
app.use(`/api/${API_VERSION}/levels`, levelRoutes);
app.use(`/api/${API_VERSION}/clusters`, clusterRoutes);
app.use(`/api/${API_VERSION}/nodes`, nodeRoutes);
app.use(`/api/${API_VERSION}/questions`, questionRoutes);
app.use(`/api/${API_VERSION}/users`, userRoutes);
app.use(`/api/${API_VERSION}/diagnostic`, diagnosticRoutes);
app.use(`/api/${API_VERSION}/learning-paths`, learningPathRoutes);

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
