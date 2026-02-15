/**
 * @file Base modal component for all modals in the application
 * Provides consistent structure, styling, animations, and behavior
 */

import React, { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'

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

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-full max-h-full m-4',
}

/**
 * Base modal component with consistent styling, animations, and behavior
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
  const [isVisible, setIsVisible] = useState(false)
  const [isContentVisible, setIsContentVisible] = useState(false)

  // Handle animation timing
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      // Small delay for content to animate in after backdrop
      setTimeout(() => setIsContentVisible(true), 50)
    } else {
      setIsContentVisible(false)
      // Wait for content animation to finish before hiding backdrop
      setTimeout(() => setIsVisible(false), 200)
    }
  }, [isOpen])

  // Handle escape key press
  useEffect(() => {
    if (!isOpen || !closeOnEscape) {
      return
    }

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

  // Focus trap - keep focus within modal
  useEffect(() => {
    if (isOpen && modalRef.current) {
      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const firstElement = focusableElements[0] as HTMLElement
      firstElement?.focus()
    }
  }, [isOpen])

  if (!isVisible) {
    return null
  }

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
      {/* Animated backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          isContentVisible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Animated modal */}
      <div
        className={`bg-gray-800 rounded-lg shadow-2xl w-full ${
          sizeClasses[size]
        } border border-white/10 relative transition-all duration-200 ${
          isContentVisible
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-95 scale-95 translate-y-4'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            {title && <h2 className="text-xl font-bold text-white">{title}</h2>}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
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
        <div className="p-4 max-h-[calc(100vh-12rem)] overflow-y-auto custom-scrollbar">
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
    <div className={`flex items-center justify-end gap-2 mt-4 pt-4 border-t border-gray-700 ${className}`}>
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
