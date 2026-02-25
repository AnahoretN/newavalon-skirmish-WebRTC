/**
 * Simple P2P - Упрощённая система P2P
 *
 * Два типа сообщений:
 * - ACTION: от клиента к хосту
 * - STATE: от хоста всем клиентам
 *
 * Экспортирует основные классы и типы
 */

export { SimpleHost } from './SimpleHost'
export { SimpleGuest } from './SimpleGuest'
export { applyAction } from './SimpleGameLogic'

export type {
  ActionMessage,
  StateMessage,
  PersonalizedState,
  PersonalizedPlayer,
  P2PMessage,
  ActionType,
  SimpleHostConfig,
  SimpleGuestConfig
} from './SimpleP2PTypes'

export type { GameState } from '../types'
