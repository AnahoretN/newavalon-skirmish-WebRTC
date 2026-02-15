# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.2.11] - 2026-02-15

### Added
- **WebRTC P2P Optimization**: Implemented binary serialization for reduced bandwidth
  - MessagePack binary encoding (~72% size reduction vs JSON)
  - Differential compression for state deltas
  - Card serialization by reference (id + stats only, tokens tracked separately)
  - Optimized delta format with short property keys
  - Compact reconnect snapshot for faster guest reconnection
- **Modal System**: Unified modal management with lazy loading
  - Zustand-based state manager (`useModals` hook)
  - Centralized `ModalsRenderer` component with React.lazy
  - All 14 modals now lazy-loaded for code splitting
  - Improved `BaseModal` with smooth animations
  - Custom scrollbar styles for modal content

### Changed
- **Code Splitting**: Refactored useGameState.ts into focused modules
  - `useGameLifecycle.ts` - game creation, joining, exiting
  - `gameCreators.ts` - game ID generation, deck creation, initial state
  - `gameStateStorage.ts` - save/load/clear game state
  - `useVisualEffects.ts` - highlight and floating text effects
  - `useWebRTC.ts` - WebRTC P2P connection management
  - `useTargetingMode.ts` - universal targeting system
  - `useBoardManipulation.ts` - board operations
  - `useCardMovement.ts` - card drag-and-drop
  - `useCardOperations.ts` - card abilities and status
  - `useCardStatus.ts` - card status management
  - `useDeckManagement.ts` - deck operations
  - `useGameSettings.ts` - game configuration
  - `usePhaseManagement.ts` - phase transitions
  - `usePlayerActions.ts` - player-specific actions
  - `useReadyCheck.ts` - ready check system
  - `useScoring.ts` - score calculations
  - `websocketHelpers.ts` - WebSocket utilities
  - `types.ts` - shared type definitions

### Fixed
- **DeckType Runtime Error**: Fixed import type vs regular import causing runtime error
- **WebRTC Reconnection Loop**: Fixed infinite reconnect cycle on HMR (Hot Module Replacement)
  - Added sessionStorage flag to prevent duplicate auto-restore attempts
  - Auto-restore now works correctly on page reload but skips on HMR
- **Unused Imports**: Removed unused imports from useGameState.ts


## [0.2.10] - 2026-02-15

### Added
- **WebRTC P2P Mode**: Added peer-to-peer WebRTC support for direct player connections
  - Host can create P2P games without requiring external server
  - Guest can connect directly to host using peer ID
  - State synchronization optimized for P2P with state deltas
  - Reconnection support after page reload
  - Visual effects broadcasting across P2P connections

### Changed
- **IP Dept Agent**: Modified ability - now enters "IP_AGENT_THREAT_SCORING" mode instead of direct scoring
- **Threat Analyst**: Now grants Threat ability to own units when they have Support status
  - Units with Threat can destroy cards with owner's Exploit tokens
  - Creates new tactical opportunities with Exploit token interactions
- **Code Cleanup**: Removed unused files and duplicate code
  - Removed `client/unused_host_webrtc_old/` directory
  - Removed `client/webrtc/` old implementation
  - Removed unused hooks: `useContentDatabase.ts`, `useWebRTC.ts`
  - Removed duplicate utilities: `server/utils/boardUtils.ts`, `server/utils/targeting.ts`
  - Removed duplicate `client/utils/webrtcStatePersistence.ts`
- **TypeScript**: Fixed all type errors
  - Added missing `Random` to server `DeckType` enum
  - Added `MODIFY_SCORE` to `AbilityAction` type
  - Unified `WebrtcMessageType` across modules
  - Added type assertions for client/server type compatibility
- **Version**: Updated project version to 0.2.10


## [0.2.8t] - 2026-01-27

### Added
- **Round Management**: Added "Start Round X" button to Round Y Complete modal
  - Resets all player scores to 0
  - Closes the modal
  - Increments round number
  - Prevents modal from reopening immediately after starting new round

### Changed
- **Logging System**: Simplified and centralized logging
  - Removed unnecessary client-side debug logs
  - Server logs now only show session lifecycle events (game creation, player join/leave, game end)
  - Detailed game actions are logged to separate game-specific log files
  - Centralized WebSocket message validation in security.ts

