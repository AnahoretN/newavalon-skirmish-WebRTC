/**
 * @file Renders a comprehensive Rules & Tutorial modal acting as an interactive encyclopedia.
 */
import React, { useState, useMemo } from 'react'
import { Card } from './Card'
import { CardTooltipContent } from './Tooltip'
import { DeckType } from '@/types'
import type { Card as CardType, PlayerColor } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { STATUS_ICONS } from '@/constants'

interface RulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_RULES = {
  title: 'Game Rules: "New Avalon: Skirmish"',
  conceptTitle: 'I. General Concept',
  conceptText: '**Genre & Role:** New Avalon: Skirmish is a fast-paced tactical duel card game played on a restricted grid battlefield. Players act as faction leaders, deploying Units and Commands to seize control of key lines.\n\n**Explanation:** The game focuses on positional control and the timing of ability activation rather than just direct attacks. Victory is achieved by accumulating Victory Points (VP) based on the power of your units in selected lines.',
  winConditionTitle: 'II. Victory Conditions',
  winConditionText: '**Match Victory:** A match is played until a player wins 2 rounds. The first player to reach 2 round wins immediately wins the match.\n**Match Draw:** If multiple players reach 2 round wins simultaneously after any round, they are all declared match winners.\n\n**Round Victory (Thresholds & Limits):** A round ends as soon as one or more players reach the Victory Point (VP) threshold, or after the 5th turn is completed.\n**Turn Limit:** Each round is limited to 5 full turns per player. If the VP threshold is not met, a final scoring occurs at the end of Turn 5 to determine the winner.\n\n**Thresholds:**\n- Round 1: 20 Victory Points (VP).\n- Round 2: 30 Victory Points (VP).\n- Round 3+: Threshold increases by +10 VP from the previous round (e.g., Round 3 is 40 VP).\n\n**Determining Round Winner:** The winner is the player who hits the threshold first, or the player with the highest VP after the turn limit.\n**Round Draw:** If two or more players have the same highest score at the end of a round, they all are declared winners of that round.',
  fieldTitle: 'III. Game Board & Components',
  fieldText: '**Battlefield (Grid):** The game takes place on a square grid, the size of which depends on the total number of participating players.\n**Sizes:**\n- 2 Players: 5x5 grid.\n- 3 Players: 6x6 grid.\n- 4 Players: 7x7 grid.\n\n**Positioning Definitions:**\n- **Line:** Refers to an entire horizontal Row or vertical Column. Used for the Scoring mechanic.\n- **Adjacency:** Cells are considered adjacent only horizontally and vertically (orthogonally). Diagonal adjacency does not count unless specified otherwise on a card.\n\n**Cards:** Two main types of cards are played from Hand:\n- **Units:** The main combat entities, possessing Power and Abilities. They remain on the battlefield until destroyed.\n- **Commands:** Instant-effect cards. They are played, execute their effect (often offering a "Choose 1 of 2 options" choice), and are then sent to the Discard pile.\n\n**Game Zones:**\n- **Hand:** Cards hidden from opponents.\n- **Discard:** The zone where destroyed Units and played Commands go.\n- **Showcase/Announced:** A temporary zone where a Command card is placed before it resolves.',
  setupTitle: 'IV. Game Start (Setup)',
  setupText: '**Deck Construction:** Before the match begins, each player selects a faction or builds a deck according to construction rules (minimum 30 cards).\n**Explanation:** Decks are shuffled.\n\n**Starting Hand:** Each player draws 6 cards from their deck to form their starting hand.\n**Hidden Information:** Cards in hand are hidden from opponents.\n\n**Mulligan:** Once at the start of the game, after drawing the starting hand, a player may shuffle any number of cards from their hand back into the deck and draw the same number of new cards.\n\n**First Player Determination:** Determine the first active player by any convenient method (e.g., coin toss).\n**Explanation:** Play proceeds in turn order, starting with the first player. The first player begins their first turn directly in the Setup Phase.',
  abilitiesTitle: 'V. Card Abilities',
  abilitiesText: '**Ability Types:**\n- **Deploy:** Triggers automatically and immediately when the card is played from hand onto the battlefield face-up.\n- **Setup:** Triggers automatically at the start of the Setup Phase of each of your turns (before drawing a card), if the card is already face-up on the battlefield.\n- **Commit:** Triggers automatically at the start of the Commit Phase of each of your turns, if the card is already face-up on the battlefield.\n- **Pas (Passive):** The effect is constantly active as long as the card is on the battlefield and face-up.\n\n**Conditions (⇒):**\nMany abilities have a requirement denoted by an arrow (e.g., **Support ⇒ Deploy:** ...).\n- This means "CONDITION ⇒ EFFECT".\n- If the condition to the left of the arrow (e.g., having Support status) is not met at the moment of activation, the ability **does not trigger** at all.\n\n**Important Rules:**\n- **Stun:** Stunned cards (with a Stun token) **do not activate** their abilities (neither Deploy, nor Phased, nor Passive).\n- **Face-down:** Cards played face-down have no abilities.\n- **Mandatory:** If an ability triggers (conditions met), you **must** apply its effect if there are legal targets. If there are no legal targets, the ability fizzles.',
  statusesTitle: 'VI. Dynamic Statuses (Positioning)',
  statusesText: 'Dynamic statuses are calculated automatically and constantly updated with any change on the board. Units with the Stun status cannot provide or participate in the calculation of these statuses.\n\n**Support:** A unit has the Support status if there is an allied unit in at least one adjacent cell (horizontal or vertical).\n**Stun/Support:** A unit with a Stun token is ignored when calculating Support for adjacent allies.\n**Significance:** Having Support is a condition for activating many powerful abilities, denoted by the syntax **Support ⇒ [Effect]**.\n\n**Threat:** A unit receives the Threat status if it is in a dangerous position created by enemy units.\n**Conditions:** Threat status is assigned in one of two cases:\n1. **Pinned:** The unit is sandwiched between cards of a single opponent on any two sides (two adjacent or two opposite sides).\n2. **Cornered:** The unit is on the edge of the battlefield and has at least one opponent card adjacent to it.\n**Stun/Threat:** A unit with a Stun token is ignored when calculating Threat for adjacent enemies.\n**Significance:** Units under Threat are vulnerable targets for powerful control and destruction abilities.',
  countersTitle: 'VII. Counters',
  countersText: 'Counters are persistent markers placed by card abilities. They remain on a unit until removed or the unit is destroyed.\n\n**Stun (O):**\n- **Effect:** A Stunned unit generates 0 VP during the Scoring Phase, cannot activate its abilities, and cannot be moved by its owner (but can be moved by opponents).\n- **Removal:** At the end of the Commit Phase, 1 Stun token is automatically removed from every unit owned by the active player.\n\n**Shield (S):**\n- **Effect:** If an ability attempts to Destroy this unit, the destruction effect is prevented, and 1 Shield token is removed instead. The unit remains on the field.\n\n**Revealed & Face-down:**\n- **Revealed:** Allows the player who owns the Revealed token to see the hidden information (face) of the card.\n- **Face-down Explanation:** A card played face-down has 0 Power and no Abilities. If such a card receives a Revealed token, its info becomes visible to the opponent, but it is still mechanically considered Face-down (0 Power, no abilities).\n\n**Special Tokens (Aim, Exploit):**\n- **Aim (A) & Exploit (E):** These tokens act as markers for faction interactions (e.g., Snipers or Hackers). By themselves, they have no inherent game effect.\n\n**Last Played:**\n- **Effect:** A temporary status automatically assigned to the last card played onto the battlefield by the active player this turn. This status determines the line the player must choose for Scoring.',
  turnTitle: 'VIII. Turn Structure & Timing',
  turnText: 'The turn passes from player to player. Card abilities only trigger during their owner\'s turn. The active player\'s turn consists of four sequential phases:\n\n**1. Setup Phase:**\n- **Draw Card:** The active player draws 1 card from their deck.\n- **Abilities:** Abilities of all cards on the board with the keyword **Setup:** trigger.\n**Explanation:** This phase is for replenishing the hand and initial unit positioning.\n\n**2. Main Phase (Action / Deploy):**\n- **Main Action:** The active player may perform one of the following:\n  - Play a Unit card (**Deploy:**) from hand to any empty cell. Its **Deploy:** ability triggers immediately.\n  - Play a Command card from hand.\n  - Pass.\n**Command Explanation:** Command cards can be played in any quantity during this phase — before, after, or between unit deployments.\n\n**3. Commit Phase:**\n- **Abilities:** Abilities of all cards on the board with the keyword **Commit:** trigger.\n- **Remove Stun:** At the end of this phase, 1 Stun token is automatically removed from every unit owned by the active player.\n**Explanation:** This phase is used for applying control effects and gaining resources before scoring.\n\n**4. Scoring Phase:**\n- **Line Selection:** The active player must choose one Line (Row or Column) that passes through their card with the **Last Played** status.\n- **Counting:** The Power of all units owned by the active player in the chosen line is summed up, and the total is added to the player\'s score.',
  mechanicsTitle: 'IX. Conflict Resolution & Key Mechanics',
  mechanicsText: '**Stun & Scoring:**\n- **Effect:** A unit with Stun status or one that is Face-down contributes 0 points during the Scoring Phase, regardless of its base Power, permanent modifiers, or passive abilities that generate points (e.g., Spotter).\n\n**Last Played Transfer:**\n- **Destruction:** If the card with Last Played status leaves the battlefield (destroyed, returned to hand/deck) before the Scoring Phase, the status is transferred to the *previous* card played by that player (the one that was Last Played in the previous turn/action).\n- **Movement:** If the card with Last Played moves to another cell, the player chooses lines based on its new position during Scoring.\n- **Absence:** If a player has no cards on the board with Last Played status, they cannot choose a line and gain no points this turn.\n\n**Unit Movement (Push, Swap):**\n- **Push:** A unit forces another card to move to an adjacent cell. The push is blocked (does not happen) if the destination is an occupied cell or the edge of the board. Other effects of the ability still apply to the target.\n- **Swap:** Allows two cards to trade places, even if both cells are occupied.\n\n**Resurrect:**\n- **Burnout Mechanic:** A card returned to the battlefield from the Discard pile (resurrected) immediately gains the **Resurrected** status upon Deploy. At the start of the next phase (phase change), this status is removed, and the card receives two Stun tokens.',
  creditsTitle: 'X. Credits',
  creditsText: '**Author:** Nikita Anahoret\n\n**Powered By:**\n- Google AI Studio\n- Gemini\n- ChatGPT\n\n**Special Thanks:**\n- Vasilisa Versus\n- Kirill Tomashchuk\n- Andrey Markosov\n- Mitya Shepelin\n\nFor questions and suggestions, please contact via Telegram or Discord.\nSupport game development and authors via DonationAlerts and Patreon.',
}

