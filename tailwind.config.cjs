/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./client/index.html",
    "./client/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        'card-back': '#5A67D8',
        'card-face': '#F7FAFC',
        'board-bg': '#283141',
        'board-cell': '#4A5568',
        'board-cell-active': '#5B687A',
        'panel-bg': '#1A202C',
      },

      // ===============================================================================
      // VIRTUAL UNIT SYSTEM (VU) - Расширение Tailwind для VU классов
      // ===============================================================================
      spacing: {
        // Базовая единица
        'vu': 'var(--vu-base)',

        // Отступы
        'vu-gap-min': 'var(--vu-gap-min)',
        'vu-gap-3': 'var(--vu-gap-3)',
        'vu-gap-5': 'var(--vu-gap-5)',
        'vu-gap-base': 'var(--vu-gap-base)',
        'vu-gap-10': 'var(--vu-gap-10)',
        'vu-gap-md': 'var(--vu-gap-md)',
        'vu-gap-lg': 'var(--vu-gap-lg)',
        'vu-gap-xl': 'var(--vu-gap-xl)',
        'vu-gap-2xl': 'var(--vu-gap-2xl)',

        // Размеры карточек
        'vu-card-tiny': 'var(--vu-card-tiny)',
        'vu-card-small': 'var(--vu-card-small)',
        'vu-card-normal': 'var(--vu-card-normal)',
        'vu-card-large': 'var(--vu-card-large)',
        'vu-card-xl': 'var(--vu-card-xl)',

        // Панели
        'vu-header-height': 'var(--vu-header-height)',
        'vu-panel-padding': 'var(--vu-panel-padding)',
        'vu-panel-gap': 'var(--vu-panel-gap)',

        // Модальные окна
        'vu-modal-sm': 'var(--vu-modal-sm)',
        'vu-modal-md': 'var(--vu-modal-md)',
        'vu-modal-lg': 'var(--vu-modal-lg)',
        'vu-modal-xl': 'var(--vu-modal-xl)',

        // Иконки
        'vu-icon-xs': 'var(--vu-icon-xs)',
        'vu-icon-sm': 'var(--vu-icon-sm)',
        'vu-icon-md': 'var(--vu-icon-md)',
        'vu-icon-lg': 'var(--vu-icon-lg)',
        'vu-icon-xl': 'var(--vu-icon-xl)',
        'vu-icon-18': 'var(--vu-icon-18)',
        'vu-icon-15': 'var(--vu-icon-15)',
        'vu-status': 'var(--vu-icon-sm)',
        'vu-icon-xl': 'var(--vu-icon-xl)',

        // Кнопки
        'vu-btn-sm': 'var(--vu-btn-sm)',
        'vu-btn-md': 'var(--vu-btn-md)',
        'vu-btn-lg': 'var(--vu-btn-lg)',
        'vu-btn-xl': 'var(--vu-btn-xl)',
        'vu-btn-40': 'var(--vu-btn-40)',

        // Игровое поле
        'vu-board-padding': 'var(--vu-board-padding)',
        'vu-board-gap': 'var(--vu-board-gap)',
        'vu-cell-min': 'var(--vu-cell-min)',
        'vu-cell-base': 'var(--vu-cell-base)',
        'vu-cell-large': 'var(--vu-cell-large)',

        // Эффекты
        'vu-effect-sm': 'var(--vu-effect-sm)',
        'vu-effect-md': 'var(--vu-effect-md)',
        'vu-effect-lg': 'var(--vu-effect-lg)',

        // Позиции
        'vu-pos-header-offset': 'var(--vu-pos-header-offset)',
        'vu-pos-corner': 'var(--vu-pos-corner)',
      },

      // Размеры текста
      fontSize: {
        'vu-5': 'var(--vu-text-5)',
        'vu-xs': 'var(--vu-text-xs)',
        'vu-sm': 'var(--vu-text-sm)',
        'vu-base': 'var(--vu-text-base)',
        'vu-md': 'var(--vu-text-md)',
        'vu-lg': 'var(--vu-text-lg)',
        'vu-xl': 'var(--vu-text-xl)',
        'vu-13': 'var(--vu-text-13)',
        'vu-15': 'var(--vu-text-15)',
        'vu-2xl': 'var(--vu-text-2xl)',
        'vu-20': 'var(--vu-text-20)',
        'vu-3xl': 'var(--vu-text-3xl)',
        'vu-deck': 'var(--vu-text-deck)',
        'vu-header': 'var(--vu-text-header)',
        'vu-score': 'var(--vu-text-score)',
        'vu-8': 'var(--vu-text-8)',
        'vu-4xl': 'var(--vu-text-4xl)',
        'vu-5xl': 'var(--vu-text-5xl)',
        'vu-6xl': 'var(--vu-text-6xl)',
      },

      // Ширина
      width: {
        'vu-card-tiny': 'var(--vu-card-tiny)',
        'vu-card-small': 'var(--vu-card-small)',
        'vu-card-normal': 'var(--vu-card-normal)',
        'vu-card-large': 'var(--vu-card-large)',
        'vu-card-xl': 'var(--vu-card-xl)',
        'vu-modal-sm': 'var(--vu-modal-sm)',
        'vu-modal-md': 'var(--vu-modal-md)',
        'vu-modal-lg': 'var(--vu-modal-lg)',
        'vu-modal-xl': 'var(--vu-modal-xl)',
        'vu-icon-xs': 'var(--vu-icon-xs)',
        'vu-icon-sm': 'var(--vu-icon-sm)',
        'vu-icon-md': 'var(--vu-icon-md)',
        'vu-icon-lg': 'var(--vu-icon-lg)',
        'vu-icon-xl': 'var(--vu-icon-xl)',
        'vu-icon-18': 'var(--vu-icon-18)',
        'vu-icon-15': 'var(--vu-icon-15)',
        'vu-status': 'var(--vu-icon-sm)',
        'vu-btn-sm': 'var(--vu-btn-sm)',
        'vu-btn-md': 'var(--vu-btn-md)',
        'vu-btn-lg': 'var(--vu-btn-lg)',
      },

      // Высота
      height: {
        'vu-card-tiny': 'var(--vu-card-tiny)',
        'vu-card-small': 'var(--vu-card-small)',
        'vu-card-normal': 'var(--vu-card-normal)',
        'vu-card-large': 'var(--vu-card-large)',
        'vu-card-xl': 'var(--vu-card-xl)',
        'vu-header': 'var(--vu-header-height)',
        'vu-icon-xs': 'var(--vu-icon-xs)',
        'vu-icon-sm': 'var(--vu-icon-sm)',
        'vu-icon-md': 'var(--vu-icon-md)',
        'vu-icon-lg': 'var(--vu-icon-lg)',
        'vu-icon-xl': 'var(--vu-icon-xl)',
        'vu-icon-18': 'var(--vu-icon-18)',
        'vu-icon-15': 'var(--vu-icon-15)',
        'vu-status': 'var(--vu-icon-sm)',
        'vu-btn-sm': 'var(--vu-btn-sm)',
        'vu-btn-md': 'var(--vu-btn-md)',
        'vu-btn-lg': 'var(--vu-btn-lg)',
      },

      // Отступы (padding)
      padding: {
        'vu-min': 'var(--vu-gap-min)',
        'vu-base': 'var(--vu-gap-base)',
        'vu-md': 'var(--vu-gap-md)',
        'vu-lg': 'var(--vu-gap-lg)',
        'vu-xl': 'var(--vu-gap-xl)',
        'vu-panel': 'var(--vu-panel-padding)',
      },

      // Поля (margin)
      margin: {
        'vu-min': 'var(--vu-gap-min)',
        'vu-3': 'var(--vu-gap-3)',
        'vu-5': 'var(--vu-gap-5)',
        'vu-base': 'var(--vu-gap-base)',
        'vu-10': 'var(--vu-gap-10)',
        'vu-md': 'var(--vu-gap-md)',
        'vu-lg': 'var(--vu-gap-lg)',
        'vu-xl': 'var(--vu-gap-xl)',
      },
      marginBottom: {
        'vu-3': 'var(--vu-gap-3)',
        'vu-5': 'var(--vu-gap-5)',
        'vu-10': 'var(--vu-gap-10)',
      },

      // Промежутки (gap)
      gap: {
        'vu-min': 'var(--vu-gap-min)',
        'vu-base': 'var(--vu-gap-base)',
        'vu-md': 'var(--vu-gap-md)',
        'vu-lg': 'var(--vu-gap-lg)',
        'vu-xl': 'var(--vu-gap-xl)',
        'vu-panel': 'var(--vu-panel-gap)',
      },

      // Позиции
      top: {
        'vu-header-offset': 'var(--vu-pos-header-offset)',
      },
      bottom: {
        'vu-corner': 'var(--vu-pos-corner)',
      },
      left: {
        'vu-corner': 'var(--vu-pos-corner)',
      },
      right: {
        'vu-corner': 'var(--vu-pos-corner)',
      },

      // Border radius (используя VU значения)
      borderRadius: {
        'vu': 'var(--vu-base)',
        'vu-2': 'calc(2 * var(--vu-base))',
        'vu-5': 'calc(5 * var(--vu-base))',
        'vu-md': 'var(--vu-gap-md)',
        'vu-lg': 'var(--vu-gap-lg)',
      },

      // Border width (используя VU значения)
      borderWidth: {
        'vu': 'var(--vu-base)',
        'vu-2': 'calc(2 * var(--vu-base))',
        'vu-3': 'calc(3 * var(--vu-base))',
        'vu-5': 'calc(5 * var(--vu-base))',
        'vu-md': 'var(--vu-gap-md)',
        'vu-lg': 'var(--vu-gap-lg)',
      },

      // Минимальные размеры
      minWidth: {
        'vu-card-tiny': 'var(--vu-card-tiny)',
        'vu-card-small': 'var(--vu-card-small)',
        'vu-card-normal': 'var(--vu-card-normal)',
        'vu-modal-md': 'var(--vu-modal-md)',
      },

      maxWidth: {
        'vu-modal-lg': 'var(--vu-modal-lg)',
        'vu-modal-xl': 'var(--vu-modal-xl)',
      },

      maxHeight: {
        'vu-modal-lg': 'var(--vu-modal-lg)',
        'vu-modal-xl': 'var(--vu-modal-xl)',
        '50': '12.5rem',
      },
    },
  },
  plugins: [],
}