### Fixed
- **handleTriggerHighlight**: Restored missing export in visualEffects.ts


## [0.2.7t] - 2026-01-21

### Added
- **Text Deck Format**: New deck save/load system using plain text format
  - Format: "Nx Card Name" (quantity followed by 'x' and card name)
  - Cards sorted alphabetically
  - Supports localized card names (English, Russian, Serbian)
  - Strict security validation with file size limits (max 10KB) and line length limits (max 200 chars)
  - Input sanitization removing control characters and suspicious patterns
- **Deck Quantity Rules**: Enforced limits per card type
  - Hero and Rarity cards: max 1 per deck
  - Command cards: max 2 per deck
  - Other cards: max 3 per deck
  - Any violation prevents file loading with clear error message

### Changed
- Deck Builder now only supports text format (.txt) for save/load
  - Removed JSON export option
  - Simplified UI with Clear, Load Text, and Save Text buttons
  - Updated button colors: Save Text now matches Close (indigo), Clear matches Load (gray)

### Fixed
- **Critical Card Ownership Bug**: Fixed issue where playing a card from hand would remove the same card from other players' hands/decks
  - Server now checks both card ID AND ownerId when removing duplicates from board/announced slots
  - Cards with same type (same ID) but different owners are now treated independently
  - Client-side moveItem also enhanced with ownerId verification
- **Logistics Chain**: Fixed to NOT advance phase after scoring/selecting diagonal

### Added
- **Universal Targeting Mode System**: Targeting highlights are now synchronized across all players
  - When any player activates an ability requiring targeting, all players see the valid targets highlighted
  - Target highlights use the activating player's color for visual distinction
  - TargetingModeData structure includes playerId, action, sourceCoords, and boardTargets
- **Target Selection Visual Effect**: White ripple animation (1s duration) when a player makes a target selection
  - Broadcast to all players via WebSocket
  - Auto-removes after animation completes
  - Works for both board and hand targets
- **4-Phase Tracker**: Added visual phase tracker showing all 4 phases (Setup/Main/Commit/Scoring)
- **Player-Colored Ready Effects**: Ready ability highlights now use each player's color
  - Card glow effect shows owner's color when ability is ready to activate
  - Inner glow and overlay effects scale with card power (higher power = more visible)
- **Shared Visual Effects**: All visual effects (highlights, floating texts, no-target overlays) are now broadcast to all players

### Changed
- Phase transitions now skip automatically when using certain command cards (e.g., Logistics Chain)


## [0.2.6t] - 2026-01-20

### Fixed
- **ABR Gawain Deploy**: Fixed targeting - can now Aim any card in its line (not just threats)
- **ABR Gawain Shield**: Fixed duplicate Shield status by adding Shield to unique statuses list
- **Reckless Provocateur Deploy**: Fixed swap positions ability - now correctly swaps with adjacent cards
- **Card Click Event Bubbling**: Fixed double-triggering by adding stopPropagation to Card component click handler
- **Auto-Draw System**: Completely refactored to prevent duplicate card draws
  - Auto-draw now only triggers when ENTERING Setup phase from a different phase (Scoring/Main/Commit)
  - No longer draws on game start when beginning in Setup phase
  - No longer draws on page refresh when already in Setup phase
  - Removed duplicate server-side auto-draw from `handleToggleActivePlayer`
  - Starting hand draw changed: all players now draw 6 cards (first player no longer gets 7)
  - First player's extra card now comes from client-side auto-draw on first turn transition

### Added
- **4-Phase Tracker**: Added visual phase tracker showing all 4 phases (Setup/Main/Commit/Scoring)
- **Player-Colored Ready Effects**: Ready ability highlights now use each player's color
  - Card glow effect shows owner's color when ability is ready to activate
  - Inner glow and overlay effects scale with card power (higher power = more visible)
- **Shared Visual Effects**: Highlight effects are now broadcast to all players with player-colored distinction


## [0.2.5t] - 2026-01-03

### Fixed
- **Tunnel Compatibility**: Fixed WebSocket connections dropping when using ngrok or cloudflared tunnels
  - Removed CONNECTION_ESTABLISHED message that was sent immediately on connect
  - Added explicit `app.ws('/', ...)` route before Vite middleware for proper tunnel handshake
  - Server now waits for client to send first message before responding

