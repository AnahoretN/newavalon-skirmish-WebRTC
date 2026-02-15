# План оптимизации New Avalon: Skirmish

**Дата анализа:** 2025-02-15
**Версия:** 0.2.10
**Статус:** Черновик - требует обсуждения

---

## 📊 Сводная таблица текущего состояния

| Метрика | Значение | Проблема | Приоритет |
|---------|----------|----------|-----------|
| **useGameState.ts** | 6,884 строк | Слишком монолитный | 🔴 Критический |
| **PlayerPanel.tsx** | 1,157 строк | Много ответственности | 🟡 Высокий |
| **App.tsx** | 2,383 строк | Требует разделения | 🟡 Высокий |
| **Initial bundle** | ~762 KB | Превышает 500 KB | 🔴 Критический |
| **CSS bundle** | ~51 KB | Можно оптимизировать | 🟡 Высокий |
| **Зависимости** | 63 dev deps | Tree-shaking нужен | 🟡 Высокий |
| **WebRTC сообщения** | JSON | Большой overhead | 🟡 Высокий |
| **Визуальные эффекты** | Отправка по 1 | Батчинг нужен | 🟢 Средний |

---

## 🎯 Приоритетные рекомендации

### 1. Оптимизация архитектуры - КРИТИЧНО!

#### Проблема: `useGameState.ts` - 6,884 строк

Это монолитный хук, который делает **всё**:
- WebSocket соединения
- WebRTC P2P соединения
- Управление состоянием игры
- UI логика и эффекты
- Обработка всех сообщений
- Локальное хранилище

**Текущая структура:**
```
useGameState.ts (6,884 строк)
├── WebSocket логика (~1,500 строк)
├── WebRTC логика (~800 строк)
├── Game state менеджмент (~2,000 строк)
├── UI обработчики (~1,500 строк)
├── Вспомогательные функции (~1,000 строк)
└── Мемоизация и оптимизация (~100 строк)
```

**Предлагаемая структура:**

```
client/hooks/
├── core/
│   ├── useConnection.ts           # WebSocket/WebRTC соединения
│   ├── useGameStateSync.ts        # Синхронизация состояния
│   ├── useGameActions.ts          # Игровые действия (playCard, drawCard, moveCard)
│   └── useVisualEffects.ts        # Визуальные эффекты (highlights, floating texts)
├── ui/
│   ├── usePlayerControls.ts       # Управление игроком (имя, цвет, очки)
│   ├── useBoardInteraction.ts     # Взаимодействие с доской (drag/drop)
│   ├── useCardActions.ts          # Действия с картами (клик, даблклик)
│   └── useModals.ts               # Управление модалками
├── webrtc/
│   ├── useWebrtcHost.ts           # WebRTC хост функционал
│   ├── useWebrtcGuest.ts          # WebRTC гость функционал
│   └── useWebrtcStateSync.ts      # Синхронизация через WebRTC
└── useGameState.ts                # Композитный хук (обёртка)
```

**Пример `useConnection.ts`:**
```typescript
// client/hooks/core/useConnection.ts
import { useState, useEffect, useRef } from 'react'

export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected'

export const useConnection = (websocketUrl: string | null) => {
  const [status, setStatus] = useState<ConnectionStatus>('Disconnected')
  const ws = useRef<WebSocket | null>(null)

  const connect = useCallback(() => {
    if (!websocketUrl) return
    ws.current = new WebSocket(websocketUrl)
    setStatus('Connecting')

    ws.current.onopen = () => setStatus('Connected')
    ws.current.onclose = () => setStatus('Disconnected')
    ws.current.onerror = () => setStatus('Disconnected')
  }, [websocketUrl])

  const disconnect = useCallback(() => {
    ws.current?.close()
  }, [])

  const send = useCallback((data: any) => {
    ws.current?.send(JSON.stringify(data))
  }, [])

  return { status, connect, disconnect, send }
}
```

---

#### Проблема: `PlayerPanel.tsx` - 1,157 строк

Компонент содержит слишком много логики:
- Выбор колоды
- Управление картами
- Drag & Drop
- Отображение руки
- Отображение discard/announce
- Счётчики и статусы

**Предлагаемая структура:**

```
PlayerPanel.tsx (основной контейнер, ~200 строк)
├── PlayerHeader.tsx           # Имя, цвет, очки (~100 строк)
├── PlayerHand.tsx             # Карточные руки (~300 строк)
├── PlayerDeckControls.tsx     # Управление колодой (~200 строк)
├── PlayerDiscard.tsx          # Отображение discard (~150 строк)
├── PlayerAnnounced.tsx        # Отображение announced (~100 строк)
└── PlayerStatus.tsx           # Статус готовности (~100 строк)
```

