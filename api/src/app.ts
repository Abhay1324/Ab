import express, { Application } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

const app: Application = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API info endpoint
app.get('/api', (_req, res) => {
  res.json({
    message: 'Milk Subscription Platform API',
    version: '1.0.0',
  });
});

// API routes
app.use('/api', routes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  });
});

// Error handler
app.use(errorHandler);

export default app;
