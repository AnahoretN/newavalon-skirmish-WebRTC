# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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