**Пример разбиения:**

```typescript
// client/components/PlayerPanel/PlayerHeader.tsx
interface PlayerHeaderProps {
  player: Player
  isLocalPlayer: boolean
  onNameChange: (name: string) => void
  onColorChange: (color: PlayerColor) => void
  onScoreChange: (delta: number) => void
  playerColor: PlayerColor
}

export const PlayerHeader = memo(({ player, isLocalPlayer, ... }: PlayerHeaderProps) => {
  return (
    <div className="flex items-center gap-2">
      {/* Avatar, name, color picker, score */}
    </div>
  )
})
```

---

### 2. Оптимизация сборки - ВЫСОКИЙ ПРИОРИТЕТ

#### Проблема: Bundle 762 KB без code splitting

**Текущий `vite.config.ts`:**
```typescript
build: {
  outDir: '../docs',
  cssMinify: true,
  emptyOutDir: true,
}
// ❌ Нет manualChunks, нет code splitting
```

**Предлагаемые изменения:**

**Шаг 1:** Добавить `manualChunks` в `vite.config.ts`:

```typescript
// vite.config.ts
export default defineConfig({
  // ...
  build: {
    outDir: '../docs',
    cssMinify: true,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vendor chunk - React и основные зависимости
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react'
          }
          // WebRTC зависимости
          if (id.includes('node_modules/peerjs')) {
            return 'vendor-webrtc'
          }
          // UI библиотеки
          if (id.includes('node_modules')) {
            return 'vendor'
          }
          // Модалки (ленивая загрузка)
          if (id.includes('/components/Modals')) {
            return 'modals'
          }
          // Game logic
          if (id.includes('/hooks/') || id.includes('/shared/')) {
            return 'game-logic'
          }
        }
      }
    },
    chunkSizeWarningLimit: 500
  }
})
```

**Шаг 2:** React.lazy для модалей в `App.tsx`:

```typescript
// client/App.tsx
import { lazy, Suspense } from 'react'

// Загружать модалки только когда нужны
const DeckViewModal = lazy(() => import('./components/DeckViewModal'))
const CardDetailModal = lazy(() => import('./components/CardDetailModal'))
const RulesModal = lazy(() => import('./components/RulesModal'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const TeamAssignmentModal = lazy(() => import('./components/TeamAssignmentModal'))
const ReadyCheckModal = lazy(() => import('./components/ReadyCheckModal'))
const RoundEndModal = lazy(() => import('./components/RoundEndModal'))
const JoinGameModal = lazy(() => import('./components/JoinGameModal'))
const TokensModal = lazy(() => import('./components/TokensModal'))
const CountersModal = lazy(() => import('./components/CountersModal'))
const CommandModal = lazy(() => import('./components/CommandModal'))
const CounterSelectionModal = lazy(() => import('./components/CounterSelectionModal'))
const RevealRequestModal = lazy(() => import('./components/RevealRequestModal'))
const DeckBuilderModal = lazy(() => import('./components/DeckBuilderModal'))

// В рендере обернуть в Suspense
<Suspense fallback={<LoadingSpinner />}>
  {showDeckViewModal && <DeckViewModal {...modalProps} />}
</Suspense>
```

**Шаг 3:** Оптимизировать Tailwind CSS:

```javascript
// tailwind.config.cjs (создать новый файл)
module.exports = {
  content: [
    "./client/index.html",
    "./client/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        'card-back': '#5A67D8',
        'card-face': '#F7FAFC',
        'board-bg': '#2D3748',
        'panel-bg': '#1A202C',
      }
    },
  },
  plugins: [],
  // Purge unused CSS в production
  purge: {
    enabled: process.env.NODE_ENV === 'production',
    content: ['./client/**/*.{tsx,ts}'],
  }
}
```

**Ожидаемый результат:**
- Initial bundle: 762 KB → ~300 KB (-60%)
- CSS: 51 KB → ~20 KB (-60%)
- Время загрузки: ~3s → ~1.2s

---

### 3. Оптимизация трафика - ВЫСОКИЙ ПРИОРИТЕТ

#### Проблема: JSON сериализация для WebRTC

WebRTC сообщения используют `JSON.stringify()` что создаёт большие payload.