### Changed
- Version now automatically sourced from `package.json` via virtual Vite module
- Removed hardcoded `client/version.ts` file
- Removed unused `autoJoin` variable from invite link parsing

### Fixed
- Fixed ESLint warnings (removed console.log statements, unused imports)
- Fixed TypeScript type errors


## [0.2.5] - 2025-12-30

### Changed
- **UI/UX Improvements for Remote Player Panels**
  - Unified card sizing: all cards in hand now use aspect-square for consistent square shape
  - Local player hand cards are 15% larger than deck cards
  - Remote player panel resources (deck, discard, showcase, score) sized at 96% of hand card size
  - Score counter uses aspect-square with each button at 1/3 height
  - Removed horizontal gaps between remote player panels for cleaner layout
  - Vertical spacing between resources and hand cards now uses gap-1 (same as between cards)
  - Scrollbar restored for hand cards in remote panels
  - Player name dynamically shrinks to accommodate status icons (star, medal, checkbox)
  - Status icons (active player checkbox, win stars) absolutely positioned in top-right corner
  - Compact color picker for remote panels (smaller, rounded-sm, no arrow icon)
  - Deck select for dummy players moved to header row in remote panels

### Fixed
- Counter icons now load immediately after page refresh by caching in localStorage
- Improved game state restoration on reconnect with playerToken support
- RemoteScore component properly sized to match deck dimensions

### Fixed
- Fixed deck data sync - server now correctly preserves `cards` array with `cardId/quantity` format when receiving deck data from client
- Fixed ability text formatting - `sanitizeString` now preserves newlines (\n) for proper multi-line ability display in tooltips
- Fixed issue where deckFiles were sent without cards array causing empty decks in game sessions

### Added
- GitHub Actions workflow (`.github/workflows/docker.yml`) for automatic Docker builds on push to master
- Docker images now pushed to GitHub Container Registry (`ghcr.io/uz0/newavalonskirmish`)


## [0.2.2] - 2025-12-29

### Fixed
- Fixed Faber and Lucius discard abilities validation - no longer incorrectly show "no target" when player has cards in hand
- Fixed target validation for hand-only actions that require discarding (SELECT_HAND_FOR_DISCARD_THEN_SPAWN, LUCIUS_SETUP, SELECT_HAND_FOR_DEPLOY)
- Fixed Zius ability - now correctly targets only cells in the same row or column as the Exploit target card
- Fixed floating score numbers not displaying - added immediate local state update in triggerFloatingText
- Fixed visual effect broadcasting to prevent duplicates by excluding sender from broadcast
- Fixed token placement mode - now persists on invalid targets instead of closing; only closes on valid target placement, right-click, or clicking outside game areas
- Fixed resurrected cards from discard (Immunis ability) - now properly initialize ready statuses so abilities can be used after returning to play

### Changed
- **Zius ability rework**: Now works like Unwavering Integrator - single-click line selection through the Exploit target card
- Updated Zius ability description in all languages to reflect simplified mechanic
- Auto-phase transition now applies to both Units and Command cards when played from hand during Setup phase
- Floating score numbers display duration set to 2 seconds
  - English: "Deploy: Exploit any card.\nSupport ⇒ Setup: Exploit any card. Gain 1 point for each of your exploits in that line."
  - Russian: "Deploy: Exploit на любую карту.\nSupport ⇒ Setup: Exploit на любую карту. Получите 1 очко за каждый ваш Exploit в этой линии."
  - Serbian: "Deploy: Exploit na bilo koju kartu.\nSupport ⇒ Setup: Exploit na bilo koju kartu. Dobij 1 bod za svaki tvoj Exploit u ovoj liniji."

### Added
- New ability mode: `ZIUS_LINE_SELECT` - single-click line selection anchored at target card position
- Special case handling in `checkActionHasTargets` for hand-only actions requiring discard
- Token ownership system: tokens from token panel are owned by active player, tokens from abilities owned by card owner
- Any player can now control dummy player's cards/tokens when dummy is the active player


## [0.2.1] - 2025-12-26

