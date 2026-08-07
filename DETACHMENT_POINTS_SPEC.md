# Detachment Points (DP) System — Implementation Spec

A portable, army-agnostic description of the Detachment Points system, written so it
can be re-implemented in another army-builder app. Framework-neutral: the snippets are
plain JS, but the model and rules apply to any stack.

---

## 1. Concept

Instead of choosing a **single** detachment, the army is given a fixed pool of
**Detachment Points (DP)** — default **3**. The player toggles on any combination of
detachments whose DP costs sum to **≤ the budget**. Every selected detachment
contributes its **rule**, its **stratagems**, and its **enhancements** simultaneously.

Some detachments belong to a **unique group** — only **one** detachment per group may
be active at a time (e.g. a full version and a cut-down version of the same theme).

Key differences from the classic "one detachment" model:
- `selectedDetachment` (a single string) becomes `selectedDetachments` (an **array**).
- Content filtering asks *"is this content's detachment among the active ones?"*
- A budget + unique-group constraint governs what can be selected.

---

## 2. Data model

```js
const DETACHMENT_POINTS = 3;              // the army's DP budget

// category name → accent colour (drives the coloured bar on each detachment card)
const DETACHMENT_CATEGORIES = {
  'Disruption':      '#36506f',
  'Take and Hold':   '#3a7d44',
  'Purge the Foe':   '#9e2f2f',
  'Reconnaissance':  '#2f8f8f',
  'Priority Assets': '#c2922b',
};

const DETACHMENTS = {
  'detachment-id': {
    name: 'Detachment Name',
    dp: 2,                          // DP cost (typically 1–3)
    category: 'Priority Assets',    // key into DETACHMENT_CATEGORIES
    unique: 'group-key' | null,     // only one active detachment per non-null group
    ruleId: 'rule-id',              // id used to open the rule popup
    ruleType: 'Detachment Rule — Name',
    ruleDescription: '<strong>…</strong>',   // HTML body for the rule popup
  },
  // …
};

// The active set. Was a single string before the refactor; now an array of ids.
let selectedDetachments = ['some-default-id'];
```

**Downstream content** (enhancements, stratagems, etc.) each carries a `detachment`
field so it can be filtered by what's active. Make it accept a **string OR an array of
ids** so a single piece of content can be shared by more than one detachment:

```js
{ /* …enhancement… */ "detachment": "hearthband" }
{ /* …shared…      … */ "detachment": ["hearthband", "hearthguard-covenant"] }
```

---

## 3. Core logic

```js
function isDetachmentActive(id) {
  return selectedDetachments.includes(id);
}

function dpSpent() {
  return selectedDetachments.reduce((s, id) => s + (DETACHMENTS[id]?.dp || 0), 0);
}

function dpRemaining() {
  return DETACHMENT_POINTS - dpSpent();
}

// Is another active detachment already occupying this unique group?
function uniqueGroupTaken(group, exceptId) {
  if (!group) return false;
  return selectedDetachments.some(id => id !== exceptId && DETACHMENTS[id]?.unique === group);
}

// Can this detachment be added right now?
function canAddDetachment(id) {
  const d = DETACHMENTS[id];
  if (!d || isDetachmentActive(id)) return false;
  if (d.dp > dpRemaining()) return false;         // budget check
  if (uniqueGroupTaken(d.unique)) return false;   // unique-group check
  return true;
}

// Add or remove a detachment, enforcing budget + unique groups.
function toggleDetachment(id) {
  const d = DETACHMENTS[id];
  if (!d) return;

  if (isDetachmentActive(id)) {
    // remove
    selectedDetachments = selectedDetachments.filter(x => x !== id);
    resetDetachmentBuffs(id);       // clear any UI toggles tied to this detachment
    clearOrphanedEnhancements();    // drop enhancements whose detachment is now inactive
  } else {
    // add (with feedback if blocked)
    if (d.dp > dpRemaining()) {
      toast(`Not enough Detachment Points — ${d.name} costs ${d.dp} DP, ${dpRemaining()} left.`);
      return;
    }
    if (uniqueGroupTaken(d.unique)) {
      toast(`${d.name} can't be combined with another selected detachment.`);
      return;
    }
    selectedDetachments.push(id);
  }

  save();       // persist (see §5)
  rerender();   // refresh selector, enhancement/stratagem lists, rule banner
}
```

### Gating downstream content

Content is available when it has **no detachment requirement**, OR **one of its
detachment(s) is active**:

```js
function isContentDetachmentActive(item) {
  if (!item.detachment) return true;                 // universal content
  const dets = Array.isArray(item.detachment) ? item.detachment : [item.detachment];
  return dets.some(isDetachmentActive);
}