**Текущий пример:**
```typescript
// client/utils/webrtcManager.ts
const send = (data: any) => {
  dataChannel.send(JSON.stringify(data)) // ❌ Большой overhead
}
```

**Решение 1:** Бинарный протокол для критических сообщений

```bash
npm install msgpack-lite
```

```typescript
// client/utils/webrtcProtocol.ts
import msgpack from 'msgpack-lite'

// Определить типы сообщений для более компактной сериализации
export enum MessageType {
  GAME_STATE_DELTA = 1,
  HIGHLIGHT = 2,
  FLOATING_TEXT = 3,
  CARD_PLAY = 4,
  // ...
}

export const encodeMessage = (type: MessageType, data: any): Uint8Array => {
  const packet = { t: type, d: data }
  return msgpack.encode(packet)
}

export const decodeMessage = (buffer: Uint8Array): any => {
  return msgpack.decode(buffer)
}
```

**Решение 2:** Оптимизировать delta-сжатие

Текущий `stateDelta.ts` уже реализует delta-сжатие, но можно улучшить:

```typescript
// client/utils/stateDelta.ts - улучшения

// 1. Не отправлять imageUrl (они неизменны)
// Клиент сам подгрузит их из локальной базы по baseId

export const createCardDelta = (card: Card): CardDelta => {
  return {
    id: card.id,
    baseId: card.baseId,
    power: card.power,
    // ❌ imageUrl: card.imageUrl - не отправлять!
    statuses: card.statuses,
  }
}

// 2. Использовать числовые идентификаторы вместо строк
export enum CardStatusType {
  POWER_MOD = 1,
  LAST_PLAYED = 2,
  // ...
}

// 3. Сжатие массивов - вместо объектов использовать массивы
// Было: [{ row: 0, col: 1 }, { row: 2, col: 3 }]
// Стало: [[0, 1], [2, 3]]
export const compressCoords = (coords: {row: number, col: number}[]): number[][] => {
  return coords.map(c => [c.row, c.col])
}
```

**Решение 3:** Батчинг визуальных эффектов

```typescript
// client/hooks/useVisualEffects.ts
import { useRef, useEffect } from 'react'

const EFFECT_BATCH_INTERVAL = 50 // мс
const effectQueue = useRef<VisualEffect[]>([])
const batchTimer = useRef<ReturnType<typeof setTimeout>>()

export const useVisualEffects = () => {
  const queueEffect = useCallback((effect: VisualEffect) => {
    effectQueue.current.push(effect)

    if (!batchTimer.current) {
      batchTimer.current = setTimeout(() => {
        // Отправить батч
        if (effectQueue.current.length > 0) {
          sendToServer({
            type: 'BATCH_EFFECTS',
            effects: [...effectQueue.current]
          })
          effectQueue.current = []
        }
        batchTimer.current = null
      }, EFFECT_BATCH_INTERVAL)
    }
  }, [])

  return { queueEffect }
}
```

**Ожидаемый результат:**
- Размер сообщения: ~50KB → ~20KB (-60%)
- Количество сообщений: -40% за счёт батчинга
- Ping: улучшение на 10-20мс

---

### 4. Производительность React - СРЕДНИЙ ПРИОРИТЕТ

#### Проблема: Лишние рендеры

**Решение 1:** Улучшить memoization

```typescript
// client/components/PlayerPanel.tsx
// Текущий memo не идеален - пропущены многие props

const PlayerPanel = memo(PlayerPanelComponent, (prevProps, nextProps) => {
  const prevPlayer = prevProps.player
  const nextPlayer = nextProps.player

  // Базовые проверки
  if (prevPlayer.id !== nextPlayer.id) return false
  if (prevProps.isLocalPlayer !== nextProps.isLocalPlayer) return false
  if (prevProps.activePlayerId !== nextProps.activePlayerId) return false

  // Проверить длины массивов (быстрее чем глубокое сравнение)
  if (prevPlayer.hand.length !== nextPlayer.hand.length) return false
  if (prevPlayer.deck.length !== nextPlayer.deck.length) return false
  if (prevPlayer.discard.length !== nextPlayer.discard.length) return false

  // Проверить critical props
  if (prevPlayer.selectedDeck !== nextPlayer.selectedDeck) return false
  if (prevPlayer.isReady !== nextPlayer.isReady) return false

  // Dragged item
  if (prevProps.draggedItem !== nextProps.draggedItem) return false

  return true // Props равны, не ререндерить
})
```

**Решение 2:** Использовать `useTransition` для тяжёлых операций

