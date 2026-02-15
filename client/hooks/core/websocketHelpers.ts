/**
 * websocketHelpers - Утилиты для работы с WebSocket соединением
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - getWebSocketURL - получение и валидация WebSocket URL из настроек
 */

import { logger } from '../../utils/logger'

/**
 * Helper to determine the correct WebSocket URL from localStorage
 * Auto-corrects protocol (http/https -> ws/wss) and validates format
 */
export function getWebSocketURL(): string | null {
  const customUrl = localStorage.getItem('custom_ws_url')
  if (!customUrl || customUrl.trim() === '') {
    // No custom URL configured - user must set one in settings
    logger.warn('No custom WebSocket URL configured in settings.')
    return null
  }

  let url = customUrl.trim()
  // Remove trailing slash
  if (url.endsWith('/')) {
    url = url.slice(0, -1)
  }

  // Auto-correct protocol if user pasted http/https
  if (url.startsWith('https://')) {
    url = url.replace('https://', 'wss://')
  } else if (url.startsWith('http://')) {
    url = url.replace('http://', 'ws://')
  }

  // Ensure the URL has a valid WebSocket protocol
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    logger.warn('Invalid WebSocket URL format (must start with ws:// or wss://)')
    return null
  }

  logger.info(`Using custom WebSocket URL: ${url}`)
  // Store the validated URL for link sharing
  localStorage.setItem('websocket_url', url)
  return url
}
