# WebRTC P2P Architecture

## Overview

New Avalon: Skirmish uses WebRTC for peer-to-peer (P2P) communication between players, eliminating the need for a central game server during gameplay. The WebSocket server is only used for initial game discovery and signaling.

## Core Components

### 1. HostManager (`client/host/HostManager.ts`)
**Purpose**: Complete game state management for the host player.

**Responsibilities**:
- Manages all game state (phases, turns, rounds, scores)
- Handles guest connections and disconnections
- Broadcasts state changes to all guests
- Manages game logic (card play, abilities, scoring)
- Handles auto-reconnection for dropped guests
- Controls visual effects synchronization

**Key Methods**:
```typescript
getHostManager(config?: HostManagerConfig): HostManager  // Singleton access
initialize(): Promise<string>                              // Start as host
acceptGuest(peerId: string, gameState, playerId)          // Accept new guest
updateFromLocal(newState, excludePeerId?)                // Host action
updateFromGuest(playerId, guestState, excludePeerId?)     // Guest action
broadcastGameState(gameState, excludePeerId?)             // Send state to guests
```

### 2. GuestConnectionManager (`client/host/GuestConnection.ts`)
**Purpose**: Manages connection from guest to host.

**Responsibilities**:
- Connects to host via PeerJS
- Sends player actions to host
- Receives state updates from host
- Handles reconnection after disconnect
- Manages local player's deck data

**Key Methods**:
```typescript
connect(hostPeerId: string): Promise<void>               // Connect to host
connectAsReconnecting(hostPeerId, playerId): Promise<void>  // Reconnect
sendAction(actionType, actionData): boolean               // Send action to host
sendStateDelta(delta): boolean                            // Send optimized delta
sendStateToHost(gameState, localPlayerId): boolean        // Send full state
```

### 3. HostConnectionManager (`client/host/HostConnectionManager.ts`)
**Purpose**: Low-level WebRTC connection management for host.

**Responsibilities**:
- Manages PeerJS connections
- Handles data serialization (MessagePack, binary codec)
- Emits events for connection lifecycle
- Routes messages to appropriate handlers

### 4. HostStateManager (`client/host/HostStateManager.ts`)
**Purpose**: Centralized state management (used by HostManager).

**Responsibilities**:
- Maintains source of truth for game state
- Merges guest state updates
- Creates state deltas for efficient syncing
- Broadcasts personalized state to each guest

**Key Principle**: Host is the source of truth. All state changes flow through host.

### 5. WebrtcPeer (`client/host/WebrtcPeer.ts`)
**Purpose**: Low-level PeerJS wrapper.

**Responsibilities**:
- Wraps PeerJS library
- Handles peer ID generation
- Manages data connections
- Emits connection events

## Message Flow

### Host Action Flow
```
Host Player Action
    ↓
HostManager.updateFromLocal()
    ↓
HostStateManager.updateFromLocal()
    ↓
Create delta (if applicable)
    ↓
HostConnectionManager.broadcastGameState()
    ↓
Each guest receives personalized CARD_STATE
```

### Guest Action Flow
```
Guest Player Action
    ↓
GuestConnectionManager.sendAction() / sendStateDelta()
    ↓
Host receives message
    ↓
HostStateManager.updateFromGuest() / applyDeltaFromGuest()
    ↓
Merge guest state with host state
    ↓
HostConnectionManager.broadcastGameState()
    ↓
All guests (including sender) receive updated state
```

### Game Start Flow
```
All players click "Ready"
    ↓
useReadyCheck.playerReady()
    ↓
HostStateManager.setPlayerReady(playerId, true)
    ↓
When all ready: HostStateManager.startGame()
    ↓
Draw initial hands (6 cards) for ALL players
    ↓
Perform Preparation phase (7th card for starting player)
    ↓
HostConnectionManager.broadcastGameState()
    ↓
Each guest receives personalized hand/deck data
```

## Message Types

### Binary Codec Messages (Efficient)
- **CARD_STATE (0x02)**: Game state with personalized card data
  - Board: full card data with baseId
  - Players: hand/deck/discard for local player, sizes only for others
  - Phase info, scores, ready status

- **ABILITY_EFFECT (0x03)**: Visual effects
  - Highlights, floating text, targeting mode

- **SESSION_EVENT (0x04)**: Game events
  - Phase changes, turn changes, round end

### Legacy JSON Messages (Compatible)
- **ACTION**: Wrapper for action type/data
- **STATE_UPDATE**: Full game state (legacy)
- **STATE_DELTA**: Partial state update
- **PLAYER_READY**: Player marked as ready
- **HOST_READY**: Host marked as ready
- **JOIN_REQUEST**: Guest requesting to join
- **JOIN_ACCEPT**: Host accepting guest

## State Synchronization Strategy

### Personalized State
Each guest receives a **personalized** game state:
- **Local player**: Full hand, deck, discard data
- **Other players**: Only sizes (handSize, deckSize, discardSize)
- **Dummy players**: Full data (all players control dummies)

### Binary Encoding
Cards are encoded using `baseId` only:
- Host sends: `[{ baseId: "card_001", ownerId: 1 }, ...]`
- Guest reconstructs: Uses local `contentDatabase.json` to get full card data

This reduces message size by ~90% compared to sending full card objects.

## Connection Lifecycle

