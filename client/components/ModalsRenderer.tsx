/**
 * ModalsRenderer - Centralized modal rendering system
 *
 * Handles lazy loading and rendering of all modals
 * Uses the useModals store to determine which modal to show
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

  return (
    <Suspense fallback={<ModalLoader />}>
      {openModal === 'deckView' && (
        <ModalWrapper title="Deck View" onClose={close} size={modalSize}>
          <DeckViewModal {...modalData} isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'cardDetail' && (
        <ModalWrapper title="Card Details" onClose={close} size={modalSize}>
          <CardDetailModal {...modalData} isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'tokens' && (
        <ModalWrapper title="Tokens" onClose={close} size={modalSize}>
          <TokensModal {...modalData} isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'counters' && (
        <ModalWrapper title="Counters" onClose={close} size={modalSize}>
          <CountersModal {...modalData} isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'teamAssignment' && (
        <ModalWrapper title="Assign Teams" onClose={close} size={modalSize}>
          <TeamAssignmentModal {...modalData} isOpen={true} onClose={close} onCancel={close} />
        </ModalWrapper>
      )}

      {openModal === 'readyCheck' && (
        <ModalWrapper title="Ready Check" onClose={close} size={modalSize}>
          <ReadyCheckModal {...modalData} isOpen={true} onClose={close} onReady={() => {}} onCancel={close} />
        </ModalWrapper>
      )}

      {openModal === 'rules' && (
        <ModalWrapper title="Rules" onClose={close} size={modalSize}>
          <RulesModal isOpen={true} onClose={close} />
        </ModalWrapper>
      )}

      {openModal === 'settings' && (
        <ModalWrapper title="Settings" onClose={close} size={modalSize}>
          <SettingsModal isOpen={true} onClose={close} onSave={() => {}} />
        </ModalWrapper>
      )}

      {openModal === 'command' && (
        <ModalWrapper title="Command" onClose={close} size={modalSize}>
          <CommandModal {...modalData} isOpen={true} onClose={close} onConfirm={() => {}} onCancel={close} />
        </ModalWrapper>
      )}

      {openModal === 'counterSelection' && (
        <ModalWrapper title="Select Counter" onClose={close} size={modalSize}>
          <CounterSelectionModal {...modalData} isOpen={true} onClose={close} onConfirm={() => {}} onCancel={close} />
        </ModalWrapper>
      )}

      {openModal === 'revealRequest' && (
        <ModalWrapper title="Reveal Request" onClose={close} size={modalSize}>
          <RevealRequestModal {...modalData} isOpen={true} onAccept={() => {}} onDecline={close} />
        </ModalWrapper>
      )}

      {openModal === 'roundEnd' && (
        <ModalWrapper title="Round Complete" onClose={close} size={modalSize}>
          <RoundEndModal {...modalData} isOpen={true} onClose={close} onConfirm={close} onExit={close} />
        </ModalWrapper>
      )}

      {openModal === 'joinGame' && (
        <ModalWrapper title="Join Game" onClose={close} size={modalSize}>
          <JoinGameModal {...modalData} isOpen={true} onClose={close} onJoin={() => {}} />
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
