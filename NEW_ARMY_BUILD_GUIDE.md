# Army Builder — Build Guide (faction-agnostic)

A complete blueprint for building a single-faction Warhammer 40,000 (11th ed.) army-builder
web app, distilled from a working implementation. **Nothing here is faction-specific** — it
describes the *systems*, the JSON contracts, and the traps, so a fresh assistant with no
knowledge of your army can build the same app once you supply your faction's data.

> **How to use this:** drop this file into a new repo and tell your assistant
> *"Read `NEW_ARMY_BUILD_GUIDE.md` and build this for \<faction\>. Here's my data: …"*
> Then feed it datasheets in batches (see §2).

---

## 1. What you're building

A **single-page, zero-dependency web app** for building and playing a list:

| Tab | Purpose |
|---|---|
| **Army** | Read-only battle view — full datasheet cards for the units in your list, for use during a game |
| **Builder** | Compose the list — add units, set sizes, pick wargear/enhancements, choose detachments |
| **Stratagems** | Filterable stratagem cards (by phase, by active detachment) |
| **Points** | In-game tracker (CP / faction resource / round counter) |

Design constraints that made this work well:

- **One `index.html`** containing all HTML, CSS and JS. No build step, no framework, no npm install.
- **Data lives in `data/*.json`**, fetched at runtime. Rules changes = edit JSON, never touch code.
- **Deployable to GitHub Pages** as-is (add a `CNAME` for a custom domain).
- **Mobile-first** — you'll use it on a phone at the table.

---

## 2. What you must supply (data-gathering checklist)

The assistant knows the *core rules* but **not your faction's datasheets**. Supply these — screenshots
work well, one batch at a time:

1. **Unit list with points** — including any *escalating* costs (Nth+ copy costs more) and multi-size prices.
2. **Per-unit datasheets** — stats line (M/T/Sv/W/Ld/OC), invulnerable save, weapon profiles (Range/A/BS or WS/S/AP/D + keywords), abilities, keywords, unit composition.
3. **Wargear options** — the "Any number of X can replace Y with Z" bullets, per unit.
4. **Leader/attachment info** — which characters can lead which units, and what bonus they confer.
5. **Detachments** — name, DP cost, category, rule text, and any mutual-exclusion group.
6. **Stratagems** — per detachment: name, CP, when/target/effect/restrictions.
7. **Enhancements & Upgrades** — name, points, restriction ("X model only"), full text.
8. **Faction-wide rules** — army rule, any faction resource (see §5.9).

**Order matters.** Build in this sequence so each layer has something to stand on:
units → abilities → detachments → stratagems → enhancements → advanced wargear.

---

## 3. File structure

```
index.html                    All JS, CSS, HTML (single file)
CNAME                         Custom domain for GitHub Pages (optional)
data/
  abilities.json              Every ability/keyword, keyed by id
  enhancements.json           Enhancements + upgrades, keyed by id
  stratagems.json             Core + detachment stratagems, keyed by id
  units/
    <unit-id>.json            One file per datasheet; filename == "id" field
  reference/                  Raw source dumps (optional, not loaded at runtime)
```

Keeping one file per unit matters: it keeps diffs small and lets you hand a single datasheet
to the assistant without dragging in the whole faction.

---

## 4. Data schemas

### 4.1 Unit (`data/units/<id>.json`)

