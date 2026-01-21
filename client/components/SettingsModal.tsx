import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { AVAILABLE_LANGUAGES, LANGUAGE_NAMES } from '@/locales'
import type { LanguageCode } from '@/locales/types'
import type { ConnectionStatus } from '@/hooks/useGameState'
import { generateInviteLink } from '@/utils/inviteLinks'

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (url: string) => void;
  connectionStatus: ConnectionStatus;
  onReconnect: () => void;
  gameId?: string | null;
  isGameStarted?: boolean;
  isPrivate?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSave: _onSave, // Unused - save is handled internally
  connectionStatus,
  onReconnect,
  gameId = null,
  isGameStarted = false,
  isPrivate = false,
}) => {
  const { language, setLanguage, t } = useLanguage()
  const [serverUrl, setServerUrl] = useState('')
  const [linkCopySuccess, setLinkCopySuccess] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [cacheClearing, setCacheClearing] = useState(false)

  const isConnected = connectionStatus === 'Connected'

  // Track when connection is established to update unsaved changes
  useEffect(() => {
    if (isConnected) {
      // Only clear unsaved changes if the current URL matches what we're connected to
      const currentCustomUrl = localStorage.getItem('custom_ws_url') || ''
      if (serverUrl.trim() === currentCustomUrl) {
        setHasUnsavedChanges(false)
      }
    }
  }, [isConnected, connectionStatus, serverUrl])

  useEffect(() => {
    if (isOpen) {
      const savedUrl = localStorage.getItem('custom_ws_url') || ''
      setServerUrl(savedUrl)
      setLinkCopySuccess(false)
      setIsReconnecting(false)
      setHasUnsavedChanges(false)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const handleSave = () => {
    const trimmedUrl = serverUrl.trim()
    // Save to localStorage and reconnect
    localStorage.setItem('custom_ws_url', trimmedUrl)
    setHasUnsavedChanges(false)
    onReconnect()
    onClose()
  }

  const handleReconnect = () => {
    // Save current input value and reconnect without closing
    const trimmedUrl = serverUrl.trim()
    localStorage.setItem('custom_ws_url', trimmedUrl)
    setHasUnsavedChanges(false)
    setIsReconnecting(true)
    onReconnect()
    setTimeout(() => setIsReconnecting(false), 2000)
  }

  const handleUrlChange = (value: string) => {
    setServerUrl(value)
    // Mark as having unsaved changes when input changes
    setHasUnsavedChanges(true)
  }

  const handleCopyGameLink = () => {
    // Generate context-aware invite link based on current game state
    const { url: inviteLink } = generateInviteLink(gameId, isGameStarted, isPrivate)

    // Copy to clipboard
    navigator.clipboard.writeText(inviteLink).then(() => {
      setLinkCopySuccess(true)
      setTimeout(() => setLinkCopySuccess(false), 2000)
    }).catch(err => {
      console.error('Failed to copy:', err)
    })
  }

  const handleClearCache = () => {
    setCacheClearing(true)
    // Clear all localStorage and sessionStorage
    localStorage.clear()
    sessionStorage.clear()
    // Show feedback then reload
    setTimeout(() => {
      window.location.reload()
    }, 1000)
  }

  // Button is only enabled when connected AND no unsaved changes
  const canCopyLink = isConnected && !hasUnsavedChanges

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-8 shadow-xl w-full max-w-xl">
        <h2 className="text-2xl font-bold mb-6">{t('settings')}</h2>

        <div className="space-y-6">
          <div>
            <label htmlFor="language-select" className="block text-sm font-medium text-gray-300 mb-1">
              {t('language')}
            </label>
            <select
              id="language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              className="w-full bg-gray-700 border border-gray-600 text-white font-sans rounded-lg p-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {AVAILABLE_LANGUAGES.map((code) => (
                <option key={code} value={code}>{LANGUAGE_NAMES[code]}</option>
              ))}
            </select>
          </div>

          {/* Server URL input with reconnect button and connection status */}
          <div>
            <label htmlFor="server-url" className="block text-sm font-medium text-gray-300 mb-1">
              {t('serverAddress')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="server-url"
                type="text"
                value={serverUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="wss://your-server.ngrok-free.app"
                className="flex-1 bg-gray-700 border border-gray-600 text-white font-mono rounded-lg p-2 focus:ring-indigo-500 focus:border-indigo-500"
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
              {/* Reconnect button */}
              <button
                onClick={handleReconnect}
                className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
                  isReconnecting
                    ? 'bg-green-600 text-white animate-pulse'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
                title={t('reconnect')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
              {/* Connection status indicator */}
              <div
                className={`w-10 h-10 flex items-center justify-center rounded bg-gray-900 border border-gray-700 ${
                  connectionStatus === 'Connected' ? 'cursor-help' : ''
                }`}
                title={connectionStatus}
              >
                <span className="relative flex h-3 w-3">
                  {connectionStatus === 'Connected' && (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </>
                  )}
                  {connectionStatus === 'Connecting' && (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                    </>
                  )}
                  {connectionStatus === 'Disconnected' && (
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  )}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              WebSocket URL сервера игры (ws:// или wss://)
            </p>
          </div>

          {/* Copy Game Link Button - only active when connected AND no unsaved changes */}
          <div className="-mt-3">
            <button
              onClick={handleCopyGameLink}
              disabled={!canCopyLink}
              className={`w-full py-2 rounded text-sm font-bold transition-colors ${
                !canCopyLink
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : linkCopySuccess
                    ? 'bg-green-600 text-white'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {linkCopySuccess ? t('copied') : t('copyGameLink')}
            </button>
            <p className="text-xs text-gray-400 mt-1">
              {t('copyGameLinkDesc')}
            </p>
          </div>

          {/* Clear Cache Button */}
          <div className="-mt-3">
            <button
              onClick={handleClearCache}
              disabled={cacheClearing}
              className={`w-full py-2 rounded text-sm font-bold transition-colors ${
                cacheClearing
                  ? 'bg-orange-600 text-white'
                  : 'bg-red-700 hover:bg-red-600 text-white'
              }`}
            >
              {cacheClearing ? t('cacheCleared') : t('clearCache')}
            </button>
            <p className="text-xs text-gray-400 mt-1">
              {t('clearCacheDesc')}
            </p>
          </div>
        </div>

        <div className="flex justify-end mt-8 space-x-3">
          <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded">
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded transition-colors"
          >
            {t('saveApply')}
          </button>
        </div>
      </div>
    </div>
  )
}
