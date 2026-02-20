/**
 * @file Content management service for cards, tokens, and decks
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory storage for content
let cardDatabase: Record<string, any> = {};
let tokenDatabase: Record<string, any> = {};
let deckFiles: any[] = [];
let countersDatabase: Record<string, any> = {};

/**
 * Initialize content database from JSON file
 */
export async function initializeContent() {
  try {
    // Check if we're in a production build (dist-server)
    const isProduction = __dirname.includes('dist-server');

    // Try multiple possible paths for robustness in different environments
    const possiblePaths = isProduction
      ? [
          // Production: from dist-server/server/services/ to project/server/content/
          // services -> server (1) -> dist-server (2) -> project root (3) -> server/content/
          path.join(__dirname, '../../../server/content/contentDatabase.json'),
          path.join(process.cwd(), 'server/content/contentDatabase.json'),
        ]
      : [
          // Development: from server/services/
          path.join(__dirname, '../content/contentDatabase.json'),
          path.join(process.cwd(), 'server/content/contentDatabase.json'),
        ];

    let contentPath = null;
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        contentPath = testPath;
        break;
      }
    }

    if (!contentPath) {
      throw new Error(`Content database not found. Tried paths: ${possiblePaths.join(', ')}`);
    }

    const rawData = fs.readFileSync(contentPath, 'utf8');
    const data = JSON.parse(rawData);

    // Process ability text to convert literal \n to actual newlines
    const processAbilityText = (text: string): string => {
      if (typeof text !== 'string') {return text;}
      return text.replace(/\\n/g, '\n');
    };

    // Process card abilities
    const processCardAbilities = (cards: Record<string, any>) => {
      const processed: Record<string, any> = {};
      for (const [id, card] of Object.entries(cards)) {
        processed[id] = {
          ...card,
          ability: processAbilityText(card.ability),
          flavorText: processAbilityText(card.flavorText),
        };
      }
      return processed;
    };

    // Support both key formats (cards/cardDatabase, tokens/tokenDatabase)
    cardDatabase = processCardAbilities(data.cardDatabase || data.cards || {});
    tokenDatabase = processCardAbilities(data.tokenDatabase || data.tokens || {});
    deckFiles = data.deckFiles || [];
    countersDatabase = data.countersDatabase || data.counters || {};

    logger.info(`Loaded content from ${contentPath}: ${Object.keys(cardDatabase).length} cards, ${Object.keys(tokenDatabase).length} tokens, ${deckFiles.length} deck files`);
  } catch (error) {
    logger.error('Failed to initialize content database', error as Error);
    throw error;
  }
}

/**
 * Get card definition by ID
 */
export function getCardDefinition(cardId: string): any {
  return cardDatabase[cardId] || null;
}

/**
 * Get token definition by ID
 */
export function getTokenDefinition(tokenId: string): any {
  return tokenDatabase[tokenId] || null;
}

/**
 * Get counter definition by ID
 */
export function getCounterDefinition(counterId: string): any {
  return countersDatabase[counterId] || null;
}

/**
 * Get all available deck files
 */
export function getDeckFiles() {
  return deckFiles;
}

/**
 * Update content database (for development/hot reload)
 */
export async function updateContent(newContent: any) {
  try {
    // Process ability text to convert literal \n to actual newlines
    const processAbilityText = (text: string): string => {
      if (typeof text !== 'string') {return text;}
      return text.replace(/\\n/g, '\n');
    };

    // Process card abilities
    const processCardAbilities = (cards: Record<string, any>) => {
      const processed: Record<string, any> = {};
      for (const [id, card] of Object.entries(cards)) {
        processed[id] = {
          ...card,
          ability: processAbilityText(card.ability),
          flavorText: processAbilityText(card.flavorText),
        };
      }
      return processed;
    };

    cardDatabase = processCardAbilities(newContent.cards || {});
    tokenDatabase = processCardAbilities(newContent.tokens || {});
    deckFiles = newContent.deckFiles || [];
    countersDatabase = newContent.counters || {};

    logger.info('Content database updated');
  } catch (error) {
    logger.error('Failed to update content database', error as Error);
    throw error;
  }
}

/**
 * Get all cards (for API endpoints)
 */
export function getAllCards() {
  return cardDatabase;
}

/**
 * Get all tokens (for API endpoints)
 */
export function getAllTokens() {
  return tokenDatabase;
}

/**
 * Get all counters (for API endpoints)
 */
export function getAllCounters() {
  return countersDatabase;
}

/**
 * Set card database (for deck data updates)
 */
export function setCardDatabase(cards: Record<string, any>) {
  cardDatabase = cards;
}

/**
 * Set token database (for deck data updates)
 */
export function setTokenDatabase(tokens: Record<string, any>) {
  tokenDatabase = tokens;
}

/**
 * Set deck files (for deck data updates)
 */
export function setDeckFiles(decks: any[]) {
  deckFiles = decks;
}