```typescript
// client/App.tsx
import { useTransition } from 'react'

export default function App() {
  const [isPending, startTransition] = useTransition()
  const [gameState, setGameState] = useState<GameState | null>(null)

  const handleGameStateUpdate = (newState: GameState) => {
    startTransition(() => {
      // Неблокирующее обновление состояния
      setGameState(newState)
    })
  }

  return (
    <div className={isPending ? 'loading' : ''}>
      {/* ... */}
    </div>
  )
}
```

**Решение 3:** Использовать `useDeferredValue` для менее критичных данных

```typescript
// client/components/GameBoard.tsx
import { useDeferredValue } from 'react'

export const GameBoard = ({ board, ...props }) => {
  // Отложенное обновление visual effects (не критичны для первого рендера)
  const deferredHighlights = useDeferredValue(highlights)
  const deferredFloatingTexts = useDeferredValue(floatingTexts)

  return (
    <div>
      {/* Рендер с отложенными данными */}
    </div>
  )
}
```

**Решение 4:** Virtual Scrolling для больших списков

```bash
npm install react-window
```

```typescript
// client/components/PlayerHand.tsx
import { FixedSizeList as List } from 'react-window'

export const PlayerHand = ({ player, onCardClick }) => {
  const Row = ({ index, style }) => (
    <div style={style}>
      <Card
        card={player.hand[index]}
        onClick={() => onCardClick(index)}
      />
    </div>
  )

  return (
    <List
      height={300}
      itemCount={player.hand.length}
      itemSize={80}
      width="100%"
      layout="horizontal"
    >
      {Row}
    </List>
  )
}
```

---

### 5. Оптимизация загрузки ресурсов - НИЗКИЙ ПРИОРИТЕТ

#### Проблема: База карт 35KB грузится сразу

**Текущее:**
```typescript
// client/contentDatabase.ts
import rawJsonData from '../server/content/contentDatabase.json'
// Весь файл грузится при старте
```

**Решение 1:** Динамическая загрузка по фракциям

```
server/content/
├── core.json          # Базовые карты (загружается сразу)
├── marauders.json     # Marauders faction
├── syndicate.json     # Syndicate faction
├── raptors.json       # Raptors faction
└── tokens.json        # Токены и счётчики
```

```typescript
// client/content/factionLoader.ts
interface FactionData {
  cards: Record<string, CardDefinition>
  tokens?: Record<string, TokenDefinition>
}

let loadedFactions = new Set<string>()
let cardDatabase: Record<string, CardDefinition> = {}

export const loadFaction = async (factionName: string): Promise<void> => {
  if (loadedFactions.has(factionName)) return

  const data = await import(`../server/content/${factionName}.json`)
  cardDatabase = { ...cardDatabase, ...data.cards }
  loadedFactions.add(factionName)
}

export const getCardDefinition = (cardId: string) => {
  return cardDatabase[cardId]
}
```

**Решение 2:** Ленивая загрузка изображений

```typescript
// client/components/LazyCardImage.tsx
import { useState, useRef, useEffect } from 'react'

export const LazyCardImage = ({ cardId, imageUrl, className }) => {
  const [src, setSrc] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setSrc(imageUrl)
          observer.disconnect()
        }
      },
      { rootMargin: '50px' }
    )

    if (imgRef.current) {
      observer.observe(imgRef.current)
    }

    return () => observer.disconnect()
  }, [imageUrl])

  return (
    <img
      ref={imgRef}
      src={src || '/placeholder.png'}
      className={className}
      alt={cardId}
    />
  )
}
```

**Решение 3:** Progressive Image Loading

```typescript
// Сначала загрузить маленькую версию, затем большую
export const ProgressiveImage = ({ lowResUrl, highResUrl, ...props }) => {
  const [src, setSrc] = useState(lowResUrl)

  useEffect(() => {
    const img = new Image()
    img.src = highResUrl
    img.onload = () => setSrc(highResUrl)
  }, [highResUrl])

  return <img src={src} {...props} />
}
```

---

### 6. Управление памятью - ВАЖНО

#### Проблемы:
1. `deckChangeDeltas` Map растёт без очистки
2. `scoreDeltaAccumulator` Map не очищается
3. WebRTC соединения могут не закрываться корректно
4. Таймеры могут не очищаться

**Решение:** Добавить cleanup

