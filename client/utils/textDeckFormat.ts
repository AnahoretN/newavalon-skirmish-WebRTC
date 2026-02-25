/**
 * @file Text-based deck format parser and exporter
 * Format: "Nx Card Name" (quantity followed by 'x' and card name)
 * Lines are alphabetically sorted
 * Strict validation for security
 */

import { getCardDefinition, getAllCards } from '@/content'
import { resources } from '@/locales'
import type { CustomDeckFile } from '@/types'
import { MAX_DECK_SIZE } from './deckValidation'

export const MAX_LINE_LENGTH = 200

// Re-export MAX_DECK_SIZE from deckValidation for convenience
export { MAX_DECK_SIZE } from './deckValidation'
export const MAX_FILE_SIZE = 10 * 1024 // 10KB

/**
 * Result type for deck parsing
 */
export type TextDeckParseResult =
  | { isValid: true; deckFile: CustomDeckFile }
  | { isValid: false; error: string }

/**
 * Card quantity limits by type
 */
const QUANTITY_LIMITS = {
  HERO: 1,
  RARITY: 1,
  COMMAND: 2,
  DEFAULT: 3,
} as const

/**
 * Strict regex for validating deck line format
 * Only allows: digits + 'x' + spaces + unicode letters/numbers/symbols
 * No control characters, no executable code patterns
 */
