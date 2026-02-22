# Future Improvements

This document tracks potential optimizations, refactoring opportunities, and technical debt items that don't require immediate action but could be addressed in the future.

---

## Performance Optimizations

### Delta System Stub (Technical Debt)

**Location:** `client/utils/stateDelta.ts`, `client/host/HostStateManager.ts`

**Current State:**
- The `createDeltaFromStates` function returns an empty delta object
- Comments throughout codebase say "Delta system is stub, broadcast full state"
- All state changes broadcast full `GameState` instead of minimal deltas

**Impact:**
- Full state broadcasts: ~2-5 KB per message
- Potential delta broadcasts: ~100-500 bytes per message
- Not critical for 2-3 player games, but could benefit 4+ player long sessions

**Implementation Requirements:**
1. Implement proper delta calculation in `createDeltaFromStates`
2. Track what changed between old and new state (players, board, phase, etc.)
3. Encode delta as compact binary format
4. Handle delta application on guest side with conflict resolution
5. Remove fallback to full state broadcast (or keep as emergency backup)

**Priority:** Low - Nice to have for optimization, not required for functionality

---

## Build & Bundle Optimizations

### Dynamic Import Warnings

**Issue:** Vite warnings about modules being both statically and dynamically imported

**Example Warning:**
```
DeckViewModal.tsx is dynamically imported by ModalsRenderer.tsx
but also statically imported by App.tsx
```

**Affected Files:**
- `DeckViewModal.tsx`
- `TokensModal.tsx`
- `CountersModal.tsx`
- `TeamAssignmentModal.tsx`
- `CardDetailModal.tsx`
- `RevealRequestModal.tsx`
- `CommandModal.tsx`
- `RoundEndModal.tsx`
- `CounterSelectionModal.tsx`

**Current State:**
- Modals are imported both statically (in `App.tsx`) and dynamically (in `ModalsRenderer.tsx`)
- This prevents Vite from moving modules to separate chunks
- No functional impact, only affects bundle optimization

**Fix Options:**
1. Remove static imports from `App.tsx`, use only dynamic imports via `ModalsRenderer`
2. Or vice versa - use only static imports everywhere
3. Or create separate lazy-loaded wrapper components

**Priority:** Low - Build optimization only, doesn't affect functionality

---

## Code Quality

### Potential Refactoring Opportunities

These are areas where code could be improved but are working correctly as-is.

1. **gameCodec.ts** - Status types hardcoded (lines 111-116)
   - Status types list duplicated in encode/decode functions
   - Could derive from central source of truth
   - Impact: Low - Risk of mismatch if new status added

2. **HostStateManager.ts** - Multiple similar broadcast patterns
   - Lines 99-103, 178-186, 210-218, 253-256, 275-278, 308-311
   - All check if delta empty, then either broadcastDelta or broadcastGameState
   - Could extract to `broadcastStateOrDelta` helper
   - Impact: Low - Code duplication but working correctly

---

## Testing Gaps

### Areas Lacking Test Coverage

1. **WebRTC Reconnection** - Not covered by automated tests
2. **Edge cases in state synchronization** - Rely on manual testing
3. **Performance under load** - Not tested with 4+ players, long sessions

---

## Architecture Considerations

### WebRTC Message Types

Current message flow can be complex:
- Some messages flow through `ACTION` wrapper
- Others are direct message types (`DECK_DATA_UPDATE`, `CARD_STATE`)
- Could benefit from more unified message routing

### State Management

Multiple state update paths:
- Direct `setGameState` calls
- State manager updates
- Delta applications
- Consider centralizing state updates through single pipeline

---

## Version: 0.2.11
**Last Updated:** 2026-02-22
