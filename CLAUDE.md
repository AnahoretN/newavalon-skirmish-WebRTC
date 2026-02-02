# New Avalon: Skirmish - Development Guide

## Setup

```bash
npm i         # Install dependencies
npm run dev   # Start development server (tsx + Vite HMR)
```

**IMPORTANT**: Use `npm run dev` for development - runs both server (tsx) and client (Vite) with HMR. Do not use npm start or docker during development.

## Deployment Architecture

This version uses a **split deployment** strategy:
- **Client**: Static files hosted on GitHub Pages
- **Server**: Runs locally, exposed via ngrok for remote players

Players configure the WebSocket URL in Settings to connect to any game server.

## Workflow

### Development
1. **Development**: `npm run dev` (localhost:8080)
Before commit **MANDATORY**:
   a. Always update CLAUDE.md ## Project Structure, ## Key Dependencies, ## API Flow IF there are any changes to:
      - Added/removed files
      - Modified component props or function signatures
      - Changed API endpoints or data flow
      - Updated dependencies or build configuration
      - Altered WebSocket message types or game state structure
   b. Update locales, all should be in sync
   c. Ensure all lint checks and type checks pass

## Critical Rules - NEVER BREAK

### Card Movement Rule
**Cards MUST be movable ANYWHERE at ANY TIME:**
- Hand ↔ Deck ↔ Discard ↔ Showcase ↔ Battlefield
- This flexibility is intentional and essential for game mechanics
- Located in: `client/components/PlayerPanel.tsx` (see header documentation)

### Deck Selection Visual Feedback Rule
**When player selects a deck from dropdown, it MUST update VISUALLY IMMEDIATELY:**

1. **Client-side (`PlayerPanel.tsx`):**
   - Memo function MUST include `player.selectedDeck` in comparison
   - `selectableDecks` MUST use `useMemo(() => deckFiles.filter(...), [deckFiles])`
   - Dropdown only renders when `selectableDecks.length > 0`

2. **Server-side (`gameManagement.ts`):**
   - Player merge logic MUST include `selectedDeck` in BOTH branches:
     - `trustClientCards=true`: Spread `...clientPlayer` covers it
     - `trustClientCards=false`: MUST explicitly add `selectedDeck: clientPlayer.selectedDeck ?? serverPlayerAfterDraw.selectedDeck`

**Failure to follow these rules will cause:**
- Dropdown not updating when deck is selected
- User having no visual feedback that selection was made
- Page reload required to see correct deck

### Deployment (GitHub Pages + ngrok)
1. **Build for GitHub Pages**:
   ```bash
   npm run build:gh-pages
   ```
2. **Deploy `dist/` folder to GitHub Pages** (via GitHub UI or gh-pages CLI)
3. **Start server locally**:
   ```bash
   npm run dev
   ```
4. **Expose via ngrok**:
   ```bash
   ngrok http 8822
   ```
5. **Share ngrok URL with players**:
   - Players open GitHub Pages URL
   - Click Settings (gear icon in main menu)
   - Enter WebSocket URL: `wss://xxxx-xxxx.ngrok-free.app`
   - Click "Save and Apply"
   - Connection status should show "Connected" (green)

### Merging
- **Build & Test**:
   ```bash
   docker build -t newavalonskirmish .
   docker run -d -p 8822:8080 --name test newavalonskirmish
   ```
   Test on `http://localhost:8822`
   - check static files served and contain changes
   - make request to server to check it works
   - establish websocket connection
   - IF something wrong use `docker logs newavalonskirmish` and find root cause, dive in and start fixing
- **Create branch**: `git checkout -b feature-name` (mandatory)
- **Update version***: this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
   - Update package.json version
   - Update CHANGELOG.md with new version
- **Commit & Push**: `git add . && git commit -m "{{VERSION}} {{CHANGES}}" && git push`
- **Code Review**: Wait 2-5 mins, read GitHub PR comments from coderabbit
- **Merge**: If OK, squash merge to main
- **Deploy**: Push to main triggers GitHub Pages auto-deploy

## Project Structure