```typescript
// client/hooks/useGameState.ts

// В начале хука
useEffect(() => {
  return () => {
    // === Cleanup Maps ===
    deckChangeDeltas.forEach((value) => clearTimeout(value.timerId))
    deckChangeDeltas.clear()

    scoreDeltaAccumulator.forEach((value) => clearTimeout(value.timerId))
    scoreDeltaAccumulator.clear()

    // === Cleanup WebRTC ===
    const webrtcManager = getWebrtcManager()
    if (webrtcManager) {
      webrtcManager.disconnect()
      webrtcManager.cleanup()
    }

    // === Cleanup WebSocket ===
    if (ws.current) {
      ws.current.onclose = null // Убрать обработчик
      ws.current.onerror = null
      ws.current.close()
    }

    // === Cleanup localStorage ===
    // Можно очистить старые данные
    const RECONNECTION_DATA_KEY = 'reconnection_data'
    const oldData = localStorage.getItem(RECONNECTION_DATA_KEY)
    if (oldData) {
      const { timestamp } = JSON.parse(oldData)
      const oneHour = 60 * 60 * 1000
      if (Date.now() - timestamp > oneHour) {
        localStorage.removeItem(RECONNECTION_DATA_KEY)
      }
    }
  }
}, [])
```

**Дополнительная рекомендация:** Использовать WeakMap вместо Map для временных данных

```typescript
// WeakMap автоматически очищает garbage collector
const componentTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

export const setComponentTimer = (element: Element, callback: () => void, delay: number) => {
  const timerId = setTimeout(callback, delay)
  componentTimers.set(element, timerId)
  return timerId
}
```

---

### 7. Альтернативный подход - State Management

Текущая реализация использует большое количество useState и useEffect. Рассмотрите возможность перехода на специализированный state management:

| Вариант | Размер | Преимущества | Недостатки | Рекомендация |
|---------|--------|--------------|------------|--------------|
| **Zustand** | ~3KB | Лёгкий, простой, TypeScript friendly | Меньше возможностей чем Redux | ✅ Рекомендую |
| **Jotai** | ~3KB | Атомарный, tree-shakeable | Кривая обучения | ⚠️ Можно |
| **Redux Toolkit** | ~15KB | Структурирован, time-travel debug | Тяжёлый, много boilerplate | ❌ Избыточен |
| **Valtio** | ~3KB | Proxy-based, простой | Меньше экосистема | ⚠️ Можно |
| **MobX** | ~20KB | Reactive, простой | Неявность, proxy | ❌ Тяжёлый |

**Пример с Zustand:**

```bash
npm install zustand
```

```typescript
// client/store/gameStore.ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface GameStateStore {
  gameState: GameState | null
  localPlayerId: number | null
  connectionStatus: ConnectionStatus

  // Actions
  setGameState: (state: GameState) => void
  setLocalPlayerId: (id: number | null) => void
  setConnectionStatus: (status: ConnectionStatus) => void

  // Game actions
  playCard: (card: Card, target: DropTarget) => void
  drawCard: () => void
}

export const useGameStore = create<GameStateStore>()(
  devtools(
    persist(
      (set, get) => ({
        gameState: null,
        localPlayerId: null,
        connectionStatus: 'Disconnected',

        setGameState: (state) => set({ gameState: state }),
        setLocalPlayerId: (id) => set({ localPlayerId: id }),
        setConnectionStatus: (status) => set({ connectionStatus: status }),

        playCard: (card, target) => {
          // Логика игры
          const ws = getWebSocket()
          ws?.send(JSON.stringify({ type: 'PLAY_CARD', card, target }))
        },

        drawCard: () => {
          const ws = getWebSocket()
          ws?.send(JSON.stringify({ type: 'DRAW_CARD' }))
        },
      }),
      {
        name: 'avalon-game-storage',
        partialize: (state) => ({ gameState: state.gameState }),
      }
    )
  )
)
```

**Использование:**

```typescript
// В компоненте
import { useGameStore } from './store/gameStore'

export const PlayerHand = () => {
  const gameState = useGameStore((state) => state.gameState)
  const localPlayerId = useGameStore((state) => state.localPlayerId)
  const drawCard = useGameStore((state) => state.drawCard)

  return (
    <button onClick={drawCard}>Draw Card</button>
  )
}
```

**Преимущества Zustand:**
- ✅ Меньше boilerplate
- ✅ Автоматический React memo
- ✅ Встроенный persist для localStorage
- ✅ DevTools
- ✅ TypeScript friendly
- ✅ Очень лёгкий (~3KB)

---

### 8. Унификация интерфейса и модальных окон - ВЫСОКИЙ ПРИОРИТЕТ

#### Проблема: Дублирование кода в модалках

