/**
 * ModalsRenderer - Centralized modal rendering system
 *
 * Handles lazy loading and rendering of all modals
 * Uses the useModals store to determine which modal to show
 *
 * For modals that need callbacks (onJoin, onSave, etc.),
 * the callbacks are passed through modalData
 */

import { lazy, Suspense } from 'react'
import { useModals } from '../hooks/useModals'
import { BaseModal } from './BaseModal'

// Lazy load all modal components for code splitting
const DeckViewModal = lazy(() => import('./DeckViewModal'))
const CardDetailModal = lazy(() => import('./CardDetailModal'))
const TokensModal = lazy(() => import('./TokensModal'))
const CountersModal = lazy(() => import('./CountersModal'))
const TeamAssignmentModal = lazy(() => import('./TeamAssignmentModal'))
const ReadyCheckModal = lazy(() => import('./ReadyCheckModal'))
const RulesModal = lazy(() => import('./RulesModal'))
const SettingsModal = lazy(() => import('./SettingsModal'))
const CommandModal = lazy(() => import('./CommandModal'))
const CounterSelectionModal = lazy(() => import('./CounterSelectionModal'))
const RevealRequestModal = lazy(() => import('./RevealRequestModal'))
const RoundEndModal = lazy(() => import('./RoundEndModal'))
const JoinGameModal = lazy(() => import('./JoinGameModal'))
const DeckBuilderModal = lazy(() => import('./DeckBuilderModal'))

// Loading fallback component
const ModalLoader = () => (
  <div className="flex items-center justify-center p-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
  </div>
)

// Modal content wrapper - handles wrapping content in BaseModal
const ModalWrapper = ({ children, title, onClose, size }: {
  children: React.ReactNode
  title?: string
  onClose: () => void
  size: 'sm' | 'md' | 'lg' | 'xl' | 'full'
}) => {
  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      title={title}
      size={size}
      showCloseButton={true}
      closeOnEscape={true}
      closeOnBackdropClick={true}
    >
      {children}
    </BaseModal>
  )
}

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
        <ModalWrapper title="Deck View" onClose={close} size={modalSize}>
          <DeckViewModal {...restData} isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'cardDetail' && (
        <ModalWrapper title="Card Details" onClose={close} size={modalSize}>
          <CardDetailModal {...restData} isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'tokens' && (
        <ModalWrapper title="Tokens" onClose={close} size={modalSize}>
          <TokensModal {...restData} isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'counters' && (
        <ModalWrapper title="Counters" onClose={close} size={modalSize}>
          <CountersModal {...restData} isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'teamAssignment' && (
        <ModalWrapper title="Assign Teams" onClose={close} size={modalSize}>
          <TeamAssignmentModal {...restData} isOpen={true} onClose={close} onCancel={onCancel || close} onConfirm={onConfirm || close} />
        </ModalWrapper>
      )}

      {openModal === 'readyCheck' && (
        <ModalWrapper title="Ready Check" onClose={close} size={modalSize}>
          <ReadyCheckModal {...restData} isOpen={true} onClose={close} onReady={onReady || close} onCancel={onCancel || close} />
        </ModalWrapper>
      )}

      {openModal === 'rules' && (
        <ModalWrapper title="Rules" onClose={close} size={modalSize}>
          <RulesModal isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'settings' && (
        <ModalWrapper title="Settings" onClose={close} size={modalSize}>
          <SettingsModal {...restData} isOpen={true} onClose={close} onSave={onSave || close} />
        </ModalWrapper>
      )}

      {openModal === 'command' && (
        <ModalWrapper title="Command" onClose={close} size={modalSize}>
          <CommandModal {...restData} isOpen={true} onClose={close} onConfirm={onConfirm || close} onCancel={onCancel || close} />
        </ModalWrapper>
      )}

      {openModal === 'counterSelection' && (
        <ModalWrapper title="Select Counter" onClose={close} size={modalSize}>
          <CounterSelectionModal {...restData} isOpen={true} onClose={close} onConfirm={onConfirm || close} onCancel={onCancel || close} />
        </ModalWrapper>
      )}

      {openModal === 'revealRequest' && (
        <ModalWrapper title="Reveal Request" onClose={close} size={modalSize}>
          <RevealRequestModal {...restData} isOpen={true} onAccept={onAccept || close} onDecline={onDecline || close} />
        </ModalWrapper>
      )}

      {openModal === 'roundEnd' && (
        <ModalWrapper title="Round Complete" onClose={close} size={modalSize}>
          <RoundEndModal {...restData} isOpen={true} onClose={close} onContinueGame={onContinueGame || close} onStartNextRound={onStartNextRound || close} onExit={onExit || close} />
        </ModalWrapper>
      )}

      {openModal === 'joinGame' && (
        <ModalWrapper title="Join Game" onClose={close} size={modalSize}>
          <JoinGameModal {...restData} isOpen={true} onClose={close} onJoin={onJoin || close} />
        </ModalWrapper>
      )}

      {openModal === 'deckBuilder' && (
        <ModalWrapper title="Deck Builder" onClose={close} size={modalSize}>
          <DeckBuilderModal isOpen={true} onClose={close} />
        </ModalWrapper>
      )}
    </Suspense>
  )
}
