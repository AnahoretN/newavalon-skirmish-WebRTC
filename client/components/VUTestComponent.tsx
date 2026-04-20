/**
 * Тестовый компонент для проверки динамической системы VU
 * Демонстрирует автоматическое масштабирование при изменении размера окна
 */

import React, { useState } from 'react';
import { useVU } from '@/hooks/useVirtualUnits';

export const VUTestComponent: React.FC = () => {
  const { sizes, css, windowHeight, pxPerVU } = useVU();
  const [showDynamicInfo, setShowDynamicInfo] = useState(true);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-vu-lg z-50 overflow-y-auto">
      <div
        className="bg-gray-800 rounded-vu-2 shadow-2xl p-vu-panel"
        style={{ width: css.modalLg }}
      >
        {/* Header */}
        <div className="mb-vu-base pb-vu-base border-b border-gray-700">
          <h2 className="text-vu-2xl font-bold text-white">
            VU Dynamic System Test
          </h2>
          <p className="text-vu-sm text-gray-400 mt-vu-min">
            1 VU = 0.1% от высоты окна (полностью динамично!)
          </p>
        </div>

        {/* Динамическая информация */}
        {showDynamicInfo && (
          <div className="mb-vu-md p-vu-md bg-blue-900/30 rounded border border-blue-700">
            <h3 className="text-vu-base font-semibold text-blue-300 mb-vu-min">
              📊 Текущие параметры:
            </h3>
            <div className="grid grid-cols-2 gap-vu-base text-vu-sm">
              <div>
                <span className="text-gray-400">Высота окна:</span>
                <span className="text-white font-mono ml-2">{windowHeight}px</span>
              </div>
              <div>
                <span className="text-gray-400">1 VU =</span>
                <span className="text-green-400 font-mono ml-2">{pxPerVU.toFixed(2)}px</span>
              </div>
            </div>
            <p className="text-vu-xs text-gray-500 mt-vu-min">
              Измените размер окна чтобы увидеть как масштабируются все элементы! 👆
            </p>
          </div>
        )}

        {/* Контент */}
        <div className="space-y-vu-md max-h-[60vh] overflow-y-auto custom-scrollbar pr-vu-min">
          {/* Размеры карточек */}
          <div>
            <h3 className="text-vu-base font-semibold text-white mb-vu-min">
              Card Sizes (CSS Classes):
            </h3>
            <div className="flex gap-vu-base flex-wrap items-end">
              <div className="w-vu-card-tiny h-vu-card-tiny bg-blue-600 rounded flex items-center justify-center text-vu-xs text-white">
                Tiny
                <div className="text-vu-xs text-blue-200">{sizes.cardTiny.toFixed(0)}px</div>
              </div>
              <div className="w-vu-card-small h-vu-card-small bg-purple-600 rounded flex items-center justify-center text-vu-sm text-white">
                Small
                <div className="text-vu-xs text-purple-200">{sizes.cardSmall.toFixed(0)}px</div>
              </div>
              <div className="w-vu-card-normal h-vu-card-normal bg-green-600 rounded flex items-center justify-center text-vu-base text-white">
                Normal
                <div className="text-vu-xs text-green-200">{sizes.cardNormal.toFixed(0)}px</div>
              </div>
              <div className="w-vu-card-large h-vu-card-large bg-red-600 rounded flex items-center justify-center text-vu-md text-white">
                Large
                <div className="text-vu-xs text-red-200">{sizes.cardLarge.toFixed(0)}px</div>
              </div>
            </div>
          </div>

          {/* Сравнение методов */}
          <div>
            <h3 className="text-vu-base font-semibold text-white mb-vu-min">
              Hook Methods Comparison:
            </h3>
            <div className="grid grid-cols-2 gap-vu-md">
              <div className="p-vu-md bg-yellow-900/30 rounded border border-yellow-700">
                <h4 className="text-vu-sm text-yellow-300 mb-vu-min">sizes.* (px values)</h4>
                <div
                  className="bg-yellow-600 rounded flex items-center justify-center text-vu-sm text-white"
                  style={{ width: sizes.cardNormal, height: sizes.cardNormal }}
                >
                  {sizes.cardNormal.toFixed(0)}px
                </div>
                <p className="text-vu-xs text-yellow-200 mt-vu-min">
                  Динамические px значения
                </p>
              </div>

              <div className="p-vu-md bg-pink-900/30 rounded border border-pink-700">
                <h4 className="text-vu-sm text-pink-300 mb-vu-min">css.* (calc expressions)</h4>
                <div
                  className="bg-pink-600 rounded flex items-center justify-center text-vu-sm text-white"
                  style={{ width: css.cardNormal, height: css.cardNormal }}
                >
                  CSS calc
                </div>
                <p className="text-vu-xs text-pink-200 mt-vu-min">
                  Масштабируется браузером
                </p>
              </div>
            </div>
          </div>

          {/* Отступы */}
          <div>
            <h3 className="text-vu-base font-semibold text-white mb-vu-min">
              Padding & Margins:
            </h3>
            <div className="space-y-vu-min">
              <div className="p-vu-min bg-gray-700 rounded text-vu-xs text-gray-300">
                p-vu-min (~{sizes.gapMin.toFixed(0)}px)
              </div>
              <div className="p-vu-base bg-gray-700 rounded text-vu-xs text-gray-300">
                p-vu-base (~{sizes.gapBase.toFixed(0)}px)
              </div>
              <div className="p-vu-md bg-gray-700 rounded text-vu-sm text-gray-300">
                p-vu-md (~{sizes.gapMd.toFixed(0)}px)
              </div>
              <div className="p-vu-lg bg-gray-700 rounded text-vu-base text-gray-300">
                p-vu-lg (~{sizes.gapLg.toFixed(0)}px)
              </div>
            </div>
          </div>

          {/* Текст */}
          <div>
            <h3 className="text-vu-base font-semibold text-white mb-vu-min">
              Text Sizes:
            </h3>
            <div className="space-y-vu-min bg-gray-900 p-vu-md rounded">
              <p className="text-vu-xs text-gray-300">text-vu-xs (~{sizes.textXs.toFixed(0)}px)</p>
              <p className="text-vu-sm text-gray-300">text-vu-sm (~{sizes.textSm.toFixed(0)}px)</p>
              <p className="text-vu-base text-gray-300">text-vu-base (~{sizes.textBase.toFixed(0)}px)</p>
              <p className="text-vu-md text-gray-300">text-vu-md (~{sizes.textMd.toFixed(0)}px)</p>
              <p className="text-vu-lg text-gray-300">text-vu-lg (~{sizes.textLg.toFixed(0)}px)</p>
              <p className="text-vu-xl text-gray-300">text-vu-xl (~{sizes.textXl.toFixed(0)}px)</p>
            </div>
          </div>

          {/* Иконки и кнопки */}
          <div>
            <h3 className="text-vu-base font-semibold text-white mb-vu-min">
              Icons & Buttons:
            </h3>
            <div className="flex gap-vu-base items-center flex-wrap">
              <div className="w-vu-icon-xs h-vu-icon-xs bg-blue-500 rounded-full" title={sizes.iconXs.toFixed(0) + 'px'} />
              <div className="w-vu-icon-sm h-vu-icon-sm bg-blue-500 rounded-full" title={sizes.iconSm.toFixed(0) + 'px'} />
              <div className="w-vu-icon-md h-vu-icon-md bg-blue-500 rounded-full" title={sizes.iconMd.toFixed(0) + 'px'} />
              <div className="w-vu-icon-lg h-vu-icon-lg bg-blue-500 rounded-full" title={sizes.iconLg.toFixed(0) + 'px'} />

              <button className="px-vu-md py-vu-min bg-green-600 rounded text-vu-xs text-white">
                Small
              </button>
              <button className="px-vu-lg py-vu-base bg-green-600 rounded text-vu-sm text-white">
                Medium
              </button>
              <button className="px-vu-xl py-vu-md bg-green-600 rounded text-vu-base text-white">
                Large
              </button>
            </div>
          </div>

          {/* Gap примеры */}
          <div>
            <h3 className="text-vu-base font-semibold text-white mb-vu-min">
              Gap Examples:
            </h3>
            <div className="space-y-vu-md">
              <div className="flex gap-vu-base">
                <div className="w-vu-btn-md h-vu-btn-md bg-orange-600 rounded" />
                <div className="w-vu-btn-md h-vu-btn-md bg-orange-600 rounded" />
                <div className="w-vu-btn-md h-vu-btn-md bg-orange-600 rounded" />
                <span className="text-vu-xs text-gray-400">gap-vu-base (~{sizes.gapBase.toFixed(0)}px)</span>
              </div>
              <div className="grid grid-cols-3 gap-vu-md">
                <div className="w-vu-btn-md h-vu-btn-md bg-teal-600 rounded" />
                <div className="w-vu-btn-md h-vu-btn-md bg-teal-600 rounded" />
                <div className="w-vu-btn-md h-vu-btn-md bg-teal-600 rounded" />
              </div>
              <span className="text-vu-xs text-gray-400">gap-vu-md (~{sizes.gapMd.toFixed(0)}px)</span>
            </div>
          </div>

          {/* Модальное окно */}
          <div>
            <h3 className="text-vu-base font-semibold text-white mb-vu-min">
              Modal Sizes:
            </h3>
            <div className="space-y-vu-min">
              <div className="p-vu-min bg-gray-700 rounded text-vu-xs text-gray-300">
                modal-sm: {sizes.modalSm.toFixed(0)}px
              </div>
              <div className="p-vu-min bg-gray-700 rounded text-vu-xs text-gray-300">
                modal-md: {sizes.modalMd.toFixed(0)}px
              </div>
              <div className="p-vu-min bg-gray-700 rounded text-vu-xs text-gray-300">
                modal-lg: {sizes.modalLg.toFixed(0)}px
              </div>
            </div>
          </div>

          {/* Позиции */}
          <div>
            <h3 className="text-vu-base font-semibold text-white mb-vu-min">
              Positions:
            </h3>
            <div
              className="relative bg-gray-700 rounded overflow-hidden"
              style={{ height: css.cardSmall }}
            >
              <div className="absolute top-vu-header-offset left-vu-corner w-vu-icon-md h-vu-icon-md bg-red-500 rounded-full flex items-center justify-center text-vu-xs text-white">
                Top
              </div>
              <div className="absolute bottom-vu-corner right-vu-corner w-vu-icon-md h-vu-icon-md bg-blue-500 rounded-full flex items-center justify-center text-vu-xs text-white">
                Bottom
              </div>
              <div className="absolute inset-0 flex items-center justify-center text-vu-xs text-gray-400">
                {sizes.cardSmall.toFixed(0)}px height
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-vu-lg pt-vu-base border-t border-gray-700 flex justify-between items-center">
          <button
            onClick={() => setShowDynamicInfo(!showDynamicInfo)}
            className="px-vu-md py-vu-min bg-gray-600 hover:bg-gray-500 rounded text-vu-xs text-white transition-colors"
          >
            {showDynamicInfo ? 'Скрыть' : 'Показать'} инфо
          </button>
          <button className="px-vu-lg py-vu-md bg-indigo-600 hover:bg-indigo-700 rounded text-vu-base text-white transition-colors">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};

export default VUTestComponent;