# WAAAGH! Army Builder — Orks (40k 11th ed.)

A single-page, zero-dependency army builder for Orks, built to the blueprint in
[`NEW_ARMY_BUILD_GUIDE.md`](NEW_ARMY_BUILD_GUIDE.md) and
[`DETACHMENT_POINTS_SPEC.md`](DETACHMENT_POINTS_SPEC.md).

Everything is one `index.html` (HTML + CSS + JS, no build step, no npm install).
All rules content lives in `data/*.json` and is fetched at runtime — **rules changes
mean editing JSON, never touching code.**

## Run it

```sh
python3 -m http.server 8000    # or: npx http-server .
# → http://localhost:8000
```

Opening `index.html` straight off disk won't work — browsers block `fetch` on
`file://`. The app says so if you try. Deploys to GitHub Pages as-is.

## Status

The **engine is complete and tested.** **Combat Patrol data is landing now**; matched-play
datasheets have not started yet. Guide §8 build order:

| # | Step | State |
|---|---|---|
| 1 | Skeleton — tabs, theme, loaders, version line | done |
| 2 | Unit schema + Army-view datasheet card | done |
| 3 | Builder — add/remove/duplicate, stepper, totals, limit | done |
| 4 | Abilities + tappable-badge modal | done |
| 5 | Points & escalating costs | done |
| 6 | Leaders, merged cards, leader bonuses | done |
| 7 | Detachment Points (DP) | done |
| 8 | Stratagems tab — phase/turn filter, detachment grouping | done |
| 9 | Enhancements & Upgrades — cap logic, overview grid | done |
| 10 | Persistence — saved lists, share URL, text export | done |
| 11 | Advanced wargear — exclusive choices, fixed loadouts, wargear options | done — options are data-driven, see *Datasheet extras* |
| 12 | Faction oddities — splitting, resource tracking | not needed yet — add if an Ork datasheet calls for it |
| + | **Combat Patrol tab** — separate game mode, read-only force view | done, data landing |
| + | Collapsible unit cards | done |

The nav is **Army · Builder · Stratagems · Combat Patrol**. The in-game tracker
(CP / battle round / VP / WAAAGH!) moved into the ☰ menu — nothing was removed.
A **faction call button** is pinned to the bottom of the Army and Combat Patrol tabs (see below).

**Combat Patrol** is complete (`data/combat-patrol/`) — 6 units, 33 models, the
'Ard As Nails detachment and both enhancements.

**Matched play** was synced with Wahapedia's 11th edition pages (Orks app v2.7.1) on
2026-10-12:

| File | Holds |
|---|---|
| `data/units/` | 22 datasheets — every CHARACTER (Warhammer Legends datasheets are left out) |
| `data/detachments.json` | all 15 Ork detachments, plus the battle-size table |
| `data/enhancements.json` | their 38 Enhancements and Upgrades |
| `data/stratagems.json` | the 10 core stratagems, 40 detachment stratagems, and the 3 Combat Patrol ones |
| `data/abilities.json` | army rules, datasheet abilities and the core/weapon ability glossary |

Stats, points, keywords, DP and CP costs match the source exactly; rules text is
written as short summaries rather than copied. No entry is flagged
`needsVerification` any more, so no ⚠ appears in any popup.

**Wahapedia does not carry Combat Patrol content**, so the 'Ardmob datasheets, their
detachment, enhancements and stratagems were *not* re-checked in that sync. They keep
their own wording of the Waaagh! (`waaagh-combat-patrol` in `data/abilities.json`),
separate from the matched-play army rule (`waaagh`).

## Adding data

```
index.html              the whole app
data/
  abilities.json        every ability/keyword, keyed by id
  enhancements.json     enhancements + upgrades, keyed by id
  stratagems.json       core + detachment stratagems, keyed by id
  detachments.json      { battleSizes, categories, detachments{} }
  units/
    index.json          MANIFEST — every unit id must be listed here
    _TEMPLATE.json      annotated copy of the unit schema (not loaded)
    <unit-id>.json      one file per datasheet; filename == "id" field
  combat-patrol/
    index.json          force name, roster, rules, Combat Patrol stratagems
    units/
      _TEMPLATE.json    annotated Combat Patrol datasheet schema (not loaded)
      <unit-id>.json    one file per Combat Patrol datasheet
  reference/            raw source dumps (not loaded at runtime)
test/                   engine regression suite (see below)
```

