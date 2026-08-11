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
| 11 | Advanced wargear — exclusive choices, fixed loadouts | partial — guided wargear panels (§5.5c) land per-unit, as datasheets that need them arrive |
| 12 | Faction oddities — splitting, resource tracking | not needed yet — add if an Ork datasheet calls for it |
| + | **Combat Patrol tab** — separate game mode, read-only force view | done, data landing |
| + | Collapsible unit cards | done |

The nav is **Army · Builder · Stratagems · Combat Patrol**. The in-game tracker
(CP / battle round / VP / WAAAGH!) moved into the ☰ menu — nothing was removed.
A **faction call button** is pinned to the bottom of the Combat Patrol tab (see below).

**Combat Patrol** is complete (`data/combat-patrol/`) — 6 units, 33 models, the
'Ard As Nails detachment and both enhancements. **Matched play has started**:
`data/units/` holds its first datasheet. `data/stratagems.json` holds the
11th-ed core stratagems, shown on the Stratagems tab. Still empty, awaiting
matched-play data: `data/detachments.json`, `data/enhancements.json`,
`data/units/`.
`data/abilities.json` holds every ability. **Everything the Ork data actually
references is verified** — no ⚠ appears anywhere in the current force. The remaining
25 entries are unused edition-core scaffolding still flagged `needsVerification`,
which shows a ⚠ in their popup until their wording is checked. They cost nothing
until a datasheet references one.

## Adding data

```
index.html              the whole app
data/
  abilities.json        every ability/keyword, keyed by id
  enhancements.json     enhancements + upgrades, keyed by id
  stratagems.json       core + detachment stratagems, keyed by id
  detachments.json      { budget, categories, detachments{} }
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
carries the DP budget (default 3) and the category → colour map.

## Model profiles

A unit with two or more statlines lists them under `modelProfiles`. A profile may
carry its **own `invulnerableSave`** — Ghazghkull Thraka is 4+ while Makari is 2+, so
the save cannot live on the unit — plus an optional `invulnerableNote` for an
asterisked footnote. Units where every model shares one save keep using the
unit-level `invulnerableSave`.

The faction call follows the same structure: where profiles carry their own saves it
improves each of them independently, so a 4+ is left alone while a 6+ becomes 5+.

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

Combat Patrol's detachment counts as active for content gating, so its stratagems
appear without having to select anything in the Builder's DP picker.

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
It currently shows on the **Combat Patrol** tab only — which tabs it appears on is the
`FACTION_CALL_TABS` array in `index.html`, so adding `'army'` to it is the whole change. Pressing it plays a shake + ring + screen-flash effect (and a
haptic buzz where supported), then an **ongoing banner** rises above it naming the
effect you just gained and how long it lasts. It stays there until you press **End**
on the banner.

It is **entirely data-driven** — nothing about Waaagh! is written in the code. The
button renders only if the ability named by `FACTION_CALL_ID` exists in
`data/abilities.json` *and* carries these keys:

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
  "invulnerableSave": "5+"             // granted, or improved if the unit's is worse
}
```

- An invulnerable save is **improved, never downgraded** — a Wartrakk's printed 6+
  becomes 5+ and pulses, but with Extra Platin' at 4+ it stays 4+ and does not pulse.
- A stat the app can't add to (`D6+2`) is **expressed** as `D6+2+1` rather than
  silently miscalculated.
- Datasheets are never mutated; ending the call restores the printed values.
- Effects with no stat to change (being eligible to charge after Advancing) live in
  the rule text only.

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
`count: 0` options staying off, DP budget + unique-group blocking, orphaned-enhancement
cleanup on detachment removal, leader attachment/merged cards/inherited abilities,
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