```text
/
├── client/                       # Client-side application
│   ├── components/               # React UI components (23 files)
│   │   ├── GameBoard.tsx         # React.FC({board: Board, isGameStarted: boolean, activeGridSize: GridSize, handleDrop: (item: DragItem, target: DropTarget) => void, draggedItem: DragItem | null, setDraggedItem: (item: DragItem | null) => void, openContextMenu: (e: React.MouseEvent, type: 'boardItem' | 'emptyBoardCell', data: any) => void, playMode: { card: Card; sourceItem: DragItem; faceDown?: boolean } | null, setPlayMode: (mode: null) => void, highlight: HighlightData | null, playerColorMap: Map<number, PlayerColor>, localPlayerId: number | null, onCardDoubleClick: (card: Card, boardCoords: { row: number; col: number }) => void, onEmptyCellDoubleClick: (boardCoords: { row: number; col: number }) => void, imageRefreshVersion?: number, cursorStack: { type: string; count: number } | null, currentPhase?: number, activePlayerId?: number, onCardClick?: (card: Card, boardCoords: { row: number; col: number }) => void, onEmptyCellClick?: (boardCoords: { row: number; col: number }) => void, validTargets?: {row: number, col: number}[], noTargetOverlay?: {row: number, col: number} | null, disableActiveHighlights?: boolean, preserveDeployAbilities?: boolean, activeFloatingTexts?: FloatingTextData[], abilitySourceCoords?: { row: number, col: number } | null, abilityCheckKey?: number})
│   │   ├── PlayerPanel.tsx       # React.FC({player: Player, isLocalPlayer: boolean, localPlayerId: number | null, isSpectator: boolean, isGameStarted: boolean, onNameChange: (name: string) => void, onColorChange: (color: PlayerColor) => void, onScoreChange: (delta: number) => void, onDeckChange: (deckType: DeckType) => void, onLoadCustomDeck: (deckFile: CustomDeckFile) => void, onDrawCard: () => void, handleDrop: (item: DragItem, target: DropTarget) => void, draggedItem: DragItem | null, setDraggedItem: (item: DragItem | null) => void, openContextMenu: (e: React.MouseEvent, type: ContextMenuParams['type'], data: ContextMenuData) => void, onHandCardDoubleClick: (player: Player, card: Card, index: number) => void, playerColorMap: Map<number, PlayerColor>, allPlayers: Player[], localPlayerTeamId?: number, activePlayerId?: number, onToggleActivePlayer: (playerId: number) => void, imageRefreshVersion: number, layoutMode: 'list-local' | 'list-remote', onCardClick?: (player: Player, card: Card, index: number) => void, validHandTargets?: { playerId: number, cardIndex: number }[], onAnnouncedCardDoubleClick?: (player: Player, card: Card) => void, currentPhase: number, disableActiveHighlights?: boolean, preserveDeployAbilities?: boolean, roundWinners?: Record<number, number[]>, startingPlayerId?: number, onDeckClick?: (playerId: number) => void, isDeckSelectable?: boolean})
│   │   ├── Card.tsx              # React.FC with split props: CardCoreProps({card: Card, isFaceUp: boolean, playerColorMap: Map<number, PlayerColor>, imageRefreshVersion?: number, smallStatusIcons?: boolean, extraPowerSpacing?: boolean, hidePower?: boolean}) and CardInteractionProps({localPlayerId?: number | null, disableTooltip?: boolean, activePhaseIndex?: number, activePlayerId?: number, disableActiveHighlights?: boolean, preserveDeployAbilities?: boolean, activeAbilitySourceCoords?: { row: number, col: number } | null, boardCoords?: { row: number, col: number } | null, abilityCheckKey?: number})
│   │   ├── Header.tsx            # React.FC with InvitePlayerMenu for game invites (copy link with gameId + encoded server URL), StatusIndicator (connection status), RoundTracker, PhaseControls, GameSettings menu
│   │   ├── MainMenu.tsx          # React.FC with connectionStatus and forceReconnect props, passes to SettingsModal
│   │   ├── TopDeckView.tsx       # React.FC({players: Player[], localPlayerId: number | null, gameState: GameState | null, onPlayerClick: (playerId: number) => void, t: (key: string) => string})
│   │   ├── JoinGameModal.tsx     # React.FC({isOpen: boolean, onClose: () => void, onJoin: (data: { playerName: string; gameCode: string }) => void, games: any[]})
│   │   ├── TeamAssignmentModal.tsx # React.FC({players: Player[], gameMode: GameMode, onCancel: () => void, onConfirm: (teams: any) => void})
│   │   ├── ReadyCheckModal.tsx   # React.FC({players: Player[], localPlayer: Player, onReady: () => void, onCancel: () => void})
│   │   ├── CardDetailModal.tsx   # React.FC({card: Card | null, ownerPlayer: Player | null, onClose: () => void, statusDescriptions: Record<string, string>, allPlayers: Player[], imageRefreshVersion?: number})
│   │   ├── DeckViewModal.tsx     # React.FC({isOpen: boolean, onClose: () => void, title: string, player: Player, cards: Card[], setDraggedItem: (item: DragItem | null) => void, onCardContextMenu: (e: React.MouseEvent, card: Card, source: string) => void, onCardDoubleClick: (card: Card, source: string) => void, onCardClick: (card: Card, source: string) => void, canInteract: boolean, isDeckView?: boolean, playerColorMap: Map<number, PlayerColor>, localPlayerId: number | null, imageRefreshVersion?: number, highlightFilter?: string})
│   │   ├── TokensModal.tsx       # React.FC({isOpen: boolean, onClose: () => void, setDraggedItem: (item: DragItem | null) => void, openContextMenu: (e: React.MouseEvent, type: string, data: any) => void, canInteract: boolean, anchorEl: HTMLElement | null, imageRefreshVersion?: number, draggedItem: DragItem | null})
│   │   ├── CountersModal.tsx     # React.FC({isOpen: boolean, onClose: () => void, setDraggedItem: (item: DragItem | null) => void, canInteract: boolean, anchorEl: HTMLElement | null, imageRefreshVersion?: number, onCounterMouseDown: (counter: any) => void, cursorStack: { type: string; count: number } | null})
│   │   ├── DeckBuilderModal.tsx  # React.FC({isOpen: boolean, onClose: () => void, setViewingCard: (card: Card | null) => void}) - Now supports text deck format (.txt) export/import with format "Nx Card Name"
│   │   ├── SettingsModal.tsx     # React.FC({isOpen, onClose, onSave, connectionStatus, onReconnect}) - Server URL config, reconnect button, connection status indicator, Copy Game Link button (only active when connected)
│   │   ├── RulesModal.tsx        # React.FC({isOpen: boolean, onClose: () => void})
│   │   ├── CommandModal.tsx      # React.FC({isOpen: boolean, card: Card | null, playerColorMap: Map<number, PlayerColor>, onConfirm: (command: string) => void, onCancel: () => void})
│   │   ├── CounterSelectionModal.tsx # React.FC({isOpen: boolean, data: any, onConfirm: (counterId: string) => void, onCancel: () => void})
│   │   ├── RevealRequestModal.tsx # React.FC({fromPlayer: Player, cardCount: number, onAccept: () => void, onDecline: () => void})
│   │   ├── RoundEndModal.tsx     # React.FC({gameState: GameState, onConfirm: () => void, localPlayerId: number | null, onExit: () => void})
│   │   ├── ContextMenu.tsx       # React.FC({x: number, y: number, items: ContextMenuItem[], onClose: () => void})
│   │   └── Tooltip.tsx           # React.FC({x: number; y: number; children: React.ReactNode}) + export { Tooltip, CardTooltipContent }
│   ├── contexts/                 # React Context providers
│   └── LanguageContext.tsx       # export const LanguageProvider: React.FC<{ children: ReactNode }>, export const useLanguage: () => {language: LanguageCode; setLanguage: (lang: LanguageCode) => void; t: (key: keyof TranslationResource['ui']) => string; getCardTranslation: (cardId: string) => CardTranslation | undefined; getCounterTranslation: (type: string) => { name: string; description: string } | undefined; resources: TranslationResource; isRTL: boolean}
│   ├── hooks/                    # Custom React hooks (4 files)
│   │   ├── useGameState.ts       # export const useGameState: () => {gameState: GameState, localPlayerId: number | null, setLocalPlayerId: (id: number | null) => void, draggedItem: DragItem | null, setDraggedItem: (item: DragItem | null) => void, connectionStatus: ConnectionStatus ('Connecting' | 'Connected' | 'Disconnected'), gamesList: any[], latestHighlight: HighlightData | null, latestFloatingTexts: FloatingTextData[], latestNoTarget: {row: number, col: number} | null, setTargetingMode, clearTargetingMode, createGame, joinGame, requestGamesList, exitGame, startReadyCheck, cancelReadyCheck, playerReady, assignTeams, setGameMode, setGamePrivacy, setActiveGridSize, setDummyPlayerCount, updatePlayerName, changePlayerColor, updatePlayerScore, changePlayerDeck, loadCustomDeck, drawCard, shufflePlayerDeck, playCard, moveCard, returnCardToHand, announceCard, endTurn, playCounter, playToken, destroyCard, addCommand, cancelPendingCommand, executePendingCommand, handleQuickDrop, forceReconnect}
│   │   ├── useAppCommand.ts      # export const useAppCommand: ({gameState, localPlayerId, draggedItem, setDraggedItem, openContextMenu, playMode, setPlayMode, setCursorStack, playerColorMap}) => {playCard, moveCard, returnCardToHand, announceCard, endTurn, playCounter, playToken, destroyCard, addCommand, cancelPendingCommand, executePendingCommand, handleQuickDrop}
│   │   ├── useAppAbilities.ts    # export const useAppAbilities: ({gameState, localPlayerId, setCursorStack, playerColorMap}) => {handleDeployAbility}
│   │   └── useAppCounters.ts     # export const useAppCounters: ({gameState, localPlayerId}) => {handleStackInteraction}
│   ├── utils/                    # Client-side utilities (6 files)
│   │   ├── boardUtils.ts         # export const createInitialBoard: () => Board, export const recalculateBoardStatuses: (gameState: GameState) => Board
│   │   ├── targeting.ts          # export const validateTarget: (action: AbilityAction, sourceCardId: string, targetCardId: string, sourceCoords: {row: number, col: number}, targetCoords: {row: number, col: number}, gameState: GameState, playerId: number) => boolean, export const calculateValidTargets: (action: AbilityAction, sourceCardId: string, sourceCoords: {row: number, col: number}, gameState: GameState, playerId: number, commandContext?: CommandContext) => {row: number, col: number}[], export const checkActionHasTargets: (action: AbilityAction, currentGameState: GameState, playerId: number | null, commandContext?: CommandContext) => boolean
│   │   ├── commandLogic.ts       # export const getCommandAction: (cardId: string) => AbilityAction[]
│   │   ├── autoAbilities.ts      # export const canActivateAbility: (card: Card, phaseIndex: number, activeTurnPlayerId: number | undefined) => boolean, export const getCardAbilityAction: (card: Card, gameState: GameState, trigger: 'deploy' | 'turn_start' | 'turn_end', sourceCoords?: {row: number, col: number}) => AbilityAction[]
│   │   ├── textFormatters.ts     # export const formatAbilityText: (ability: string) => React.ReactNode
│   │   ├── textDeckFormat.ts     # Text-based deck format parser/exporter (format: "Nx Card Name"), export const parseTextDeckFormat: (textContent: string) => TextDeckParseResult, export const exportToTextDeckFormat: (deckFile: CustomDeckFile) => string
│   │   └── deckValidation.ts     # export const validateDeckData: (data: any) => DeckValidationResult
│   ├── locales/                  # Translation system
│   │   ├── index.ts              # export const resources: Record<LanguageCode, TranslationResource>, export const LANGUAGE_NAMES: Record<LanguageCode, string>, export const AVAILABLE_LANGUAGES (en, ru, sr), includes new translations: saveJson, saveText, loadTextDeck, cannotSaveEmptyDeck
│   │   ├── types.ts              # type LanguageCode, interface CardTranslation, interface CounterTranslation, interface TranslationResource
│   │   └── ru.ts, sr.ts          # Translation files with same structure as en
│   ├── App.tsx                   # export default function App - includes useEffect for auto-joining games from invite links (checks sessionStorage for invite_game_id)
│   ├── index.tsx                 # Entry point - parses URL params (game, s) for invite links, stores invite_game_id in sessionStorage, decodes and saves WebSocket URL to localStorage
│   ├── types.ts                  # enum DeckType, enum GameMode, type SpecialItemType, type PlayerColor, type GridSize, interface CardStatus, interface CounterDefinition, interface Card, interface Player, interface Cell, type Board, type CardIdentifier, interface RevealRequest, interface HighlightData, interface FloatingTextData, interface TargetingModeData, interface GameState, interface DragItem, interface DropTarget, interface CustomDeckCard, interface CustomDeckFile, type ContextMenuItem, type ContextMenuParams, interface CursorStackState, interface CommandContext
│   ├── constants.ts              # export const MAX_PLAYERS, DECK_THEMES, PLAYER_COLORS, FLOATING_TEXT_COLORS, PLAYER_COLOR_NAMES, TURN_PHASES, STATUS_ICONS, STATUS_DESCRIPTIONS, AVAILABLE_COUNTERS, COUNTERS, shuffleDeck, PLAYER_POSITIONS
│   ├── contentDatabase.ts        # export const rawJsonData, export type CardDefinition, export const cardDatabase, export const tokenDatabase, export const countersDatabase, export const deckFiles, export const commandCardIds, export const decksData, export const getSelectableDecks, export function getCardDefinition, export function getCardDefinitionByName, export function getAllCards
│   ├── vite.config.ts            # export default defineConfig: (options: { command: string }) => UserConfig
│   └── index.css                 # (no exports - global styles)
├── server/                       # Server-side application
│   ├── services/                 # Core services (6 files)
│   │   ├── websocket.ts          # export function setupWebSocket(wss), export function broadcastToGame(gameId, gameState, excludeClient), export function sendToClient(client, message), export function broadcastToGameMessage(gameId, message, excludeClient)
│   │   ├── gameState.ts          # export function createGameState(gameId, options), export function getGameState(gameId), export function updateGameState(gameId, updates), export function deleteGameState(gameId), export function addPlayerToGame(gameId, player), export function removePlayerFromGame(gameId, playerId), export function getAllGameStates(), export function getPublicGames(), export function associateClientWithGame(client, gameId), export function getGameIdForClient(client), export function removeClientAssociation(client), export function getClientGameMap(), export function logGameAction(gameId, action), export function getGameLogs(gameId), export function clearGameTimers(gameId), export function getGameStats()
│   │   ├── gameLifecycle.ts      # export const gameTerminationTimers, export const gameInactivityTimers, export const playerDisconnectTimers, export function logToGame(gameId, message, gameLogs), export function endGame(gameId, reason, gameLogs, wss), export function resetInactivityTimer(gameId, gameLogs, wss), export function convertPlayerToDummy(gameId, playerId, gameLogs, wss, broadcastToGame), export function scheduleGameTermination(gameId, gameLogs, wss), export function cancelGameTermination(gameId, gameLogs), export function handlePlayerLeave(gameId, playerId, isManualExit, gameLogs, wss, broadcastToGame, broadcastGamesListFn), export function broadcastGamesList(gameLogs, wss)
│   │   ├── content.ts            # export function getCardDefinition(cardId), export function getTokenDefinition(tokenId), export function getCounterDefinition(counterId), export function getDeckFiles(), export function getAllCards(), export function getAllTokens(), export function getAllCounters(), export function setCardDatabase(cards), export function setTokenDatabase(tokens), export function setDeckFiles(decks)
│   │   └── rateLimit.ts          # export function isRateLimited(client), export function cleanupRateLimitData(client), export function getRateLimitStatus(client)
│   ├── handlers/                 # WebSocket message handlers (7 modules)
│   │   ├── gameManagement.ts     # export function handleSubscribe(ws, data), export function handleUpdateState(ws, data), export function handleJoinGame(ws, data), export function handleExitGame(ws, data), export function handleForceSync(ws, data)
│   │   ├── readyCheck.ts         # export function handleStartReadyCheck(ws, data), export function handleCancelReadyCheck(ws, data), export function handlePlayerReady(ws, data)
│   │   ├── gameSettings.ts       # export function handleSetGameMode(ws, data), export function handleSetGamePrivacy(ws, data), export function handleAssignTeams(ws, data), export function handleSetGridSize(ws, data)
│   │   ├── visualEffects.ts      # export function handleTriggerHighlight(ws, data), export function handleTriggerNoTarget(ws, data), export function handleTriggerFloatingText(ws, data), export function handleTriggerFloatingTextBatch(ws, data), export function handleSyncHighlights(ws, data), export function handleSyncValidTargets(ws, data), export function handleTriggerDeckSelection(ws, data), export function handleTriggerHandCardSelection(ws, data), export function handleSetTargetingMode(ws, data), export function handleClearTargetingMode(ws, data)
│   │   ├── deckData.ts           # export function handleUpdateDeckData(ws, data)
│   │   ├── playerSettings.ts     # export function handleUpdatePlayerName(ws, data), export function handleChangePlayerColor(ws, data), export function handleUpdatePlayerScore(ws, data), export function handleChangePlayerDeck(ws, data), export function handleLoadCustomDeck(ws, data), export function handleSetDummyPlayerCount(ws, data), export function handleLogGameAction(ws, data), export function handleGetGameLogs(ws, data)
│   │   └── phaseManagement.ts    # export function handleToggleAutoAbilities(ws, data), export function handleNextPhase(ws, data), export function handlePrevPhase(ws, data), export function handleSetPhase(ws, data), export function performDrawPhase(gameState), export function handleToggleAutoDraw(ws, data), export function handleToggleActivePlayer(ws, data), export function handleStartNextRound(ws, data), export function handleStartNewMatch(ws, data), includes getRoundVictoryThreshold(round), checkRoundEnd(gameState), endRound(gameState)
│   ├── utils/                    # Server utilities (4 files)
│   │   ├── logger.ts             # export const logger: Logger (info, warn, error, debug methods)
│   │   ├── config.ts             # export const CONFIG: {MAX_PLAYERS, MAX_ACTIVE_GAMES, MAX_MESSAGE_SIZE, MAX_GAME_STATE_SIZE, MAX_STRING_LENGTH, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW, INACTIVITY_TIMEOUT, GAME_CLEANUP_DELAY, PLAYER_DUMMY_DELAY}, export function validateConfig()
│   │   ├── security.ts           # export function sanitizeString(input, maxLength), export function sanitizePlayerName(name), export function validateGameStateSize(gameState), export function validateMessageSize(message), export function generateSecureGameId()
│   │   └── deckUtils.ts          # export const COMMAND_CARD_IDS: Set<string>, export function shuffleDeck<T>(deck: T[]): T[], export function generatePlayerToken(): string, export function createDeck(deckType, playerId, playerName): any[], export function createNewPlayer(id, isDummy): any
│   ├── constants/                # Server constants
│   │   └── playerColors.ts       # export const PLAYER_COLOR_MAP: Map<string, PlayerColor>
│   ├── content/                  # Game content data
│   │   └── contentDatabase.json  # Cards, tokens, decks definitions
│   └── dev.ts                    # Development server entry point (no exports)
├── Dockerfile                    # (no exports - build configuration)
├── index.html                    # (no exports - HTML template)
├── package.json                  # (no exports - dependencies and scripts)
├── tsconfig.json                 # (no exports - TypeScript config)
├── tsconfig.client.json          # (no exports - TypeScript config (client override))
├── tsconfig.server.json          # (no exports - TypeScript config (server))
├── vite.config.ts                # Vite configuration with BASE_URL support for GitHub Pages
├── .env.example                  # Environment variables template
├── .gitignore                    # Git ignore patterns (includes .env)
├── README.md                     # Project README with deployment instructions
├── DEPLOYMENT.md                 # Detailed deployment guide
└── CLAUDE.md                     # This file - development guide
```

