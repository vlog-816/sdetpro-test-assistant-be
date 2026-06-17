import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { connectMongoDB } from './config/index.js';
import authRoute from './routes/auth.js';
import generations from './routes/generations.js';
import { logger } from './utils/logger.js';
import { requireAuth } from './middleware/auth.js';

const app = express();

//CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN | 3000,
  credentials: true
}));

//Body parser - Parse JSON request body
app.use(express.json({ limit: '10mb' }));

//Log HTTP request
app.use(morgan('dev'));

//Health check end point
app.get('/serverStatus', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString,
    service: 'BE-Powered AI Assistent Testing'
  });
});

//Connect to MongoDB
connectMongoDB().catch(err => {
  logger.error('MongoDB connection', err);
  process.exit(1);
});

//Routes
app.use('/auth', authRoute);
app.use('/generations', requireAuth, generations)

//Log Register Route
logger.info('✅ Registered routes:');
logger.info('  POST /auth/register');

// 404 Handler - Route not found
app.use((req, res) => {
  logger.info(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`
  });
});

// Error Handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  logger.error('Error:', err);
  res.status(status).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

export default app;