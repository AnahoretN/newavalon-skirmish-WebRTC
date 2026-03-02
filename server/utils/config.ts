/**
 * @file Server configuration and validation
 */

import fs from 'fs';

// Security and performance constants
export const CONFIG = {
  MAX_PLAYERS: 4,
  INACTIVITY_TIMEOUT_MS: 20 * 60 * 1000, // 20 minutes
  MAX_MESSAGE_SIZE: 1024 * 1024, // 1MB max WebSocket message
  MAX_GAME_STATE_SIZE: 10 * 1024 * 1024, // 10MB max game state
  MAX_ACTIVE_GAMES: 1000, // Maximum concurrent games
  RATE_LIMIT_WINDOW: 60000, // 1 minute
  MESSAGE_RATE_LIMIT: 1000, // Max messages per minute (increased for development)
  MAX_STRING_LENGTH: 1000, // Max string length for user input
  DECKS_FILE_PATH: 'shared/content/contentDatabase.json',
  LOGS_DIR: 'logs'
};

/**
 * Validate server configuration
 */
export function validateConfig() {
  const requiredEnvVars: string[] = [];

  if (requiredEnvVars.some(envVar => !process.env[envVar])) {
    throw new Error(`Missing required environment variables: ${requiredEnvVars.join(', ')}`);
  }

  // Create logs directory if it doesn't exist
  if (!fs.existsSync(CONFIG.LOGS_DIR)) {
    fs.mkdirSync(CONFIG.LOGS_DIR, { recursive: true });
  }
}