## Key Dependencies

### Core Runtime

- **React 18.2.0**: UI framework (components + hooks)
- **Express 5.2.1**: HTTP server + middleware
- **express-ws 5.0.2**: WebSocket integration
- **ws 8.17.1**: WebSocket protocol implementation
- **tsx 4.21.0**: TypeScript executor for Node.js server development
- **Vite 5.2.11**: Build tool + dev server + HMR

### Build & Styling

- **@vitejs/plugin-react 4.2.1**: React JSX support
- **Tailwind CSS 3.4.3**: Utility-first CSS framework
- **PostCSS 8.4.38**: CSS processing pipeline
- **Autoprefixer 10.4.19**: CSS vendor prefixing
- **TypeScript 5.4.5**: Type checking and compilation

## API Flow

### Server-to-Client Game State Broadcast
1. **server/services/websocket.ts** - `broadcastToGame(gameId, gameState, excludeClient)` (line 287)
2. **server/services/websocket.ts** - `sanitizeGameState(gameState)` removes `ws` references (line 327)
3. **server/services/websocket.ts** - Iterate `wssInstance.clients`, check `clientGameMap.get(client) === gameId` (line 296-307)
4. **client/hooks/useGameState.ts** - `ws.current.onmessage = (event) =>` (line 201)
5. **client/hooks/useGameState.ts** - `const data = JSON.parse(event.data)` (line 203)
6. **client/hooks/useGameState.ts** - `setGameState(data)` → React state update (line 244)