В проекте 13+ модальных компонентов с похожей структурой:
- `DeckViewModal` - 400+ строк
- `CardDetailModal` - 200+ строк
- `TokensModal` - 150+ строк
- `CountersModal` - 150+ строк
- `TeamAssignmentModal` - 120+ строк
- `ReadyCheckModal` - 100+ строк
- `RulesModal` - 100+ строк
- `SettingsModal` - 200+ строк
- `CommandModal` - 80+ строк
- `CounterSelectionModal` - 80+ строк
- `RevealRequestModal` - 60+ строк
- `RoundEndModal` - 100+ строк
- `JoinGameModal` - 150+ строк

**Проблемы:**
1. Дублирование логики закрытия (onClose, ESC клик, клик вне)
2. Дублирование стилей (backdrop, container, header)
3. Дублирование анимаций
4. Нет единого центра управления модалками

#### Решение: Единая система модалок

**Шаг 1:** Создать базовый компонент модалки (уже есть `BaseModal`, нужно улучшить)

```typescript
// client/components/modals/BaseModal.tsx
import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export interface BaseModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  showCloseButton?: boolean
  closeOnEscape?: boolean
  closeOnBackdropClick?: boolean
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-6xl',
}

export const BaseModal = memo(({
  isOpen,
  onClose,
  title,
  children,
  size = 'lg',
  showCloseButton = true,
  closeOnEscape = true,
  closeOnBackdropClick = true,
}: BaseModalProps) => {
  // ESC ключ
  useEffect(() => {
    if (!closeOnEscape || !isOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose, closeOnEscape])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeOnBackdropClick ? onClose : undefined}
            className="fixed inset-0 bg-black/60 z-50"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className={`bg-gray-800 rounded-lg shadow-xl w-full ${sizeClasses[size]} pointer-events-auto`}
            >
              {/* Header */}
              {title && (
                <div className="flex items-center justify-between p-4 border-b border-gray-700">
                  <h2 className="text-xl font-bold text-white">{title}</h2>
                  {showCloseButton && (
                    <button
                      onClick={onClose}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      <XIcon className="w-5 h-5" />
                    </button>
                  )}
                </div>
              )}

              {/* Content */}
              <div className="p-4">
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
})
```

**Шаг 2:** Создать менеджер модалок

```typescript
// client/hooks/useModals.ts
import { create } from 'zustand'

type ModalType =
  | 'deckView'
  | 'cardDetail'
  | 'tokens'
  | 'counters'
  | 'teamAssignment'
  | 'readyCheck'
  | 'rules'
  | 'settings'
  | 'command'
  | 'counterSelection'
  | 'revealRequest'
  | 'roundEnd'
  | 'joinGame'
  | 'deckBuilder'

interface ModalState {
  openModal: ModalType | null
  modalData: Record<string, any>

  open: (type: ModalType, data?: any) => void
  close: () => void
  isOpen: (type: ModalType) => boolean
  getData: <T = any>() => T
}

export const useModals = create<ModalState>((set, get) => ({
  openModal: null,
  modalData: {},

  open: (type, data) => set({ openModal: type, modalData: data || {} }),
  close: () => set({ openModal: null, modalData: {} }),

  isOpen: (type) => get().openModal === type,
  getData: () => get().modalData,
}))
```

**Шаг 3:** Универсальный компонент рендера модалок

```typescript
// client/components/ModalsRenderer.tsx
import { Suspense, lazy } from 'react'
import { useModals } from '../hooks/useModals'
import { BaseModal } from './modals/BaseModal'

// Lazy load all modals
const DeckViewModal = lazy(() => import('./DeckViewModal'))
const CardDetailModal = lazy(() => import('./CardDetailModal'))
const TokensModal = lazy(() => import('./TokensModal'))
// ... и т.д.

const modalComponents = {
  deckView: DeckViewModal,
  cardDetail: CardDetailModal,
  tokens: TokensModal,
  // ... и т.д.
} as const

export const ModalsRenderer = () => {
  const { openModal, close, getData } = useModals()

  if (!openModal) return null

  const ModalComponent = modalComponents[openModal]
  if (!ModalComponent) return null

  return (
    <Suspense fallback={<ModalLoadingSpinner />}>
      <ModalComponent
        isOpen={true}
        onClose={close}
        {...getData()}
      />
    </Suspense>
  )
}

// Использование в App.tsx:
// <ModalsRenderer />
```

**Шаг 4:** Рефакторинг существующих модалок

