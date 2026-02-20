/**
 * Ready Status System for Card Abilities
 *
 * Each card has hidden statuses that control ability availability:
 * - readyDeploy: Card can use Deploy ability (once per game, after entering battlefield)
 * - readySetup: Card can use Setup ability (reset each turn)
 * - readyCommit: Card can use Commit ability (reset each turn)
 *
 * Status behavior:
 * 1. When card enters battlefield -> gains ready statuses ONLY for abilities it has
 * 2. At start of owner's turn -> card regains readySetup, readyCommit (if it has those abilities)
 * 3. When ability is used, cancelled, or shows "no target" -> card loses that ready status
 */

// Use any for Card to avoid type conflicts between client/server Card types
//eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Card = any

// Ready status types
export const READY_STATUS_DEPLOY = 'readyDeploy'
export const READY_STATUS_SETUP = 'readySetup'
export const READY_STATUS_COMMIT = 'readyCommit'

/**
 * Check if a card has a specific status
 */
export const hasStatus = (card: Card, type: string, playerId?: number): boolean => {
  if (!card.statuses) {
    return false
  }
  return card.statuses.some((s: any) => s.type === type && (playerId === undefined || s.addedByPlayerId === playerId))
}

/**
 * Check if a card has a ready status
 */
export const hasReadyStatus = (card: Card, statusType: string): boolean => {
  if (!card.statuses) {
    return false
  }
  return card.statuses.some((s: any) => s.type === statusType)
}

/**
 * Add a ready status to a card (if not already present)
 */
export const addReadyStatus = (card: Card, statusType: string, ownerId: number): void => {
  if (!card.statuses) {
    card.statuses = []
  }
  if (!card.statuses.some((s: any) => s.type === statusType)) {
    card.statuses.push({ type: statusType, addedByPlayerId: ownerId })
  }
}

/**
 * Remove a ready status from a card
 */
export const removeReadyStatus = (card: Card, statusType: string): void => {
  if (!card.statuses) {
    return
  }
  card.statuses = card.statuses.filter((s: any) => s.type !== statusType)
}

/**
 * Check if a card can activate an ability in the current phase
 */
export const canActivateAbility = (
  card: Card,
  activationType: 'deploy' | 'setup' | 'commit',
  currentPhase: number
): boolean => {
  // Deploy abilities (phase 0 - Draw/Main Phase)
  if (activationType === 'deploy') {
    return currentPhase === 0 && hasReadyStatus(card, READY_STATUS_DEPLOY)
  }

  // Setup abilities (phase 1 - Setup Phase)
  if (activationType === 'setup') {
    return currentPhase === 1 && hasReadyStatus(card, READY_STATUS_SETUP)
  }

  // Commit abilities (ONLY phase 3 - Commit Phase)
  if (activationType === 'commit') {
    return currentPhase === 3 && hasReadyStatus(card, READY_STATUS_COMMIT)
  }

  return false
}

/**
 * Check if card has a ready status for the current phase
 * Deploy takes priority over phase-specific abilities
 */
export const hasReadyStatusForPhase = (card: Card, currentPhase: number): boolean => {
  // Deploy takes priority in ALL phases
  if (hasReadyStatus(card, READY_STATUS_DEPLOY)) {
    return true
  }
  // Setup only in Setup phase
  if (currentPhase === 1 && hasReadyStatus(card, READY_STATUS_SETUP)) {
    return true
  }
  // Commit only in Commit phase
  if (currentPhase === 3 && hasReadyStatus(card, READY_STATUS_COMMIT)) {
    return true
  }
  return false
}

/**
 * Check if a card has ANY ready ability in the current phase
 * Deploy abilities work in ANY phase (once per game when card enters battlefield)
 * Setup abilities ONLY work in Setup phase (phase 1)
 * Commit abilities ONLY work in Commit phase (phase 3)
 *
 * PRIORITY: Deploy > Phase-specific ability
 * In Setup/Commit phases: Deploy takes priority over Setup/Commit abilities
 */
export const hasReadyAbilityInCurrentPhase = (
  card: Card,
  currentPhase: number,
  hasDeployAbility: boolean,
  hasSetupAbility: boolean,
  hasCommitAbility: boolean
): boolean => {
  // Deploy abilities work in ANY phase and take PRIORITY over phase-specific abilities
  if (hasDeployAbility && hasReadyStatus(card, READY_STATUS_DEPLOY)) {
    return true
  }
  // Setup abilities ONLY in Setup phase (when no Deploy ability)
  if (currentPhase === 1 && hasSetupAbility && hasReadyStatus(card, READY_STATUS_SETUP)) {
    return true
  }
  // Commit abilities ONLY in Commit phase (when no Deploy ability)
  if (currentPhase === 3 && hasCommitAbility && hasReadyStatus(card, READY_STATUS_COMMIT)) {
    return true
  }
  return false
}

/**
 * Remove all ready statuses from a card
 */
export const removeAllReadyStatuses = (card: Card): void => {
  if (!card.statuses) {
    return
  }
  card.statuses = card.statuses.filter((s: any) =>
    s.type !== READY_STATUS_DEPLOY &&
    s.type !== READY_STATUS_SETUP &&
    s.type !== READY_STATUS_COMMIT
  )
}

/**
 * Reset ready statuses for a new turn (regain setup and commit)
 */
export const resetReadyStatusesForTurn = (
  card: Card,
  ownerId: number,
  hasSetupAbility: boolean,
  hasCommitAbility: boolean
): void => {
  if (hasSetupAbility) {
    addReadyStatus(card, READY_STATUS_SETUP, ownerId)
  }
  if (hasCommitAbility) {
    addReadyStatus(card, READY_STATUS_COMMIT, ownerId)
  }
}

/**
 * Get the next available ability type after Deploy is used
 * Used for sequential ability execution within the same phase
 *
 * @param hasDeployAbility - Card has Deploy ability
 * @param hasSetupAbility - Card has Setup ability
 * @param hasCommitAbility - Card has Commit ability
 * @returns The next ability type to use, or null if none available
 */
export const getNextAbilityType = (
  _hasDeployAbility: boolean,
  hasSetupAbility: boolean,
  hasCommitAbility: boolean
): 'deploy' | 'setup' | 'commit' | null => {
  // After Deploy, check if there's a phase-specific ability available
  // This will be called after readyDeploy is removed
  if (hasSetupAbility) {
    return 'setup'
  }
  if (hasCommitAbility) {
    return 'commit'
  }
  return null
}
