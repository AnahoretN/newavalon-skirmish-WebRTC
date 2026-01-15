/**
 * @file Development server with integrated Vite middleware.
 * Combines Express server with Vite dev server for unified development experience.
 */

import express from 'express';
import expressWs from 'express-ws';
import { fileURLToPath } from 'url';
import path from 'path';

import { setupRoutes } from './routes/index.js';
import { setupWebSocket } from './services/websocket.js';
import { initializeContent } from './services/content.js';
import { logger } from './utils/logger.js';
import { validateConfig } from './utils/config.js';

// Import Vite
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createDevServer() {
  // Create Express app and enable WebSocket
  const app = express();
  const wsInstance = expressWs(app);
  const wss = wsInstance.getWss();

  // Validate configuration
  validateConfig();

  // Initialize content database
  await initializeContent();

  // Create Vite server in middleware mode
  const vite = await createViteServer({
    configFile: path.join(__dirname, '../vite.config.ts'),
    root: path.join(__dirname, '../client'),
    server: { middlewareMode: true },
    appType: 'spa'
  });

  // Setup API routes BEFORE Vite middleware so they take priority
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
    next();
  });

  setupRoutes(app);

  // Setup WebSocket route BEFORE Vite middleware (important for tunnel compatibility)
  // This matches the old working version's approach: app.ws('/', ...)
  (app as any).ws('/', () => {
    // WebSocket connection will be handled by the wss 'connection' event
    // The express-ws library routes this through the same wss instance
    // Just log for debugging - actual handling is in setupWebSocket
    logger.info('WebSocket connection received via app.ws route');
  });

  // Use vite's connect instance as middleware (catch-all for SPA routing)
  app.use(vite.middlewares);

  // Setup WebSocket server reference for broadcasting
  setupWebSocket(wss);

  // Start server
  const PORT = process.env.PORT || 8822;
  const server = app.listen(PORT, () => {
    logger.info(`🚀 Development server running on http://localhost:${PORT}`);
    logger.info(`📦 Vite middleware integrated`);
    logger.info(`🔌 WebSocket server ready`);
  });

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);

    // Set a forced exit timeout in case server.close() hangs
    const shutdownTimeout = setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10000); // 10 second timeout

    try {
      await vite.close();
      server.close(() => {
        clearTimeout(shutdownTimeout);
        logger.info('Process terminated');
        process.exit(0);
      });
    } catch (error) {
      logger.error('Error during shutdown:', error);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return { app, wss, vite };
}

// Start the development server
createDevServer().catch((error) => {
  logger.error('Failed to start development server:', error);
  process.exit(1);
});
