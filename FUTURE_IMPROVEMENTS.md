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

---

# Comprehensive Code Quality Analysis (2026-02-23)

Ниже представлен подробный анализ кодовой базы с рекомендациями по улучшению. Анализ проведён агентом Claude Code.

---

## 🔴 Высокий приоритет (Критические проблемы)

### 1. Разбивка `useGameState.ts` (4,932 строки!)

**Расположение:** `client/hooks/useGameState.ts`

**Проблема:**
- Файл нарушает принцип единой ответственности (Single Responsibility Principle)
- Содержит: WebSocket соединение, WebRTC менеджмент, game state логику, UI эффекты, обработку команд
- Сложно поддерживать и тестировать

**Решение:** Вынести в отдельные focused hooks:
- `useWebSocketConnection.ts` — только WebSocket соединение и базовые сообщения
- `useWebRTCManager.ts` — WebRTC логику (host/guest sync)
- `useGameStateActions.ts` — game actions (playCard, moveCard, announceCard и т.д.)
- `useVisualEffects.ts` — highlights, floatingTexts, targeting mode
- `usePlayerActions.ts` — player-specific actions (drawCard, shuffleDeck, changeColor)

**Приоритет:** Высокий

---

### 2. Замена типов `any`

**Расположение:**
- `client/hooks/useGameState.ts:151` — `webrtcManagerRef: useRef<any>(null)`
- `server/services/websocket.ts` — `data: any` параметры в handler'ах
- `client/host/*.ts` — множество `any` в WebRTC типах

**Проблема:**
- Потеря type safety
- Возможные runtime ошибки
- Плохая IDE поддержка

**Решение:** Создать конкретные типы:
```typescript
// client/host/types.ts
export interface WebRTCManager {
  connect(): Promise<void>;
  disconnect(): void;
  send(data: WebRTCMessage): void;
  // ...
}

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}
```

**Приоритет:** Высокий

---

### 3. Утечки памяти в WebRTC и таймерах

**Расположение:**
- `client/hooks/useGameState.ts:95-104` — setTimeout без cleanup
- `client/hooks/useGameState.ts:150-162` — WebRTC connection без proper cleanup

**Проблема:**
- setTimeout не очищается при размонтировании компонента
- WebRTC соединения могут оставаться активными

**Решение:**
```typescript
useEffect(() => {
  const timeoutId = setTimeout(() => {
    // ...
  }, delay);

  return () => clearTimeout(timeoutId); // Cleanup
}, [dependencies]);
```

**Приоритет:** Высокий

---

### 4. React Error Boundaries

**Проблема:** Нет Error Boundary компонентов

**Решение:** Добавить error boundaries для:
- GameBoard
- App
- PlayerPanel

```typescript
// client/components/ErrorBoundary.tsx
class ErrorBoundary extends React.Component {
  // ...
}
```

**Приоритет:** Высокий

---

## 🟡 Средний приоритет

### 5. Оптимизация ре-рендеров

**Расположение:**
- `client/components/PlayerPanel.tsx` (1,437 строк)
- `client/components/GameBoard.tsx` (531 строка)

**Проблемы:**
- `selectableDecks` (строки 526-547) пересчитывается каждый рендер
- Компоненты без `React.memo`
- Inline GridCell компонент в GameBoard

**Решение:**
```typescript
const selectableDecks = useMemo(() =>
  deckFiles.filter(...),
  [deckFiles]
);

const GridCell = React.memo(({ ... }) => {
  // ...
}, (prev, next) => {
  // Custom comparison
});
```

**Приоритет:** Средний

---

### 6. Дублирование кода между клиентом и сервером

**Проблемы:**
1. `shuffleDeck` дублируется в:
   - `shared/utils/array.ts`
   - `server/utils/deckUtils.ts`

2. `validateDeckData` только в `client/utils/deckValidation.ts`
   - Должен быть в `shared/utils/`

3. Логика команд частично дублируется

**Решение:**
- Удалить дубликаты, использовать только shared версии
- Перенести `validateDeckData` в `shared/utils/deckValidation.ts`

**Приоритет:** Средний

---

### 7. Пустая директория `shared/types/`

**Проблема:**
- Типы импортируются из `client/types.ts`
- Нарушает принцип shared code

**Решение:** Перенести общие типы:
- `Card`, `Player`, `Board`, `GameState`
- `DragItem`, `DropTarget`
- `CardIdentifier`, `RevealRequest`

**Приоритет:** Средний

---

### 8. Неполные dependency arrays в useEffect

**Расположение:** Множество файлов

**Проблема:**
- Пропущенные зависимости вызывают stale closures
- Лишние зависимости вызывают ненужные рендеры

**Решение:** Использовать ESLint rule `react-hooks/exhaustive-deps`

**Приоритет:** Средний

---

## 🟢 Низкий приоритет (Улучшения качества)

### 9. Консистентность именования файлов

**Проблема:**
- PascalCase: `WebrtcStatePersistence.ts`, `HostManager.ts`
- camelCase: `deckValidation.ts`, `boardUtils.ts`, `targeting.ts`

**Решение:** Выбрать один стиль (предпочтительно camelCase для утилит, PascalCase для компонентов)

**Приоритет:** Низкий

---

### 10. Консистентность именования функций

**Проблема:**
- `handleDrop` vs `onDrop` vs `handleCardDrag`
- Разные паттерны для похожих callback'ов

**Решение:**
- `handle*` — для internal handlers
- `on*` — для props/callbacks

**Приоритет:** Низкий

---

### 11. Стили импортов

**Проблема:** Микс относительных и абсолютных импортов

**Решение:** Выбрать один стиль (предпочтительно относительные для текущей структуры проекта)

**Приоритет:** Низкий

---

### 12. Оптимизация тяжёлых вычислений

**Расположение:** `shared/utils/boardUtils.ts`
- `recalculateBoardStatuses` (строки 68-417)

**Проблема:** Вычислительно сложная функция с множественными вложенными циклами

**Решение:**
- Использовать мемоизацию для unchanged частей
- Рассмотреть spatial partitioning для больших досок

**Приоритет:** Низкий

---

### 13. Документация

**Проблема:** Микс JSDoc, inline комментариев, отсутствие документации

**Решение:** Выбрать единый стиль:
- JSDoc для экспортируемых функций
- Inline комментарии для сложной логики

**Приоритет:** Низкий

---

## 📊 Статистика проблем

| Категория | Количество | Приоритет |
|-----------|------------|-----------|
| Файлы с типом `any` | 20+ | Высокий |
| Пропущенные dependency arrays | Множество | Средний |
| Дублированный код | 5+ мест | Средний |
| Компоненты без memo | 10+ | Средний |
| Потенциальные memory leaks | 3-5 | Высокий |
| Слишком большие файлы | 3+ | Средний |

---

## 🎯 Рекомендуемый порядок действий

1. **Исправить memory leaks** — критично для стабильности
2. **Разбить useGameState.ts** — улучшит поддерживаемость
3. **Добавить Error Boundaries** — улучшит UX при ошибках
4. **Переместить общие типы в shared/** — архитектурное улучшение
5. **Оптимизировать ре-рендеры** — производительность UI
6. **Заменить `any` типы** — type safety
7. **Устранить дублирование кода** — консистентность
8. **Улучшить документацию** — поддерживаемость

---

## Version: 0.2.11
**Last Updated:** 2026-02-23
