import React, { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContextMenuItem } from '@/types'

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [correctedPos, setCorrectedPos] = useState({ top: y, left: x })

  useEffect(() => {
    if (menuRef.current) {
      const { innerWidth, innerHeight } = window
      const { offsetWidth, offsetHeight } = menuRef.current

      // Convert VU to pixels for edge distance
      const vuBase = window.innerHeight * 0.001 // CSS пиксели, автоматически компенсируют zoom
      const edgeDistance = vuBase * 10 // ~10px edge distance

      const correctedX = x + offsetWidth > innerWidth ? innerWidth - offsetWidth - edgeDistance : x
      const correctedY = y + offsetHeight > innerHeight ? innerHeight - offsetHeight - edgeDistance : y

      setCorrectedPos({ top: correctedY, left: correctedX })
    }
  }, [x, y, items])

  return createPortal(
    <div
      ref={menuRef}
      className="fixed bg-gray-900 border border-gray-700 rounded-vu-2 shadow-lg z-[9999] py-vu-min"
      style={{ top: correctedPos.top, left: correctedPos.left, opacity: menuRef.current ? 1 : 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, index) => {
        if ('isDivider' in item) {
          return <hr key={`divider-${index}`} className="border-gray-700 my-vu-min" />
        } else if ('onClick' in item) {
          return (
            <button
              key={index}
              onClick={() => {
                if (!item.disabled) {
                  item.onClick()
                  onClose()
                }
              }}
              disabled={item.disabled}
              className="block w-full text-left px-vu-lg py-vu-min text-vu-13 text-white hover:bg-indigo-600 disabled:text-gray-500 disabled:cursor-not-allowed disabled:bg-gray-800"
              style={{ fontWeight: item.isBold ? 'bold' : 'normal' }}
            >
              {item.label}
            </button>
          )
        } else { // This item must be a statusControl.
          return (
            <div key={index} className="flex items-center justify-between px-vu-lg py-vu-min text-vu-13 text-white w-full space-x-vu-md">
              <button
                onClick={(e) => {
                  e.stopPropagation(); item.onRemove()
                }}
                disabled={item.removeDisabled}
                className="w-vu-status-btn h-vu-status-btn flex items-center justify-center bg-gray-700 hover:bg-red-600 rounded disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed font-mono text-vu-13"
              >
                                -
              </button>
              <span className="flex-grow text-center">{item.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation(); item.onAdd()
                }}
                className="w-vu-status-btn h-vu-status-btn flex items-center justify-center bg-gray-700 hover:bg-green-600 rounded font-mono text-vu-13"
              >
                                +
              </button>
            </div>
          )
        }
      })}
    </div>,
    document.body,
  )
}