```typescript
// client/components/DeckViewModal.tsx - ДО
export const DeckViewModal = ({
  isOpen,
  onClose,
  title,
  player,
  cards,
  // ... 20+ props
}: DeckViewModalProps) => {
  // 400+ строк логики
}

// client/components/DeckViewModal.tsx - ПОСЛЕ
export const DeckViewModal = memo(({
  isOpen,
  onClose,
  playerId,
}: DeckViewModalProps) => {
  // Получить данные из контекста/хука
  const { gameState } = useGameState()
  const player = gameState.players.find(p => p.id === playerId)!

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('deckView')}
      size="xl"
    >
      <DeckViewContent player={player} />
    </BaseModal>
  )
})
```

**Шаг 5:** Унифицированная система размеров

```typescript
// client/components/modals/modalSizes.ts
export const MODAL_SIZES = {
  sm: 'max-w-md w-full',      // 448px
  md: 'max-w-lg w-full',      // 512px
  lg: 'max-w-2xl w-full',     // 672px
  xl: 'max-w-4xl w-full',     // 896px
  '2xl': 'max-w-5xl w-full',  // 1024px
  full: 'max-w-6xl w-full',   // 1152px
} as const

export type ModalSize = keyof typeof MODAL_SIZES
```

#### Ожидаемый результат:

| Метрика | До | После | Улучшение |
|---------|----|-------|-----------|
| Код модалок | ~2000 строк | ~1200 строк | -40% |
| Дублирование | Высокое | Минимальное | -70% |
| Размер bundle | 762 KB | ~350 KB | -54% |
| Обслуживание | Сложно | Легко | ✅ |

#### Дополнительные улучшения:

1. **Анимации** - использовать Framer Motion для всех модалок
2. **Compose** - возможность вложенных модалок
3. **Stack** - стек модалок для открытия одной поверх другой
4. **Priority** - приоритетные модалки (Disconnect, Error)

```bash
npm install framer-motion zustand
```

---

## 📋 Детальный план внедрения

### Этап 1: Быстрые победы (✅ ЧАСТИЧНО ВЫПОЛНЕНО)

#### Выполненные задачи:
- [x] Настроить manual chunks в vite.config.ts ✅
- [x] Создать tailwind.config.cjs для purge (уже был) ✅
- [x] Добавить cleanup в useEffect для useGameState ✅
- [ ] Добавить React.lazy для модалок ⚠️ (отложено - требует аккуратного рефакторинга App.tsx)

#### Создано (но не интегрировано):
- [x] Создан модуль `useVisualEffects.ts` 📁 (готов к интеграции)

#### Файлы изменены:
```
vite.config.ts                  - ✅ manual chunks добавлены
client/hooks/useGameState.ts    - ✅ cleanup добавлен
client/hooks/core/useVisualEffects.ts - ✅ создан (новый файл)
```

#### Результат билда после manual chunks:
```
index.html              2.72 KB │ gzip: 0.89 KB
CSS                     50.99 KB │ gzip: 9.16 KB
vendor-webrtc          38.65 KB │ gzip: 11.34 KB (PeerJS)
vendor                 53.62 KB │ gzip: 14.80 KB (другие зависимости)
vendor-react          137.55 KB │ gzip: 43.99 KB (React + DOM)
game-logic            244.95 KB │ gzip: 57.93 KB (хуки + shared)
index (main)           285.96 KB │ gzip: 88.11 KB
```

**Итого:** ~815 KB (без gzip), ~225 KB (с gzip)

#### Преимущества:
- ✅ Chunks кэшируются отдельно
- ✅ React/WebRTC не перезагружаются при изменениях кода
- ⚠️ Нужно дальше разбивать game-logic

#### Заметки:
- React.lazy требует Suspense wrappers, что сложно добавить в App.tsx (2383 строк)
- Рекомендуется использовать компонент-роутер или менеджер модалок
- useGameState.ts слишком большой для прямого редактирования

---

### Этап 2: Рефакторинг (3-5 дней)

#### Задачи:
- [ ] Разбить `useGameState.ts` на модули
- [ ] Разбить `PlayerPanel.tsx` на компоненты
- [ ] Улучшить memoization в критичных компонентах
- [ ] Создать контекст для глобального состояния

#### Файлы для создания:
```
client/hooks/core/useConnection.ts
client/hooks/core/useGameStateSync.ts
client/hooks/core/useGameActions.ts
client/hooks/core/useVisualEffects.ts

client/components/PlayerPanel/PlayerHeader.tsx
client/components/PlayerPanel/PlayerHand.tsx
client/components/PlayerPanel/PlayerDeckControls.tsx
client/components/PlayerPanel/PlayerStatus.tsx
```