// --- Constants for Demo ---
const GAWAIN_IMG = 'https://res.cloudinary.com/dxxh6meej/image/upload/v1764622845/Reclaimed_Gawain_sg6257.png'
const GAWAIN_FALLBACK = '/images/cards/NEU_RECLAIMED_GAWAIN.png'

const DEMO_CARDS: Record<string, CardType> = {
  gawain: {
    id: 'demo_gawain',
    name: 'Reclaimed "Gawain"',
    deck: DeckType.Neutral,
    power: 5,
    imageUrl: GAWAIN_IMG,
    fallbackImage: GAWAIN_FALLBACK,
    ability: 'Deploy: Shield 1. Push an adjacent card 1 cell. May take its place.\nSetup: Destroy an adjacent card with threat or stun.',
    types: ['Unit', 'Device', 'Rarity'],
    faction: 'Neutral',
    ownerId: 1,
  },
  riot: {
    id: 'demo_riot',
    name: 'Riot Agent',
    deck: DeckType.SynchroTech,
    power: 3,
    imageUrl: 'https://res.cloudinary.com/dxxh6meej/image/upload/v1763253337/SYN_RIOT_AGENT_jurf4t.png',
    fallbackImage: '/images/cards/SYN_RIOT_AGENT.png',
    ability: 'Deploy: Push.',
    types: ['Unit', 'SynchroTech'],
    faction: 'SynchroTech',
    ownerId: 1,
  },
  princeps: {
    id: 'demo_princeps',
    name: 'Princeps',
    deck: DeckType.Optimates,
    power: 3,
    imageUrl: 'https://res.cloudinary.com/dxxh6meej/image/upload/v1763253332/OPT_PRINCEPS_w3o5lq.png',
    fallbackImage: '/images/cards/OPT_PRINCEPS.png',
    ability: '',
    types: ['Unit', 'Optimates'],
    faction: 'Optimates',
    ownerId: 2,
  },
}