const LINE_REGEX = /^(\d{1,2})x\s+([\p{L}\p{N}\p{M}\s'"\-.,&()]+)$/u

/**
 * Sanitize a string value - remove any potentially dangerous characters
 */
function sanitizeString(input: string): string {
  // Remove control characters except newlines and tabs
  // eslint-disable-next-line no-control-regex
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '')
  return sanitized.trim()
}

/**
 * Check if a string contains suspicious patterns (potential injection attempts)
 */
function containsSuspiciousPatterns(str: string): boolean {
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // event handlers like onclick=
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /eval\s*\(/i,
    /expression\s*\(/i,
    /@import/i,
    /\$\{/,
    /__proto__/i,
    /constructor\s*\[/,
  ]

  return suspiciousPatterns.some(pattern => pattern.test(str))
}

/**
 * Get the current language from localStorage
 */
function getCurrentLanguage(): string {
  if (typeof window === 'undefined') {return 'en'}
  const savedLang = localStorage.getItem('app_language')
  return (savedLang && savedLang in resources) ? savedLang : 'en'
}

/**
 * Get the localized name of a card for the current language
 * Falls back to English name if translation not available
 */
function getLocalizedCardName(cardId: string, language: string): string {
  const langResources = resources[language as keyof typeof resources] || resources.en
  const translation = langResources.cards[cardId]
  const cardDef = getCardDefinition(cardId)
  if (!cardDef) {return ''}

  return translation?.name || cardDef.name
}

/**
 * Build a map of localized card names to card IDs for reverse lookup
 * This is case-insensitive and ignores extra whitespace
 */
function buildCardNameMap(language: string): Map<string, string> {
  const map = new Map<string, string>()
  const allCards = getAllCards()

  for (const { id, card } of allCards) {
    if (!card.allowedPanels?.includes('DECK_BUILDER')) {continue}

    const localizedName = getLocalizedCardName(id, language)
    const key = localizedName.toLowerCase().trim().replace(/\s+/g, ' ')
    map.set(key, id)

    // Also map the English name as fallback for compatibility
    const englishKey = card.name.toLowerCase().trim().replace(/\s+/g, ' ')
    if (englishKey !== key) {
      map.set(englishKey, id)
    }
  }

  return map
}

/**
 * Parse a text deck file and convert it to CustomDeckFile
 * Strict validation: any invalid line causes complete rejection
 *
 * @param textContent - The raw text content of the deck file
 * @returns Parse result with either valid deck or error message
 */
export function parseTextDeckFormat(textContent: string): TextDeckParseResult {
  // Validate file size
  const fileSize = new Blob([textContent]).size
  if (fileSize > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024}KB.`
    }
  }

  // Check for suspicious patterns in entire file
  if (containsSuspiciousPatterns(textContent)) {
    return {
      isValid: false,
      error: 'File contains invalid content.'
    }
  }

  // Split into lines and filter empty lines
  const rawLines = textContent.split(/\r?\n/)
  const lines: string[] = []

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()
    if (trimmed.length === 0) {continue}

    // Check line length
    if (trimmed.length > MAX_LINE_LENGTH) {
      return {
        isValid: false,
        error: `Line too long (maximum ${MAX_LINE_LENGTH} characters).`
      }
    }

    // Check for suspicious patterns in each line
    if (containsSuspiciousPatterns(trimmed)) {
      return {
        isValid: false,
        error: `Invalid content in line: "${trimmed.substring(0, 30)}..."`
      }
    }

    lines.push(trimmed)
  }

  // Must have at least one card
  if (lines.length === 0) {
    return {
      isValid: false,
      error: 'File is empty or contains no valid cards.'
    }
  }

  // Build card name lookup map
  const language = getCurrentLanguage()
  const cardNameMap = buildCardNameMap(language)
  const cardEntries = new Map<string, number>()
  let totalCards = 0

  // Parse each line
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]

    // Validate line format with regex
    const match = line.match(LINE_REGEX)
    if (!match) {
      return {
        isValid: false,
        error: `Invalid format on line ${lineNum + 1}: "${line}". Expected format: "Nx Card Name"`
      }
    }

    const quantityStr = match[1]
    const cardName = sanitizeString(match[2])

    // Parse and validate quantity
    const quantity = parseInt(quantityStr, 10)
    if (isNaN(quantity) || quantity < 1 || quantity > 99) {
      return {
        isValid: false,
        error: `Invalid quantity on line ${lineNum + 1}: "${quantityStr}". Must be between 1 and 99.`
      }
    }

    // Validate card name is not empty
    if (cardName.length === 0) {
      return {
        isValid: false,
        error: `Empty card name on line ${lineNum + 1}.`
      }
    }

    // Look up card by name (case-insensitive)
    const nameKey = cardName.toLowerCase().trim().replace(/\s+/g, ' ')
    const cardId = cardNameMap.get(nameKey)

    if (!cardId) {
      return {
        isValid: false,
        error: `Card not found: "${cardName}"`
      }
    }

    // Verify card actually exists in database
    const cardDef = getCardDefinition(cardId)
    if (!cardDef) {
      return {
        isValid: false,
        error: `Card definition error: "${cardName}"`
      }
    }

    // Check for duplicates in the file
    if (cardEntries.has(cardId)) {
      return {
        isValid: false,
        error: `Duplicate card entry: "${cardName}"`
      }
    }

    // Validate card is allowed in deck builder
    if (!cardDef.allowedPanels?.includes('DECK_BUILDER')) {
      return {
        isValid: false,
        error: `Card not allowed in decks: "${cardName}"`
      }
    }

    // Add to entries
    cardEntries.set(cardId, quantity)
    totalCards += quantity

    // Check deck size limit
    if (totalCards > MAX_DECK_SIZE) {
      return {
        isValid: false,
        error: `Deck exceeds ${MAX_DECK_SIZE} card limit.`
      }
    }
  }

  // Validate quantity limits based on card types
  for (const [cardId, quantity] of cardEntries.entries()) {
    const cardDef = getCardDefinition(cardId)
    if (!cardDef) {continue}

    const isHero = cardDef.types?.includes('Hero')
    const isRarity = cardDef.types?.includes('Rarity')
    const isCommand = cardDef.types?.includes('Command')

    // Determine limit and type name
    let maxQty: 1 | 2 | 3 = QUANTITY_LIMITS.DEFAULT
    let cardType = ''
    if (isHero || isRarity) {
      maxQty = QUANTITY_LIMITS.HERO
      cardType = isHero ? 'Hero' : 'Rarity'
    }
    else if (isCommand) {
      maxQty = QUANTITY_LIMITS.COMMAND
      cardType = 'Command'
    }

    if (quantity > maxQty) {
      const cardName = getLocalizedCardName(cardId, language)
      return {
        isValid: false,
        error: `Invalid quantity for "${cardName}" (${cardType}): ${quantity} (maximum ${maxQty} per deck)`
      }
    }
  }

  // Build the custom deck file
  const cards = Array.from(cardEntries.entries())
    .map(([cardId, quantity]) => ({ cardId, quantity }))

  const deckFile: CustomDeckFile = {
    deckName: 'Imported Deck',
    cards
  }

  return {
    isValid: true,
    deckFile
  }
}

/**
 * Export a deck to text format
 * Format: "Nx Card Name" sorted alphabetically
 *
 * @param deckFile - The deck file to export
 * @returns Text content in the specified format
 */
export function exportToTextDeckFormat(deckFile: CustomDeckFile): string {
  const lines: string[] = []
  const language = getCurrentLanguage()

  // Build list of cards with localized names
  const cardEntries: { name: string; quantity: number }[] = []

  for (const { cardId, quantity } of deckFile.cards) {
    const cardName = getLocalizedCardName(cardId, language)
    if (cardName) {
      cardEntries.push({ name: cardName, quantity })
    }
  }

  // Sort alphabetically (case-insensitive)
  cardEntries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  // Generate lines in "Nx Card Name" format
  for (const { name, quantity } of cardEntries) {
    lines.push(`${quantity}x ${name}`)
  }

  return lines.join('\n')
}
