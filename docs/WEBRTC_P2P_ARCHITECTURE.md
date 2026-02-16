# WebRTC P2P System - Architecture Documentation

## Overview

The New Avalon: Skirmish WebRTC P2P system enables peer-to-peer multiplayer gaming without a central server. Players connect directly to each other using WebRTC, with one player acting as the host that manages game state and broadcasts to all guests.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [File Structure](#file-structure)
3. [Message Types](#message-types)
4. [Connection Flow](#connection-flow)
5. [State Synchronization](#state-synchronization)
6. [Game Session Synchronization](#game-session-synchronization)
7. [Known Issues](#known-issues)
8. [Recommendations](#recommendations)

---

## Architecture Overview

### Dual System Architecture

The codebase currently contains **two parallel WebRTC systems**:

```
┌─────────────────────────────────────────────────────────────────┐
│                     WebRTC P2P System                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐    ┌──────────────────────────┐   │
│  │   Legacy System       │    │   New Codec System       │   │
│  │   (Active)           │    │   (TODO: Migration)      │   │
│  └──────────────────────┘    └──────────────────────────┘   │
│                                                                │
│  • webrtcManager.ts           • gameCodec.ts                │
│  • useWebRTC.ts               • webrtcSerialization.ts     │
│  • useGameState.ts (partial)  • abilityMessages.ts          │
│  • JSON/MessagePack           • sessionMessages.ts         │
│  • Delta compression          • Binary encoding            │
└─────────────────────────────────────────────────────────────────┘
```

### Host-Guest Model

```
                    ┌──────────────────┐
                    │     Host         │
                    │  (Player 1)      │
                    │  Source of Truth │
                    └─────────┬──────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
                ▼             ▼             ▼
         ┌─────────┐   ┌─────────┐   ┌─────────┐
         │ Guest 1 │   │ Guest 2 │   │ Guest 3 │
         │ (Player2)│   │ (Player3)│   │ (Player4)│
         └─────────┘   └─────────┘   └─────────┘
                │             │             │
                └─────────────┴─────────────┘
                    (All receive same state)
```

**Key Principles:**
- **Host Authority**: Host is the "source of truth" for game state
- **Personalized Broadcasting**: Each guest receives state customized for them (their hand visible, others' hands hidden)
- **Guest Actions**: Guests send actions to host, host processes and broadcasts result
- **State Immutability**: State updates create new state objects (React pattern)

---

## File Structure

### Core WebRTC Files

| File | Description | Lines |
|------|-------------|-------|
| `client/utils/webrtcManager.ts` | Main WebRTC manager using PeerJS | ~1200 |
| `client/hooks/core/useWebRTC.ts` | React hook for WebRTC functionality | ~150 |
| `client/utils/webrtcSerialization.ts` | Binary serialization (MessagePack + custom) | ~500 |
| `client/utils/webrtcMessageHandlers.ts` | Handlers for new codec messages | ~300 |
| `client/utils/gameCodec.ts` | Optimized binary encoding | ~800 |
| `client/utils/abilityMessages.ts` | Binary encoding for abilities | ~200 |
| `client/utils/sessionMessages.ts` | Binary encoding for session events | ~150 |
| `client/types/codec.ts` | Type definitions for codec | ~100 |

### Host Module (Advanced Architecture)

| File | Description | Lines |
|------|-------------|-------|
| `client/host/HostManager.ts` | Main orchestrator combining all host systems | ~200 |
| `client/host/HostConnectionManager.ts` | Connection management with guest tracking | ~400 |
| `client/host/HostStateManager.ts` | Centralized state management for host | ~300 |
| `client/host/GuestStateSync.ts` | Guest state synchronization to host | ~250 |
| `client/host/HostMessageHandler.ts` | Message routing and processing | ~600 |
| `client/host/VisualEffects.ts` | Visual effects broadcasting | ~200 |
| `client/host/TimerSystem.ts` | Disconnect/inactivity timers | ~150 |
| `client/host/GameLogger.ts` | Game action logging | ~100 |
| `client/host/PhaseManagement.ts` | Phase transitions and round management | ~400 |
| `client/host/ReconnectionManager.ts` | Reconnection handling | ~200 |
| `client/host/WebrtcStatePersistence.ts` | Session persistence for F5 restore | ~150 |
| `client/host/types.ts` | Host-specific type definitions | ~100 |

### Game State Integration

| File | WebRTC-Related Functions |
|------|---------------------------|
| `client/hooks/useGameState.ts` | ~3000 lines (WebRTC integration points) |
| `client/hooks/core/useDeckManagement.ts` | Deck change broadcasting |
| `client/hooks/core/useReadyCheck.ts` | Ready check via WebRTC |
| `client/hooks/core/usePhaseManagement.ts` | Phase management via WebRTC |

---

## Message Types

### Connection Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `JOIN_REQUEST` | Guest → Host | Initial connection request with optional `preferredDeck` |
| `JOIN_ACCEPT_MINIMAL` | Host → Guest | Minimal accept with player ID and basic state |
| `JOIN_ACCEPT_BINARY` | Host → Guest | Accept with binary codec support |
| `JOIN_ACCEPT` | Host → Guest | Full accept with complete state (legacy) |
| `PLAYER_LEAVE` | Any → Host | Player leaving the game |
| `PLAYER_DISCONNECTED` | Host → Guests | Player disconnected (30s reconnect window) |
| `PLAYER_RECONNECTED` | Host → Guests | Player successfully reconnected |
| `GUEST_DISCONNECTED` | Host → Guests | Guest disconnected permanently |
| `REQUEST_DECK_DATA` | Host → Guests | Host requests deck data from guests (F5 restore) |

### State Synchronization Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `STATE_UPDATE` | Guest → Host | Full state update from guest |
| `STATE_UPDATE_COMPACT` | Host → Guests | Compact state with card IDs |
| `STATE_DELTA` | Host → Guests | Only changed portions of state |
| `ACTION` | Guest → Host | Wrapper for guest actions (deck changes, etc.) |
| `DECK_DATA_UPDATE` | Guest → Host | Guest sends deck data to host |

### Game Management Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `CHANGE_PLAYER_DECK` | Both → All | Deck selection change broadcast |
| `REQUEST_DECK_VIEW` | Guest → Host | Request to view another player's deck |
| `DECK_VIEW_DATA` | Host → Guest | Deck data response |
| `START_READY_CHECK` | Host → Guests | Start ready check phase |
| `CANCEL_READY_CHECK` | Host → Guests | Cancel ready check |
| `PLAYER_READY` | Both → All | Player marked as ready |
| `HOST_READY` | Host → Guests | Host marked as ready |
| `GAME_START` | Host → Guests | Game starting (trigger initial draw) |

### Visual Effects Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `TRIGGER_HIGHLIGHT` | Both → All | Highlight cell on board |
| `TRIGGER_NO_TARGET` | Both → All | Show "no target" overlay |
| `TRIGGER_FLOATING_TEXT` | Both → All | Show floating text effect |
| `TRIGGER_FLOATING_TEXT_BATCH` | Both → All | Batch floating text |
| `SET_TARGETING_MODE` | Both → All | Set targeting mode for all players |
| `CLEAR_TARGETING_MODE` | Both → All | Clear targeting mode |
| `SYNC_VALID_TARGETS` | Host → Guests | Sync valid targets for abilities |

### Phase Management Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `NEXT_PHASE` | Both → All | Advance to next phase |
| `PREV_PHASE` | Both → All | Go to previous phase |
| `SET_PHASE` | Both → All | Set specific phase |
| `TOGGLE_ACTIVE_PLAYER` | Both → All | Toggle active player |
| `START_NEXT_ROUND` | Both → All | Start next round |
| `START_NEW_MATCH` | Both → All | Start new match |

### Game Settings Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `SET_GAME_MODE` | Host → Guests | Set game mode (Skirmish, Draft, etc.) |
| `SET_GAME_PRIVACY` | Host → Guests | Set game privacy (public/private) |
| `ASSIGN_TEAMS` | Host → Guests | Team assignments |
| `SET_GRID_SIZE` | Host → Guests | Set active grid size |

### New Codec System Messages (Binary)

| Type | Hex | Description |
|------|-----|-------------|
| `CARD_REGISTRY` | 0x01 | Card definitions sent once per connection |
| `CARD_STATE` | 0x02 | Full game state in binary format |
| `ABILITY_EFFECT` | 0x03 | Visual effects (highlights, floating text, etc.) |
| `SESSION_EVENT` | 0x04 | Game events (player connected, phase change, etc.) |

---

## Connection Flow

### Guest Join Flow

```
Guest                          Host
  │                              │
  │  1. Initialize WebRTC       │
  │  2. Connect to hostId       │
  │                              │
  │────── JOIN_REQUEST ────────→│
  │     {preferredDeck}          │
  │                              │
  │←──── JOIN_ACCEPT_MINIMAL ─────│
  │     {playerId,               │
  │      basicState,             │
  │      hostDeckData}           │
  │                              │
  │  3. Create local deck        │
  │  4. Send DECK_DATA_UPDATE ──→│
  │                              │
  │←──── STATE_UPDATE_COMPACT ────│
  │     (Full game state)        │
  │                              │
  │  5. Ready to play!           │
```

### Auto-Restore Flow (F5 Refresh)

```
Guest/Host                      Host (on reconnect)
  │                              │
  │  1. F5 Refresh              │
  │  2. Check localStorage     │
  │  3. Has saved session?      │
  │                              │
  │────── RECONNECT ─────────→│
  │     {playerToken,           │
  │      lastGameState}          │
  │                              │
  │←──── ACCEPT_MINIMAL ────────│
  │     (Resume session)         │
  │                              │
  │  4. If host: REQUEST_DECK_DATA ─→│ (request deck data from guests)
  │  5. Guests send DECK_DATA_UPDATE │
  │                              │
  │←──── STATE_UPDATE_COMPACT ────│
  │     (Restore full state)      │
```

---

## State Synchronization

### Personalized State Broadcasting

The host creates **different state for each guest** based on what they should see:

```typescript
// For Player 2 (recipient), sending to Player 2:
{
  players: [
    { id: 1,  // Host (other player)
      hand: [
        {id: "card1", isCardBack: true, ...},  // Face-down
        {id: "card2", isCardBack: true, ...}   // Face-down
      ],
      deck: [],  // Empty (size sent separately)
      deckSize: 24
    },
    { id: 2,  // Player 2 (self)
      handCards: [  // Compact card data with baseId
        {id: "card3", baseId: "cardA", power: 5, ...},
        {id: "card4", baseId: "cardB", power: 3, ...}
      ],
      deckCards: [...],  // Full deck with baseId
      handSize: 2,
      deckSize: 30
    }
  ]
}
```

### Card Reconstruction

Guests reconstruct full cards from `baseId` using local contentDatabase:

```typescript
const reconstructCard = (compactCard: any) => {
  const cardDef = getCardDefinition(compactCard.baseId)
  return {
    ...cardDef,  // Spread all card properties (name, ability, etc.)
    id: compactCard.id,
    baseId: compactCard.baseId,
    power: compactCard.power,
    statuses: compactCard.statuses || []
  }
}
```

### Deck Synchronization

When player changes deck:

1. **Player selects deck** → `changePlayerDeck(deckType)`
2. **Create new deck** locally using `createDeck()`
3. **Send compact data**:
   - Guest: `sendWebrtcAction('CHANGE_PLAYER_DECK', {deck, deckType})`
   - Host: `broadcastToGuests('CHANGE_PLAYER_DECK', {deck, deckType})`
4. **Receiver reconstructs** full cards from `baseId`

---

## Game Session Synchronization

### Complete Game State Elements

For a fully synchronized game session, the following must be synchronized:

#### 1. Player Data
- [x] `player.id` - Unique player identifier
- [x] `player.name` - Player name
- [x] `player.color` - Player color
- [x] `player.teamId` - Team assignment
- [x] `player.score` - Victory points
- [x] `player.isReady` - Ready status
- [x] `player.isDummy` - AI-controlled flag
- [x] `player.isDisconnected` - Disconnection status
- [x] `player.selectedDeck` - Selected deck type

#### 2. Card Collections
- [x] `player.hand` - Cards in hand (personalized per player)
- [x] `player.deck` - Deck (personalized per player)
- [x] `player.discard` - Discard pile (personalized per player)
- [x] `player.boardHistory` - Cards played to board
- [x] `player.announcedCard` - Currently announced card

#### 3. Board State
- [x] `gameState.board` - 6x6 grid with cells
- [x] `cell.card` - Card on board (with all properties)
- [x] `card.statuses` - Status effects on board cards
- [x] `card.powerModifier` - Power modifications

#### 4. Game Flow
- [x] `gameState.currentPhase` - Current phase index
- [x] `gameState.activePlayerId` - Active player
- [x] `gameState.startingPlayerId` - Starting player for round
- [x] `gameState.currentRound` - Current round number
- [x] `gameState.isGameStarted` - Game started flag
- [x] `gameState.isReadyCheckActive` - Ready check in progress
- [x] `gameState.gameMode` - Game mode
- [gameState.isPrivate] - Privacy setting (NOT synced via WebRTC)

#### 5. Visual Effects
- [x] Highlighted cells (for targeting)
- [x] Floating text effects
- [x] Targeting mode (what's being targeted)
- [x] "No target" overlay
- [ ] **ISSUE**: Guest-placed tokens on host's cards not synced

#### 6. Turn Information
- [x] `gameState.roundWinners` - Round winners map
- [x] `gameState.gameWinner` - Overall winner (if any)

#### 7. Ability System
- [x] Ability activation events
- [x] Ability mode changes
- [x] Ready statuses on cards
- [ ] **TODO**: Full ability synchronization across clients

---

## Known Issues

### 1. Token Synchronization (Guest → Host)

**Problem**: When a guest places a token on the host's card in hand, the token appears locally on the guest's client but doesn't sync to the host.

**Root Cause**: The `STATE_UPDATE_COMPACT` message from guest to host includes hand data, but token (`statuses`) changes on host's cards may not be properly merged.

**Location**: `client/hooks/useGameState.ts` - STATE_UPDATE handler around line 1494

**Impact**: Medium - Guests cannot affect host's cards with token abilities

### 2. Dual System Complexity

**Problem**: Two parallel systems (legacy JSON and new binary codec) create maintenance burden.

**Evidence**:
- `webrtcManager.ts` has both JSON and MessagePack serialization
- TODO comment at line 898: "Switch to new codec system after fixing card registry loading issue"
- Duplicate message type definitions

**Impact**: High - Increases code complexity, potential for bugs

### 3. Code Duplication

**Problem**: State broadcasting logic exists in multiple places:
- `client/utils/webrtcManager.ts` - `broadcastGameState()`
- `client/host/HostConnectionManager.ts` - `createPersonalizedGameState()`

**Impact**: Medium - Changes must be made in multiple places

### 4. Message Type Definition Duplication

**Problem**: Message types defined in:
- `client/utils/webrtcManager.ts` - `WebrtcMessageType` union
- `client/host/types.ts` - `HostMessageType` enum

**Impact**: Low - Type inconsistencies possible

### 5. Card Registry Loading Issue

**Problem**: New binary codec system blocked by card registry loading problem.

**Location**: `client/hooks/useGameState.ts` line 898

**Impact**: High - Prevents optimization

### 6. Incomplete Token Sync

**Problem**: When guest adds token to host's card, token appears locally but not on host.

**Evidence**: User reported "жетоны ревила появляются только локально у игрока 2"

**Impact**: High - Breaks gameplay mechanics

---

## Recommendations

### Priority 1: Fix Token Synchronization

**Issue**: Guest cannot place tokens on host's cards

**Solution**: Ensure `STATE_UPDATE` from guest properly merges statuses onto host's card states.

**Files to modify**:
- `client/hooks/useGameState.ts` - STATE_UPDATE handler
- Consider adding explicit token sync message

### Priority 2: Complete Codec Migration

**Issue**: Dual system complexity

**Steps**:
1. Fix card registry loading issue
2. Migrate all message handlers to new codec
3. Remove legacy serialization code
4. Update all references to use binary format

### Priority 3: Consolidate Message Types

**Action**: Create single source of truth for message types

**Proposed structure**:
```
client/shared/messages/
  ├── types.ts          # All message type definitions
  ├── handlers.ts        # Message handlers
  └── serializers.ts     # Serialization/deserialization
```

### Priority 4: Simplify State Broadcasting

**Action**: Choose ONE system:
- Option A: Use `HostManager` module exclusively
- Option B: Use `webrtcManager.ts` exclusively
- Remove duplicate logic

### Priority 5: Add Acknowledgment System

**Problem**: No guarantee that critical messages arrive

**Solution**: Add ACK/NACK for:
- Deck changes
- Game state updates
- Token placements

### Priority 6: Implement Proper Diff Algorithm

**Current**: "Delta compression" sends some changed data
**Ideal**: Use proper diff algorithm (e.g., jsondiffpatch)

**Benefits**:
- Smaller messages
- Faster synchronization
- Better performance

### Priority 7: Add Connection Quality Monitoring

**Features**:
- Ping/pong for latency
- Message delivery confirmation
- Automatic quality adjustment

### Priority 8: Document Message Flow

**Action**: Create sequence diagrams for:
- Guest joining
- Game start
- Turn progression
- Card play
- Phase changes
- Reconnection

---

## Future Enhancements

### 1. Spectator Mode
- Allow read-only connections
- No player slot consumption
- Full visibility of all hands

### 2. Replay System
- Record game sessions
- Playback functionality
- State snapshot/restore

### 3. Tournament Mode
- Best-of-three matches
- Sideboard management
- Tournament bracket integration

### 4. Chat System
- In-game chat
- Emote support
- Admin commands

### 5. Save/Load Game
- Mid-game save
- Load saved games
- Resume later

---

## Performance Considerations

### Current Optimizations

1. **Personalized Broadcasting**: Each guest receives only what they need
2. **Delta Compression**: Only changes are sent
3. **MessagePack**: Binary format smaller than JSON
4. **Card Registry**: Reference cards by index instead of full data

### Potential Optimizations

1. **Binary Codec Migration**: Complete migration to new codec system
2. **Batch Updates**: Combine multiple updates into single message
3. **Compression**: Apply compression to large payloads
4. **WebSocket Fallback**: Hybrid P2P/WebRTC for reliability

---

## Security Considerations

### Current Implementation

1. **No Authentication**: Any peer with hostId can connect
2. **No Encryption**: WebRTC provides encryption but no application-layer auth
3. **No Validation**: Clients trust host's state implicitly

### Recommendations

1. **Player Tokens**: Generate tokens on connection, validate on actions
2. **Host Authentication**: Password-protected hosting
3. **Action Validation**: Validate all actions server-side (or host-side in P2P)
4. **Rate Limiting**: Prevent spam of actions

---

## Testing Checklist

### Connection Tests
- [ ] Guest can join host
- [ ] Multiple guests can join simultaneously
- [ ] Guest reconnect after disconnect (30s window)
- [ ] Host F5 refresh maintains game
- [ ] Guest F5 refresh reconnects successfully

### State Sync Tests
- [ ] Deck changes sync to all players
- [ ] Hand draws sync correctly
- [ ] Card plays sync board state
- [ ] Phase changes sync to all
- [ ] Score updates sync
- [ ] Visual effects sync (highlights, floating text)

### Edge Cases
- [ ] Guest joins during game start
- [ ] Guest joins mid-turn
- [ ] Host disconnects during game
- [ ] Multiple guests disconnect simultaneously
- [ ] Large deck sizes (30+ cards)
- [ ] Many tokens on cards

### Performance Tests
- [ ] Message size under limits
- [ ] State updates complete in <100ms
- [ ] No memory leaks during long sessions
- [ ] Reconnection works after 30+ minutes

---

## Glossary

| Term | Definition |
|------|------------|
| **Host** | Player who initialized the game, manages state, broadcasts to guests |
| **Guest** | Player who connected to host, receives state, sends actions |
| **PeerJS** | WebRTC wrapper library used for P2P connections |
| **baseId** | Card identifier used to reconstruct full card from contentDatabase |
| **Compact Card Data** | Minimal card info (id, baseId, power, statuses) for network efficiency |
| **Personalized State** | Game state customized per player (hides private information) |
| **Reconnect Window** | 30-second period where disconnected player can rejoin |
| **Dummy Player** | AI-controlled player replacing disconnected human |
| **Delta Compression** | Sending only changed state instead of full state |

---

## Changelog

### Recent Fixes (v0.2.11)
- Fixed deck change broadcasting for both host and guest
- Added recipientPlayerId to STATE_UPDATE_COMPACT
- Fixed deck size display to use deck.length
- Fixed revealed cards in hand display
- Preserved real deck data from CHANGE_PLAYER_DECK

### Previous Versions
- Initial WebRTC P2P implementation
- Added host/guest architecture
- Implemented ready check system
- Added visual effects synchronization