### Client-to-Server Action Flow
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify(payload))` (line 283)
2. **server/services/websocket.ts** - `ws.on('message', message =>` (line 85)
3. **server/services/websocket.ts** - `data = JSON.parse(message.toString())` (line 131)
4. **server/services/websocket.ts** - `routeMessage(ws, data)` → handler dispatch (line 152, line 166)
5. **server/services/websocket.ts** - `broadcastToGame(gameId, updatedGameState)` (called by handlers)

### Games List Request
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'GET_GAMES_LIST' }))` (line 317)
2. **server/services/websocket.ts** - `routeMessage` → `handleGetGamesList` (line 167, line 343)
3. **server/services/gameState.ts** - `getPublicGames()` filters non-private games (line 151)
4. **server/services/websocket.ts** - `sendToClient(ws, { type: 'GAMES_LIST', games: publicGames })` (line 345)
5. **client/hooks/useGameState.ts** - `if (data.type === 'GAMES_LIST') { setGamesList(data.games) }` (line 204)

### Game Join Flow
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'JOIN_GAME', gameId, playerToken }))` (line 188-194)
2. **server/services/websocket.ts** - `routeMessage` → `handleJoinGame` (line 170)
3. **server/handlers/gameManagement.ts** - `associateClientWithGame(ws, gameId)` (line 119)
4. **server/handlers/gameManagement.ts** - `ws.send(JSON.stringify({ type: 'JOIN_SUCCESS', playerId, playerToken }))` (line 204-207)
5. **server/handlers/gameManagement.ts** - `broadcastToGame(gameId, gameState)` (line 210)
6. **client/hooks/useGameState.ts** - `if (data.type === 'JOIN_SUCCESS') { setLocalPlayerId(data.playerId) }` (line 206)

### Invite Link System
#### Invite Link Creation (Header.tsx → handleCopyLink)
1. **client/components/Header.tsx** - `handleCopyLink()` creates invite link (line 317-344)
2. Get baseUrl: `window.location.origin` (e.g., `http://localhost:8822/`)
3. Get WebSocket URL from `localStorage.getItem('websocket_url')`
4. Encode WebSocket URL: `btoa(encodeURIComponent(wsUrl))`
5. Create invite link: `${baseUrl}?game=${gameId}&s=${encodedServerUrl}`