// enhancement filter:  if (!isContentDetachmentActive(enh)) hide;
// stratagem  filter:  if (strat.detachment && !isDetachmentActive(strat.detachment)) hide;
```

### Cleanup when a detachment is removed

If an assigned enhancement belongs only to detachments that are no longer active, clear it:

```js
function clearOrphanedEnhancements() {
  armyList.forEach(inst => {
    if (inst.enhancementId && !isContentDetachmentActive(enhancements[inst.enhancementId])) {
      inst.enhancementId = null;
    }
  });
}
```

Also reset any detachment-specific UI state (quick-toggle buttons, aura switches, etc.)
in `resetDetachmentBuffs(id)`.

---

## 4. Rule display

Because multiple detachments can be active at once, a single "detachment rule" banner is
not enough. Show a combined popup listing every active detachment's rule:

```js
function showDetachmentRules() {
  const active = selectedDetachments.map(id => DETACHMENTS[id]).filter(Boolean);
  const body = active.length
    ? active.map(d =>
        `<div><strong>${esc(d.name)}</strong> (${d.dp} DP · ${esc(d.category)})<br>${d.ruleDescription}</div>`
      ).join('')
    : '<p>No detachments selected.</p>';
  openModal('Detachment Rules', `${dpSpent()} / ${DETACHMENT_POINTS} DP used`, body);
}
```

---

## 5. Persistence (with backward compatibility)

Everything stores an **array**, and migrates the old single-detachment form on read.

```js
// --- localStorage ---
function save() {
  localStorage.setItem('detachments', JSON.stringify(selectedDetachments));
}
function load() {
  try {
    const arr = JSON.parse(localStorage.getItem('detachments'));
    if (Array.isArray(arr)) { selectedDetachments = arr.filter(id => DETACHMENTS[id]); return; }
  } catch {}
  const old = localStorage.getItem('detachment');            // legacy single-string key
  selectedDetachments = (old && DETACHMENTS[old]) ? [old] : ['some-default-id'];
}

// --- saved lists ---
list.detachments = [...selectedDetachments];
// on load:
selectedDetachments = Array.isArray(list.detachments)
  ? list.detachments.filter(id => DETACHMENTS[id])
  : (list.detachment && DETACHMENTS[list.detachment] ? [list.detachment] : ['some-default-id']);

// --- shareable URL / export ---
packed.d = selectedDetachments;                              // store the array
// on load, accept array OR legacy string:
if (Array.isArray(packed.d))      selectedDetachments = packed.d.filter(id => DETACHMENTS[id]);
else if (DETACHMENTS[packed.d])   selectedDetachments = [packed.d];
```

---

## 6. UI

**Selector = a grid of cards, one per detachment** (sort by name for a stable layout).
Each card shows:
- a **category-coloured bar** (from `DETACHMENT_CATEGORIES`),
- the **name**,
- its **DP cost** (prefix a ✓ when active),
- a **"Unique: group"** tag when `unique` is set.

Card states:
- **active** — visually highlighted.
- **blocked** — dimmed / non-interactive when `!isActive && !canAddDetachment(id)`
  (won't fit the budget, or its unique group is already taken).

Also provide:
- a **DP counter** `dpSpent() / DETACHMENT_POINTS` (turn it red when over budget — should
  only happen transiently if you ever allow over-spend),
- a **collapsible** panel (show a one-line summary of selected detachments when collapsed),
- the **combined rules popup** from §4.

---

## 7. Edge cases / gotchas

1. **Budget and unique-group are independent constraints** — check both. In practice the
   budget check usually trips first, but the unique check is still needed.
2. **Shared content** — let the `detachment` field be a string *or* an array, and test
   membership with `.some(isDetachmentActive)`. (Two mutually-exclusive detachments in the
   same unique group can safely share content — they're never active together.)
3. **Always clean up on de-selection** — strip enhancements that are no longer legal and
   reset detachment-specific UI toggles, or you leave dangling state that still costs
   points / shows buffs.
4. **Migration** — legacy data stores a single detachment id. Wrap it in an array on read
   in *every* load path: localStorage, saved lists, and shareable URLs.
5. **Empty selection is valid** (0 DP spent). Don't force a default at runtime except when
   there is genuinely no stored value to migrate.
6. **DP budget is a constant** here (3). If it ever needs to vary (per game size, per
   faction), make `DETACHMENT_POINTS` a value on the list/army object instead of a global.
