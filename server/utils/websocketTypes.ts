/**
 * @file Shared WebSocket type definitions
 */

import type { WebSocket } from 'ws';

/**
 * Extended WebSocket interface with additional properties
 */
export interface ExtendedWebSocket extends WebSocket {
  server?: any;
  playerId?: number;
  gameId?: string;
  playerToken?: string;
  isReconnecting?: boolean;
}
