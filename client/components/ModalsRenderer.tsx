/**
 * ModalsRenderer - Centralized modal rendering system
 *
 * Handles lazy loading and rendering of all modals
 * Uses the useModals context to determine which modal to show
 *
 * For modals that need callbacks (onJoin, onSave, etc.),
 * the callbacks are passed through modalData
 */

import { lazy, Suspense } from 'react'
import { useModals } from '../hooks/useModals.tsx'
import { BaseModal } from './BaseModal'

// Re-export ModalsProvider for convenience
export { ModalsProvider } from '../hooks/useModals.tsx'

// Lazy load all modal components for code splitting
// Using wrapper functions for components with named exports
const DeckViewModal = lazy(() => import('./DeckViewModal').then(m => ({ default: m.DeckViewModal })))
const CardDetailModal = lazy(() => import('./CardDetailModal').then(m => ({ default: m.CardDetailModal })))
const TokensModal = lazy(() => import('./TokensModal').then(m => ({ default: m.TokensModal })))
const CountersModal = lazy(() => import('./CountersModal').then(m => ({ default: m.CountersModal })))
const TeamAssignmentModal = lazy(() => import('./TeamAssignmentModal').then(m => ({ default: m.TeamAssignmentModal })))
const RulesModal = lazy(() => import('./RulesModal').then(m => ({ default: m.RulesModal })))
const SettingsModal = lazy(() => import('./SettingsModal').then(m => ({ default: m.SettingsModal })))
const CommandModal = lazy(() => import('./CommandModal').then(m => ({ default: m.CommandModal })))
const CounterSelectionModal = lazy(() => import('./CounterSelectionModal').then(m => ({ default: m.CounterSelectionModal })))
const RevealRequestModal = lazy(() => import('./RevealRequestModal').then(m => ({ default: m.RevealRequestModal })))
const RoundEndModal = lazy(() => import('./RoundEndModal').then(m => ({ default: m.RoundEndModal })))
const JoinGameModal = lazy(() => import('./JoinGameModal').then(m => ({ default: m.JoinGameModal })))
const DeckBuilderModal = lazy(() => import('./DeckBuilderModal').then(m => ({ default: m.DeckBuilderModal })))

// Loading fallback component
const ModalLoader = () => (
  <div className="flex items-center justify-center p-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
  </div>
)

/**
 * Main modal renderer component
 * Place this in App.tsx once - it handles all modals
 */
export const ModalsRenderer = () => {
  const { openModal, close, getData, getSize } = useModals()

  if (!openModal) {
    return null
  }

  const modalData = getData()
  const modalSize = getSize()

  // Extract callbacks from modalData
  const { onJoin, onSave, onConfirm, onReady, onCancel, onAccept, onDecline, onContinueGame, onStartNextRound, onExit, ...restData } = modalData

  return (
    <Suspense fallback={<ModalLoader />}>
      {openModal === 'deckView' && (
        <BaseModal title={restData.title || 'Deck View'} onClose={close} size={modalSize} isOpen={true}>
          <DeckViewModal
            isOpen={true}
            onClose={close}
            title={restData.title || 'Deck View'}
            player={restData.player}
            cards={restData.cards || []}
            setDraggedItem={restData.setDraggedItem || (() => {})}
            onCardContextMenu={restData.onCardContextMenu}
            onCardDoubleClick={restData.onCardDoubleClick}
            onCardClick={restData.onCardClick}
            onReorder={restData.onReorder}
            canInteract={restData.canInteract ?? true}
            isDeckView={restData.isDeckView}
            playerColorMap={restData.playerColorMap}
            localPlayerId={restData.localPlayerId ?? null}
            imageRefreshVersion={restData.imageRefreshVersion}
            highlightFilter={restData.highlightFilter}
          />
        </BaseModal>
      )}

      {openModal === 'cardDetail' && (
        <BaseModal title="Card Details" onClose={close} size="md" isOpen={true}>
          <CardDetailModal
            card={restData.card ?? null}
            ownerPlayer={restData.ownerPlayer ?? null}
            onClose={close}
            statusDescriptions={restData.statusDescriptions ?? {}}
            allPlayers={restData.allPlayers ?? []}
            imageRefreshVersion={restData.imageRefreshVersion}
          />
        </BaseModal>
      )}

      {openModal === 'tokens' && (
        <TokensModal
          isOpen={true}
          onClose={close}
          setDraggedItem={restData.setDraggedItem || (() => {})}
          openContextMenu={restData.openContextMenu || (() => {})}
          canInteract={restData.canInteract ?? true}
          anchorEl={restData.anchorEl ?? null}
          imageRefreshVersion={restData.imageRefreshVersion}
          localPlayerId={restData.localPlayerId ?? null}
        />
      )}

      {openModal === 'counters' && (
        <CountersModal
          isOpen={true}
          onClose={close}
          canInteract={restData.canInteract ?? true}
          anchorEl={restData.anchorEl ?? null}
          imageRefreshVersion={restData.imageRefreshVersion}
          onCounterMouseDown={restData.onCounterMouseDown || (() => {})}
          cursorStack={restData.cursorStack ?? null}
        />
      )}

      {openModal === 'teamAssignment' && (
        <BaseModal title="Assign Teams" onClose={onCancel || close} size="lg" isOpen={true}>
          <TeamAssignmentModal
            players={restData.players ?? []}
            gameMode={restData.gameMode}
            onCancel={onCancel || close}
            onConfirm={onConfirm || (() => {})}
          />
        </BaseModal>
      )}

      {openModal === 'rules' && (
        <RulesModal isOpen={true} onClose={close} />
      )}

      {openModal === 'settings' && (
        <SettingsModal
          isOpen={true}
          onClose={close}
          onSave={onSave || close}
          connectionStatus={restData.connectionStatus}
          onReconnect={restData.onReconnect}
          gameId={restData.gameId}
          isGameStarted={restData.isGameStarted}
          isPrivate={restData.isPrivate}
        />
      )}

      {openModal === 'command' && (
        <CommandModal
          isOpen={true}
          card={restData.card}
          playerColorMap={restData.playerColorMap}
          onConfirm={onConfirm || (() => {})}
          onCancel={onCancel || close}
        />
      )}

      {openModal === 'counterSelection' && (
        <CounterSelectionModal
          isOpen={true}
          data={restData.data}
          onConfirm={onConfirm || (() => {})}
          onCancel={onCancel || close}
        />
      )}

      {openModal === 'revealRequest' && (
        <BaseModal title="Reveal Request" onClose={onDecline || close} size="md" isOpen={true}>
          <RevealRequestModal
            fromPlayer={restData.fromPlayer}
            cardCount={restData.cardCount}
            onAccept={onAccept || close}
            onDecline={onDecline || close}
          />
        </BaseModal>
      )}

      {openModal === 'roundEnd' && (
        <BaseModal title="Round Complete" onClose={onExit || close} size="lg" isOpen={true}>
          <RoundEndModal
            gameState={restData.gameState}
            onContinueGame={onContinueGame || close}
            onStartNextRound={onStartNextRound || close}
            onExit={onExit || close}
          />
        </BaseModal>
      )}

      {openModal === 'joinGame' && (
        <JoinGameModal
          isOpen={true}
          onClose={close}
          onJoin={onJoin || (() => {})}
          onRefreshGames={restData.onRefreshGames || (() => {})}
          games={restData.games ?? []}
        />
      )}

      {openModal === 'deckBuilder' && (
        <DeckBuilderModal isOpen={true} onClose={close} setViewingCard={restData.setViewingCard} />
      )}
    </Suspense>
  )
}
