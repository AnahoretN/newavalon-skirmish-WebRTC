# Host Module

Централизованный модуль для управления функциями хоста в WebRTC P2P режиме.

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                         Host Manager                         │
│  (Главный класс, объединяющий все компоненты)              │
└──────────────┬──────────────────────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼─────────┐  ┌──▼─────────────┐
│  Connection    │  │  State          │
│  Manager       │  │  Manager        │
│  (WebRTC       │  │  (Состояние     │
│   соединения)  │  │   игры)         │
└────────────────┘  └─────────────────┘
```

## Ключевые принципы

1. **Хост - источник истины**: Все изменения состояния идут через хоста
2. **Хост тоже игрок**: Действия хоста проходят через тот же пайлайн
3. **Эффективная синхронизация**: Используются дельты (изменения), а не полное состояние

## Файлы модуля

### `types.ts`
Типы для WebRTC коммуникации:
- `WebrtcMessage` - структура сообщения
- `WebrtcMessageType` - типы сообщений
- `HostConfig` - конфигурация хоста

### `HostConnectionManager.ts`
Управление WebRTC соединениями:
- Создание PeerJS
- Обработка подключений гостей
- Отправка сообщений
- Получение информации о соединениях

### `HostStateManager.ts`
Централизованное управление состоянием игры:
- `setInitialState()` - установка начального состояния
- `updateFromLocal()` - обновление от хоста (игрока)
- `updateFromGuest()` - обновление от гостя
- `applyDeltaFromGuest()` - применение дельты от гостя
- `startGame()` - начало игры с раздачей карт

### `GuestStateSync.ts`
Отправка изменений от гостя к хосту:
- `updateState()` - отправка дельты при изменении состояния
- `sendPlayerReady()` - отправка готовности
- `sendChangeDeck()` - изменение колоды
- `applyIncomingDelta()` - применение входящей дельты от хоста

### `HostManager.ts`
Главный класс, объединяющий всё:
- Инициализация хоста
- Обработка входящих сообщений
- Управление состоянием
- Callbacks для событий

## Пример использования

### На стороне хоста

```typescript
import { getHostManager } from '@/host'

// Создание хоста
const hostManager = getHostManager({
  onStateUpdate: (newState) => {
    setGameState(newState) // Обновить React state
  },
  onPlayerJoin: (playerId, peerId) => {
    console.log(`Player ${playerId} joined from ${peerId}`)
  },
  onGuestConnected: (peerId) => {
    console.log(`Guest connected: ${peerId}`)
  }
})

// Инициализация
const peerId = await hostManager.initialize()
console.log('Host peer ID:', peerId)

// Установка начального состояния
hostManager.setInitialState(gameState)
hostManager.setLocalPlayerId(1) // ID хоста как игрока

// Когда хост делает действие (играет карту, ходит и т.д.)
hostManager.updateFromLocal(newGameState)
```

### На стороне гостя

```typescript
import { GuestStateSync } from '@/host'

// Создание синхронизатора
const stateSync = new GuestStateSync({
  sendMessage: (message) => webrtcManager.sendMessageToHost(message),
  onStateUpdate: (newState) => {
    setGameState(newState) // Обновить React state
  }
})

stateSync.setLocalPlayerId(2) // ID гостя

// Когда гость делает действие
const oldState = gameState
const newState = doAction(oldState)
stateSync.updateState(oldState, newState)
```

## Поток данных

```
Гость 1 ──┐
           ├──> [Хост: StateManager] ──┐
Гость 2 ──┘                              │
                                       ├──> [Broadcast] ──> Гость 1
Хост (игрок) ─────────────────────────┘                    └──> Гость 2
```

## Преимущества

1. **Единая точка управления**: Весь state management на стороне хоста
2. **Консистентность**: Все изменения проходят через один пайплайн
3. **Приватность**: Только размеры рук/колод, не сами карты
4. **Эффективность**: Дельты вместо полного состояния
