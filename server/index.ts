/**
 * @file Main server entry point for the multiplayer card game.
 * Sets up Express app, WebSocket server, and starts the server.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';

import { setupRoutes } from './routes/index.js';
import { setupWebSocket } from './services/websocket.js';
import { initializeContent } from './services/content.js';
import { logger } from './utils/logger.js';
import { validateConfig } from './utils/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();

// Validate configuration
validateConfig();

// Initialize content database
try {
  await initializeContent();
} catch (error) {
  logger.error('Failed to initialize content database:', error as Error);
  process.exit(1);
}

// Setup middleware
app.use(express.json({ limit: '10mb' }));

// CORS middleware for ngrok and remote connections
app.use((req, res, next) => {
  // Allow any origin for ngrok/GitHub Pages setup
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  // ngrok free tier skip browser warning header
  res.header('ngrok-skip-browser-warning', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  return next();
});

// Determine static file path based on environment
const isProduction = process.env.NODE_ENV === 'production' || __dirname.includes('dist-server');

// For bundled server.js, __dirname will be the root, so use process.cwd() and calculate correctly
const getStaticPath = (): string => {
  if (isProduction) {
    // In production (bundled server.js or dist-server), static files are at /app/dist
    return path.join(process.cwd(), 'dist');
  }
  // Development: not used, dev server uses tsx
  return path.join(__dirname, '../client/dist');
};

const staticPath = getStaticPath();

app.use(express.static(staticPath));

// Setup routes
setupRoutes(app);

// Start server
const PORT = process.env.PORT || 8822;
const server = createServer(app);

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Setup WebSocket handlers
setupWebSocket(wss);

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`WebSocket server ready`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

export { app, wss };