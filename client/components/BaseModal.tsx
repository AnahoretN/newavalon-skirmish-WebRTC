/**
 * @file Base modal component for all modals in the application
 * Provides consistent structure, styling, and behavior
 */

import React, { useEffect, useRef } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { MODAL_SIZE_CLASSES, MODAL_COMMON_CLASSES } from '@/constants'

export interface BaseModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  showCloseButton?: boolean
  closeOnEscape?: boolean
  closeOnBackdropClick?: boolean
}

// Use constants from constants.ts instead of local definition

/**
 * Base modal component with consistent styling and behavior
 * All modals should use this as their foundation
 */
export const BaseModal: React.FC<BaseModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  size = 'lg',
  showCloseButton = true,
  closeOnEscape = true,
  closeOnBackdropClick = true,
}) => {
  const { t } = useLanguage()
  const modalRef = useRef<HTMLDivElement>(null)

  // Handle escape key press
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose, closeOnEscape])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (closeOnBackdropClick && e.target === modalRef.current) {
      onClose()
    }
  }

  return (
    <div
      ref={modalRef}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${className}`}
      onClick={handleBackdropClick}
    >
      <div
        className={`${MODAL_COMMON_CLASSES.base} ${MODAL_SIZE_CLASSES[size]} border border-white/10`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className={MODAL_COMMON_CLASSES.header}>
            {title && <h2 className="text-xl font-bold text-white">{title}</h2>}
            {showCloseButton && (
              <button
                onClick={onClose}
                className={MODAL_COMMON_CLASSES.closeButton}
                aria-label={t('close') || 'Close'}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className={MODAL_COMMON_CLASSES.inner}>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Modal footer component for consistent action buttons
 */
export interface ModalFooterProps {
  children: React.ReactNode
  className?: string
}

export const ModalFooter: React.FC<ModalFooterProps> = ({ children, className = '' }) => {
  return (
    <div className={`${MODAL_COMMON_CLASSES.footer} ${className}`}>
      {children}
    </div>
  )
}

/**
 * Modal section component for organizing content
 */
export interface ModalSectionProps {
  title?: string
  children: React.ReactNode
  className?: string
}

export const ModalSection: React.FC<ModalSectionProps> = ({ title, children, className = '' }) => {
  return (
    <div className={`mb-4 ${className}`}>
      {title && <h3 className="text-lg font-semibold mb-2 text-white">{title}</h3>}
      {children}
    </div>
  )
}
