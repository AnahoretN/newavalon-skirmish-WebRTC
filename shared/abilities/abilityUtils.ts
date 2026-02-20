/**
 * Ability Utility Functions
 *
 * Shared helper functions for ability system
 */

/* eslint-disable @typescript-eslint/no-unused-vars -- Type definitions may have params used only in implementations */

// Use any for Card to avoid type conflicts between client/server Card types

export type Card = any

/**
 * Check if two positions are adjacent
 */
export const checkAdj = (r1: number, c1: number, r2: number, c2: number): boolean => {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1
}

/**
 * Get the activation type from ability mode string
 */
export type AbilityActivationType = 'deploy' | 'setup' | 'commit'

/**
 * Interface for card ability definition
 */
export interface CardAbilityDefinition {
  baseId: string
  baseIdAlt?: string[]
  activationType: AbilityActivationType
  supportRequired?: boolean
  getAction: (_card: Card, _gameState: any, _ownerId: number, _coords: { row: number; col: number }) => any | null
}

/**
 * Create a targeting filter for hand cards
 */
export interface HandTargetFilter {
  excludeOwnerId?: number
  onlyOpponents?: boolean
  onlyFaceDown?: boolean
  targetOwnerId?: number
  targetType?: string
}

/**
 * Create a filter function for hand targeting
 */
export const createHandTargetFilter = (
  gameState: any,
  actorId: number,
  constraints: HandTargetFilter
// eslint-disable-next-line @typescript-eslint/no-unused-vars
): ((card: Card) => boolean) => {
  return (card: Card) => {
    // Check targetType if specified
    if (constraints.targetType && !card.types?.includes(constraints.targetType)) {
      return false
    }

    // Check excludeOwnerId (for abilities like Vigilant Spotter - exclude owner, target opponents)
    if (constraints.excludeOwnerId !== undefined && card.ownerId === constraints.excludeOwnerId) {
      return false
    }

    // Check onlyOpponents
    if (constraints.onlyOpponents) {
      const ownerPlayer = gameState.players?.find((p: any) => p.id === actorId)
      if (ownerPlayer && card.ownerId === ownerPlayer.id) {
        return false
      }
    }

    // Check onlyFaceDown (for hand targeting - only face-down cards)
    // In hand, face-down means card doesn't have Revealed status
    if (constraints.onlyFaceDown) {
      const isRevealed = card.statuses?.some((s: any) => s.type === 'Revealed')
      if (isRevealed) {
        return false
      }
    }

    // Check targetOwnerId if specified
    if (constraints.targetOwnerId !== undefined) {
      if (constraints.targetOwnerId === -1) {
        // -1 means opponents only
        const ownerPlayer = gameState.players?.find((p: any) => p.id === actorId)
        if (ownerPlayer && card.ownerId === ownerPlayer.id) {
          return false
        }
      } else if (card.ownerId !== constraints.targetOwnerId) {
        return false
      }
    }

    return true
  }
}
