# Phase and Turn Management System

## Overview

The Phase and Turn Management System is a complete implementation for WebRTC P2P mode that ensures all clients (host, guests, dummy players) always see the same phase and active player.

## Architecture

### Design Principles

1. **Host Authority**: The host controls all phase transitions and broadcasts updates to guests
2. **Ultra-Compact Messages**: Binary encoding (10 bytes for full phase state) minimizes bandwidth
3. **Synchronization**: All clients receive identical phase state simultaneously
4. **Request/Response Model**: Guests request actions, host decides and broadcasts result

## File Structure

```
client/host/phase/
├── PhaseTypes.ts           # Types, enums, and utility functions
├── PhaseManager.ts         # Core phase logic (host-side)
├── PhaseMessageCodec.ts    # Binary encoding/decoding for phase messages
├── PhaseSyncManager.ts     # Broadcasts phase state to guests (host-side)
├── GuestPhaseHandler.ts    # Receives and processes phase messages (guest-side)
└── index.ts                # Public exports

Integration modules:
├── HostPhaseIntegration.ts    # Extends HostManager with phase system
└── GuestPhaseIntegration.ts   # Extends GuestConnectionManager with phase system

Client hooks:
├── usePhaseActions.ts      # Actions (next phase, pass turn, etc.)
└── usePhaseManagement.ts   # Display (current phase, round info, etc.)
```

## Game Phases

| Phase | Index | Description | Auto-Transition |
|-------|-------|-------------|-----------------|
| Preparation | 0 | Hidden: Auto-draw, round check | → Setup |
| Setup | 1 | Place units face-up/down | Card played → Main |
| Main | 2 | Activate abilities | Manual → Commit |
| Commit | 3 | Add counters/statuses | No cards → Pass OR Manual → Scoring |
| Scoring | 4 | Select line, score points | Line selected → Pass |

## Phase Flow

### Turn Start (Any Player Becomes Active)

```
Player becomes active → Preparation (0)
    ↓
[Auto-draw if enabled]
    ↓
[Check round victory]
    ↓ If threshold reached → Round End Modal
    ↓ If not → Setup (1)
```

### During Turn

```
Setup (1) → [Card played/token placed] → Main (2)
    ↓
Main (2) → [Next Phase button] → Commit (3)
    ↓
Commit (3) → [Check: cards on board?]
    ├── Yes → [Next Phase button] → Scoring (4)
    └── No → Pass Turn
    ↓
Scoring (4) → [Select line] → Score points → Pass Turn
```

### Pass Turn

```
Pass Turn → Next player active → Preparation (0)
```

## Message Format

### Phase State Update (10 bytes)

```
[FLAGS:1] [PHASE:1] [ACTIVE_PLAYER:1] [STARTING_PLAYER:1]
[ROUND:1] [TURN:1] [WINNER:1] [WINNERS_MASK:2] [RESERVED:1]
```

- `FLAGS`: Bitmask for optional fields
- `PHASE`: Current phase (0-4)
- `ACTIVE_PLAYER`: Current active player ID (0 = null)
- `STARTING_PLAYER`: First player of the match
- `ROUND`: Current round number (1-3)
- `TURN`: Total turn count
- `WINNER`: Match winner (255 = none)
- `WINNERS_MASK`: Bitmask of round winners

### Phase Action Request (3-5 bytes)

```
[MSG_TYPE:1] [ACTION:1] [PLAYER_ID:1] [DATA...]
```

Actions:
- `NEXT_PHASE` (0x01)
- `PREVIOUS_PHASE` (0x02)
- `PASS_TURN` (0x03)
- `START_SCORING` (0x04)
- `SELECT_LINE` (0x05) - includes line type + index
- `ROUND_COMPLETE` (0x06)
- `START_NEXT_ROUND` (0x07)
- `START_NEW_MATCH` (0x08)

## Usage

### Host Side

```typescript
import { HostManager } from './host'
import { initializePhaseSystem } from './host/HostPhaseIntegration'

// Create host manager
const hostManager = new HostManager({ onStateUpdate: setState })

// Initialize phase system
initializePhaseSystem(hostManager, {
  onPhaseChanged: (result) => {
    console.log(`Phase: ${result.oldPhase} → ${result.newPhase}`)
  },
  onRoundEnded: (info) => {
    console.log(`Round ${info.roundNumber} winners:`, info.winners)
  },
  onMatchEnded: (winnerId) => {
    console.log('Match winner:', winnerId)
  }
})

// Start game
hostManager.startGameWithPhaseSystem(startingPlayerId)
```