### Host Starting
```
MainMenu → "Host Game" button
    ↓
useWebRTC.initializeWebrtcHost()
    ↓
HostManager.initialize()
    ↓
WebrtcPeer creates new PeerJS instance
    ↓
Generate peerId (e.g., "uuid-1234")
    ↓
Broadcast peerId via BroadcastChannel API
    ↓
Share peerId link with guests
```

### Guest Joining
```
MainMenu → "Join Game" → Enter host peerId
    ↓
useWebRTC.connectAsGuest(hostPeerId)
    ↓
GuestConnectionManager.connect()
    ↓
WebrtcPeer.connect(hostPeerId)
    ↓
Send JOIN_REQUEST to host
    ↓
Host receives request, assigns playerId
    ↓
Host sends JOIN_ACCEPT with initial state
    ↓
Guest receives state, initializes game
```

### Reconnection
```
Connection lost (host F5, network issue)
    ↓
Guest detects disconnect
    ↓
Store reconnection data in localStorage
    ↓
Show reconnection modal
    ↓
Attempt reconnection every 1 second for 30 seconds
    ↓
Check BroadcastChannel for new host peerId (in case host F5)
    ↓
Reconnect with same playerId
    ↓
Host recognizes returning player, restores state
```

## Event System

Both HostManager and GuestConnectionManager emit events:

```typescript
type WebrtcEvent =
  | { type: 'peer_open', data: { peerId } }
  | { type: 'guest_connected', data: { peerId, playerId } }
  | { type: 'connected_to_host', data: { hostPeerId } }
  | { type: 'host_disconnected' | 'guest_disconnected' }
  | { type: 'message_received', data: { message } }
  | { type: 'error', data: error }
```

Subscribe via:
```typescript
manager.on((event: WebrtcEvent) => {
  // Handle event
})
```

## Persistence

### Host Data (`localStorage`)
```typescript
{
  peerId: string,
  isHost: true,
  playerName: string
}
```

### Guest Data (`localStorage`)
```typescript
{
  hostPeerId: string,
  playerId: number,
  playerName: string,
  timestamp: number,
  isHost: false
}
```

### Reconnection Data (`localStorage`)
```typescript
{
  hostPeerId: string,
  playerId: number,
  gameState: GameState,
  timestamp: number,
  isHost: false
}
```

## Broadcasting (Host Peer Discovery)

Host uses `BroadcastChannel` API to announce peerId to guests on same device/network:
```typescript
broadcastHostPeerId(peerId, gameId)
  → BroadcastChannel: 'webrtc_host_discovery'
  → All tabs receive: { type: 'host_peer_id', peerId, gameId }
```

This allows:
- Multiple tabs to discover host
- Guests to reconnect after host F5 (new peerId)
- Multi-device testing on same machine

## File Organization

```
client/host/
├── HostManager.ts              # Main host class (game logic + state)
├── HostConnectionManager.ts    # Host's WebRTC connections
├── HostStateManager.ts         # State management for host
├── GuestConnection.ts          # Guest's WebRTC connection
├── WebrtcPeer.ts              # PeerJS wrapper
├── PhaseManagement.ts          # Phase/round logic
├── VisualEffects.ts            # Visual effects broadcasting
├── TimerSystem.ts             # Inactivity timers
├── GameLogger.ts              # Action logging
├── GuestStateSync.ts          # Guest state sync helper
├── ReconnectionManager.ts     # Reconnection logic
├── WebrtcStatePersistence.ts  # localStorage helpers
└── types.ts                   # Shared WebRTC types
```

## Usage in Hooks

### `useWebRTC` Hook
```typescript
const webrtc = useWebRTC({
  webrtcManagerRef,
  webrtcIsHostRef,
  setWebrtcIsHost,
  setConnectionStatus,
  setWebrtcHostId,
  gameStateRef,
  localPlayerIdRef,
})

// Initialize as host
await webrtc.initializeWebrtcHost()

// Connect as guest
await webrtc.connectAsGuest(hostPeerId)

// Send action (guest only)
webrtc.sendWebrtcAction('PLAY_CARD', { cardId, position })
```

### `useGameState` Hook
```typescript
// Access manager
webrtcManagerRef.current.broadcastGameState(newState)
webrtcManagerRef.current.sendToGuest(peerId, message)
webrtcManagerRef.current.getStateManager()?.setPlayerReady(playerId, true)
```

### `useReadyCheck` Hook
```typescript
playerReady()  // Marks local player as ready, auto-starts game when all ready
```

## Important Notes

1. **Host is Source of Truth**: All game state changes must go through host
2. **Personalized State**: Each guest receives different state (privacy)
3. **Binary Encoding**: Use baseId encoding, not full card objects
4. **No Direct Guest-Guest Communication**: All messages go through host
5. **Reconnection is Automatic**: Guests reconnect after disconnect
6. **F5 Support**: Host can refresh page, guests reconnect automatically

## Common Issues

### Issue: Guest can't see other players' hand/deck sizes
**Solution**: Ensure `HostConnectionManager.broadcastGameState()` is called with personalized state for each guest.

### Issue: Game doesn't start when all players ready
**Solution**: Check that `HostStateManager.setPlayerReady()` is being called (not just setting `isReady: true`).

### Issue: Guests get wrong deck order
**Solution**: Ensure host sends full deck array in correct order, and guest preserves it.

### Issue: Reconnection fails after host F5
**Solution**: Host must broadcast new peerId via `BroadcastChannel` after F5.
