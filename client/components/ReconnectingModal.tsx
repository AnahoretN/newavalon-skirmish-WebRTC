/**
 * @file Modal shown when WebRTC connection is lost and attempting to reconnect
 */
import React, { useEffect, useState } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'

interface ReconnectingModalProps {
  isOpen: boolean
  message?: string
}

export const ReconnectingModal: React.FC<ReconnectingModalProps> = ({ isOpen, message }) => {
  const { t } = useLanguage()
  const [statusMessage, setStatusMessage] = useState<string>('')

  // Update status message every 2 seconds to show activity
  useEffect(() => {
    if (!isOpen) {
      setStatusMessage('')
      return
    }

    const messages = [
      t('connectingToHost') || 'Connecting to host...',
      t('reconnectingDescription') || 'Attempting to restore connection...',
    ]

    let index = 0
    setStatusMessage(messages[0])

    const interval = setInterval(() => {
      index = (index + 1) % messages.length
      setStatusMessage(messages[index])
    }, 2000)

    return () => clearInterval(interval)
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[300] backdrop-blur-sm">
      <div className="bg-gray-900 rounded-lg border-2 border-blue-500 shadow-2xl p-8 w-full max-w-md text-center">

        {/* Animated spinner */}
        <div className="flex justify-center mb-6">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="absolute inset-2 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" style={{ animationDuration: '1.5s' }}></div>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white mb-4">
          {t('reconnecting')}
        </h2>

        {/* Dynamic status message */}
        <p className="text-blue-300 mb-4 min-h-[24px] flex items-center justify-center">
          {message || statusMessage}
        </p>

        {/* Subtitle */}
        <p className="text-sm text-gray-400">
          {t('pleaseWait')}
        </p>

        {/* Info text */}
        <p className="text-xs text-gray-500 mt-4">
          {t('doNotClose') || 'Do not close this window while reconnecting'}
        </p>

        {/* Pulsing dot indicator */}
        <div className="flex justify-center gap-2 mt-6">
          <span className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></span>
          <span className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '200ms' }}></span>
          <span className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '400ms' }}></span>
        </div>
      </div>
    </div>
  )
}
