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
localStorage + legacy single-detachment migration, share-link round trip, text export.

It never reads `data/`, so it keeps passing as the real Ork data lands.

## Conventions

- **Version line** under the header, bumped every change: `+0.0.1` minor, `+0.1` feature.
- **Never invent rules text.** Missing effects render as
  `<em>Rule to be added.</em>` rather than something plausible.
- When adding a per-instance field, update **all four** persistence paths in the same
  commit — localStorage, saved slots, share pack/unpack, text export — plus `duplicateInstance`.
