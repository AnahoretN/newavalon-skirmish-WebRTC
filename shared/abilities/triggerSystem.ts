/**
 * Trigger System for Passive Abilities
 *
 * Handles passive abilities that trigger in response to game events.
 * Example: Vigilant Spotter - "When your opponent plays a revealed card, gain 2 points."
 */

// Use 'any' for types to avoid circular dependencies
type CardAny = any
type GameStateAny = any
type TriggerDefinition = any

/**
 * Trigger event types that can be listened to
 */
export type TriggerEventType =
  | 'OPPONENT_PLAYS_REVEALED_CARD'
  | 'OPPONENT_PLAYS_CARD_WITH_STATUS'
  | 'CARD_ENTERS_BATTLEFIELD'
  | 'CARD_DESTROYED'

/**
 * Effect types for trigger responses
 */
export interface TriggerEffect {
  type: 'MODIFY_SCORE' | 'DRAW_CARD' | 'CREATE_TOKEN' | 'MODIFY_POWER'
  points?: number
  target?: 'self' | 'opponent' | 'all'
  tokenType?: string
  powerModifier?: number
}

/**
 * Active trigger registered on the board
 */
export interface ActiveTrigger {
  cardId: string
  cardBaseId: string
  ownerId: number
  coords: { row: number; col: number }
  trigger: TriggerDefinition
  supportRequired: boolean
}

/**
 * Event data for card placement events
 */
export interface CardPlacedEvent {
  card: CardAny
  coords: { row: number; col: number }
  playerId: number
  source: 'hand' | 'deck' | 'discard' | 'announced' | 'board'
}

/**
 * Result of trigger execution
 */
export interface TriggerResult {
  triggerOwnerId: number
  effectType: string
  points?: number
  cardsToDraw?: number
  message?: string
  triggerCardCoords?: { row: number; col: number } // Coordinates of the card that triggered the effect
}

/**
 * Card lookup function type - used to get card definitions
 */
// eslint-disable-next-line no-unused-vars
export type CardLookupFn = (baseId: string) => { ABILITIES?: any[] } | null

/**
 * Check if a card has the Revealed status
 */
function hasRevealedStatus(card: CardAny): boolean {
  if (!card.statuses || card.statuses.length === 0) {
    return false
  }
  return card.statuses.some((s: any) => s.type === 'Revealed')
}

/**
 * Check if a card has a specific status
 */
function hasStatusType(card: CardAny, statusType: string): boolean {
  if (!card.statuses || card.statuses.length === 0) {
    return false
  }
  return card.statuses.some((s: any) => s.type === statusType)
}

/**
 * Get all active triggers from the board
 * Scans the board for cards with TRIGGER_ON_EVENT abilities
 */
export function getActiveTriggers(
  gameState: GameStateAny,
  cardLookup: CardLookupFn
): ActiveTrigger[] {
  const triggers: ActiveTrigger[] = []

  if (!gameState.board) {
    console.log('[getActiveTriggers] No board found')
    return triggers
  }

  gameState.board.forEach((row: any[], rowIndex: number) => {
    row.forEach((cell: any, colIndex: number) => {
      const card = cell.card
      if (!card || !card.baseId) {
        return
      }

      // Look up the card definition to check for trigger abilities
      const cardDef = cardLookup(card.baseId)
      if (!cardDef || !cardDef.ABILITIES) {
        return
      }

      cardDef.ABILITIES.forEach((ability: any) => {
        if (ability.action === 'TRIGGER_ON_EVENT' && ability.details?.eventType) {
          console.log('[getActiveTriggers] Found trigger on', card.baseId, 'eventType:', ability.details.eventType, 'ownerId:', card.ownerId)
          triggers.push({
            cardId: card.id,
            cardBaseId: card.baseId,
            ownerId: card.ownerId,
            coords: { row: rowIndex, col: colIndex },
            trigger: ability.details,
            supportRequired: ability.supportRequired || false
          })
        }
      })
    })
  })

  console.log('[getActiveTriggers] Found', triggers.length, 'active triggers')
  return triggers
}

/**
 * Check and execute triggers when a card is placed on the board
 *
 * @param gameState - Current game state
 * @param event - The card placement event
 * @param cardLookup - Function to look up card definitions by baseId
 * @returns Array of trigger results to apply
 */