#### Invite Link Processing (index.tsx)
1. **client/index.tsx** - Parse URL parameters on app load (line 8-39)
2. `game` parameter → `sessionStorage.setItem('invite_game_id', inviteGameId)`
3. `s` parameter → decode and save to both `localStorage.setItem('websocket_url', decodedUrl)` and `localStorage.setItem('custom_ws_url', decodedUrl)`
4. Clear URL parameters from browser address bar: `window.history.replaceState({}, '', window.location.pathname)`

#### Auto-Join Flow (App.tsx)
1. **client/App.tsx** - `useEffect` checks for invite game ID (line 1071-1081)
2. When connected (`connectionStatus === 'Connected'`) and invite exists:
   - `handleJoinGame(inviteGameId)` is called
   - `sessionStorage.removeItem('invite_game_id')` clears the invite

#### WebSocket URL Management
- **custom_ws_url**: User-configured server URL (from Settings modal)
- **websocket_url**: Active/verified server URL (saved by getWebSocketURL and onopen handler)
- **client/hooks/useGameState.ts** - `getWebSocketURL()` saves validated URL to `websocket_url` (line 41)
- **client/hooks/useGameState.ts** - `ws.current.onopen` saves active URL to `websocket_url` (line 370)

### Copy Game Link (SettingsModal)
1. **client/components/SettingsModal.tsx** - `handleCopyGameLink()` (line 95-121)
2. Gets baseUrl: `window.location.origin`
3. Gets active server URL: `localStorage.getItem('websocket_url')`
4. Creates link: `${baseUrl}?s=${encodedServerUrl}` (no game ID, just server config)
5. Button only active when `isConnected && !hasUnsavedChanges`