```jsonc
{
  "id": "unit-id",                  // must match filename
  "name": "Unit Name",
  "type": ["Infantry", "Character"],// display-only labels
  "keywords": ["INFANTRY", "CHARACTER", "FACTION KEYWORD"],
  "isLeader": false,                // can attach to another unit
  "isEpicHero": false,              // cannot take enhancements
  "isBattleline": false,

  "points": 100,                    // base cost (see §5.1 for tiers)
  "models": 10,                     // default model count
  "baseModels": 5,                  // min size (multi-size units)
  "maxModels": 10,                  // max size
  "modelBreakdown": "1 Sergeant + 9 Troopers",   // flavour text

  "costing": { /* see §5.1 */ },

  "stats": { "m": "6\"", "t": 4, "sv": "3+", "w": 2, "ld": "6+", "oc": 2 },
  "modelProfiles": [ /* if the unit has 2+ different statlines */
    { "name": "Sergeant", "count": 1, "stats": { … } },
    { "name": "Trooper",  "count": 9, "stats": { … } }
  ],

  "invulnerableSave": "4+",              // null if none
  "invulnerableSource": "ability-id",    // what grants it (for the popup)
  "transportCapacity": 6,

  "fixedWeapons": false,            // true = loadout can't be edited (see §5.6)

  "weapons": {
    "ranged": [{
      "name": "Weapon Name",
      "count": 8,                   // how many models carry it (0 = an option, off by default)
      "range": "24\"", "a": "2", "bs": "3+", "s": "4", "ap": "-1", "d": "1",
      "abilities": ["rapid-fire", { "id": "sustained-hits", "display": "Sustained Hits 2" }],
      "inheritedAbilities": [],     // populated at runtime by leader bonuses — leave empty
      "weaponGroup": "launcher",    // links multi-profile weapons (see §5.7)
      "weaponGroupLabel": "Choose one profile per shooting phase"
    }],
    "melee": [ /* same, no "range" */ ]
  },

  "abilities": ["ability-id"],
  "coreAbilities": ["feel-no-pain-5"],
  "wargear": ["always-equipped-item"],
  "wargearChoices": ["optional-a", "optional-b"],          // checkboxes, capped
  "wargearExclusiveChoices": ["option-a", "option-b"],     // pick exactly one (§5.5)
  "canBeLeadBy": ["leader-unit-id"],

  // leaders only:
  "canLead": ["bodyguard-unit-id"],
  "leaderBonus": {
    "text": "+1 to Advance and Charge rolls",
    "grantsAbilities": ["lethal-hits"],   // inherited by the led unit's weapons
    "grantsFnp": "feel-no-pain-5",
    "appliesTo": "ranged"                 // restrict inherited abilities to a weapon type
  }
}
```

### 4.2 Ability (`data/abilities.json`)

```jsonc
"ability-id": {
  "name": "Ability Name",
  "type": "Core Ability" | "Weapon Ability" | "Wargear" | "Keyword" | "Ability — <Unit>",
  "phases": ["shooting"],           // optional, for phase filtering
  "description": "HTML with <strong> and <br> allowed."
}
```