Two rules that will bite otherwise:

1. **A browser can't list a directory.** Every new unit file must be added to
   `data/units/index.json` or it simply won't load.
2. **Keys starting with `_` are ignored** by the loader, so `_note` / `_schema` /
   `_comment` keys are safe to leave in the data files as inline documentation.

Copy `data/units/_TEMPLATE.json` to start a new datasheet. `data/detachments.json`
carries the battle-size table and the category → colour map.

**A datasheet's own name is a keyword** (core rules 02.01.01) even though it is not
printed in the keyword list. The app adds it itself, so copy the KEYWORDS line exactly
as printed — "BOYZ unit only" will still match a datasheet named Boyz.

## List-building rules the app enforces

All of it comes from core rules section 25, and all the numbers live in the
`battleSizes` table in `data/detachments.json`:

```jsonc
"battleSizes": [
  { "name": "Incursion",    "maxPoints": 1000, "dp": 2, "enhancements": 2, "unitLimit": 2, "soloDp": 3 },
  { "name": "Strike Force",                    "dp": 3, "enhancements": 4, "unitLimit": 3 }
]
```

The **points limit picks the battle size** — the first entry whose `maxPoints` is not
below it, else the last one (a limit of 0 means "no limit" and plays as the largest).

| Rule | Behaviour |
|---|---|
| **Detachment Points** | Budget is the size's `dp`. A detachment that does not fit is dimmed and refused. |
| **Lone detachment** | `soloDp`: at that size one detachment of exactly that cost may be taken as the *only* detachment, over budget — a 3 DP one at Incursion. |
| **Enhancement limit** | The size's `enhancements`. The 2nd and 3rd copy of an Upgrade do not count towards it, but still cost points. |
| **One per unit** | No unit — an Attached unit included — can have more than one Enhancement, and an Upgrade is an Enhancement. A leader and the unit it leads cannot both hold one; the pickers disable the second. |
| **Upgrade copies** | Up to three of the same Upgrade. |
| **Unit limit** | `unitLimit` copies of one datasheet, doubled for BATTLELINE and DEDICATED TRANSPORT, always 1 for an EPIC HERO. Going over is **flagged, not blocked**. |

Lowering the points limit under a list that was legal at the bigger size never
removes anything: the DP counter turns red and the affected cards carry a ⚠ until you
fix the list yourself. The same goes for a list saved under older rules.

## Detachment grants

A detachment rule that hands something out is table-driven, so a new detachment plugs
in by editing `data/detachments.json` alone:

```jsonc
"grants":               [ { "keyword": "MOB",  "abilityId": "stealth" } ],
"grantsWeaponAbilities":[ { "keyword": "ORKS", "appliesTo": "melee",
                            "abilityId": "sustained-hits", "display": "Sustained Hits 1" } ]
```

`grants` adds an ability to the **unit** (a ✦ row under the statline);
`grantsWeaponAbilities` adds one to its **weapons** — War Horde's Get Stuck In gives
every ORKS melee weapon [SUSTAINED HITS 1] — shown as a dashed badge on the weapon
rows, the same signal already used for an ability a leader confers. Both are
suppressed on Combat Patrol cards, which run their own detachment.

`keyword` needs **every** keyword listed; use `anyKeyword` instead when **one** is
enough — Bully Boyz's rule covers "MEGANOBZ/NOBZ units":

```jsonc
"grantsWeaponAbilities":[ { "anyKeyword": ["MEGANOBZ", "NOBZ"], "appliesTo": "melee",
                            "abilityId": "sustained-hits", "display": "Sustained Hits 1" } ]
```

