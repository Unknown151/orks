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

The **engine is complete and tested**; the **Ork data is not in yet.** Guide §8 build order:

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
| + | **Combat Patrol tab** — separate game mode, read-only force view | done, awaiting data |

The nav is **Army · Builder · Stratagems · Combat Patrol**. The in-game tracker
(CP / battle round / VP / WAAAGH!) moved into the ☰ menu — nothing was removed.
A **faction call button** is pinned to the bottom of the Combat Patrol tab (see below).

**Empty data files, waiting on datasheets:** `data/detachments.json`,
`data/enhancements.json`, `data/stratagems.json`, `data/units/`.
`data/abilities.json` is seeded with edition-core weapon/core abilities, each flagged
`needsVerification` until the wording is checked against an 11th-ed source — the app
shows a ⚠ note in those popups.

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

## Collapsing unit cards

Every unit card — Army, Builder and Combat Patrol — collapses to its header by
tapping anywhere on that header. The chevron on the right points down when open and
right when closed. Collapsed, a card still shows its name, its sub-line (model
breakdown, loadout note, diff label) and its points, so a tidied list stays readable.

- Collapsing an **Attached unit** hides the leader and bodyguard sections together —
  it is one card, so it collapses as one.
- State is **per card and per view**: the same unit collapsed on the Builder stays
  open on the Army tab, and vice versa.
- It **persists across reloads** (`orks.collapsed` in localStorage), so a list tidied
  before a game is still tidy after a refresh mid-game.
- Toggling happens **in place** rather than through a re-render, so the page doesn't
  jump under your thumb.

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
  "rule": [ { "name": "…", "description": "HTML" } ],
  "stratagems": { "id": { /* same schema as data/stratagems.json, no detachment */ } }
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