#### Файлы для изменения:
```
client/hooks/useGameState.ts    - рефакторинг
client/components/PlayerPanel.tsx - рефакторинг
client/App.tsx                  - контекст
```

#### Ожидаемый результат:
- Улучшение читаемости кода
- Упрощение тестирования
- Уменьшение количества рендеров на 20-30%

---

### Этап 3: Сетевая оптимизация (2-3 дня)

#### Задачи:
- [ ] Оптимизировать delta-сжатие
- [ ] Добавить батчинг эффектов
- [ ] Рассмотреть MessagePack для WebRTC
- [ ] Не отправлять imageUrl в delta

#### Файлы для создания:
```
client/utils/webrtcProtocol.ts
client/hooks/useVisualEffects.ts
```

#### Файлы для изменения:
```
client/utils/stateDelta.ts
client/utils/webrtcManager.ts
client/host/*.ts
```

#### Ожидаемый результат:
- Размер сообщения: ~50KB → ~20KB
- Количество сообщений: -40%

---

### Этап 4: Ресурсы (1-2 дня)

#### Задачи:
- [ ] Разделить contentDatabase.json по фракциям
- [ ] Реализовать динамическую загрузку
- [ ] Добавить lazy loading для изображений

#### Файлы для создания:
```
server/content/core.json
server/content/marauders.json
server/content/syndicate.json
server/content/raptors.json
server/content/tokens.json

client/content/factionLoader.ts
client/components/LazyCardImage.tsx
```

#### Ожидаемый результат:
- Initial bundle: ещё -50-100 KB
- Быстрая загрузка начального экрана

---

## 🎯 Итоговые ожидаемые результаты

| Метрика | До | После | Улучшение |
|---------|----|-------|-----------|
| Initial bundle | 762 KB | ~200-300 KB | -60-70% |
| CSS bundle | 51 KB | ~15-20 KB | -60-70% |
| Time to Interactive | ~3s | ~1-1.5s | -50-66% |
| Network overhead | ~50KB/msg | ~15-20KB/msg | -60-70% |
| Количество сообщений | 100% | ~60% | -40% |
| Re-renders | Избыточные | Оптимальные | -30-40% |
| Использование памяти | Растёт | Стабильно | ✅ |

---

## 🔍 Дополнительные рекомендации

### Мониторинг производительности

Добавить React DevTools Profiler:

```typescript
// client/index.tsx
import { Profiler } from 'react'

root.render(
  <Profiler id="App" onRender={(id, phase, actualDuration) => {
    if (actualDuration > 16) { // Больше 16мс = проблемный рендер
      console.warn(`Slow render: ${id} (${phase}) took ${actualDuration}ms`)
    }
  }}>
    <App />
  </Profiler>
)
```

### Анализ bundle

Добавить rollup-plugin-visualizer:

```bash
npm install -D rollup-plugin-visualizer
```

```typescript
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    react(),
    visualizer({
      filename: './dist/stats.html',
      open: true,
      gzipSize: true,
    })
  ]
})
```

### Lighthouse CI

Добавить в CI/CD:

```yaml
# .github/workflows/lighthouse.yml
name: Lighthouse
on: [pull_request]
jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: treosh/lighthouse-ci-action@v9
        with:
          urls: |
            https://your-app.com
          uploadArtifacts: true
```

---

## 📝 Checklist для code review

Перед каждым коммитом проверять:

- [ ] Нет `console.log` в production коде
- [ ] Все useEffect имеют cleanup
- [ ] Все таймеры сохраняются в useRef и очищаются
- [ ] Компоненты с большим количеством props используют memo
- [ ] Тяжёлые компоненты используют lazy loading
- [ ] Нет лишних re-renders (проверить через React DevTools)
- [ ] WebRTC/WebSocket сообщения минимального размера
- [ ] Нет duplicate code
- [ ] Переводы синхронизированы
- [ ] Типы корректны (no any)

---

## 📚 Полезные ресурсы

- [React Performance](https://react.dev/learn/render-and-commit)
- [Vite Performance](https://vitejs.dev/guide/performance.html)
- [WebRTC Optimization](https://webrtc.org/getting-started/performance)
- [Bundle Analysis](https://bundlephobia.com/)
- [State Management Comparison](https://dev.to/sgomez/state-management-in-react-2023-2ka7)

---

**Автор анализа:** Claude (Anthropic)
**Последнее обновление:** 2025-02-15