Only grant what is **unconditional**. A rule that depends on having charged, on the
target, or on being riled up stays in the rule text, which is always one tap away on
the 📜 button.

`category` is a detachment's Force Disposition. It may be an **array** — War Horde
carries two — in which case both are named and the colour bar is split between them.

Keyword matching checks **all three scopes**: the shared list, a profile's own list,
and the Faction Keywords line. Ghazghkull's ORKS lives on the faction line, so a rule
matching ORKS would silently miss him otherwise.

## Model profiles

A unit with two or more statlines lists them under `modelProfiles`. A profile may
carry its **own `invulnerableSave`** for a unit whose models do not share one, where
the save cannot live on the unit — plus an optional `invulnerableNote` for an
asterisked footnote. Units where every model shares one save keep using the
unit-level `invulnerableSave`. (No current Ork datasheet needs this: Ghazghkull
Thraka used to, when Makari was a model of his own, and is now a single model.)

The faction call follows the same structure: where profiles carry their own saves it
improves each of them independently, so a 4+ is left alone while a 6+ becomes 5+.

**Keywords are scoped the same way.** `keywords` is what ALL MODELS carry; a profile
may add its own `keywords` for a model-specific list; `factionKeywords` is the
separate FACTION KEYWORDS line. Each scope renders as a labelled row. A unit with a
plain flat list — every Combat Patrol datasheet so far — renders unlabelled as before.

## Datasheet extras

Everything a datasheet needs beyond stats and weapons is a key on its JSON file, all of
it optional. `data/units/_TEMPLATE.json` shows each one in place.

### Leaders and Support units

A Bodyguard unit can have **one Leader and one Support unit** attached (core rules
19.01). A datasheet is one or the other — `isLeader` or `isSupport` — and `canLead`
lists the units it can join either way:

```jsonc
"isSupport": true,
"canLead": ["boyz", "nobz"]
```

- The Builder card of a unit that can take one shows a **Led by** and a **Support**
  picker; the leader's or support unit's own card says where it currently sits.
- The Army view folds all three into **one card** — Leader, Support, Unit — with one
  combined cost.
- A **Support unit must be attached** (25.04). One that is not carries a ⚠, like every
  other broken rule, and is not removed.
- The one-Enhancement-per-unit rule counts the whole Attached unit, Support included.

### Wargear options

"This model's Kustom Shoota can be replaced with one of the following" is one
**decision** with named choices. The first choice is the printed loadout:

```jsonc
"wargearOptions": [
  { "id": "ranged", "label": "Kustom Shoota", "choices": [
      { "id": "kustom-shoota", "name": "Kustom Shoota", "weapons": ["Kustom Shoota"] },
      { "id": "kombi-rokkit",  "name": "Kombi-rokkit",  "weapons": ["Kombi-rokkit"] } ] },
  { "id": "extra", "label": "Also takes", "choices": [
      { "id": "none", "name": "— nothing —" },
      { "id": "kustom-force-field", "name": "Kustom Force Field", "abilities": ["kustom-force-field"] } ] }
]
```

- `weapons` names a weapon **or a `weaponGroup`**, so a multi-profile weapon swaps in
  and out as one item.
- A weapon named by any choice is carried **only while that choice is picked**; a weapon
  no option mentions is simply always carried. The loadout is derived from the picks,
  so it can never hold both halves of a swap, or neither.
- `abilities` on a choice are wargear abilities that come with it.
- Only a non-default pick is stored on the list entry (in `slots`), so it travels
  through saved lists, share links and the text export with no extra plumbing.

### Abilities that reach the weapon rows

"This unit's ranged attacks have [IGNORES COVER]" applies to every model in the unit —
the datasheet's own, and in an Attached unit everyone else's too:

```jsonc
"unitWeaponAbilities": [
  { "appliesTo": "ranged", "abilityId": "ignores-cover", "display": "Ignores Cover" },
  { "appliesTo": "ranged", "abilityId": "sustained-hits", "display": "Sustained Hits 1", "whileCalled": true }
]
```