### Host Game Creation & Deck Sync
1. **client/hooks/useGameState.ts** - Player 1 sends: `ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))` (line 311)
2. **server/services/websocket.ts** - `routeMessage` → `handleUpdateDeckData` (line 176)
3. **client/hooks/useGameState.ts** - Delay 500ms resend: `ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))` (line 221-224)
4. **server/handlers/deckData.ts** - Load deck data: `cardDatabase = deckData.cards; tokenDatabase = deckData.tokens;`

### Real-time Visual Effects
#### Highlight Trigger
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'TRIGGER_HIGHLIGHT', gameId, highlightData }))` (line 1391)
2. **server/services/websocket.ts** - `routeMessage` → `handleTriggerHighlight` (line 195)
3. **server/handlers/visualEffects.ts** - Broadcast: `JSON.stringify({ type: 'HIGHLIGHT_TRIGGERED', highlightData })`
4. **client/hooks/useGameState.ts** - `if (data.type === 'HIGHLIGHT_TRIGGERED') { setLatestHighlight(data.highlightData) }` (line 235)

#### Floating Text
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'TRIGGER_FLOATING_TEXT_BATCH', gameId, batch }))` (line 1400)
2. **server/services/websocket.ts** - `routeMessage` → `handleTriggerFloatingTextBatch` (line 197)
3. **client/hooks/useGameState.ts** - `if (data.type === 'FLOATING_TEXT_BATCH_TRIGGERED') { setLatestFloatingTexts(data.batch) }` (line 239-242)