export function checkTriggersOnCardPlaced(
  gameState: GameStateAny,
  event: CardPlacedEvent,
  cardLookup: CardLookupFn
): TriggerResult[] {
  console.log('[checkTriggersOnCardPlaced] Checking triggers for card:', event.card.baseId, 'playerId:', event.playerId, 'statuses:', event.card.statuses)
  const results: TriggerResult[] = []
  const activeTriggers = getActiveTriggers(gameState, cardLookup)

  activeTriggers.forEach((trigger) => {
    console.log('[checkTriggersOnCardPlaced] Checking trigger:', trigger.cardBaseId, 'ownerId:', trigger.ownerId, 'eventType:', trigger.trigger.eventType, 'supportRequired:', trigger.supportRequired)

    // Skip triggers owned by the same player who placed the card
    if (trigger.ownerId === event.playerId) {
      console.log('[checkTriggersOnCardPlaced] Skipping - same player')
      return
    }

    // Check if support is required and available
    if (trigger.supportRequired) {
      const hasSupport = checkSupportAvailable(gameState, trigger.ownerId, trigger.coords)
      console.log('[checkTriggersOnCardPlaced] Has support:', hasSupport)
      if (!hasSupport) {
        return
      }
    }

    // Check if trigger matches the event
    if (!doesTriggerMatchEvent(trigger.trigger, event)) {
      console.log('[checkTriggersOnCardPlaced] Trigger does not match event')
      return
    }

    console.log('[checkTriggersOnCardPlaced] TRIGGER MATCHED! Executing...')
    // Execute the trigger effect
    results.push(executeTriggerEffect(trigger))
  })

  console.log('[checkTriggersOnCardPlaced] Returning', results.length, 'results')
  return results
}

/**
 * Check if a support card is adjacent to the trigger card
 */
function checkSupportAvailable(
  gameState: GameStateAny,
  ownerId: number,
  coords: { row: number; col: number }
): boolean {
  const { row, col } = coords
  const adjacentOffsets = [
    { dr: -1, dc: 0 }, // up
    { dr: 1, dc: 0 },  // down
    { dr: 0, dc: -1 }, // left
    { dr: 0, dc: 1 },  // right
  ]

  for (const offset of adjacentOffsets) {
    const newRow = row + offset.dr
    const newCol = col + offset.dc

    // Check bounds
    if (newRow < 0 || newRow >= gameState.board.length ||
        newCol < 0 || newCol >= gameState.board[0].length) {
      continue
    }

    const cell = gameState.board[newRow][newCol]
    if (cell.card && cell.card.ownerId === ownerId) {
      return true
    }
  }

  return false
}

/**
 * Check if a trigger matches the given event
 */
function doesTriggerMatchEvent(trigger: TriggerDefinition, event: CardPlacedEvent): boolean {
  switch (trigger.eventType) {
    case 'OPPONENT_PLAYS_REVEALED_CARD':
      return hasRevealedStatus(event.card)

    case 'OPPONENT_PLAYS_CARD_WITH_STATUS':
      if (trigger.statusFilter) {
        return hasStatusType(event.card, trigger.statusFilter)
      }
      return false

    case 'CARD_ENTERS_BATTLEFIELD':
      return true // Any card entering battlefield

    case 'CARD_DESTROYED':
      return false // Handled by a different event type

    default:
      return false
  }
}

/**
 * Execute the effect of a trigger
 */
function executeTriggerEffect(trigger: ActiveTrigger): TriggerResult {
  const { effect } = trigger.trigger
  const result: TriggerResult = {
    triggerOwnerId: trigger.ownerId,
    effectType: effect.type,
    triggerCardCoords: trigger.coords
  }

  switch (effect.type) {
    case 'MODIFY_SCORE':
      result.points = effect.points || 0
      result.message = `${trigger.cardBaseId} triggered: +${effect.points} points`
      break

    case 'DRAW_CARD':
      // Cards to draw would be specified in effect
      result.message = `${trigger.cardBaseId} triggered: draw card`
      break

    case 'CREATE_TOKEN':
      result.message = `${trigger.cardBaseId} triggered: create ${effect.tokenType} token`
      break

    case 'MODIFY_POWER':
      result.message = `${trigger.cardBaseId} triggered: modify power`
      break

    default:
      console.warn(`Unknown trigger effect type: ${effect.type}`)
  }

  return result
}