Descriptions are injected as HTML (you control the data, so it's safe). For multi-condition
rules, format as a bulleted list — `intro:<br><br>• A<br>• B<br>• C` — it reads far better
in the popup than one long sentence.

### 4.3 Enhancement / Upgrade (`data/enhancements.json`)

```jsonc
"enhancement-id": {
  "name": "Enhancement Name",
  "type": "Enhancement (15 pts)" | "Upgrade (15 pts)",
  "upgrade": true,                        // makes it an Upgrade (§5.3)
  "restriction": "CHARACTER model only",  // human-readable; shown as "Goes on: …"
  "restrictedTo": ["unit-id"],            // hard gate by unit id
  "restrictedToKeyword": "KEYWORD",       // hard gate by unit keyword
  "restrictedToWeapon": "Weapon Name",    // hard gate by carried weapon
  "detachment": "det-id" | ["det-a","det-b"],   // array = shared by several
  "points": 15,
  "short": "One-line blurb for the overview grid.",
  "grantsAbilities": ["ability-id"],      // surfaced on the unit's card
  "description": "Full HTML text."
}
```

### 4.4 Stratagem (`data/stratagems.json`)

```jsonc
"stratagem-id": {
  "name": "Stratagem Name",
  "type": "Core Stratagem" | "<Detachment> – Battle Tactic Stratagem",
  "turn": "your" | "opponent" | "either",
  "phases": ["command","movement","shooting","charge","fight"],
  "cpCost": 1,
  "ypCost": 0,                       // faction resource, if any
  "summary": "One-line gist for the card.",
  "when": "…", "target": "…", "effect": "…",
  "restrictions": "…",               // optional
  "detachment": "det-id" | null      // null = core, available always
}
```

---

## 5. Core systems

### 5.1 Points, sizes and escalating costs

11th ed. prices some units *per copy* — the 3rd+ unit of a datasheet costs more. Model it
explicitly rather than computing it:

```jsonc
"costing": {
  "escalationAfter": 2,            // copies beyond this index use the last tier
  "tiers": [
    [{ "models": 3, "points": 80 }, { "models": 6, "points": 160 }],   // 1st–2nd copy
    [{ "models": 3, "points": 90 }, { "models": 6, "points": 170 }]    // 3rd+ copy
  ]
}
```

- **List every size explicitly.** Don't assume the 10-model price is 2× the 5-model price — often it isn't.
- `getUnitCopyIndex(instance)` = the instance's 1-based position among same-datasheet instances (army-list order). If it exceeds `escalationAfter`, use the last tier.
- Single-model units escalate too — `escalationAfter: 3` with one size entry each covers "1st–3rd = 70, 4th+ = 80".
- The **model-count stepper snaps between the sizes in `tiers[0]`** and is hidden entirely for single-size units.
- Mark escalated copies in the UI (a `↑` and a tooltip) so the higher price isn't mysterious.

Total = Σ over instances of: size price + attached leader's points + enhancement points.

### 5.2 Detachment Points (DP)

The army gets a **budget (3 DP)** and spends it across *multiple* simultaneous detachments,
each contributing its rule, stratagems and enhancements. Some detachments share a **unique
group** and are mutually exclusive.

This system is documented in full — schema, logic, persistence, UI, edge cases — in
**`DETACHMENT_POINTS_SPEC.md`**. Copy that file alongside this one. Summary:

```js
selectedDetachments = ['det-a', 'det-b']            // an ARRAY, not a single id
canAddDetachment(id)  // dp fits in remaining budget AND unique group is free
```

Content gating everywhere becomes: *"is this content's detachment among the active ones?"*

### 5.3 Enhancements vs Upgrades

Two sub-types with different rules — get this right or list-building breaks:

| | **Enhancement** | **Upgrade** (`"upgrade": true`) |
|---|---|---|
| Who can take it | non-Epic **CHARACTER** only | **any** non-Epic-Hero unit |
| Copies in army | max **one** of each | up to **three** of the same |
| Counts toward army cap | every one counts | only the **first** copy of each distinct Upgrade |
| Points | charged once | charged **per copy** |

- Army cap is a constant (`MAX_ENHANCEMENTS`) — verify the current edition's number; it has changed.
- **One enhancement/upgrade per unit.** To field two different Upgrades you need two units.
- Epic Heroes can take neither.
- Two helpers do the work: `getEnhancementUsage(excludeId)` → `{id: countElsewhere}`, and
  `countArmyEnhancements(excludeId, extraId)` → cap count with distinct-Upgrade folding.
  Disable an option when selecting it would push the count over the cap.
- Hide the whole selector when a unit has nothing available — otherwise every vehicle sprouts an empty control.
- Show an assigned enhancement as a **★ on the builder card header** so you can scan the list.

### 5.4 Leaders and attached units

- A non-leader instance gets a `leaderId`; the pair renders as **one merged card** (leader section + bodyguard section).
- `leaderBonus.grantsAbilities` are injected into the led unit's weapon rows as *inherited* badges (visually distinct).
- 11th ed.: **leaders keep their abilities when their unit dies.** Don't build a "bodyguard wiped" state that strips them — that's a 10th-ed behaviour.
- Enhancements assigned to an attached leader belong to the *instance*, not the leader unit.

### 5.5 Wargear — three levels of complexity

Pick the lightest one that models the datasheet:

**(a) Static** — `"wargear": ["item-id"]`. Always equipped, renders as a badge.

**(b) Exclusive choice** — `"wargearExclusiveChoices": ["crest-a", "crest-b"]`. Radio-style
picker; the app applies the chosen item's effect. Beware **who** the effect targets:
an item on a *leader* might buff the led unit, or only the bearer. Handle both:

```js
if (choice === 'item-that-buffs-bearer')     displayUnit = { ...displayUnit, invulnerableSave: '4+' };
else if (choice === 'item-that-buffs-unit')  displayBodyguard = { …grant to the led unit… };
```

**(c) Guided wargear panel** — for squads with a page of "up to 2 models can replace…" options.
Free-form weapon rows become unmanageable and let you build illegal lists. Instead:

- Store the *decisions* in a slot object on the instance, e.g.
  `{ special1: 'launcher', special2: 'rifle', knives: 2, ion: 3, leaderRanged: 'bolter' }`.
- **Derive** `instance.weapons` from those slots on every change — the basic-weapon count is
  whatever's left over. The loadout is then *always legal by construction*.
- Render steppers + dropdowns with live `max` hints; block duplicate picks between "choose one
  of the following" slots; clamp numeric picks to what's still available.
- Show a **derived-loadout summary line** so you can see the actual result.
- Provide a migration path: infer slots from any pre-existing free-form loadout on first load.

### 5.6 Fixed loadouts

`"fixedWeapons": true` renders weapon rows **without** the equip checkbox and count controls
(the stats dropdown stays). Use it for single-loadout models so you can't accidentally edit them.

### 5.7 Multi-profile weapons

A weapon with several firing profiles (e.g. blast/focused) is **one weapon**, stored as multiple
entries linked by `weaponGroup`. The battle card groups them under a "choose one profile"
header — but every **summary** must merge them or the unit looks like it carries two weapons.

Write one helper and use it in *all* summary paths (builder header, derived lines, text export):

```js
summarizeWeaponEntries(unit, cfg)  // → [{name, count}], one entry per weaponGroup,
                                   //   using the base name before the profile suffix
```

### 5.8 Detachment-granted abilities

A detachment rule that gives a keyword-matched unit an ability should *show on that unit's card*:

```js
function getDetachmentGrantedAbilities(unit) {
  const granted = [];
  if (isDetachmentActive('det-id') && unit.keywords.includes('KEYWORD'))
    granted.push({ id: 'ability-id', name: 'Ability Name' });
  return granted;
}
```

Render it as a distinct row just below the stat line (next to the invulnerable-save row), tappable
for the description. Keep it table-driven so future detachments plug in at one place.

### 5.9 Faction resource

If your faction has a resource beyond CP, add `ypCost` to stratagems and a tracker on the Points
tab. Give it a neutral internal name so it's easy to rename.

### 5.10 Unit splitting (only if your faction has it)

Some transports split a squad into two units at deployment. Implementation that worked:

- A `split` flag on the instance, only offered when the enabling unit is in the list (and
  auto-inactive if it's removed).
- The Army view renders **two half-cards** from one instance (`makeSplitHalf(instance, 'a'|'b')`),
  each with its own card state. Points stay on the parent instance.
- Half A keeps the attached leader/enhancement; weapons divide per your assignment (or ceil/floor by default).
- **Watch model-borne abilities**: if the squad's invuln comes from its sergeant's wargear, only
  the half containing that model gets it. Track which half he's in and strip the save from the other.
- Mark the halves in their labels (`Split A`, `Split B • Sergeant`) and give them a `noMerge` flag
  so duplicate-card convergence doesn't collapse them back into one.

---

## 6. UI patterns worth copying

- **Collapsible panels everywhere.** The detachment picker and the enhancements overview both
  collapse to a one-line summary (selected names / a count badge). Vertical space on a phone is scarce.
- **Available-Enhancements overview** — a compact grid on the Builder tab, grouped by active
  detachment, each card showing name, points, an *Upgrade* tag, who it goes on, and a one-line
  `short`. Tap → full description. This is the single most useful "what are my options" view.
- **Tappable everything.** Any ability/keyword/enhancement badge opens a modal with its full text
  (`data-ab="<id>"` + one delegated click handler). Include a "Goes on: …" line for enhancements.
- **Context-sensitive header.** Hide controls that don't apply to the current tab (e.g. the DP
  button is builder context), and hide a menu entirely when it has no items for the active detachments.
- **Duplicate handling.** Identical units converge into one card; units of the same datasheet with
  *different* configs each render with a short diff label ("6 models", "Enhancement X").
- **Version line** under the header (`<Edition> - Version X.Y.Z`) — invaluable for knowing what's
  deployed on your phone. Bump it every change: +0.0.1 minor, +0.1 for features.

---

## 7. Persistence, sharing, export

Four channels, all of which must stay in sync as you add per-instance fields:

1. **localStorage** — army list, saved list slots, detachments, in-game state, theme.
2. **Saved list slots** — several named lists, switchable.
3. **Share URL** — the list packed into a compact object (short keys), deflate-compressed, base64
   in the hash. Store only non-default values.
4. **Text export** — plain-text list for sharing/printing.

**The discipline that avoids bugs:** every time you add a field to an instance (a split flag,
a wargear slot object, per-half weapons), add it to **all four** — pack, unpack, duplicate,
and export — in the same commit. And always accept the *old* shape on load:

```js
selectedDetachments = Array.isArray(x.detachments) ? x.detachments
                    : (x.detachment ? [x.detachment] : [default]);   // migrate single → array
```

---

## 8. Recommended build order

1. **Skeleton** — tabs, theme, empty data loaders, version line.
2. **Units** — schema + a couple of datasheets + the Army-view card (stats, weapons, abilities).
3. **Builder** — add/remove/duplicate instances, model-count stepper, points total, points limit.
4. **Abilities & modal** — the tappable-badge system; everything else hangs off it.
5. **Points/costing** — sizes and escalation.
6. **Leaders** — attachment, merged card, leader bonuses.
7. **Detachments (DP)** — see `DETACHMENT_POINTS_SPEC.md`.
8. **Stratagems** tab — phase filter + detachment grouping.
9. **Enhancements & Upgrades** — selector, cap logic, overview grid.
10. **Persistence** — saved lists, share URL, text export.
11. **Advanced wargear** — exclusive choices, guided panels, fixed loadouts.
12. **Faction oddities** — splitting, resource tracking, keyword grants.

---

## 9. Gotchas (learned the hard way)

- **CSS class collisions.** A new component reusing an existing class name will silently restyle
  unrelated cards. Prefix new component classes distinctly and grep before naming.
- **`w.count || 1` breaks optional weapons.** A weapon defaulting to `count: 0` (an option that's
  off) becomes 1. Use `w.count ?? 1`.
- **Merge multi-profile weapons in summaries** (§5.7) or every such weapon appears twice.
- **Clean up on removal.** Dropping a detachment must clear enhancements that are no longer legal
  and reset that detachment's UI toggles — otherwise dangling state keeps charging points.
- **Derive, don't validate.** For complex wargear, computing the loadout from decisions beats
  letting the user free-type counts and checking them afterwards.
- **Ability text drifts between editions.** Rules like *Heavy* and *Stealth* changed wording; when
  the user pastes a rules screenshot, diff it against the JSON rather than assuming it matches.
- **Don't invent rules text.** If a datasheet's effect isn't in the supplied material, use a clearly
  marked placeholder (`<em>Rule to be added.</em>`) and ask, rather than writing something plausible.
- **Distinct ids for same-named content.** Two detachments can have stratagems with identical names;
  give them suffixed ids so both can coexist.
- **Verify before editing.** When given a points/errata screenshot, diff every line against the data
  first — often most values already match and only two or three genuinely changed.

---

## 10. Starter prompt for a new assistant

> I'm building a Warhammer 40k 11th-edition army builder for **\<faction\>**, following
> `NEW_ARMY_BUILD_GUIDE.md` and `DETACHMENT_POINTS_SPEC.md` in this repo. Read both first.
>
> Build it as a single `index.html` with data in `data/*.json`, exactly as the guide describes.
> Start with the skeleton and the unit schema; I'll send datasheets in batches as screenshots.
> Keep a version line under the header and bump it every change (+0.0.1 minor, +0.1 feature).
> Validate the JSON and the JS syntax before each commit, and commit + push each change separately.
>
> First batch: \<paste unit list with points\>

---

*Derived from a working 11th-edition army-builder implementation. The systems described here —
DP budgeting, escalating costs, Upgrades, guided wargear, unit splitting — are edition mechanics,
not faction mechanics, and should port to any army.*
