/**
 * @file Security utilities for input sanitization and validation
 */

import { CONFIG } from './config.js';
import crypto from 'crypto';
import type { ExtendedWebSocket } from './websocketTypes.js';

/**
 * Validation result type
 */
export interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  sanitizedData?: Record<string, unknown>;
}

/**
 * Send error response to WebSocket client
 */
export function sendErrorResponse(ws: ExtendedWebSocket, message: string): void {
  try {
    ws.send(JSON.stringify({
      type: 'ERROR',
      message
    }));
  } catch {
    // Ignore send errors
  }
}

/**
 * Validate basic message structure
 * Checks that data is an object and has a type field
 */
export function validateMessageStructure(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object') {
    return { isValid: false, errorMessage: 'Invalid data format' };
  }

  const dataObj = data as Record<string, unknown>;

  if (!dataObj.type || typeof dataObj.type !== 'string') {
    return { isValid: false, errorMessage: 'Missing or invalid message type' };
  }

  return { isValid: true, sanitizedData: dataObj };
}

/**
 * Validate gameId field
 */
export function validateGameId(gameId: unknown): ValidationResult {
  if (!gameId || typeof gameId !== 'string') {
    return { isValid: false, errorMessage: 'Invalid or missing gameId' };
  }

  // Sanitize the gameId
  const sanitized = sanitizeString(gameId);

  if (!sanitized) {
    return { isValid: false, errorMessage: 'Invalid gameId format' };
  }

  return { isValid: true, sanitizedData: { gameId: sanitized } };
}

/**
 * Validate that a field exists and is of expected type
 */
export function validateField(
  data: Record<string, unknown>,
  fieldName: string,
  expectedType: 'string' | 'number' | 'boolean' | 'object' | 'array'
): ValidationResult {
  const value = data[fieldName];

  if (value === undefined || value === null) {
    return { isValid: false, errorMessage: `Missing ${fieldName}` };
  }

  const actualType = Array.isArray(value) ? 'array' : typeof value;

  if (actualType !== expectedType) {
    return { isValid: false, errorMessage: `Invalid ${fieldName}: expected ${expectedType}` };
  }

  return { isValid: true };
}

/**
 * Common validation for visual effect messages
 * Validates message size, data structure, gameId, and a data payload field
 */
export function validateVisualEffectMessage(
  data: Record<string, unknown>,
  dataFieldName: string
): ValidationResult {
  // Validate message size
  if (!validateMessageSize(JSON.stringify(data))) {
    return { isValid: false, errorMessage: 'Message size exceeds limit' };
  }

  // Validate basic structure
  const structureResult = validateMessageStructure(data);
  if (!structureResult.isValid) {
    return structureResult;
  }

  // Validate gameId
  const gameIdResult = validateGameId(data.gameId);
  if (!gameIdResult.isValid) {
    return gameIdResult;
  }

  // Validate the data payload field
  const dataField = data[dataFieldName];
  if (!dataField || typeof dataField !== 'object') {
    return { isValid: false, errorMessage: `Invalid or missing ${dataFieldName}` };
  }

  return { isValid: true };
}

/**
 * Common validation for game state update messages
 */
export function validateGameStateMessage(data: Record<string, unknown>): ValidationResult {
  const structureResult = validateMessageStructure(data);
  if (!structureResult.isValid) {
    return structureResult;
  }

  const { gameState, gameId } = data as { gameState: unknown; gameId: unknown };

  if (!gameState || typeof gameState !== 'object') {
    return { isValid: false, errorMessage: 'Invalid game state data' };
  }

  if (!gameId || typeof gameId !== 'string') {
    return { isValid: false, errorMessage: 'Missing gameId in game state' };
  }

  return { isValid: true };
}

/**
 * Message field validation schema
 */
export interface MessageFieldSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  validate?: (value: unknown) => boolean;
}

/**
 * Message validation schema
 */
export interface MessageSchema {
  fields: MessageFieldSchema[];
}

/**
 * Schemas for common message types
 */
export const MessageSchemas: Record<string, MessageSchema> = {
  // Messages requiring gameId
  WITH_GAME_ID: {
    fields: [
      { name: 'gameId', type: 'string', required: true }
    ]
  },
  // Messages requiring gameId + playerId
  WITH_PLAYER_ID: {
    fields: [
      { name: 'gameId', type: 'string', required: true },
      { name: 'playerId', type: 'number', required: true }
    ]
  },
  // Visual effects messages
  VISUAL_EFFECT: {
    fields: [
      { name: 'gameId', type: 'string', required: true }
    ]
  },
  // Phase management
  PHASE_SET: {
    fields: [
      { name: 'gameId', type: 'string', required: true },
      { name: 'phaseIndex', type: 'number', required: true }
    ]
  },
  TOGGLE_BOOLEAN: {
    fields: [
      { name: 'gameId', type: 'string', required: true },
      { name: 'enabled', type: 'boolean', required: true }
    ]
  }
};

/**
 * Validate message against a schema
 */
export function validateMessageAgainstSchema(
  data: Record<string, unknown>,
  schema: MessageSchema
): ValidationResult {
  for (const field of schema.fields) {
    const value = data[field.name];

    // Check required fields
    if (field.required && (value === undefined || value === null)) {
      return { isValid: false, errorMessage: `Missing required field: ${field.name}` };
    }

    // Skip type check if value is optional and not provided
    if (!field.required && (value === undefined || value === null)) {
      continue;
    }

    // Check type
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== field.type) {
      return { isValid: false, errorMessage: `Invalid type for ${field.name}: expected ${field.type}, got ${actualType}` };
    }

    // Run custom validation if provided
    if (field.validate && !field.validate(value)) {
      return { isValid: false, errorMessage: `Validation failed for field: ${field.name}` };
    }
  }

  return { isValid: true };
}

/**
 * Sanitize string input
 * Removes HTML special characters and control characters
 */
export function sanitizeString(input: unknown, maxLength = CONFIG.MAX_STRING_LENGTH): string {
  if (typeof input !== 'string') return '';

  return input
    .replace(/[<>"'&]/g, '') // Remove HTML special chars
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .substring(0, maxLength);
}

/**
 * Sanitize player name
 */
export function sanitizePlayerName(name: unknown): string {
  const sanitized = sanitizeString(name, 20);
  // Remove leading/trailing whitespace and collapse multiple spaces
  return sanitized.trim().replace(/\s+/g, ' ') || 'Anonymous';
}

/**
 * Validate game state size
 */
export function validateGameStateSize(gameState: unknown): boolean {
  try {
    const size = JSON.stringify(gameState).length;
    return size <= CONFIG.MAX_GAME_STATE_SIZE;
  } catch {
    // JSON.stringify can throw on circular references or other unserializable data
    return false;
  }
}

/**
 * Check if message size is within limits
 * Handles both string and Buffer (from WebSocket messages)
 */
export function validateMessageSize(message: Buffer | string | null | undefined): boolean {
  // Guard against null/undefined
  if (message == null) {
    return true; // Treat null/undefined as empty message
  }
  // Handle Buffer (WebSocket messages are Buffers)
  if (Buffer.isBuffer(message)) {
    return message.length <= CONFIG.MAX_MESSAGE_SIZE;
  }
  // Handle string
  if (typeof message === 'string') {
    return message.length <= CONFIG.MAX_MESSAGE_SIZE;
  }
  // Unknown type
  return false;
}

/**
 * Generate secure game ID
 */
export function generateSecureGameId() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex').substring(0, 6);
  return `${timestamp}_${random}`.toUpperCase();
}
