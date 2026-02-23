# Детальный отчет о системе способностей карт

## Содержание
1. [Обзор системы](#overview)
2. [Типы способностей](#ability-types)
3. [Механика Stack Cursor](#stack-cursor-mechanics)
4. [Механика Targeting Mode](#targeting-mode-mechanics)
5. [Детальное описание всех способностей карт](#card-abilities-detail)
6. [Резюме ограничений targeting](#targeting-restrictions-summary)
7. [Обработка отсутствия целей](#no-target-handling)
8. [Визуальные эффекты](#visual-effects)
9. [WebRTC синхронизация](#webrtc-sync)
10. [Отладка](#debugging)
11. [Известные особенности](#known-features)
12. [Система командных карт](#command-cards-system)
13. [Полный список типов действий](#action-types-list)
14. [Важные правила способностей](#ability-rules)

---

<a name="overview"></a>
## 1. Обзор системы

Система способностей реализована через централизованные определения в `server/utils/autoAbilities.ts`. Каждая карта имеет объект `CARD_ABILITIES` с определениями способностей для каждого типа активации.

### Файл-источник истины
- **Server**: `server/utils/autoAbilities.ts` - все определения способностей (CARD_ABILITIES)
- **Shared**: `shared/utils/targeting.ts` - валидация целей
- **Client**: `client/hooks/useAppAbilities.ts` - исполнение действий
- **Client**: `client/hooks/abilities/` - обработчики кликов

### CARD_ABILITIES - Централизованное определение способностей

Все способности карт определены в массиве `CARD_ABILITIES` в `server/utils/autoAbilities.ts`. Это **единственный источник истины** для способностей.

```typescript
const CARD_ABILITIES: CardAbilityDefinition[] = [
  {
    baseId: 'faber',              // ID карты (из contentDatabase)
    activationType: 'deploy',     // Тип активации: 'deploy' | 'setup' | 'commit'
    getAction: (card, gameState, ownerId, coords) => ({ ... })
  },
  // ... остальные способности
]
```

**Важно:** При добавлении новой карты или изменении способностей необходимо обновлять `CARD_ABILITIES`. Система автоматически:
- Добавляет правильные ready статусы при входе карты на поле
- Проверяет доступность способностей в нужных фазах
- Предоставляет `getAction()` для генерации действий способностей

### Функция getAbilitiesForCard()

Получает все способности для конкретной карты:
```typescript
const getAbilitiesForCard = (card: Card): CardAbilityDefinition[] => {
  const baseId = card.baseId || ''
  return CARD_ABILITIES.filter(ability =>
    ability.baseId === baseId || ability.baseIdAlt?.includes(baseId)
  )
}
```

Эта функция используется:
- В `initializeReadyStatuses()` - чтобы добавить только нужные ready статусы
- В `hasReadyAbilityInCurrentPhase()` - чтобы проверить доступность способности
- В `canActivateAbility()` - чтобы проверить можно ли активировать

### Поток выполнения способности

```
Клик по карте
  -> activateAbility() (abilityActivation.ts)
    -> markAbilityUsed() - удаляет ready status НЕМЕДЛЕННО
    -> handleActionExecution() (useAppAbilities.ts)
      -> checkActionHasTargets() - проверка наличия целей
        -> Если нет целей: triggerNoTarget() + chainedAction
        -> Если есть цели: продолжение
      -> CREATE_STACK: setCursorStack() - создание стека токенов
      -> ENTER_MODE: setAbilityMode() + setTargetingMode()
      -> GLOBAL_AUTO_APPLY: немедленное применение
      -> OPEN_MODAL: открытие модального окна
```

---

<a name="ability-types"></a>
## 2. Типы способностей

### 2.1 Ready Status System

Каждая карта получает **только те** ready статусы, которые соответствуют её способностям:

**ПРАВИЛО:** При входе на поле боя карта получает ready статусы **ТОЛЬКО** для тех типов способностей, которые у неё есть.
- Если у карты есть Deploy способность → получит `readyDeploy`
- Если у карты есть Setup способность → получит `readySetup`
- Если у карты есть Commit способность → получит `readyCommit`

Это реализовано в функции `initializeReadyStatuses()` в `server/utils/autoAbilities.ts`:
```typescript
const abilities = getAbilitiesForCard(card)
for (const ability of abilities) {
  if (ability.activationType === 'deploy') { ... }
  else if (ability.activationType === 'setup') { ... }
  else if (ability.activationType === 'commit') { ... }
}
```

| Status | Когда добавляется | Когда сбрасывается | Описание |
|--------|-------------------|-------------------|----------|
| `readyDeploy` | При входе на поле (если есть Deploy способность) | После использования | Разрешает Deploy способность |
| `readySetup` | При входе на поле (если есть Setup способность) | Каждый ход в Preparation | Разрешает Setup способность |
| `readyCommit` | При входе на поле (если есть Commit способность) | Каждый ход в Preparation | Разрешает Commit способность |

### 2.2 Activation Types

| Тип | Фаза | Описание |
|-----|------|----------|
| `deploy` | После выхода на поле (в любой фазе) | Одноразовая способность | Но если крату убрать с поля боя и поставить на поле боя снова - деплой снова мжно применять.
| `setup` | Setup (фаза 1) | Сбрасывается каждый ход |
| `commit` | Commit (фаза 3) | Сбрасывается каждый ход |

### 2.3 Priority System и Последовательное выполнение

**ПРАВИЛО ПРИОРИТЕТА И ПОСЛЕДОВАТЕЛЬНОГО ВЫПОЛНЕНИЯ:**

Когда у карты есть несколько способностей, доступных в текущей фазе:
1. **Deploy способность имеет ПРИОРИТЕТ** - выполняется первой
2. После использования Deploy (или отмены по ПКМ) - переход к следующей способности
3. **Setup/Commit способности** выполняются по порядку в своей фазе

**Пример:** Карта с Deploy и Commit способностями в фазе 3 (Commit):
- Сначала показывается Deploy способность (приоритет)
- Игрок использует Deploy → `readyDeploy` удаляется
- Карта **остаётся** на поле и теперь показывается Commit способность (readyCommit)
- Игрок использует Commit → `readyCommit` удаляется
- Карта больше не имеет готовых способностей в этой фазе

**Фазы активации способностей:**
| Тип | Фаза | Описание |
|-----|------|----------|
| `deploy` | ЛЮБАЯ фаза (0, 1, 2, 3, 4) | Приоритет над другими способностями |
| `setup` | ТОЛЬКО фаза 1 (Setup) | Если нет Deploy |
| `commit` | ТОЛЬКО фаза 3 (Commit) | Если нет Deploy |

### 2.4 Support Required

Некоторые способности требуют статус `Support` на карте:

```
if (ability.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
  return null // Способность недоступна
}
```

Карты с требованием Support:
- IP Dept Agent (Setup)
- Cautious Avenger (Setup)
- Immunis (Deploy)
- Unwavering Integrator (Setup)
- Signal Prophet (Commit)
- Zealous Missionary (Commit)
- Code Keeper (Commit)
- Zius IJ (Setup)

---

<a name="stack-cursor-mechanics"></a>
## 3. Механика Stack Cursor

### 3.1 Создание стека

Стек создается через действие `CREATE_STACK`:

```typescript
{
  type: 'CREATE_STACK',
  tokenType: 'Aim' | 'Stun' | 'Revealed' | 'Exploit',
  count: 1-2,
  // Ограничения targeting
  targetOwnerId?: number,
  excludeOwnerId?: number,
  onlyOpponents?: boolean,
  onlyFaceDown?: boolean,
  targetType?: string,
  requiredTargetStatus?: string,
  requireStatusFromSourceOwner?: boolean,
  mustBeAdjacentToSource?: boolean,
  mustBeInLineWithSource?: boolean,
  maxDistanceFromSource?: number,
  maxOrthogonalDistance?: number,
  placeAllAtOnce?: boolean,
  chainedAction?: AbilityAction,
  recordContext?: boolean,
  replaceStatus?: boolean,
}
```

### 3.2 Визуальное отображение

При активном стеке:
- Курсор показывает тип и количество токенов
- Подсветка валидных целей цветом владельца карты-источника
- Невалидные цели не реагируют на клик

### 3.3 Размещение токенов

**При клике на валидную цель:**

```
1. validateTarget() проверяет соответствие ограничениям
2. moveItem() помещает токен на цель
3. markAbilityUsed() помечает способность использованной
4. count-- (если count > 1)
5. Если count == 0:
     - Если есть chainedAction -> handleActionExecution(chainedAction)
     - setCursorStack(null)
```

**Ограничения validateTarget():**

```typescript
// Владелец цели
targetOwnerId !== undefined && targetOwnerId !== ownerId

// Исключенный владелец
excludeOwnerId !== undefined && excludeOwnerId === ownerId

// Только оппоненты
onlyOpponents && (
  ownerId === userPlayerId ||
  userPlayer.teamId === targetPlayer.teamId
)

// Только рубашкой вверх
onlyFaceDown && (
  card.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === userPlayerId) ||
  (location === 'board' && !card.isFaceDown)
)

// Требуемый статус
requiredTargetStatus && !card.statuses.some(s => s.type === requiredTargetStatus)

// Статус от владельца источника
requireStatusFromSourceOwner && !card.statuses.some(
  s => s.type === requiredTargetStatus && s.addedByPlayerId === userPlayerId
)

// Соседство (ортогональное)
mustBeAdjacentToSource && (Math.abs(r1-r2) + Math.abs(c1-c2) !== 1)

// На одной линии
mustBeInLineWithSource && (r1 !== r2 && c1 !== c2)

// Максимальное расстояние (Chebyshev)
maxDistanceFromSource !== undefined && Math.max(Math.abs(r1-r2), Math.abs(c1-c2)) > maxDistanceFromSource

// Максимальное ортогональное расстояние (Manhattan)
maxOrthogonalDistance !== undefined && (Math.abs(r1-r2) + Math.abs(c1-c2)) > maxOrthogonalDistance
```

### 3.4 Targeting Tokens vs Rule Tokens

**ПРАВИЛО: Targeting токены не могут быть размещены на картах в руке**

Токены делятся на две категории:

| Тип | Токены | Могут целить карты в руке? | Примеры карт |
|-----|--------|---------------------------|--------------|
| **Targeting Tokens** | Aim, Exploit, Stun, Shield | **НЕТ** | Tactical Agent, Threat Analyst, IP Dept Agent, Princeps |
| **Rule Tokens** | Revealed, Power buffs | **ДА** | Threat Analyst, Vigilant Spotter |

**Реализация:**
1. `shared/utils/targeting.ts` - `checkActionHasTargets()` исключает hand targets для targeting токенов
2. `client/hooks/abilities/handCardHandlers.ts` - при клике на карту в руке с активным stack targeting токена - действие игнорируется

```typescript
// Список targeting токенов, которые НЕ могут целить карты в руке
const targetingTokens = ['Aim', 'Exploit', 'Stun', 'Shield']
if (targetingTokens.includes(cursorStack.type)) {
  return // Игнорировать клик
}
```

**Список всех карт с targeting токенами:**
- **Aim**: Tactical Agent, Cautious Avenger, Walking Turret, Eleftheria MD, Gawain, Princeps
- **Exploit**: Threat Analyst, Code Keeper, Data Liberator, Censor, Unwavering Integrator, Signal Prophet, Zealous Missionary, Zius IJ
- **Stun**: IP Dept Agent, Patrol Agent, Riot Agent, Censor, Pinku Neko SV
- **Shield**: Princeps, Edith Byron, Gawain, Reclaimed Gawain

### 3.5 placeAllAtOnce

Если `placeAllAtOnce: true`, все токены размещаются одним кликом на одной цели:
- IP Dept Agent Deploy: 2x Stun на одну цель с Threat

### 3.5 chainedAction

После опустешения стека выполняется связанное действие:
- Zius Setup: после размещения Exploit -> выбор линии для подсчета очков
- Princeps Deploy: после Shield -> Aim stack
- Gawain Deploy: после Shield -> Aim stack

### 3.6 Ограничения на размещение токенов

**Правило: Targeting токены нельзя размещать на картах в руке**

На карты в руке можно помещать только:
- **Rule токены** (правила игры)
- **Revealed статус** (специальный статус для открытых карт)

Targeting токены, которые **НЕЛЬЗЯ** помещать на карты в руке:
- `Aim` (прицел)
- `Exploit` (эксплойт)
- `Stun` (стан)
- `Shield` (щит)

Это правило реализовано в `client/hooks/abilities/handCardHandlers.ts`.

### 3.7 Отмена режимов по правому клику

**Правило: Правая кнопка мыши отменяет все активные режимы**

При нажатии правой кнопки мыши (ПКМ) в любом месте игры:
- Отменяется `abilityMode` (активная способность)
- Очищается `cursorStack` (стек токенов для размещения)
- Очищается `playMode` (режим размещения карты из руки)
- Очищается `targetingMode` у **всех игроков** (синхронизация через WebRTC)
- Очищаются `validHandTargets` (подсветка карт в руке)

Это реализовано через `handleCancelAllModes()` в `App.tsx` и передается в:
- `GameBoard.tsx` - для доски
- `PlayerPanel.tsx` - для панелей игроков

---

<a name="targeting-mode-mechanics"></a>
## 4. Механика Targeting Mode

### 4.1 Активация режима

```
ENTER_MODE действие
  -> setAbilityMode(abilityAction)
  -> setTargetingMode(action, playerId, sourceCoords)
    -> gameState.targetingMode обновляется
    -> Рассылается всем игрокам через WebRTC
```

### 4.2 Структура TargetingModeData

```typescript
interface TargetingModeData {
  playerId: number,           // Игрок, выбирающий цель
  action: AbilityAction,      // Действие с ограничениями
  sourceCoords?: {row, col},  // Координаты карты-источника
  timestamp: number,          // Уникальность
  boardTargets?: [{row, col}],// Предвычисленные цели на поле
  handTargets?: [{playerId, cardIndex}], // Цели в руке
  isDeckSelectable?: boolean, // Можно ли выбрать колоду
}
```

### 4.3 Подсветка валидных целей

**calculateValidTargets()** вычисляет подсвечиваемые клетки:

```
1. Определить границы активной сетки (activeGridSize)
2. Для каждой клетки в границах:
     - Если CREATE_STACK: validateTarget() с ограничениями
     - Если SELECT_TARGET: payload.filter(card, r, c)
     - Если PATROL_MOVE: пустые клетки в строке/столбце
     - Если RIOT_PUSH: соседи-оппоненты с пустой клеткой для толкания
     - И т.д. для каждого режима
```

### 4.4 Клик по валидной цели

```
handleBoardCardClick(card, coords)
  -> Проверка mode-specific логики
  -> Выполнение действия
  -> markAbilityUsed()
  -> setTimeout(setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
```

### 4.5 Клик по невалидной цели

```
handleBoardCardClick(card, coords)
  -> Проверка фильтра/ограничений
  -> Если не проходит: return (ничего не происходит)
```

### 4.6 Отмена режима

```
- Esc клавиша
- Клик по невозможной цели (в некоторых режимах)
- Выполнение действия
- Истечение времени
```

---

<a name="card-abilities-detail"></a>
## 5. Детальное описание всех способностей карт

### SYCHROTECH

---

#### IP Dept Agent (ipDeptAgent)

**Deploy**: `CREATE_STACK: Stun x2`
```
1. Клик по карте
2. Визуально: исчезновение readyDeploy
3. Создается cursorStack:
   - type: 'Stun'
   - count: 2
   - requiredTargetStatus: 'Threat'
   - requireStatusFromSourceOwner: true
   - placeAllAtOnce: true
4. Валидные цели:
   - Карты на поле с статусом Threat
   - Статус Threat добавлен владельцем IP Dept Agent
   - Любые карты (свои, чужие, teammates)
5. Клик по цели:
   - 2 токена Stun размещаются на карте
   - markAbilityUsed()
   - setCursorStack(null)
6. Нет целей:
   - triggerNoTarget()
   - Способность помечена использованной
```

**Setup**: `ENTER_MODE: IP_AGENT_THREAT_SCORING`
```
Требуется: Support status

1. Клик по карте (с Support)
2. Визуально: исчезновение readySetup
3. Активируется targeting mode:
   - mode: 'IP_AGENT_THREAT_SCORING'
   - sourceCoords: координаты агента
4. Валидные цели:
   - Любая клетка в той же строке ИЛИ столбце, что и агент
   - Включая клетки с картами и пустые
5. Клик по клетке:
   - Подсчитывается количество Threat с addedByPlayerId = ownerId агента
     в выбранной строке или столбце
   - Очки = threatCount * 2
   - updatePlayerScore(ownerId, очки)
   - triggerFloatingText(+очки)
   - markAbilityUsed()
6. Нет целей:
   - Невозможно (всегда есть как минимум сама клетка агента)
```

---

#### Tactical Agent (tacticalAgent)

**Deploy**: `CREATE_STACK: Aim x1`
```
1. Клик по карте
2. Создается cursorStack:
   - type: 'Aim'
   - count: 1
   - requiredTargetStatus: 'Threat'
   - requireStatusFromSourceOwner: true
3. Валидные цели:
   - Карты на поле с статусом Threat
   - Статус Threat добавлен владельцем Tactical Agent
4. Клик по цели:
   - 1 токен Aim размещается на карте
   - markAbilityUsed()
```

**Setup**: `SELECT_TARGET: DESTROY`
```
1. Клик по карте
2. Активируется targeting mode: SELECT_TARGET
3. Валидные цели:
   - Карты на поле с статусом Aim
   - Статус Aim добавлен владельцем Tactical Agent
4. Клик по цели:
   - Если есть Shield: removeBoardCardStatus(Shield)
   - Иначе: moveItem в discard
   - markAbilityUsed()
```

---

#### Patrol Agent (patrolAgent)

**Setup**: `ENTER_MODE: PATROL_MOVE`
```
1. Клик по карте
2. Визуально: исчезновение readySetup
3. Активируется targeting mode:
   - mode: 'PATROL_MOVE'
   - sourceCoords: координаты агента
4. Валидные цели:
   - Пустые клетки в той же строке ИЛИ столбце
   - Включая текущую позицию (отмена)
5. Клик по пустой клетке:
   - moveItem агента на выбранную клетку
   - markAbilityUsed()
6. Клик на себя:
   - Отмена движения
   - markAbilityUsed()
```

**Commit**: `CREATE_STACK: Stun x1`
```
1. Клик по карте (в фазу Commit)
2. Создается cursorStack:
   - type: 'Stun'
   - count: 1
   - requiredTargetStatus: 'Threat'
   - onlyOpponents: true
   - mustBeAdjacentToSource: true
3. Валидные цели:
   - Соседние карты (ортогонально, dist=1)
   - С статусом Threat
   - Принадлежащие оппонентам (не self, не teammate)
4. Клик по цели:
   - 1 токен Stun размещается
   - markAbilityUsed()
```

---

#### Riot Agent (riotAgent)

**Deploy**: `ENTER_MODE: RIOT_PUSH`
```
1. Клик по карте
2. Проверка наличия валидных целей для толкания:
   - Соседняя карта (ортогонально)
   - Принадлежит оппоненту (не self, не teammate)
   - За ней есть пустая клетка для толкания
3. Если есть цели:
   - Активируется targeting mode: RIOT_PUSH
   - Подсвечиваются валидные соседи
4. Если нет целей:
   - triggerNoTarget()
   - Способность помечена использованной

Валидные цели:
- Соседние карты (ортогонально, расстояние 1)
- Владелец: не self, не teammate
- За картой есть пустая клетка в активной сетке

Клик по цели:
- Карта толкается на 1 клетку в направлении от агента
- Переход в режим RIOT_MOVE

RIOT_MOVE режим:
- Валидные цели: вакантная клетка (куда толкнули) ИЛИ текущая позиция
- Клик на вакантную: moveItem агента туда
- Клик на себя: остаться на месте
```

**Commit**: `CREATE_STACK: Stun x1`
```
Идентично Patrol Agent Commit
```

---

#### Threat Analyst (threatAnalyst)

**Deploy**: `CREATE_STACK: Exploit x1`
```
1. Клик по карте
2. Создается cursorStack:
   - type: 'Exploit'
   - count: 1
   - Без ограничений (любая карта на поле)
3. Валидные цели:
   - Любая карта на поле
4. Клик по цели:
   - 1 токен Exploit размещается
   - markAbilityUsed()
```

**Commit**: `CREATE_STACK: Revealed (dynamic)`
```
Требуется: Support status

1. Клик по карте (с Support)
2. Подсчет Exploit на поле:
   - Сканируется все поле
   - Считаются токены Exploit с addedByPlayerId = ownerId
3. Если count > 0:
   - Создается cursorStack:
     - type: 'Revealed'
     - count: общее количество Exploit
     - onlyFaceDown: true
4. Валидные цели:
   - Карты на поле без Revealed от этого игрока
   - Карты в руке оппонентов
5. Нет целей (count == 0):
   - triggerNoTarget()
```

---

#### Mr. Pearl (mrPearlDoF)

**Deploy**: `OPEN_MODAL: SEARCH_DECK`
```
1. Клик по карте
2. Открывается модальное окно:
   - filterType: 'Unit'
   - action: 'RETRIEVE_FROM_DECK'
3. Игрок выбирает юнита из колоды
4. Карта перемещается в руку
5. markAbilityUsed()
```

---

#### Vigilant Spotter (vigilantSpotter)

**Commit**: `CREATE_STACK: Revealed x1`
```
1. Клик по карте (в фазу Commit)
2. Создается cursorStack:
   - type: 'Revealed'
   - count: 1
   - onlyFaceDown: true
   - excludeOwnerId: ownerId (не на свои карты)
3. Валидные цели:
   - Карты на поле, не принадлежащие владельцу
   - Без Revealed от этого игрока
   - Лица с рубашкой вниз ИЛИ unrevealed в руке
4. Клик по цели:
   - 1 токен Revealed размещается
   - markAbilityUsed()
```

---

#### Code Keeper (codeKeeper)

**Deploy**: `GLOBAL_AUTO_APPLY: Exploit`
```
1. Клик по карте
2. Немедленное применение (выбор игрока не требуется):
   - Сканируется все поле
   - Для каждой карты:
     - Если ownerId !== ownerId Code Keeper
     - И есть статус Threat
     - Добавляется Exploit
3. Если есть хотя бы одна цель:
   - applyGlobalEffect() для всех целей
   - markAbilityUsed()
4. Если нет целей:
   - triggerNoTarget()
   - markAbilityUsed()
```

**Commit**: `ENTER_MODE: SELECT_UNIT_FOR_MOVE`
```
Требуется: Support status

1. Клик по карте (с Support)
2. Активируется targeting mode: SELECT_UNIT_FOR_MOVE
3. Валидные цели:
   - Карты на поле
   - Владелец: не ownerId Code Keeper
   - Имеют статус Exploit от Code Keeper
4. Клик по цели:
   - Переход в режим SELECT_CELL (выбор клетки для перемещения)
   - range: 2 (1 или 2 клетки)
   - moveFromHand: false
5. После выбора клетки:
   - moveItem выбранной карты на клетку
   - recordContext: true
   - Если есть chainedAction: выполнение
```

---

#### Centurion (centurion)

**Commit**: `SELECT_TARGET: SACRIFICE_AND_BUFF_LINES`
```
1. Клик по карте
2. Активируется targeting mode: SELECT_TARGET
3. Валидные цели:
   - Карты на поле
   - Владелец: ownerId Centurion
   - Тип: 'Unit'
   - r и c определены
4. Клик по цели:
   - SACRIFICE: карта отправляется в discard (bypass shield)
   - BUFF: все союзные карты в строке И столбце получают +1 power
   - markAbilityUsed()
```

---

### HOODS

---

#### Reckless Provocateur (recklessProvocateur)

**Deploy**: `ENTER_MODE: SWAP_POSITIONS`
```
1. Клик по карте
2. Активируется targeting mode: SWAP_POSITIONS
3. Валидные цели:
   - Карты на поле
   - Соседние (ортогонально, distance = 1)
   - Любого владельца (включая свои)
4. Клик по цели:
   - swapCards(sourceCoords, targetCoords)
   - Reckless Provocateur перемещается на цель
   - Цель перемещается на старое место Reckless
   - markAbilityUsed() на НОВОЙ позиции
```

**Commit**: `ENTER_MODE: TRANSFER_ALL_STATUSES`
```
1. Клик по карте
2. Активируется targeting mode: TRANSFER_ALL_STATUSES
3. Валидные цели:
   - Карты на поле
   - Владелец: ownerId Reckless
   - Не сама карта (id !== sourceCard.id)
4. Клик по цели:
   - transferAllCounters(targetCoords, sourceCoords)
   - Все статусы переносятся с Reckless на цель
   - markAbilityUsed()
```

---

#### Data Liberator (dataLiberator)

**Deploy**: `CREATE_STACK: Exploit x1`
```
Аналогично Threat Analyst Deploy
```

---

#### Cautious Avenger (cautiousAvenger)

**Deploy**: `CREATE_STACK: Aim x1`
```
1. Клик по карте
2. Создается cursorStack:
   - type: 'Aim'
   - count: 1
   - maxOrthogonalDistance: 2
3. Валидные цели:
   - Карты на поле
   - Ортогональное расстояние <= 2 (Manhattan distance)
   - Проверка: |r1-r2| + |c1-c2| <= 2
4. Клик по цели:
   - 1 токен Aim размещается
   - markAbilityUsed()
```

**Setup**: `SELECT_TARGET: DESTROY`
```
Требуется: Support status

Аналогично Tactical Agent Setup
```

---

#### Inventive Maker (inventiveMaker)

**Deploy**: `ENTER_MODE: SPAWN_TOKEN`
```
1. Клик по карте
2. Активируется targeting mode: SPAWN_TOKEN
3. Валидные цели:
   - Пустые клетки
   - Соседние (ортогонально, distance = 1)
4. Клик по клетке:
   - spawnToken(coords, 'Recon Drone', ownerId)
   - Создается токен Recon Drone
   - markAbilityUsed()
```

**Setup**: `OPEN_MODAL: RETRIEVE_DEVICE`
```
Требуется: Support status

1. Клик по карте (с Support)
2. Открывается модальное окно:
   - filterType: 'Device'
   - action: 'recover'
3. Игрок выбирает карту Device из discard
4. Карта перемещается в руку
5. markAbilityUsed()
```

---

### OPTIMATES

---

#### Faber (faber)

**Deploy**: `SELECT_TARGET: SELECT_HAND_FOR_DISCARD_THEN_SPAWN`
```
1. Клик по карте
2. Проверка: есть ли карты в руке владельца
3. Если нет:
   - triggerNoTarget()
   - Способность помечена использованной
4. Если есть:
   - Активируется targeting mode: SELECT_TARGET
   - payload.handOnly = true
5. Валидные цели:
   - Карты в руке владельца Faber
   - filter: c.ownerId === ownerId
6. Клик по карте в руке:
   - moveItem в discard
   - Переход в режим SPAWN_TOKEN
7. SPAWN_TOKEN:
   - Валидные цели: пустые клетки на поле
   - Spawn: Walking Turret
   - markAbilityUsed()
```

---

#### Censor (censor)

**Deploy**: `CREATE_STACK: Exploit x1`
```
Аналогично Threat Analyst Deploy
```

**Commit**: `CREATE_STACK: Stun x1 (REPLACE)`
```
Требуется: Support status

1. Клик по карте (с Support)
2. Создается cursorStack:
   - type: 'Stun'
   - count: 1
   - requiredTargetStatus: 'Exploit'
   - requireStatusFromSourceOwner: true
   - replaceStatus: true
3. Валидные цели:
   - Карты на поле
   - С статусом Exploit от Censor
4. Клик по цели:
   - Exploit ЗАМЕНЯЕТСЯ на Stun
   - (добавляется Stun, удаляется Exploit)
   - markAbilityUsed()
```

---

#### Princeps (princeps)

**Deploy**: `SHIELD_SELF_THEN_AIM`
```
1. Клик по карте
2. Немедленно: addBoardCardStatus(sourceCoords, 'Shield', ownerId)
3. Проверка валидных целей для Aim stack:
   - mustBeInLineWithSource: true
   - Цель: любая карта в строке или столбце
4. Если есть цели:
   - Создается cursorStack:
     - type: 'Aim'
     - count: 1
     - mustBeInLineWithSource: true
5. Если нет целей:
   - triggerNoTarget()
```

**Setup**: `SELECT_TARGET: DESTROY`
```
Аналогично Tactical Agent Setup (уничтожение карт с Aim)
```

---

#### Immunis (immunis)

**Deploy**: `OPEN_MODAL: IMMUNIS_RETRIEVE`
```
Требуется: Support status

1. Клик по карте (с Support)
2. Открывается модальное окно:
   - filterType: 'Optimates'
   - action: 'resurrect'
3. Игрок выбирает карту из discard
4. Переход в режим IMMUNIS_RETRIEVE:
   - Валидные цели: пустые клетки
   - Соседние (ортогонально)
5. Клик по клетке:
   - resurrectDiscardedCard()
   - markAbilityUsed()
```

---

#### Devout Synthetic (devoutSynthetic)

**Deploy**: `RIOT_PUSH`
```
Аналогично Riot Agent Deploy
```

**Setup**: `SELECT_TARGET: DESTROY`
```
1. Клик по карте
2. Активируется targeting mode: SELECT_TARGET
3. Валидные цели:
   - Карты на поле
   - Соседние (ортогонально)
   - Владелец: не ownerId Devout
   - Имеют статус Threat ИЛИ Stun от Devout
4. Клик по цели:
   - Если есть Shield: removeBoardCardStatus(Shield)
   - Иначе: moveItem в discard
   - markAbilityUsed()
```

---

#### Unwavering Integrator (unwaveringIntegrator)

**Deploy**: `CREATE_STACK: Exploit x1`
```
Аналогично Threat Analyst Deploy
```

**Setup**: `ENTER_MODE: INTEGRATOR_LINE_SELECT`
```
Требуется: Support status

1. Клик по карте (с Support)
2. Активируется targeting mode: INTEGRATOR_LINE_SELECT
3. Валидные цели:
   - Любая клетка в той же строке ИЛИ столбце
4. Клик по клетке:
   - Если выбрана строка: подсчет Exploit в строке
   - Если выбран столбец: подсчет Exploit в столбце
   - Очки = количество Exploit
   - updatePlayerScore()
   - triggerFloatingText()
   - markAbilityUsed()
```

---

#### Signal Prophet (signalProphet)

**Deploy**: `GLOBAL_AUTO_APPLY: Exploit`
```
1. Клик по карте
2. Немедленное применение:
   - Для каждой карты на поле:
     - Если ownerId === ownerId Signal Prophet
     - И имеет статус Support
     - Добавляется Exploit
3. Если есть цели:
   - applyGlobalEffect()
   - markAbilityUsed()
4. Если нет целей:
   - triggerNoTarget()
```

**Commit**: `SELECT_UNIT_FOR_MOVE`
```
Требуется: Support status

Аналогично Code Keeper Commit, но:
- Владелец: ownerId Signal Prophet
- Статус: Exploit от Signal Prophet
```

---

#### Zealous Missionary (zealousMissionary)

**Deploy**: `CREATE_STACK: Exploit x1`
```
Аналогично Threat Analyst Deploy
```

**Commit**: `ZEALOUS_WEAKEN`
```
Требуется: Support status

1. Клик по карте (с Support)
2. Активируется targeting mode: ZEALOUS_WEAKEN
3. Валидные цели:
   - Карты на поле
   - С статусом Exploit от Zealous
4. Клик по цели:
   - modifyBoardCardPower(coords, -1)
   - markAbilityUsed()
```

---

### TOKENS

---

#### Walking Turret (walkingTurret)

**Deploy**: `CREATE_STACK: Aim x1`
```
1. При создании токена
2. Создается cursorStack:
   - type: 'Aim'
   - count: 1
   - mustBeInLineWithSource: true
3. Валидные цели:
   - Карты на поле в той же строке или столбце
4. Клик по цели:
   - 1 токен Aim размещается
   - markAbilityUsed()
```

**Setup**: `SELECT_TARGET: MODIFY_POWER`
```
1. Клик по токену
2. Активируется targeting mode: SELECT_TARGET
3. Валидные цели:
   - Карты на поле
   - С статусом Aim от владельца токена
4. Клик по цели:
   - modifyBoardCardPower(coords, -1)
   - markAbilityUsed()
```

---

#### Recon Drone (reconDrone)

**Setup**: `SELECT_CELL`
```
1. Клик по токену
2. Активируется targeting mode: SELECT_CELL
3. Валидные цели:
   - Любая пустая клетка на поле (range: 'global')
4. Клик по клетке:
   - moveItem токена на выбранную клетку
   - markAbilityUsed()
```

**Commit**: `REVEAL_ENEMY`
```
1. Клик по токену
2. Активируется targeting mode: REVEAL_ENEMY
3. Валидные цели:
   - Карты на поле
   - Соседние (ортогонально)
   - Владелец: не ownerId Recon Drone
4. Клик по цели:
   - Создается cursorStack:
     - type: 'Revealed'
     - count: 1
     - targetOwnerId: ownerId цели
     - onlyFaceDown: true
     - onlyOpponents: true
   - markAbilityUsed() источника
```

---

### NEUTRAL / HEROES

---

#### ABR Gawain (abrGawain / autonomousBattleRobot)

**Deploy**: `GAWAIN_DEPLOY_SHIELD_AIM`
```
1. Клик по карте
2. Немедленно: addBoardCardStatus(sourceCoords, 'Shield', ownerId)
3. Проверка валидных целей для Aim:
   - mustBeInLineWithSource: true
   - Любая карта в строке или столбце
4. Если есть цели:
   - Создается cursorStack: Aim x1
5. Если нет целей:
   - triggerNoTarget()
```

**Setup**: `SELECT_TARGET: DESTROY`
```
Аналогично Princeps Setup (уничтожение карт с Aim)
```

---

#### Reclaimed Gawain (reclaimedGawain)

**Deploy**: `SHIELD_SELF_THEN_RIOT_PUSH`
```
1. Клик по карте
2. Немедленно: addBoardCardStatus(sourceCoords, 'Shield', ownerId)
3. Проверка валидных целей для RIOT_PUSH:
   - Соседняя карта оппонента
   - За ней есть пустая клетка
4. Если есть цели:
   - Активируется targeting mode: RIOT_PUSH
5. Если нет целей:
   - triggerNoTarget()
```

**Setup**: `SELECT_TARGET: DESTROY`
```
Аналогично Devout Synthetic Setup
(Threat или Stun от Gawain, соседние карты оппонентов)
```

---

#### Falk PD (FalkPD)

**Deploy**: `OPEN_MODAL: SEARCH_DECK`
```
1. Клик по карте
2. Открывается модальное окно:
   - filterType: 'Any'
3. Игрок выбирает любую карту из колоды
4. Карта перемещается в руку
5. markAbilityUsed()
```

**Commit**: `CREATE_STACK: Revealed x1`
```
Аналогично Vigilant Spotter Commit
```

---

#### Edith Byron (edithByron)

**Deploy**: `SHIELD_SELF_THEN_SPAWN`
```
1. Клик по карте
2. Немедленно: addBoardCardStatus(sourceCoords, 'Shield', ownerId)
3. Активируется targeting mode: SPAWN_TOKEN
4. Валидные цели:
   - Пустые клетки
   - Соседние (ортогонально)
5. Клик по клетке:
   - spawnToken(coords, 'Recon Drone', ownerId)
   - markAbilityUsed()
```

**Setup**: `PATROL_MOVE`
```
Аналогично Patrol Agent Setup
```

---

#### Pinkunoneko SV (pinkunonekoSV)

**Deploy**: `CREATE_STACK: Stun x1`
```
1. Клик по карте
2. Создается cursorStack:
   - type: 'Stun'
   - count: 1
   - onlyOpponents: true
   - mustBeAdjacentToSource: true
3. Валидные цели:
   - Соседние карты оппонентов
4. Клик по цели:
   - 1 токен Stun размещается
   - markAbilityUsed()
```

**Setup**: `SELECT_TARGET: DESTROY + CHAIN`
```
1. Клик по карте
2. Активируется targeting mode: SELECT_TARGET
3. Валидные цели:
   - Карты на поле
   - Соседние (ортогонально)
   - С статусом Threat ИЛИ Stun от Pinkunoneko
4. Клик по цели:
   - Если есть Shield: removeBoardCardStatus(Shield)
   - Иначе: moveItem в discard
   - chainedAction: SELECT_CELL (range: 1, allowSelf: true)
5. SELECT_CELL:
   - Валидные цели: пустые соседние клетки ИЛИ текущая позиция
   - После выбора: возможность переместить карту
```

---

#### Eleftheria MD (EleftheriaMD)

**Deploy**: `CREATE_STACK: Aim x1`
```
Аналогично Tactical Agent Deploy (но без ограничений на Threat)
```

**Setup**: `SELECT_TARGET: DESTROY`
```
Аналогично Tactical Agent Setup
```

---

#### Zius IJ (ziusIJ)

**Deploy**: `CREATE_STACK: Exploit x1`
```
Аналогично Threat Analyst Deploy
```

**Setup**: `CREATE_STACK + CHAIN`
```
Требуется: Support status

1. Клик по карте (с Support)
2. Создается cursorStack:
   - type: 'Exploit'
   - count: 1
   - recordContext: true
3. Валидные цели:
   - Любая карта на поле
4. Клик по цели:
   - Exploit размещается
   - commandContext.lastMovedCardCoords = цель
   - chainedAction: ZIUS_LINE_SELECT
5. ZIUS_LINE_SELECT:
   - Валидные цели: клетки в строке или столбце ЦЕЛИ
   - Клик по клетке:
     - Подсчет Exploit в выбранной линии
     - Очки = количество Exploit
     - triggerFloatingText() для каждой карты с Exploit
     - updatePlayerScore()
     - markAbilityUsed()
```

---

#### Secret Informant (secretInformant)

**Deploy**: `SELECT_DECK` - "Look at the top 3 cards of any deck. Put any number of them on the bottom of that deck. Draw 1 card."

```
1. Клик по карте Secret Informant
2. Активируется ability mode: SELECT_DECK
3. Валидные цели:
   - Любая колода любого игрока (все колоды становятся кликабельными)
4. Клик по колоде:
   - Открывается TopDeckView с верхними 3 картами
   - isLocked: true (нельзя закрыть без завершения)
   - sourceCard сохраняется в topDeckViewState
5. Игрок может:
   - Переместить любую из карт на низ колоды
   - Переместить карту в руку
   - Просто закрыть модалку
6. При закрытии модалки (handleTopDeckClose):
   - Проверяется isLocked и sourceCard
   - Вызывается drawCard(sourceCard.ownerId) - дование 1 карты
   - Вызывается markAbilityUsed()
   - topDeckViewState очищается
```

**Важные детали:**
- sourceCard извлекается напрямую из abilityMode.sourceCard (не через action)
- Колода НЕ перемешивается после просмотра (в отличие от карт типа Michael Falk)
- Карту можно довать даже если ничего не переместил на низ колоды
- Используется mode: SELECT_DECK в autoAbilities.ts
- Обработка в App.tsx: handleDeckClick() + handleTopDeckClose()

---

#### Reverend of the Choir (reverendOfTheChoir)

**Setup**: `REVEREND_SETUP_SCORE`
```
1. Клик по карте
2. Подсчет Exploit на поле:
   - Сканируется все поле
   - Считаются токены Exploit с addedByPlayerId = ownerId
3. Очки = количество Exploit
4. updatePlayerScore(ownerId, очки)
5. triggerFloatingText(+очки)
6. markAbilityUsed()
```

**Deploy**: `REVEREND_DOUBLE_EXPLOIT`
```
1. Клик по карте
2. Активируется targeting mode: REVEREND_DOUBLE_EXPLOIT
3. Валидные цели:
   - ЛЮБАЯ карта на поле (даже без Exploit)
4. Клик по цели:
   - Подсчет Exploit на карте с addedByPlayerId = ownerId
   - Добавляется такое же количество Exploit (удвоение)
   - Если 0 Exploit: ничего не добавляется
   - markAbilityUsed()
```

---

#### Lucius the Immortal (luciusTheImmortal)

**Setup**: `SELECT_TARGET: LUCIUS_SETUP`
```
1. Клик по карте
2. Проверка: есть ли карты в руке
3. Если нет:
   - triggerNoTarget()
4. Если есть:
   - Активируется targeting mode: SELECT_TARGET
5. Валидные цели:
   - Карты в руке владельца Lucius
   - filter: target.ownerId === ownerId
6. Клик по карте:
   - moveItem в discard
   - chainedAction: OPEN_MODAL (SEARCH_DECK, filterType: 'Command')
7. Модальное окно:
   - Выбор карты Command из колоды
   - Перемещение в руку
```

---

#### Finn MW/SD (finnMW / finnSD)

**Setup**: `SELECT_UNIT_FOR_MOVE`
```
1. Клик по карте
2. Активируется targeting mode: SELECT_UNIT_FOR_MOVE
3. Валидные цели:
   - Карты на поле
   - Владелец: ownerId Finn
4. Клик по цели:
   - Переход в SELECT_CELL
   - range: 2 (может переместиться на 1 или 2 клетки)
5. SELECT_CELL:
   - Валидные клетки:
     - distance = 1: соседняя клетка
     - distance = 2: через одну пустую клетку (L-форма или прямая)
   - moveItem на выбранную клетку
   - markAbilityUsed()
```

**Commit**: `GLOBAL_AUTO_APPLY: FINN_SCORING`
```
1. Клик по карте
2. Подсчет Revealed от Finn:
   - В руках оппонентов
   - На поле (карты оппонентов)
3. Очки = количество Revealed
4. updatePlayerScore()
5. triggerFloatingText()
6. markAbilityUsed()
```

---

<a name="targeting-restrictions-summary"></a>
## 6. Резюме ограничений targeting

### Ограничения владельца
- `targetOwnerId`: включительное ограничение (только этот владелец)
- `excludeOwnerId`: исключающее ограничение (все КРОМЕ этого)
- `onlyOpponents`: не self + не teammates
- `-1` (TARGET_OPPONENTS): синоним onlyOpponents

### Ограничения статусов
- `requiredTargetStatus`: цель ДОЛЖНА иметь этот статус
- `requireStatusFromSourceOwner`: статус ДОЛЖЕН быть от владельца источника
- `onlyFaceDown`: цель без Revealed от активного игрока

### Пространственные ограничения
- `mustBeAdjacentToSource`: ортогонально, distance = 1
- `mustBeInLineWithSource`: та же строка ИЛИ тот же столбец
- `maxDistanceFromSource`: Chebyshev distance (максимум разности координат)
- `maxOrthogonalDistance`: Manhattan distance (сумма разностей координат)

### Специальные режимы
- `handOnly`: только карты в руке, не на поле
- `allowHandTargets`: карты в руке тоже валидны
- `placeAllAtOnce`: все токены на одну цель

---

<a name="no-target-handling"></a>
## 7. Обработка отсутствия целей

### Порядок действий при отсутствии целей:

```
1. checkActionHasTargets() возвращает false
2. triggerNoTarget(sourceCoords)
   - Визуальный эффект "Нет цели" на карте
3. Если есть chainedAction:
   - setTimeout(() => handleActionExecution(chainedAction), 500)
4. markAbilityUsed() УЖЕ вызван ранее в activateAbility()
```

### Специальные случаи, которые ВСЕГДА валидны:

```
- PRINCEPS_SHIELD_THEN_AIM: Shield происходит всегда
- SHIELD_SELF_THEN_SPAWN: Shield происходит всегда
- SHIELD_SELF_THEN_RIOT_PUSH: Shield происходит всегда
- ABR_DEPLOY_SHIELD_AIM: Shield происходит всегда
- GAWAIN_DEPLOY_SHIELD_AIM: Shield происходит всегда
```

---

<a name="visual-effects"></a>
## 8. Визуальные эффекты

### Подсветка готовых способностей

Карта подсвечивается, если:
1. `card.ownerId === activePlayerId`
2. Нет Stun статуса
3. Есть ready status для текущей фазы
4. Если требуется Support - карта имеет Support

### Targeting Mode подсветка

```
- gameState.targetingMode устанавливается
- Рассылается всем игрокам
- GameBoard рисует подсветку:
  - Цвет: цвет targeting player
  - Стиль: пунктирная рамка
  - Только для targeting player: кликабельность
```

### Cursor Stack отображение

```
- Курсор показывает иконку токена
- Число: оставшееся количество
- Валидные цели: подсвечиваются
- Невалидные цели: не реагируют
```

---

<a name="webrtc-sync"></a>
## 9. WebRTC синхронизация

### Ability Mode
```
client -> setAbilityMode()
  -> WebSocket: ABILITY_MODE_SET
  -> server -> broadcast
  -> client -> gameState.abilityMode
```

### Targeting Mode
```
client -> setTargetingMode()
  -> WebSocket: SET_TARGETING_MODE
  -> server -> broadcast TARGETING_MODE_SET
  -> client -> gameState.targetingMode
```

### Cursor Stack
```
client -> setCursorStack()
  -> Локальное состояние (не синхронизируется)
  - Только активный игрок видит свой стек
```

---

<a name="debugging"></a>
## 10. Отладка

### Логирование

```typescript
console.log(`[activateAbility] ${card.name} action:`, action.mode)
console.log(`[handleActionExecution] mode:`, action.mode)
```

### Проверки

```typescript
// Валидация цели
validateTarget(target, constraints, actorId, players)

// Проверка наличия целей
checkActionHasTargets(action, gameState, playerId, commandContext)

// Подсчет валидных целей
calculateValidTargets(action, gameState, playerId, commandContext)
```

---

<a name="known-features"></a>
## 11. Известные особенности

### Stale State в цепочках действий

При chainedAction состояние React может не обновиться мгновенно:

```typescript
// Решение: внедрение _tempContextId
nextAction.payload._tempContextId = sourceCard.id

// Использование в handleActionExecution:
const searchId = action.payload._tempContextId || commandContext.lastMovedCardId
```

### Dummy игроки

- Карта принадлежит dummy игроку
- activePlayerId === dummy.id
- localPlayerId === 1 (host) может управлять

### Teammates

```typescript
const isTeammate = userPlayer?.teamId !== undefined &&
                   targetPlayer?.teamId !== undefined &&
                   userPlayer.teamId === targetPlayer.teamId
```

Ограничения `onlyOpponents` исключают teammates.

---

<a name="command-cards-system"></a>
## 12. Система командных карт

Командные карты — это особый тип карт с несколькими вариантами выбора. Каждый вариант отделён символом `●` и даёт разный эффект.

### Структура командной карты

```typescript
{
  name: "Tactical Maneuver",
  ability: "● Move one of your units to an empty cell in its line. Draw cards equal to that unit's power.\n● Move one of your units to an empty cell in its line. Gain points equal to that unit's power."
}
```

### Поток выполнения командной карты

#### 1. Розыгрыш командной карты
```
Игрок выбирает командную карту из руки
  -> playCard() сannounce = true
  -> Карта перемещается в showcase
  -> Открывается CommandModal
```

#### 2. Парсинг опций (CommandModal.tsx)
```typescript
// Разделение текста способности по ●
const options = card.ability.split('●').map(opt => opt.trim())

// Создание кнопок для каждой опции
{options.map((option, index) => (
  <button key={index} onClick={() => onConfirm(index)}>
    {index + 1}. {formatAbilityText(option)}
  </button>
))}
```

#### 3. Выбор опции
```
Игрок кликает на опцию (1, 2, 3, ...)
  -> onConfirm(selectedIndex)
  -> handleCommandOption(selectedIndex, card)
  -> Определяется actionType для выбранной опции
  -> Выполняется соответствующая логика
```

### Примеры командных карт

#### Tactical Maneuver
**Option 1**: "Move one of your units to an empty cell in its line. Draw cards equal to that unit's power."
```
1. Активируется targeting mode: SELECT_UNIT_FOR_MOVE
2. Валидные цели:
   - Карты на поле
   - Владелец: activePlayerId
3. Клик по карте:
   - Переход в SELECT_CELL
   - Валидные клетки: пустые клетки в той же строке ИЛИ столбце
4. Клик по клетке:
   - moveItem карты на выбранную клетку
   - power = карта.power
   - drawCard(activePlayerId, power) - дование power карт
```

**Option 2**: "Move one of your units to an empty cell in its line. Gain points equal to that unit's power."
```
1-3. То же самое для выбора и перемещения
4. Клик по клетке:
   - moveItem карты на выбранную клетку
   - power = карта.power
   - updatePlayerScore(activePlayerId, power)
   - triggerFloatingText(+power)
```

#### Overwatch
**Option 1**: "Place 1 Aim token on any card. Reveal 1 card from an opponent's hand for each of your Aim tokens on the battlefield."
```
1. Создается cursorStack: Aim x1 (любая карта на поле)
2. После размещения Aim:
   - Подсчёт Aim на поле с addedByPlayerId = activePlayerId
   - aimCount = количество Aim
   - Цикл aimCount раз:
     - Открывается модал выбора карты из руки оппонента
     - Добавляется статус Revealed
```

**Option 2**: "Place 1 Aim token on any card. Move any card with your Aim token 1 or 2 cells."
```
1. Создается cursorStack: Aim x1
2. После размещения Aim:
   - Переход в SELECT_UNIT_FOR_MOVE
   - Валидные цели: карты с Aim от activePlayerId
   - После выбора: SELECT_CELL (range: 1-2)
```

#### Enhanced Interrogation
**Option 1**: "Place 1 Aim token on any card. Reveal 1 card from an opponent's hand for each of your Aim tokens on the battlefield."
```
Аналогично Overwatch Option 1
```

**Option 2**: "Place 1 Aim token on any card. Move any card with your Aim token 1 or 2 cells."
```
Аналогично Overwatch Option 2
```

#### Data Interception
**Option 1**: "Place 1 Exploit token on any card. Reveal 1 card from an opponent's hand for each of your Exploit tokens on the battlefield."
```
Аналогично Overwatch Option 1, но с Exploit вместо Aim
```

**Option 2**: "Place 1 Exploit token on any card. Move a unit with your Exploit token 1 or 2 cells."
```
Аналогично Overwatch Option 2, но с Exploit вместо Aim
```

#### Inspiration
**Option 1**: "Place 1 Shield token on one of your units. Draw 1 card."
```
1. Создается cursorStack: Shield x1
2. Ограничения: targetOwnerId = activePlayerId
3. После размещения:
   - drawCard(activePlayerId, 1)
```

**Option 2**: "Place 1 Shield token on one of your units. Gain 2 points."
```
1-2. То же самое
3. После размещения:
   - updatePlayerScore(activePlayerId, 2)
   - triggerFloatingText(+2)
```

#### Emergency Extraction
**Option 1**: "Return one of your units to your hand. Draw 1 card."
```
1. Активируется targeting mode: SELECT_TARGET
2. Валидные цели:
   - Карты на поле
   - Владелец: activePlayerId
   - Тип: 'Unit'
3. Клик по карте:
   - returnCardToHand()
   - drawCard(activePlayerId, 1)
```

**Option 2**: "Return one of your units to your hand. Gain 3 points."
```
1-2. То же самое
3. Клик по карте:
   - returnCardToHand()
   - updatePlayerScore(activePlayerId, 3)
```

### Обработка командных карт в коде

**client/utils/commandLogic.ts**:
```typescript
export const getCommandAction = (cardId: string): AbilityAction[] => {
  // Возвращает массив действий для каждой опции командной карты
  // Используется для определения валидных целей
}
```

**client/components/CommandModal.tsx**:
```typescript
interface CommandModalProps {
  isOpen: boolean
  card: Card | null
  onConfirm: (optionIndex: number) => void
  onCancel: () => void
}
```

**client/hooks/useAppCommand.ts**:
```typescript
const handleCommandOption = (optionIndex: number, card: Card) => {
  // Определяет действие на основе выбранной опции
  // Выполняет соответствующую логику
}
```

### Особенности командных карт

1. **Множественные эффекты**: Одна карта может дать совершенно разные эффекты
2. **Стратегический выбор**: Игрок выбирает опцию на основе текущей ситуации
3. **Синергия с токенами**: Многие опции усиливаются при наличии определённых токенов на поле
4. **Комбо-потенциал**: Опции могут создавать цепочки действий (move → draw → score)

### Полный список командных карт

| Карта | ID | Опции | Описание |
|-------|----|-------|----------|
| **Overwatch** | `overwatch` | 2 | Aim → Reveal per Aim / Move unit with Aim |
| **Tactical Maneuver** | `tacticalmaneuver` | 2 | Move → Draw = Power / Move → Score = Power |
| **Inspiration** | `inspiration` | 2 | Remove counters → Draw per removed / Score per removed |
| **Data Interception** | `datainterception` | 2 | Exploit → Reveal per Exploit / Move unit with Exploit |
| **False Orders** | `falseorders` | 2 | Exploit opponent → Move + Reveal x2 / Move + Stun x2 |
| **Experimental Stimulants** | `experimentalstimulants` | 2 | Reactivate Deploy / Move unit in line |
| **Logistics Chain** | `logisticschain` | 2 | Score diagonal + points per Support / Score + draw per Support |
| **Quick Response Team** | `quickresponseteam` | 2 | Deploy from hand / Search deck for Unit |
| **Temporary Shelter** | `temporaryshelter` | 2 | Shield → Remove all Aim / Shield → Move range 2 |
| **Enhanced Interrogation** | `enhancedinterrogation` | 2 | Aim → Reveal per Aim / Move unit with Aim |
| **Line Breach** | `linebreach` | 1 | Gain points in a line |

### Детальное описание командных карт

#### Overwatch
```
Common: Place 1 Aim token on any card

Option 0: Reveal X cards from opponent's hand (X = total Aim on battlefield)
  - dynamicCount: { factor: 'Aim', ownerId: localPlayerId }
  - targetOwnerId: -1 (opponents only)
  - onlyFaceDown: true
  - Создаётся стек Revealed токенов

Option 1: Draw X cards (X = total Aim on battlefield)
  - GLOBAL_AUTO_APPLY
  - dynamicResource: { type: 'draw', factor: 'Aim', ownerId: localPlayerId }
```

#### Tactical Maneuver
```
Option 0: Move your unit to empty cell in its line. Draw cards equal to power.
  - ENTER_MODE: SELECT_UNIT_FOR_MOVE
  - range: 'line'
  - filter: target.ownerId === localPlayerId
  - chainedAction: GLOBAL_AUTO_APPLY with contextReward: 'DRAW_MOVED_POWER'

Option 1: Move your unit to empty cell in its line. Gain points equal to power.
  - То же самое, но contextReward: 'SCORE_MOVED_POWER'
```

#### Inspiration
```
Common: Select your unit → Open Counter Modal
  - ENTER_MODE: SELECT_TARGET
  - actionType: 'OPEN_COUNTER_MODAL'
  - filter: target.ownerId === localPlayerId

Option 0: Remove counters → Draw 1 per removed
Option 1: Remove counters → Score 1 per removed
```

#### Data Interception
```
Common: Place 1 Exploit token on any card

Option 0: Place X Revealed tokens (X = total Exploit on battlefield)
  - dynamicCount: { factor: 'Exploit', ownerId: localPlayerId }
  - onlyOpponents: true
  - onlyFaceDown: true

Option 1: Move a unit with your Exploit token 1-2 cells
  - ENTER_MODE: SELECT_UNIT_FOR_MOVE
  - range: 2
  - filter: card has Exploit from localPlayerId
```

#### False Orders
```
Common: Place 1 Exploit on opponent's Unit (record context)

Option 0: Move the unit (range 2) → Place 2 Revealed tokens
  - ENTER_MODE: SELECT_CELL
  - range: 2
  - useContextCard: true (uses commandContext.lastMovedCardCoords)
  - chainedAction: CREATE_STACK (Revealed x2, opponents only, face-down only)

Option 1: Move the unit (range 2) → Place 2 Stun tokens
  - ENTER_MODE: SELECT_CELL
  - range: 2
  - useContextCard: true
  - chainedAction: GLOBAL_AUTO_APPLY (Stun x2, ownerId = localPlayerId)
```

#### Experimental Stimulants
```
Option 0: Reactivate Deploy ability of your unit
  - ENTER_MODE: SELECT_TARGET
  - actionType: 'RESET_DEPLOY'
  - filter: target.ownerId === localPlayerId && target.types.includes('Unit')

Option 1: Move your unit to empty cell in its line
  - ENTER_MODE: SELECT_UNIT_FOR_MOVE
  - range: 'line'
  - filter: target.ownerId === localPlayerId
```

#### Logistics Chain
```
Option 0: Score diagonal + 1 point per Support
  - ENTER_MODE: SELECT_DIAGONAL
  - actionType: 'SCORE_DIAGONAL'
  - bonusType: 'point_per_support'
  - skipNextPhase: true

Option 1: Score diagonal + Draw 1 per Support
  - bonusType: 'draw_per_support'
```

#### Quick Response Team
```
Option 0: Deploy unit from hand
  - ENTER_MODE: SELECT_TARGET
  - actionType: 'SELECT_HAND_FOR_DEPLOY'
  - filter: target.ownerId === localPlayerId && target.types.includes('Unit')

Option 1: Search deck for Unit → Hand
  - OPEN_MODAL: SEARCH_DECK
  - filterType: 'Unit'
```

#### Temporary Shelter
```
Option 0: Place 1 Shield on your unit → Remove all Aim from that unit
  - CREATE_STACK: Shield x1
  - targetOwnerId: localPlayerId
  - recordContext: true
  - chainedAction: GLOBAL_AUTO_APPLY with customAction: 'REMOVE_ALL_AIM_FROM_CONTEXT'

Option 1: Place 1 Shield on your unit → Move it 1-2 cells
  - CREATE_STACK: Shield x1
  - recordContext: true
  - chainedAction: ENTER_MODE: SELECT_CELL (range: 2, useContextCard: true)
```

#### Enhanced Interrogation
```
Common: Place 1 Aim token on any card

Option 0: Place X Revealed tokens (X = total Aim on battlefield)
  - Аналогично Data Interception Option 0

Option 1: Move a card with your Aim token 1-2 cells
  - ENTER_MODE: SELECT_UNIT_FOR_MOVE
  - range: 2
  - filter: card has Aim from localPlayerId
```

#### Line Breach (Mobilization 1)
```
Common: Select line start → Gain points for completed line
  - ENTER_MODE: SELECT_LINE_START
  - actionType: 'SCORE_LINE'
```

### Специальные параметры командных карт

#### dynamicCount
```typescript
dynamicCount: {
  factor: 'Aim' | 'Exploit',    // Тип токена для подсчёта
  ownerId: number               // Владелец токенов
}
```
Используется для создания стека с количеством токенов, равным количеству указанных токенов на поле.

#### dynamicResource
```typescript
dynamicResource: {
  type: 'draw',                 // Тип ресурса
  factor: 'Aim' | 'Exploit',    // Фактор для подсчёта
  ownerId: number,              // Владелец
  baseCount: number             // Базовое количество
}
```
Используется для дования карт или начисления очков на основе токенов на поле.

#### contextReward
```typescript
contextReward: 'DRAW_MOVED_POWER' | 'SCORE_MOVED_POWER'
```
Используется для награды после перемещения карты (записанной в commandContext).

#### useContextCard
```typescript
useContextCard: true
```
Указывает, что для действия следует использовать карту из commandContext.lastMovedCardCoords вместо sourceCoords.

#### originalOwnerId
```typescript
originalOwnerId: number
```
Сохраняет владельца командной карты для правильного определения цвета подсветки и принадлежности эффектов в многошаговых командах.

---

<a name="action-types-list"></a>
## 13. Полный список типов действий (AbilityAction Types)

| Тип | Описание | Примеры карт |
|-----|----------|--------------|
| `CREATE_STACK` | Создаёт стек токенов для размещения | IP Dept Agent, Tactical Agent |
| `ENTER_MODE` | Активирует специальный режим | Riot Agent, Patrol Agent |
| `OPEN_MODAL` | Открывает модальное окно выбора | Mr. Pearl, Falk PD |
| `GLOBAL_AUTO_APPLY` | Немедленное применение эффекта | Code Keeper, Signal Prophet |
| `ABILITY_COMPLETE` | Завершение способности | Конец цепочки действий |
| `SELECT_TARGET` | Выбор цели с последующим действием | Centurion, Devout Synthetic |
| `SELECT_CELL` | Выбор клетки для перемещения | Recon Drone, Finn |
| `SELECT_UNIT_FOR_MOVE` | Выбор юнита для перемещения | Code Keeper, Signal Prophet |
| `SPAWN_TOKEN` | Создаёт токен на поле | Inventive Maker |
| `SWAP_POSITIONS` | Меняет местами две карты | Reckless Provocateur |
| `TRANSFER_ALL_STATUSES` | Переносит все статусы | Reckless Provocateur |
| `SELECT_DECK` | Выбор колоды для просмотра | Secret Informant |
| `SACRIFICE_AND_BUFF_LINES` | Жертва + бафф линий | Centurion |
| `MODIFY_POWER` | Изменяет power карты | Walking Turret, Cautious Avenger |
| `DESTROY` | Уничтожает карту | Tactical Agent, Princeps |
| `REVEAL_ENEMY` | Открывает карту врага | Recon Drone |
| `PATROL_MOVE` | Перемещение в линии | Patrol Agent |
| `RIOT_PUSH` | Толкает врага | Riot Agent |
| `IP_AGENT_THREAT_SCORING` | Подсчёт Threat для очков | IP Dept Agent |
| `INTEGRATOR_LINE_SELECT` | Подсчёт Exploit в линии | Unwavering Integrator |
| `ZIUS_LINE_SELECT` | Подсчёт Exploit от цели | Zius IJ |
| `FINN_SCORING` | Подсчёт Revealed для очков | Finn |
| `REVEREND_SETUP_SCORE` | Подсчёт Exploit для очков | Reverend |
| `REVEREND_DOUBLE_EXPLOIT` | Удвоение Exploit | Reverend |
| `LUCIUS_SETUP` | Дiscard + поиск Command | Lucius |
| `ZEALOUS_WEAKEN` | Ослабление цели | Zealous Missionary |
| `SELECT_HAND_FOR_DISCARD_THEN_SPAWN` | Дiscard + spawn токена | Faber |
| `IMMUNIS_RETRIEVE` | Воскрешение из discard | Immunis |
| `REVEAL_ENEMY_CHAINED` | Reveal с последующим действием | Recon Drone |
| `SHIELD_SELF_THEN_AIM` | Shield + Aim stack | Princeps, Gawain |
| `SHIELD_SELF_THEN_SPAWN` | Shield + spawn токена | Edith Byron |
| `SHIELD_SELF_THEN_RIOT_PUSH` | Shield + riot push | Reclaimed Gawain |
| `GAWAIN_DEPLOY_SHIELD_AIM` | Shield + Aim (Gawain) | Gawain |
| `ABR_DEPLOY_SHIELD_AIM` | Shield + Aim (ABR) | ABR Gawain |
| `SEARCH_DECK` | Поиск карты в колоде | Mr. Pearl, Falk PD |
| `RETRIEVE_FROM_DECK` | Извлечение из колоды | Mr. Pearl |
| `RECOVER` | Восстановление из discard | Inventive Maker |
| `RESURRECT` | Воскрешение на поле | Immunis |

---

<a name="ability-rules"></a>
## 14. Важные правила способностей

### Правило приоритета Deploy
```
Если у карты есть Deploy способность и другая способность (Setup/Commit):
- Deploy ВСЕГДА показывается первой
- После использования Deploy становится доступной другая способность
- Это работает даже если Deploy был использован ранее и карта вернулась на поле
```

### Правило Support Required
```
Некоторые способности требуют статус Support на карте:
- Проверка происходит в canActivateAbility()
- Если Support отсутствует → способность неактивна
- Support может быть добавлен другими картами
```

### Правило ready статусов
```
- readyDeploy: добавляется при входе на поле, удаляется после использования
- readySetup: добавляется при входе, сбрасывается каждый ход в Preparation
- readyCommit: добавляется при входе, сбрасывается каждый ход в Preparation
```

### Правило Stun
```
- Карта со статусом Stun НЕ может активировать способности
- Проверка в canActivateAbility()
- Stun можно снять определёнными эффектами
```

### Правило одной способности за клик
```
Каждый клик по карте:
1. Проверяется какая способность доступна
2. Активируется только ОДНА способность
3. После использования ready статус удаляется
4. Следующий клик активирует следующую способность (если есть)
```

### Правило отсутствия целей
```
Если у способности нет валидных целей:
1. triggerNoTarget() показывает визуальный эффект
2. Способность помечается использованной
3. Если есть chainedAction → выполняется следующая действие
```

### Правило цепочечных действий (chainedAction)
```
После завершения основного действия:
1. Проверяется наличие chainedAction
2. setTimeout(() => handleActionExecution(chainedAction), 500)
3. Новое действие выполняется как отдельная способность
4. Используется для многошаговых способностей
```

### Правило targeting токенов на руки
```
Targeting токены (Aim, Exploit, Stun, Shield) НЕ могут быть размещены на картах в руке.
Это реализовано в handCardHandlers.ts - клики игнорируются.
```

### Правило отмены режимов
```
Правая кнопка мыши (ПКМ) отменяет:
- abilityMode (активная способность)
- cursorStack (стек токенов)
- playMode (размещение карты)
- targetingMode (для всех игроков)
```