const DUMMY_COLOR_MAP = new Map<number, PlayerColor>([
  [1, 'blue'],
  [2, 'red'],
])

// --- Text Formatter ---
const formatRuleText = (text: string) => {
  // Split by markdown patterns: **bold** and [link](url)
  // Use [\s\S]+? to match across newlines for links
  const parts = text.split(/(\[[^\]]+\]\([^\)]+\)|\*\*[^\*]+\*\*)/g)

  return parts.map((part, i) => {
    // Handle [text](url) links
    const linkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      const linkText = linkMatch[1]
      const linkUrl = linkMatch[2]
      return (
        <a key={i} href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 underline font-medium">
          {linkText}
        </a>
      )
    }

    // Handle **bold** text
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-indigo-300">{part.slice(2, -2)}</strong>
    }

    return part
  })
}

// --- Visual Sub-Components ---

const VisualWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="w-full h-full bg-board-bg/50 rounded-xl shadow-inner border-2 border-gray-600/50 flex items-center justify-center overflow-hidden relative p-4">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-transparent to-transparent pointer-events-none"></div>
    {children}
  </div>
)

// I. General Concept Visual
const AnatomyVisual = () => {
  return (
    <VisualWrapper>
      <div className="flex gap-16 items-center justify-center relative pl-4 scale-90 md:scale-100">
        {/* The Card */}
        <div className="relative w-48 h-48 flex-shrink-0">
          <Card
            card={DEMO_CARDS.gawain}
            isFaceUp={true}
            playerColorMap={DUMMY_COLOR_MAP}
            localPlayerId={1}
            disableTooltip
          />

          {/* Power Label Pointer */}
          <div className="absolute -bottom-2 -right-2 w-full h-full pointer-events-none">
            <div className="absolute bottom-[-45px] right-[5px] flex flex-col items-center">
              <div className="w-px h-8 bg-white mb-1"></div>
              <div className="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg border border-white whitespace-nowrap">
                                 Power
              </div>
            </div>
          </div>
        </div>

        {/* The Tooltip (Static Render) */}
        <div className="relative w-80 flex-shrink-0">
          <div className="bg-gray-900 border border-gray-700 rounded-md shadow-2xl p-3 text-white relative">
            <CardTooltipContent card={DEMO_CARDS.gawain} />

            {/* Name Label */}
            <div className="absolute top-4 -left-[90px] flex items-center">
              <div className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg border border-white">
                                 Name
              </div>
              <div className="w-[60px] h-px bg-white ml-2"></div>
              <div className="w-1.5 h-1.5 bg-white rounded-full -ml-1"></div>
            </div>

            {/* Types Label */}
            <div className="absolute top-10 -left-[90px] flex items-center">
              <div className="bg-purple-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg border border-white">
                                 Types
              </div>
              <div className="w-[60px] h-px bg-white ml-2"></div>
              <div className="w-1.5 h-1.5 bg-white rounded-full -ml-1"></div>
            </div>

            {/* Ability Label */}
            <div className="absolute bottom-12 -left-[90px] flex items-center">
              <div className="bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg border border-white">
                                 Abilities
              </div>
              <div className="w-[60px] h-px bg-white ml-2"></div>
              <div className="w-1.5 h-1.5 bg-white rounded-full -ml-1"></div>
            </div>
          </div>
        </div>
      </div>
    </VisualWrapper>
  )
}