### Guest Side

```typescript
import { GuestConnectionManager } from './host/GuestConnection'
import { initializePhaseSystemForGuest } from './host/GuestPhaseIntegration'

// Create guest connection
const guestConnection = new GuestConnectionManager({
  onMessage: (message) => {
    // Phase messages handled automatically by GuestPhaseHandler
  }
})

// Initialize phase system
initializePhaseSystemForGuest(guestConnection, {
  gameStateRef: gameStateRef,
  onStateUpdate: setState
})
```

### Client Side (Both Host and Guest)

```typescript
import { usePhaseActions } from './hooks/core/usePhaseActions'

function PhaseControls() {
  const {
    nextPhase,
    previousPhase,
    passTurn,
    startScoring,
    getCurrentPhaseName,
    isMyTurn,
    canAct
  } = usePhaseActions({
    gameStateRef,
    localPlayerId,
    isHost,
    hostManager,
    guestConnection
  })

  return (
    <div>
      <p>Phase: {getCurrentPhaseName()}</p>
      {canAct && (
        <>
          <button onClick={nextPhase}>Next Phase</button>
          <button onClick={passTurn}>Pass Turn</button>
        </>
      )}
    </div>
  )
}
```

## Victory and Round System

### Victory Threshold

- Round 1: 20 points (10 + 10×1)
- Round 2: 30 points (10 + 10×2)
- Round 3+: 40+ points (10 + 10×3)

### Round End

1. Any player reaches threshold
2. Round ends immediately
3. Winner(s) = player(s) with highest score
4. Round End Modal opens
5. Players can start next round

### Match End

- First player to win 2 rounds wins the match
- Game Over modal opens
- Option to start new match

## Scoring System

### Line Selection (Scoring Phase)

1. Active player enters Scoring phase
2. Valid lines are calculated from player's "last played" cards
3. Lines must contain at least one of the player's cards
4. Player selects a line (row, column, or diagonal)
5. Points = sum of power of all player's cards in selected line
6. Floating text shows points earned
7. Turn passes to next player

## API Reference

### PhaseManager (Host)

```typescript
class PhaseManager {
  setState(state: GameState): void
  handleAction(request: PhaseActionRequest): PhaseTransitionResult | null
  startGame(startingPlayerId: number): PhaseTransitionResult
  getPhaseState(): PhaseState
  getScoringMode(): ScoringSelectionMode
  canPlayerAct(playerId: number): boolean
}
```

### PhaseSyncManager (Host)

```typescript
class PhaseSyncManager {
  broadcastPhaseState(state: PhaseState, excludePeerId?: string): void
  broadcastPhaseTransition(result: PhaseTransitionResult, excludePeerId?: string): void
  broadcastTurnChange(oldPlayerId: number, newPlayerId: number, excludePeerId?: string): void
  broadcastRoundEnd(info: RoundEndInfo, excludePeerId?: string): void
  broadcastMatchEnd(winnerId: number | null, excludePeerId?: string): void
}
```

### GuestPhaseHandler (Guest)

```typescript
class GuestPhaseHandler {
  handlePhaseStateUpdate(message: any): void
  handlePhaseTransition(message: any): void
  handleTurnChange(message: any): void
  handleRoundEnd(message: any): void
  handleScoringModeStart(message: any): void
  requestPhaseAction(action: string, playerId: number, data?: any): WebrtcMessage | null
}
```

## Testing Checklist

- [ ] Host can start game with random first player
- [ ] All guests see same phase and active player
- [ ] Phase transitions sync correctly (0 → 1 → 2 → 3 → 4 → 0)
- [ ] Turn passing works correctly (player 1 → 2 → 3 → 1)
- [ ] Auto-draw happens in Preparation phase
- [ ] Round victory check triggers correctly
- [ ] Round End Modal shows correct winners
- [ ] Match ends when someone wins 2 rounds
- [ ] Scoring line selection works
- [ ] Points are awarded correctly
- [ ] Floating text appears on scored cards
- [ ] Dummy players can be controlled by anyone