### Fixed
- Fixed IP Dept Agent Support ability - now targets any card in hand with Reveal token from same player
- Fixed Setup abilities - now only work in Setup phase (phase 0), not in Main phase
- Fixed Patrol Agent Setup ability - now properly consumes ready status when used
- Fixed Maria "Eleftheria" Damanaki Setup ability - now only works in Setup phase
- Fixed card movement - all card statuses (including ready statuses) are now preserved when moving cards on the board
- Fixed Secret Informant deploy ability - decks now properly highlight when selecting a target
- Fixed React Hooks order violation in DeckViewModal - all hooks now defined before early return

### Changed
- **Ability System Overhaul**: Replaced global ability flags with card-based ready status system (readyDeploy, readySetup, readyCommit)
- Setup abilities now work only in Setup phase (phase 0) instead of Setup + Main phases (phases 0-1)
- Main phase (phase 1) is now for manual actions only, no phase abilities
- **Content Loading Refactor**: Moved content database loading from client import to server API
- Client now fetches card/token/counter data from `/api/content/database` endpoint
- Removed client-side `contentDatabase.json` - now served exclusively by server
- Improved drag-and-drop: cards can now be dragged from deck/discard/top-deck views directly to board or hand
- `allowHandTargets` added to AbilityAction type for targeting cards in hand

### Added
- Dynamic version display in main menu - version is now sourced from `client/version.ts`
- Auto-draw feature enabled by default for all players
- Auto-draw and auto-abilities settings persist in localStorage
- Auto-phase transition: when playing a unit from hand in Setup phase with auto-abilities enabled, game automatically transitions to Main phase
- Visual ready status indicators on cards showing which abilities are available
- Deck selection highlighting (cyan glow) for abilities that target decks (Secret Informant)
- Server-side targeting utilities (`server/utils/targeting.ts`) with validation logic
- Toggle auto-draw handler (`handleToggleAutoDraw`) for per-player auto-draw settings
- New locale: Serbian (Српски) with complete UI and rules translation
- `client/version.ts` - centralized version constant

### Removed
- `client/utils/boardUtils.ts` - moved to server
- `client/utils/commandLogic.ts` - moved to server
- `client/utils/targeting.ts` - moved to server
- `client/content/contentDatabase.json` - now served from server


## [0.2.0] - 2025-12-24

### Fixed
- Fixed CodeRabbit issues: tsconfig path alias, board bounds checking, type mismatches
- Fixed DeckType import to use value import instead of type import
- Added MAX_DECK_SIZE constant export and usage
- Removed unused variables and imports across multiple files
- Fixed player lookup in websocket to use playerId instead of ws reference
- Fixed message type from LEAVE_GAME to EXIT_GAME
- Fixed playerColorMap type to use PlayerColor instead of string
- Improved type safety in GameBoard, PlayerPanel, and other components
- Resolved TypeScript import paths after restructuring
- Fixed duplicate dependency declarations
- Cleaned up root directory to contain only configuration files
- Improved type safety across client and server code
- Added type guards for GameState validation
- Enhanced counter and ability utility functions
- Improved error handling in components

### Changed
- **BREAKING**: Complete project refactoring - split client/server architecture
- Moved frontend code to `/client/` directory
- Moved backend code to `/server/` directory
- Updated build system to use separate TypeScript configs
- Changed client build output from `/docs` to `/dist`
- Replaced tsx with ts-node for server execution
- Enhanced deck validation with proper sanitization
- Improved error handling and type checking throughout codebase
- Updated locale system to include Serbian translation
- Language dropdown now functional (previously disabled)

### Added
- Client TypeScript configuration (`tsconfig.client.json`)
- Server TypeScript configuration (`tsconfig.server.json`)
- Clean separation of client and server codebases
- Modular server architecture with routes, services, and utilities
- Vite proxy configuration for API calls during development
- Enhanced type guards for GameState validation
- Improved null/undefined checks in React components
- Enhanced counter and ability utility functions
- Visual effects handler improvements
- Serbian (Српски) locale support with complete UI and rules translation
- Enabled language selector in Settings modal
- Language changes are saved to localStorage and persist across sessions

### Removed
- Old monolithic project structure
- Unused server-dev.js and old server.js files
- Shared directory - moved types to respective client/server directories

## [0.1.0] - 2024-12-20

### Added
- Initial project setup
- React frontend with TypeScript
- Express server with WebSocket support
- Basic game mechanics
- Card and token content database