#### No Target Overlay
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'TRIGGER_NO_TARGET', gameId, coords, timestamp }))` (line 1410)
2. **server/services/websocket.ts** - `routeMessage` → `handleTriggerNoTarget` (line 198)
3. **client/hooks/useGameState.ts** - `if (data.type === 'NO_TARGET_TRIGGERED') { setLatestNoTarget({ coords: data.coords, timestamp: data.timestamp }) }` (line 237-238)

### Universal Targeting Mode System
The universal targeting mode system provides a synchronized way to show valid targets to all players when any player activates an ability, command, or multi-step action that requires targeting.

#### Targeting Mode Activation
1. **client/hooks/useGameState.ts** - `setTargetingMode(action, playerId, sourceCoords?, commandContext?)` (line 2515-2561)
   - Calculates valid board targets using `calculateValidTargetsUtil` from server/utils/targeting.ts
   - Creates `TargetingModeData` object with action, playerId, sourceCoords, timestamp, boardTargets
   - Updates local gameState.targetingMode immediately
   - Broadcasts `SET_TARGETING_MODE` message to server
2. **server/services/websocket.ts** - `routeMessage` → `handleSetTargetingMode` (line 215)
3. **server/handlers/visualEffects.ts** - `handleSetTargetingMode()` (line 642-703)
   - Validates gameId and targetingMode data
   - Updates gameState.targetingMode on server
   - Broadcasts `TARGETING_MODE_SET` to all clients
4. **client/hooks/useGameState.ts** - `if (data.type === 'TARGETING_MODE_SET')` (line 641-654)
   - All clients update their local gameState.targetingMode
   - Visual highlights appear on GameBoard using the targeting player's color

#### Targeting Mode Clearing
1. **client/hooks/useGameState.ts** - `clearTargetingMode()` (line 2567-2586)
   - Clears local gameState.targetingMode
   - Broadcasts `CLEAR_TARGETING_MODE` message to server
2. **server/services/websocket.ts** - `routeMessage` → `handleClearTargetingMode` (line 216)
3. **server/handlers/visualEffects.ts** - `handleClearTargetingMode()` (line 709-762)
   - Clears gameState.targetingMode on server
   - Broadcasts `TARGETING_MODE_CLEARED` to all clients
4. **client/hooks/useGameState.ts** - `if (data.type === 'TARGETING_MODE_CLEARED')` (line 655-662)
   - All clients clear their local gameState.targetingMode
   - Visual highlights are removed

#### Visual Display (GameBoard)
- **client/components/GameBoard.tsx** - `targetingMode` prop (line 37)
- Valid targets from `targetingMode.boardTargets` are combined with local `validTargets`
- Each valid target cell is highlighted with dashed border in the targeting player's color
- Highlights are visible to ALL players, but only the targeting player can click to select

#### TargetingModeData Structure
```typescript
interface TargetingModeData {
  playerId: number;              // The player whose turn it is to select a target
  action: AbilityAction;         // The action defining targeting constraints
  sourceCoords?: {row: number; col: number};  // Source card coordinates (if applicable)
  timestamp: number;             // For uniqueness and timeout
  boardTargets?: {row: number, col: number}[];  // Valid board targets (pre-calculated)
  handTargets?: {playerId: number, cardIndex: number}[];  // Valid hand targets
  isDeckSelectable?: boolean;    // Whether deck is a valid target
}
```

### Game State Updates
#### Ready Check System
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'START_READY_CHECK', gameId }))` (line 348)
2. **server/services/websocket.ts** - `routeMessage` → `handleStartReadyCheck` (line 193)
3. **server/handlers/readyCheck.ts** - `updateGameState(gameId, { isReadyCheckActive: true })`
4. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'PLAYER_READY', gameId, playerId }))` (line 356)
5. **server/services/websocket.ts** - `routeMessage` → `handlePlayerReady` (line 178)
6. **server/handlers/readyCheck.ts** - `player.isReady = true` → `updateGameState` → `broadcastToGame`

### UPDATE_STATE Flow (Game Creation/Updates)
1. **client/hooks/useGameState.ts** - `updateState(gameState)` sends WebSocket message (line 145-157)
2. **server/services/websocket.ts** - `routeMessage` → `handleUpdateState` (line 177)
3. **server/handlers/gameManagement.ts** - Extract `gameState` from `data.gameState` (line 57)
4. **server/handlers/gameManagement.ts** - If game exists: `Object.assign(existingGameState, updatedGameState)` (line 82)
5. **server/handlers/gameManagement.ts** - If game doesn't exist: `createGameState(gameId, updatedGameState)` + `ws.playerId = 1` (line 88-91)
6. **server/services/websocket.ts** - `broadcastToGame(gameId, gameState)` to all clients

### RESET_GAME Flow (Optimized with Compact Message)
1. **client/hooks/useGameState.ts** - `resetGame()` sends `RESET_GAME` message (line ~1864)
2. **server/services/websocket.ts** - `routeMessage` → `handleResetGame` (line 201)
3. **server/handlers/gameManagement.ts** - `handleResetGame()` resets server-side state (line 943-1026)
4. **server/services/websocket.ts** - `broadcastToGameMessage(gameId, { type: 'GAME_RESET', ... })` sends compact message (line ~300)
   - Only sends necessary reset data (players, settings, flags)
   - Avoids sending full deck data and large game state
5. **client/hooks/useGameState.ts** - `data.type === 'GAME_RESET'` handler (line ~665)
   - Updates local gameState with reset values
   - Clears board, targetingMode, floatingTexts, currentCommand

### Phase Transition Flow (with Draw Phase)
1. **client/hooks/useGameState.ts** - `nextPhase()` called after scoring (line ~1730)
2. **client/hooks/useGameState.ts** - `completeTurn()` sets `currentPhase = -1` (Draw Phase) (line ~1725)
3. **client/hooks/useGameState.ts** - Sends `SET_PHASE` with `phaseIndex: -1` to server (line ~1749)
4. **server/handlers/phaseManagement.ts** - `handleSetPhase()` receives phaseIndex -1 (line ~329)
5. **server/handlers/phaseManagement.ts** - Calls `performDrawPhase()` to auto-draw card (line ~332)
6. **server/handlers/phaseManagement.ts** - `performDrawPhase()` sets phase to 0 (Setup) after draw (line ~201)
7. **server/services/websocket.ts** - `broadcastToGame(gameId, gameState)` with updated state

### Round Management Flow (Server-Side)
1. **server/handlers/phaseManagement.ts** - `performDrawPhase()` transitions to phase 0 (Setup)
2. **server/handlers/phaseManagement.ts** - `checkRoundEnd(gameState)` checks if round should end:
   - Only during Setup phase (0)
   - Only when first player (startingPlayerId) becomes active
   - Calculates victory threshold: `10 + (roundNumber * 10)` (Round 1: 20, Round 2: 30, etc.)
   - If any player's score >= threshold, round ends
3. **server/handlers/phaseManagement.ts** - `endRound(gameState)` determines winners:
   - Finds player(s) with highest score
   - Stores in `roundWinners[roundNumber]`
   - Checks if any player has 2 round wins → sets `gameWinner`
   - Sets `isRoundEndModalOpen = true`
4. **client/components/RoundEndModal.tsx** - Displays round results with medal icons
5. **client/hooks/useGameState.ts** - `closeRoundEndModal()` sends `START_NEXT_ROUND` message
6. **server/handlers/phaseManagement.ts** - `handleStartNextRound()` processes:
   - Increments `currentRound` (resets to 1 if game was over)
   - Resets all player scores to 0
   - Closes modal (`isRoundEndModalOpen = false`)
   - Same `startingPlayerId` continues (no rotation)
   - Cards remain on board (no reset)

### Game Start Flow (Random First Player)
1. **server/handlers/readyCheck.ts** - All players ready → game starts (line ~135-216)
2. **server/handlers/readyCheck.ts** - Randomly selects starting player:
   - Gets all non-disconnected players
   - `Math.floor(Math.random() * allPlayers.length)` selects index
   - Sets both `startingPlayerId` and `activePlayerId` to selected player
   - Triggers Draw phase for starting player (7th card after initial 6)