They show as dashed badges on the weapon rows. An entry marked `whileCalled` only
appears while the unit is under the faction call. A badge is not repeated when the
weapon already says the same thing — compared by what the badge says, so a
detachment's [SUSTAINED HITS 1] still shows next to a weapon's own
[SUSTAINED HITS 2: MONSTER/VEHICLE].

### Other keys

| Key | Does |
|---|---|
| `coreAbilities` | An id, or `{ "id": "deadly-demise", "display": "Deadly Demise D3" }` when the datasheet prints a value. |
| `costing` | Escalating cost — "1st to 2nd unit 100 pts, 3rd+ unit 115 pts" is `escalationAfter: 2` with one tier each. |
| `whileCalled` | `[{ "text", "from" }]` — what the datasheet's own abilities add while it is riled up, listed in the card note. |
| `alwaysCalled` | The unit is riled up permanently (Zodgrod's Super Runts). Works on an Enhancement too (Mekwaaagh! Mastermind), and covers the whole Attached unit. |

## Weapon sections

Each weapon is its own block: **name, then its stats with their own labels across the
full width, then its abilities underneath.** There is no shared header row — that
layout squeezed the values into narrow right-hand columns, left melee with a dead
Range column, and pushed ability badges alongside the numbers where they collided.

Ranged and melee carry colour-banded headers — cool blue and warm red — with a left
accent stripe, and each weapon's stat labels take the same colour, so the two blocks
separate at a glance while scrolling a card mid-game. Every other section (Abilities, Wargear,
Keywords, Leader) deliberately keeps the plain header: the banding only means
something because it is used sparingly. The colours are theme tokens
(`--ranged*` / `--melee*`) with light-theme variants.

## The Stratagems tab

A phase bar across the top (All · Command · Movement · Shooting · Charge · Fight)
and a grid of compact cards below it, grouped by source with Core first. Each card
shows its CP cost, whose turn it is usable on, and a one-line summary; tapping it
opens the full WHEN / TARGET / EFFECT / RESTRICTIONS text.

Turn is a coloured badge rather than a filter — green for either, blue for your turn,
red for your opponent's — so a phase view tells you at a glance what is yours to use
and what is a response.

`cpCostNote` marks a stratagem that can cost more if you take an option. The card
shows the short form (`+1 CP`) to stay compact, with the full note in the tooltip and
the popup, so the cost is never under-reported.

`phases` follows the **phase icons on the stratagem card**, which can list more than
the phase named in WHEN: Mow ’Em Down is used in the Fight phase but also carries the
Charge icon, because it only works for a unit that charged. It therefore shows under
both filters. "Any phase" is stored as all five.

Combat Patrol's detachment counts as active for content gating, so its stratagems
appear without having to select anything in the Builder's DP picker.

## Enhancements that carry a weapon

A few Enhancements hand the bearer a weapon of its own (Da Gobshot Thunderbuss, Da
Krunch, ’Eadbanger). Put the profile on the entry as `weapon`, in the same shape as a
datasheet weapon, and it is drawn in the Enhancement's popup and on the unit's card:

```jsonc
"weapon": { "name": "Da Krunch", "range": "24\"", "a": "3", "bs": "4+", "s": "5", "ap": "-1", "d": "1",
            "abilities": [{ "id": "blast", "display": "Blast 3" }, "hazardous", "lethal-hits", "psychic"] }
```

## Unit cards are an accordion

Cards start **collapsed**, and opening one **closes whichever was open** — at most one
card is expanded per view. Tap anywhere on a header to open or close it; the chevron
points down when open and right when closed. Collapsed, a card still shows its name,
its sub-line (model breakdown, loadout note, diff label) and its points, so the list
stays a usable index of the force.

- State is stored as **which card is open**, per view, rather than a set of collapsed
  ones — so "nothing recorded" naturally means "all collapsed", and the accordion
  rule is a property of the model rather than something to enforce on every toggle.
- Each view has its **own** open card: opening a Combat Patrol card leaves the
  Builder's alone.
- Collapsing an **Attached unit** hides the leader and bodyguard sections together —
  it is one card, so it collapses as one.
- It **persists across reloads** (`orks.openCard`), so a refresh mid-game returns you
  to the card you were reading.
- Toggling happens **in place** rather than through a re-render, and the scroll is
  corrected afterwards so the header you tapped stays put — otherwise closing a card
  above it would yank it up the screen.

## The faction call button

A button fixed to the bottom of the screen, for the faction's once-per-battle call.
It shows on the two tabs you play a game from, **Army** and **Combat Patrol** — which
tabs is the `FACTION_CALL_TABS` array in `index.html`. Pressing it plays a shake + ring + screen-flash effect (and a
haptic buzz where supported), then an **ongoing banner** rises above it naming the
effect you just gained and how long it lasts. It stays there until you press **End**
on the banner.

It is **entirely data-driven** — nothing about Waaagh! is written in the code. The
button renders only if the call ability exists in `data/abilities.json` *and* carries
the keys below. Which ability that is: `FACTION_CALL_ID` (`waaagh`, the matched-play
army rule), except on the Combat Patrol tab, where the force can name its own with
`"factionCall"` in `data/combat-patrol/index.json`. The Orks one does
(`waaagh-combat-patrol`), because the Combat Patrol rules are written against a
different wording of the Waaagh! than the current army rule.

```jsonc
"waaagh": {
  "name": "Waaagh!",
  "description": "…full rule, shown when you tap the badge on a datasheet…",

  "callLabel":    "WAAAGH! CALLED",                    // banner heading
  "callWhen":     "Start of the Command phase · once per battle",  // idle tooltip
  "callDuration": "Until the end of the next turn",     // shown under the effect
  "callEffect":   "…HTML naming what you gained…"       // the ongoing text
}
```

### Live effects on the cards

While the call is active, the effects in `callEffects` are applied to the **displayed**
profile of every unit whose `factionAbilities` include the ability, and every changed
value **pulses green** — distinct from the amber used for a change an enhancement made.

```jsonc
"callEffects": {
  "meleeWeapon": { "s": 1, "a": 1 },   // added to each melee weapon's stats
  "invulnerableSave": "5+",            // granted, or improved if the unit's is worse
  "weaponAbilities": [                 // a badge on matching weapon rows
    { "appliesTo": "ranged", "abilityId": "assault", "display": "Assault" }
  ]
}
```

- **Each unit follows the call ability it carries**, not a global one. A matched-play
  datasheet lists `waaagh` and gets *riled up* (5+ invulnerable save, ranged
  [ASSAULT]); a Combat Patrol datasheet lists `waaagh-combat-patrol` and gets that
  version's +1 S / +1 A and 5+ invulnerable save. One WAAAGH! toggle drives both.
- A called weapon ability is **not shown twice** — a weapon that already has [ASSAULT]
  from its profile or a detachment gets no second badge.
- An invulnerable save is **improved, never downgraded** — a Wartrakk's printed 6+
  becomes 5+ and pulses, but with Extra Platin' at 4+ it stays 4+ and does not pulse.
- A stat the app can't add to (`D6+2`) is **expressed** as `D6+2+1` rather than
  silently miscalculated.
- Datasheets are never mutated; ending the call restores the printed values.
- Effects with no stat to change (being eligible to charge after Advancing) are
  listed on the card instead — see below.

### Everything else the call switches on

Being under the call is a *state* other rules key off — for Orks, "riled up". All of
it is data, and all of it appears only while the call is active:

```jsonc
// data/abilities.json — on the call ability
"callState": "Riled up",                               // labels the card note and the stratagem badge
"callNotes": ["Can declare a charge after Advancing"], // the call's own effects that change no number

// data/detachments.json — a rule with a "while riled up" clause
"whileCalled": [ { "keyword": ["ORKS", "INFANTRY"], "who": "ORKS INFANTRY",
                   "text": "+3\" Range on ranged attacks", "rangedWeapon": { "range": 3 } } ]

// data/enhancements.json and data/stratagems.json — the bonus, as one line
"whileCalled": "+1 to the roll"
```

| Where | What you see while the call is active |
|---|---|
| **Unit card** | A pulsing note under the statline headed with `callState`, listing `callNotes`, each active detachment's `whileCalled` text that matches the unit, and its own Enhancement's `whileCalled` — every line naming where it comes from. `rangedWeapon` / `meleeWeapon` add to the weapon stats on the card (a Range in inches is added to: 36" becomes 39"). |
| **Banner** | Below the call's own effects: one line per active detachment `whileCalled` (`who` names the units), and how many of the stratagems on offer have a stronger mode. Matched play only — Combat Patrol's banner is unchanged. |
| **Stratagems tab** | A stratagem with `whileCalled` gets a `callState` badge and an accent border, and its popup gains a "RILED UP NOW" line. |

A detachment `whileCalled` entry matches units with `keyword` (all) or `anyKeyword`
(one), exactly like a grant, and only reaches units that carry the call ability.

**Permanent** riled-up states are shown: a datasheet or Enhancement marked
`alwaysCalled` (Zodgrod's Super Runts, Mekwaaagh! Mastermind) has the call's effects
on its card at all times, and so does the rest of its Attached unit.

**Not tracked:** rules that rile up a *single* unit for a turn — Intimidating
Motivation, Keep Huntin'!, Da Boss is Watchin', Makari, Hoist Dat Banner!, Dread
Power, Flyboss. The app has no per-unit game state, so those stay in their rule text.

### The background flourish

An optional `callGif` key on the same ability plays a near-transparent full-screen
GIF when the button is pressed — fading in and out over three seconds at 20% opacity,
behind the UI and taking no clicks.

```jsonc
"callGif": "assets/waaagh.gif"
```

- It **starts the instant the button is pressed**, alongside the shake and flash.
  To keep that from stuttering, the GIF is **fetched and decoded once while the app
  is idle** (via `requestIdleCallback` when the dock first renders), so a press only
  ever hits the cache.
- The source is **released when the run ends**, so nothing keeps decoding in the
  background between presses. Re-assigning the same URL on the next press restarts
  the animation from cache rather than re-downloading it.
- If the file is **missing or fails to load, nothing happens** — the code gives up
  after the first failure instead of retrying on every press, and the button behaves
  exactly as it did before.
- Skipped entirely under `prefers-reduced-motion`.
- Delete the key to switch it off.

**The GIF itself is not in the repo** — drop your own at `assets/waaagh.gif`. See
[`assets/README.md`](assets/README.md).

Delete those `call*` keys and the button disappears; point `FACTION_CALL_ID` at a
different ability and another faction's call works the same way. The button shares
its state with the WAAAGH! toggle on the in-game tracker, so the two can't disagree,
and it survives a reload. Pressing it again while active re-plays the effect but will
**not** cancel the call — ending it is deliberate, via the banner. It honours
`prefers-reduced-motion`.

## Combat Patrol

Combat Patrol is a separate, introductory game mode: a **fixed force**, its **own
datasheets** (which deviate from the matched-play ones) and its **own stratagems**.
There is no list building, no wargear selection, no points and no detachments — so
the tab is read-only by design and the data lives in its own namespace, where it can
never mix with matched play. Detachment-granted abilities are explicitly suppressed
on Combat Patrol cards.

Everything is driven by `data/combat-patrol/index.json`:

```jsonc
{
  "name": "Orks Combat Patrol",
  "notes": "",
  "roster": [                                  // the fixed force, in display order
    "cp-unit-id",                              // plain id, or:
    { "unit": "cp-boyz", "count": 2, "ledBy": "cp-nob", "note": "free text" }
  ],
  "rule": [ { "name": "…", "description": "HTML" } ]
}
```

- Datasheets are **loaded straight from the roster** — no separate manifest to keep
  in sync. `ledBy` renders the character and its unit as one merged card.
- A roster entry whose file is missing renders a visible placeholder naming the
  expected path, rather than silently disappearing.
- Copy `data/combat-patrol/units/_TEMPLATE.json` to start a datasheet. It is the
  matched-play schema minus everything list-building: no points, no costing, no
  wargear choices. Loadouts are static, so every weapon needs a real `count`.
- The whole file is optional: if it is absent the tab just shows an empty state.

### Force choices

Combat Patrol is read-only about the *datasheets*, but the force itself has per-game
picks, driven by two optional keys in `index.json`. Both panels disappear entirely if
the keys are absent.

```jsonc
"leaderChoice": {                     // one leader, attached to one unit it can lead
  "prompt": "Select one Leader to attach to an 'Ardmob Boyz unit.",
  "leaders": ["cp-ardmob-warboss", "cp-ardmob-weirdboy"]
},
"enhancementLimit": 1,                // how many may be active at once
"enhancements": {
  "extra-platin": {
    "restrictedTo": ["cp-ardmob-wartrakk"],   // gates it, and stars that unit's card
    "effects": { "sv": "3+", "invulnerableSave": "4+" },
    "description": "…"
  }
}
```

- The enhancement picker is a **grid of cards, each carrying its full rule**, so you can
  read what every option does before committing to one — a dropdown only told you the
  name. Tap a card to select it, tap it again to clear. The restriction is shown as a
  separate "Goes on" line only when the rule text doesn't already say it, so it is
  never printed twice.
- Attaching a leader **merges the two cards** and removes the leader's own card, so it
  is never shown twice. The unit total drops by one, because an Attached unit is one
  unit on the table; the model total does not move.
- Legal attach targets come from the leader's own `canLead`. If exactly one is legal
  it is selected automatically; with more than one you choose.
- `effects` are applied to the **displayed** profile and the changed stats are
  highlighted, so an upgraded save is visible where you look for it rather than in
  small print. The underlying datasheet is never mutated — clearing the choice
  restores it.
- Choices persist across reloads, and any stored choice the data no longer offers is
  discarded on load.

### Stratagems

The Combat Patrol tab has **no stratagem panel** — stratagems live on their own tab.
The Combat Patrol tab is for the force: its detachment, its choices and its
datasheets.
- A unit with `canLead` renders the datasheet's **Leader** block listing what it can
  attach to. Names are de-duplicated, so a leader pointing at both 'Ardmob Boyz units
  shows that name once, as the datasheet does. The block is suppressed on a leader
  that is already attached via `ledBy`, where it would only repeat what the merged
  card already shows.

## Tests

```sh
node test/run.mjs          # needs playwright (global install is fine)
```

Boots the real `index.html` in headless Chromium against deliberately fake fixture
datasheets in `test/fixtures/data`, and asserts the mechanics the guide flags as
traps: escalating costs, non-linear multi-size pricing, the Enhancement/Upgrade cap
and its distinct-Upgrade folding, multi-profile weapon merging in summaries,
`count: 0` options staying off, the call button on the Army tab and everything a call
switches on (detachment, Enhancement and stratagem bonuses), DP budget + unique-group
blocking, Support units (own slot, merged card, must be attached), wargear options,
unit-wide weapon abilities, permanently riled-up units, battle sizes (DP
budget, Enhancement limit and unit limit by points limit, the lone 3 DP detachment at
Incursion), one Enhancement per Attached unit, datasheet names as keywords,
orphaned-enhancement cleanup on detachment removal, leader attachment/merged
cards/inherited abilities,
localStorage + legacy single-detachment migration, share-link round trip, text export,
and the Combat Patrol tab (roster rendering, merged `ledBy` cards, missing-datasheet
placeholders, and matched-play detachment grants *not* leaking into Combat Patrol cards).

It never reads `data/`, so it keeps passing as the real Ork data lands.

## Conventions

- **Version line** under the header, bumped every change: `+0.0.1` minor, `+0.1` feature.
- **Never invent rules text.** Missing effects render as
  `<em>Rule to be added.</em>` rather than something plausible.
- When adding a per-instance field, update **all four** persistence paths in the same
  commit — localStorage, saved slots, share pack/unpack, text export — plus `duplicateInstance`.