// Internal Helper for Labels
const StatusLabel = ({ text, subtext, color, top, left, subtextAbove = false }: { text: string, subtext?: React.ReactNode, color: 'green' | 'red', top: string, left: string, subtextAbove?: boolean }) => {
  const borderColor = color === 'green' ? 'border-green-500/50' : 'border-red-500/50'
  const textColor = color === 'green' ? 'text-green-400' : 'text-red-400'

  return (
    <div className={`absolute ${top} ${left} text-center w-28 pointer-events-none z-20 flex flex-col items-center`}>
      {subtext && subtextAbove && <div className="text-gray-400 text-[9px] font-semibold mb-0.5 leading-tight whitespace-nowrap">{subtext}</div>}
      <div className={`${textColor} font-bold text-[10px] uppercase tracking-wider bg-gray-900/90 px-2 py-1 rounded shadow-sm border ${borderColor}`}>
        {text}
      </div>
      {subtext && !subtextAbove && <div className="text-gray-400 text-[9px] font-semibold mt-0.5 leading-tight">{subtext}</div>}
    </div>
  )
}

// V. Dynamic Statuses Visual (4x4 Grid)
const StatusMechanicsVisual = () => {
  // 4 cols x 4 rows grid
  const gridCells = Array(16).fill(null)

  // Scenario 1: Support (Row 1, Cols 0-1) - Two Blue cards
  const supportCard1 = { ...DEMO_CARDS.riot, id: 's1', statuses: [{ type: 'Support', addedByPlayerId: 1 }] }
  const supportCard2 = { ...DEMO_CARDS.riot, id: 's2', statuses: [{ type: 'Support', addedByPlayerId: 1 }] }

  // Scenario 2: Threat (Row 2, Cols 1-3) - Red, Blue, Red
  // Left Red: Pinned by Top Blue (Support2) and Right Blue (Victim)
  const enemy1 = { ...DEMO_CARDS.princeps, id: 'e1', statuses: [{ type: 'Threat', addedByPlayerId: 1 }] }
  // Middle Blue: Pinned by Left Red and Right Red
  const victim = { ...DEMO_CARDS.riot, id: 'v1', statuses: [{ type: 'Threat', addedByPlayerId: 2 }] }
  // Right Red: Cornered by Left Blue (Victim) and Edge
  const enemy2 = { ...DEMO_CARDS.princeps, id: 'e2', statuses: [{ type: 'Threat', addedByPlayerId: 1 }] }

  return (
    <VisualWrapper>
      <div className="relative scale-[0.8] md:scale-100 origin-center">
        {/* 4x4 Grid - Dimensions optimized for w-28 cards + gaps */}
        <div className="grid grid-cols-4 grid-rows-4 gap-1 w-[460px] h-[452px]">
          {gridCells.map((_, i) => {
            const r = Math.floor(i / 4)
            const c = i % 4
            let cardToRender: CardType | null = null

            // Support Placement (Row 1)
            if (r === 1 && c === 0) {
              cardToRender = supportCard1
            }
            if (r === 1 && c === 1) {
              cardToRender = supportCard2
            }

            // Threat Placement (Row 2)
            if (r === 2 && c === 1) {
              cardToRender = enemy1
            } // Red
            if (r === 2 && c === 2) {
              cardToRender = victim
            } // Blue
            if (r === 2 && c === 3) {
              cardToRender = enemy2
            } // Red

            return (
              <div key={i} className="relative w-full h-full bg-board-cell/30 rounded border border-white/5 flex items-center justify-center">
                {cardToRender && (
                  <div className="w-28 h-28 p-0">
                    <Card
                      card={cardToRender}
                      isFaceUp={true}
                      playerColorMap={DUMMY_COLOR_MAP}
                      localPlayerId={1}
                      disableTooltip
                      smallStatusIcons
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* LABELS */}

        {/* Support Labels - Above Row 1 Cards */}

        {/* Above Left Blue Card (Row 1, Col 0) */}
        <StatusLabel
          text="Support"
          subtext="Adjacent Ally"
          color="green"
          top="top-[68px]"
          left="left-[0px]"
          subtextAbove={true}
        />

        {/* Above Right Blue Card (Row 1, Col 1) */}
        <StatusLabel
          text="Support"
          subtext="Adjacent Ally"
          color="green"
          top="top-[68px]"
          left="left-[116px]"
          subtextAbove={true}
        />

        {/* Threat Labels - Under Row 2 Cards */}

        {/* Under Left Red (Row 2, Col 1) */}
        <StatusLabel
          text="Threat"
          subtext="Pinned"
          color="red"
          top="top-[345px]"
          left="left-[116px]"
        />

        {/* Under Middle Blue (Row 2, Col 2) */}
        <StatusLabel
          text="Threat"
          subtext="Pinned"
          color="red"
          top="top-[345px]"
          left="left-[232px]"
        />

        {/* Under Right Red (Row 2, Col 3) */}
        <StatusLabel
          text="Threat"
          subtext={<>Cornered<br/>(Enemy + Edge)</>}
          color="red"
          top="top-[345px]"
          left="left-[348px]"
        />
      </div>
    </VisualWrapper>
  )
}

const GridLinesVisual = () => {
  return (
    <VisualWrapper>
      <div className="grid grid-cols-4 gap-1 w-64 aspect-square relative scale-[1.3] origin-center">
        {/* Background Cells */}
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="bg-board-cell/40 rounded border border-white/5"></div>
        ))}

        {/* Highlight Row */}
        <div className="absolute top-[25%] left-0 right-0 h-[25%] bg-yellow-500/30 border-y-2 border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.4)] pointer-events-none flex items-center justify-end px-2 z-10">
          <span className="text-[8px] font-black text-yellow-200 uppercase tracking-wider drop-shadow-md">Row</span>
        </div>

        {/* Highlight Col */}
        <div className="absolute top-0 bottom-0 left-[50%] w-[25%] bg-indigo-500/30 border-x-2 border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.4)] pointer-events-none flex items-end justify-center py-2 z-10">
          <span className="text-[8px] font-black text-indigo-200 uppercase tracking-wider whitespace-nowrap drop-shadow-md mb-1">Column</span>
        </div>
      </div>
    </VisualWrapper>
  )
}

// IV. Setup Visual (Hand - Matches Game Session Appearance)
const HandVisual = ({ demoImageRefreshVersion }: { demoImageRefreshVersion: number }) => {
  const handCards = [DEMO_CARDS.gawain, DEMO_CARDS.riot, DEMO_CARDS.gawain]
  return (
    <VisualWrapper>
      <div className="flex flex-col items-center gap-6 w-full">
        {/* Hand Container resembling PlayerPanel */}
        <div className="bg-gray-800 rounded-lg p-3 shadow-xl border border-gray-700 w-auto">
          <div className="text-[10px] text-gray-400 mb-2 font-bold uppercase tracking-wider pl-1">Hand (6 Cards)</div>
          <div className="flex gap-2 justify-center bg-gray-900/50 rounded p-2">
            {handCards.map((card, i) => (
              <div key={i} className="w-28 h-28 flex-shrink-0 relative shadow-lg">
                <Card
                  card={{ ...card, id: `hand_demo_${i}` }}
                  isFaceUp={true}
                  playerColorMap={DUMMY_COLOR_MAP}
                  localPlayerId={1}
                  disableTooltip
                  imageRefreshVersion={demoImageRefreshVersion}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Interaction Hint */}
        <div className="flex items-center gap-2 opacity-70">
          <div className="w-8 h-8 rounded-full border-2 border-dashed border-white/30 flex items-center justify-center animate-pulse">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-indigo-400">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </div>
          <span className="text-xs text-gray-400">Drag to Board</span>
        </div>
      </div>
    </VisualWrapper>
  )
}

// VI. Counters Visual
const CountersVisual = () => {
  const countersToShow = ['Stun', 'Shield', 'Revealed', 'Aim', 'Exploit', 'Support', 'Threat']
  const COUNTER_BG_URL = 'https://res.cloudinary.com/dxxh6meej/image/upload/v1763653192/background_counter_socvss.png'

  return (
    <VisualWrapper>
      <div className="grid grid-cols-4 gap-4 p-4 w-full">
        {countersToShow.map(type => {
          const iconUrl = STATUS_ICONS[type]
          return (
            <div key={type} className="flex flex-col items-center gap-2 p-2 bg-gray-800/50 rounded border border-white/5 hover:bg-gray-800 transition-colors">
              <div
                className="w-10 h-10 rounded-full border-2 border-white/30 flex items-center justify-center shadow-lg relative"
                style={{
                  backgroundImage: `url(${COUNTER_BG_URL})`,
                  backgroundSize: 'contain',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }}
              >
                {iconUrl ? (
                  <img src={iconUrl} alt={type} className="w-6 h-6 object-contain drop-shadow-md" />
                ) : (
                  <span className="font-bold text-white text-base">{type[0]}</span>
                )}
              </div>
              <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider text-center leading-tight">{type}</span>
            </div>
          )
        })}
      </div>
    </VisualWrapper>
  )
}


export const RulesModal: React.FC<RulesModalProps> = ({ isOpen, onClose }) => {
  const { resources, t } = useLanguage()

  // Prioritize translated rules if available (e.g. Ru), otherwise fallback to local DEFAULT_RULES constant.
  // Note: resources.rules will likely be empty for 'en' now, but populated for 'ru'.
  const r = (resources.rules && resources.rules.title) ? resources.rules : DEFAULT_RULES

  // Stable image refresh version for demo cards
  const demoImageRefreshVersion = useMemo(() => Date.now(), [])

  // Compute sections with stable defaults
  const SECTIONS = useMemo(() => [
    { id: 'concept', title: r.conceptTitle, text: r.conceptText, visual: <AnatomyVisual /> },
    { id: 'winCondition', title: r.winConditionTitle, text: r.winConditionText, visual: <VisualWrapper><div className="text-center text-yellow-400 font-black text-8xl font-mono bg-gray-900 p-10 rounded-3xl border-8 border-yellow-500 shadow-[0_0_50px_#eab308] scale-[1.2]">30 <div className="text-lg font-bold text-gray-400 font-sans mt-2 uppercase tracking-widest">Points</div></div></VisualWrapper> },
    { id: 'field', title: r.fieldTitle, text: r.fieldText, visual: <GridLinesVisual /> },
    { id: 'setup', title: r.setupTitle, text: r.setupText, visual: <HandVisual demoImageRefreshVersion={demoImageRefreshVersion} /> },
    { id: 'abilities', title: r.abilitiesTitle, text: r.abilitiesText, visual: null },
    { id: 'statuses', title: r.statusesTitle, text: r.statusesText, visual: <StatusMechanicsVisual /> },
    { id: 'counters', title: r.countersTitle, text: r.countersText, visual: <CountersVisual /> },
    { id: 'turn', title: r.turnTitle, text: r.turnText, visual: null },
    { id: 'mechanics', title: r.mechanicsTitle, text: r.mechanicsText, visual: null },
    { id: 'credits', title: r.creditsTitle, text: r.creditsText, visual: null },
  ], [r, demoImageRefreshVersion])

  const [activeSectionId, setActiveSectionId] = useState<string>('concept')
  const activeSection = useMemo(() => SECTIONS.find(s => s.id === activeSectionId) || SECTIONS[0], [activeSectionId, SECTIONS])

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="bg-gray-900 w-[95vw] h-[90vh] rounded-xl shadow-2xl flex overflow-hidden border border-gray-700" onClick={e => e.stopPropagation()}>

        {/* Navigation Sidebar */}
        <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-gray-700 bg-gray-850">
            <h2 className="text-xl font-bold text-indigo-400 tracking-wide">{r.title}</h2>
          </div>
          <div className="flex-grow overflow-y-auto p-2 space-y-1">
            {SECTIONS.map(section => (
              <button
                key={section.id}
                onClick={() => setActiveSectionId(section.id)}
                className={`w-full text-left px-4 py-3 rounded-md transition-all duration-200 text-sm font-medium flex items-center justify-between ${
                  activeSectionId === section.id
                    ? 'bg-indigo-600 text-white shadow-lg translate-x-1'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                <span className="truncate">{section.title}</span>
                {activeSectionId === section.id && <span className="text-indigo-300">▶</span>}
              </button>
            ))}
          </div>
          <div className="p-4 border-t border-gray-700">
            <button onClick={onClose} className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 rounded transition-colors uppercase text-sm tracking-wider">
              {t('close')}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-grow flex flex-col md:flex-row overflow-hidden bg-gray-900">

          {/* Text Pane */}
          <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
            <div className="max-w-2xl mx-auto">
              <h1 className="text-3xl font-black text-white mb-8 pb-4 border-b-2 border-indigo-500/50">
                {activeSection.title}
              </h1>
              <div className="prose prose-invert prose-lg text-gray-300 leading-relaxed whitespace-pre-wrap">
                {formatRuleText(activeSection.text)}
              </div>
            </div>
          </div>

          {/* Visual Pane (Desktop Only) */}
          <div className="hidden md:flex w-[45%] bg-gray-850 border-l border-gray-700 flex-col items-center justify-start p-6 relative overflow-hidden">
            <h3 className="text-center text-gray-500 text-xs uppercase tracking-[0.3em] font-bold z-20 opacity-70 mb-2 absolute top-6">
                            Visual Example
            </h3>

            {/* Demo Screen: Reduced height by 20% (h-[65%]) and pushed down (mt-20) */}
            <div className="relative z-10 w-full h-[65%] mt-20 flex items-center justify-center">
              {activeSection.visual ? (
                activeSection.visual
              ) : (
                <div className="text-gray-600 italic flex flex-col items-center opacity-40">
                  <svg className="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                    No visual available
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
