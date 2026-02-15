/**
 * useModals - Centralized modal management using Zustand
 *
 * Provides a single source of truth for all modal state
 * Replaces scattered useState for modal visibility
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

// All modal types in the application
export type ModalType =
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

// Modal size options
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

// Modal state interface
interface ModalState {
  // Currently open modal (null if none)
  openModal: ModalType | null
  // Data passed to the modal
  modalData: Record<string, any>
  // Modal size preference
  modalSize: ModalSize

  // Actions
  open: (type: ModalType, data?: Record<string, any>, size?: ModalSize) => void
  close: () => void
  isOpen: (type: ModalType) => boolean
  getData: <T = Record<string, any>>() => T
  getSize: () => ModalSize
}

// Create the modal store
export const useModals = create<ModalState>()(
  devtools(
    (set, get) => ({
      openModal: null,
      modalData: {},
      modalSize: 'lg',

      // Open a modal with optional data and size
      open: (type, data = {}, size = 'lg') =>
        set({
          openModal: type,
          modalData: data,
          modalSize: size,
        }),

      // Close the current modal
      close: () =>
        set({
          openModal: null,
          modalData: {},
          modalSize: 'lg',
        }),

      // Check if a specific modal is open
      isOpen: (type) => get().openModal === type,

      // Get the current modal data (typed)
      getData: <T = Record<string, any>>() => get().modalData as T,

      // Get the current modal size
      getSize: () => get().modalSize,
    }),
    { name: 'ModalsStore' }
  )
)

// Convenience hooks for specific modals
export const useDeckViewModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('deckView'),
    open: (data?: Record<string, any>) => open('deckView', data, 'xl'),
    close,
    getData: () => getData<DeckViewModalData>(),
  }
}

export const useCardDetailModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('cardDetail'),
    open: (data?: CardDetailModalData) => open('cardDetail', data, 'md'),
    close,
    getData: () => getData<CardDetailModalData>(),
  }
}

export const useRulesModal = () => {
  const { open, close, isOpen } = useModals()

  return {
    isOpen: isOpen('rules'),
    open: () => open('rules', {}, 'full'),
    close,
  }
}

export const useSettingsModal = () => {
  const { open, close, isOpen } = useModals()

  return {
    isOpen: isOpen('settings'),
    open: () => open('settings', {}, 'md'),
    close,
  }
}

export const useJoinGameModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('joinGame'),
    open: (data?: JoinGameModalData) => open('joinGame', data, 'lg'),
    close,
    getData: () => getData<JoinGameModalData>(),
  }
}

// Type definitions for modal data
export interface DeckViewModalData {
  player?: any
  cards?: any[]
  setDraggedItem?: (item: any) => void
  onCardContextMenu?: (e: React.MouseEvent, card: any, source: string) => void
  onCardDoubleClick?: (card: any, source: string) => void
  onCardClick?: (card: any, source: string) => void
  canInteract?: boolean
  isDeckView?: boolean
  playerColorMap?: Map<number, any>
  localPlayerId?: number | null
  imageRefreshVersion?: number
  highlightFilter?: (card: any) => boolean
}

export interface CardDetailModalData {
  card: any | null
  ownerPlayer: any | null
  statusDescriptions: Record<string, string>
  allPlayers: any[]
  imageRefreshVersion?: number
}

export interface JoinGameModalData {
  isOpen: boolean
  games: any[]
}

// Re-export commonly used types
export type { ModalType, ModalSize }
