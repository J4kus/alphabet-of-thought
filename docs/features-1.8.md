# Alpha features 1.8 — the editor keeps the model whole

A per-feature reference for the **1.8.0** batch. It picks up where [features-1.6.md](features-1.6.md) leaves off. Each entry has four parts:

- **Before** — how it worked (or failed) without the feature. Worth reading: most of these exist because the old behaviour bit someone.
- **What changed** — the feature, plainly.
- **Write** — snippets you can paste into a `.aot` file: the case that works, and the neighbouring case that does **not**, with why.
- **How it is tested** — the check that holds it, and what that check actually does.

Every snippet uses the **current** syntax, so it runs as written. The file **verifies** when its violation total **V = 0**: errors count toward V, warnings and hints never do.

Run the whole suite with `npm test` (580 checks across nine plain Node scripts — no framework, each prints `PASS`/`FAIL` and exits non-zero on failure).

The batch has one idea behind it: **the editor maintains the model's consistency for you, instead of only reporting where it broke.** A duplicate shows both of its halves and offers to merge them; numbering keeps itself sequential and never breaks a reference; a wrapped table stays one table; a misspelling fixes in one stroke. Everything below is that idea applied.

---

## Every duplicate reports at both of its places

### Before
A duplicate names two lines, but only one of them squiggled. The univocity error landed on the second definition (the first sat clean); the Gödel clash squiggled only the later of its two twins; the cross-file duplicate warning mentioned the other file in its message text with nothing to click. To see the other half you read the message and scrolled.

### What changed
Every finding that names two nodes now reports **at every occurrence**, and each diagnostic carries the partner locations as **clickable related information** (the "related" list under a squiggle's hover, and in the Problems panel). This covers same-file duplicate Concepts, identical siblings, shared aliases, differentia twins, case-twin Examples, Gödel clashes, and the cross-file duplicate — the last pointing straight into the other file. Deleting a definition in one file clears the warning in the other **live**: the index refresh now re-analyses every other open `.aot`, so a stale duplicate warning no longer survives until you happen to touch the file.

### Write
```aot
Dog
    Animal      <- ERROR here …
Cat
    Animal      <- … and ERROR here, each pointing at the other
```

Both lines squiggle; hover either and the related entry jumps to its twin. Before 1.8 only the `Cat`'s `Animal` squiggled.

### How it is tested
`out/test-linter.js` — `verify: both duplicate definitions error, each related to the other` asserts a two-member group yields **two** errors whose `related[0].line` cross-reference each other; `…the case-only Example warning reports at both spellings` does the same for the warning channel. `out/test-godel.js` — `clash: both twins report, each related to the other` pins the pair to `a.line` and `b.line`. The cross-file half rides `out/test-extension.js` §7b (`a Concept defined in two files warns repo-wide`), now emitting the other file's location as related information.

---

## A cross-file duplicate says how the two differ — and reconciles on a click

### Before
`Concept 'Car' is also defined in Fleet.aot:12` told you *that* the repo held two definitions, not *how they disagreed* or what to do about it. Merging meant reading both files, copying facts across by hand, and deleting one block.

### What changed
The warning now ends with the difference, computed from both trees: where each definition is filed (its is-a home), the attributes and Examples only one side carries, and the default values they set differently — or `The two carry identical content.` when nothing separates them. Its lightbulb offers **Reconcile: keep this definition** — one edit that merges the other file's missing attributes, values, and Examples into the definition you clicked (rows onto its table when it has one, `- ` lines otherwise, raw lines copied so aliases, constraints, and formulas survive), deletes the other definition, and saves both files. A definition holding sub-Concepts refuses the automatic merge — moving a subtree is a decision, not a fix.

### Write
`Garage.aot`:
```aot
Car
    wheels: 4
    - Beetle
```
`Fleet.aot`:
```aot
Car
    doors: 2
    - Model T
```

Both `Car` lines warn: `… Differs: attributes only there: 'doors'; Examples only there: 'Model T'.` Reconcile from `Garage.aot` and its `Car` gains `doors: 2` and `- Model T`, while `Fleet.aot`'s block is deleted — both warnings clear on the save.

### How it is tested
`out/test-derive.js` — the *reconcile* block: `diffConcepts: differing homes are named`, `…attributes and Examples only one side carries`, `…content-identical twins say so`, and `conceptDiffClause` phrasing checks; `mergeConceptOps` is applied to the kept file's lines and re-linted (`the merged tree carries both files' facts`), the table form pins the appended `|Model T|` row, and `a sub-Concept under the other refuses (null)` holds the guard.

---

## Case never makes a second name

### Before
References always resolved case-insensitively, but the *uniqueness* checks compared exact strings: `Foo` and `FOO` counted as two different Concepts (no univocity error), `colour: red` and `colour: RED` as two different siblings — so a file could hold two spellings that every link treated as one name, and no check said so.

### What changed
The remaining case-sensitive comparisons folded: Concept univocity, identical-sibling detection (name, value, and alias), the file-name-repeat check, the differentia slot signatures, and the CSV mirror's Concept lookup. What resolves as one name now *counts* as one name. The case-twin Example warning stays — it is about aligning spelling, and now reports at both spellings.

### Write
```aot
Box
    colour: red
    colour: RED     <- ERROR: identical siblings (case folds)
Dog
    Animal
Cat
    ANIMAL          <- ERROR: 'Animal' defined 2 times (names differ only in case)
```

### How it is tested
`out/test-linter.js` — `verify: Concept names differing only in case are one name (univocity)`, `…sibling defaults differing only in value case are identical`, `…repeating the file name in another case is still the repeat error`, `…sibling slots differing only in case still share a signature`. `out/test-table.js` — `updateTable: the Concept name matches in any case`.

---

## Dependency arrows ride only on attributes

### Before
The small-print inlay chain (`→Person→Address`) appeared at the end of **any** line carrying a crosslink — including a Concept whose *name contains* another Concept (`Independent Node`) and a Concept *aliased* to one. But those links name a **kind**; the Concept inherits nothing through them, so the arrow claimed a dependency that does not exist.

### What changed
The inlay arrows fire only for **attribute-is-a-Concept** links — an attribute (or its `(alias)`) typed by a Concept, which is exactly what creates a dependency edge. Concept-level crosslinks still underline and still Ctrl+click; they just carry no arrow. The hover chains were already correct (they exclude kind-links from the graph itself) and are unchanged.

### Write
```aot
Address
    street
Person
    home address        <- →Address rides here: a dependency
Independent Person      <- underlines 'Person', but no arrow: a kind, not a dependency
```

### How it is tested
`out/test-extension.js` — `inlay: the dependency chain appears in small print at the line's end` (an attribute link, still hinting) and `hover: a Concept alias is a kind, not a dependency — 'Auto' shows no chain` hold both sides; the provider's filter is one guard on `link.connection`.

---

## `...` quiets drift on either side of the fence

### Before
A `...` Map excused its Concept from the differentia, clash, and exhaustion checks — but **not** from drift. A Concept openly marked incomplete could still pull an outside Example toward it, and an Example filed under an openly incomplete home could still be reported as drifting away.

### What changed
Drift is skipped when **either** Concept carries a `...` — the Concept drifted *toward*, or the home the Example is filed *under* — whether written as a Map child (`... more to come`) or as the Example form (`- ...`). What is missing is declared, not forgotten, so drift over it is provisional; delete the `...` and the finding returns.

### Write
```aot
Fish
    lives in water
    ... more kinds of fish
    - Trout
    - Salmon
Bird
    has wings
    - Sparrow
    - Goldfish
        lives in water    <- silent: Fish declares itself incomplete
```

Remove the `...` line and the drift error returns: `'- Goldfish' carries every attribute the Examples of 'Fish' share…`

### How it is tested
`out/test-fca.js` — `drift: silent when the Concept drifted toward carries '...'`, `…silent when the Example's home carries '...'`, and `…the Example form '- ...' opens its Concept just as a Map does`, each against the misfiled-Goldfish control fixture that still fires without the marker.

---

## The Example dropdown works inside table cells

### Before
On a line-form value (`person: `), typing popped the Concept's Examples and its archived CSV values. The same attribute as a **table column** offered nothing — the completion provider bailed on any pipe row, though a typed column's cells are exactly the same idea.

### What changed
A cell in a column typed by a Concept — by the header's name or its `(alias)` — pops the same dropdown: the Concept's Examples first, archived values after, identical to the line form. Typing `|` (entering a fresh cell) triggers it too. The name column and the header row offer nothing (they declare, they don't value), and a `=` formula cell is left to the `@` completion. A value the list lacks still hints once written, and its Quick Fix lists it under the Concept — so picking from the dropdown and coining a fresh Example both keep the model whole.

### Write
```aot
Person
    - Socrates
Trip
    name|person
    T1  |      |    <- typing in this cell offers 'Socrates'
```

### How it is tested
`out/test-extension.js` §6e — `value completion: a Concept-typed column's cell offers the Concept's Examples` drives the provider at a cell position and asserts exactly `Socrates`; `…the name column and the header row are offered nothing` holds the guards. §6d keeps the line form and the formula bail-out unchanged.

---

## A spelling suggestion applies in one stroke

### Before
A misspelling hinted with its suggestions in the message — `'recieve' is not in the dictionary — did you mean 'receive'?` — but the only Quick Fix was *Accept* (add the word to your vocabulary). Applying the suggestion meant retyping it.

### What changed
Each suggestion is now its own Quick Fix — **Replace with 'receive'** — editing exactly the flagged span. When there is exactly **one** suggestion the fix is marked *preferred*, so `Ctrl+.` `Enter` (or the editor's Auto Fix) applies it in a single stroke. *Accept* still sits beside the replacements for when the word is right and the dictionary is wrong.

### Write
```aot
Note
    status: recieve confirmed    <- Ctrl+. Enter -> 'receive confirmed'
```

### How it is tested
`out/test-extension.js` §11 — `spelling: each suggestion offers Replace with 'X', preferred when it stands alone` asserts one action per suggestion, each carrying a workspace edit on the diagnostic's exact range, `isPreferred` exactly when the suggestion is alone; the *Accept* fixes and their round trip through `aot.acceptedWords` keep passing beside it.

---

## Numbered Examples number themselves

### Before
An ordered list — steps, days, rankings — was hand-maintained: insert `- 2. Prepare` between two steps and every number after it was wrong, plus every reference to the renamed steps.

### What changed
The first `N. ` on any Example opts its Concept's list in: on **save** and on **Format Document**, all of that Concept's Examples take sequential `1. `, `2. `, … prefixes in listed order — unnumbered names gain a number, stale numbers correct — and every same-file reference to a renamed Example (crosslink values, table name cells, formula references) follows through the rename engine, the exact spans F2 would edit. A list with no numbered Example is never touched: the numbering is opt-in per Concept, and removing every prefix opts back out.

### Write
```aot
Recipe
    - 1. Mix
    - Bake
    - 4. Serve
Note
    recipe: 4. Serve
```

saves as:

```aot
Recipe
    - 1. Mix
    - 2. Bake
    - 3. Serve
Note
    recipe: 3. Serve     <- the reference followed
```

Cross-file references are the one thing not renamed — same limitation as F2 — and show their own finding in their own file.

### How it is tested
`out/test-derive.js` — `renumberExamples: stale and missing numbers correct in listed order`, `…already true numbering changes nothing`, `…an unnumbered list is not opted in (null)`, `…double digits number cleanly ('11. Step K')`. `out/test-extension.js` §6f — `renumber: Format Document renumbers the list and its references` runs the real formatting provider over the snippet above and asserts all three rewritten lines, reference included.

---

## Concepts number too — `1.`, `1.1`, `1.1.1` — and the numbers are presentation

### Before
Concepts could not be usefully numbered at all: a `1. ` prefix made the name a *different* name, so `trip` no longer typed by `1. Trip`, `@Trip@…` formulas broke, and the duplicate checks went blind to the pair `2. Animal` / `Animal`.

### What changed
Type `1. ` on any Concept and save: **every Concept in its scope numbers sequentially in document order** — top Concepts `1. `, `2. `, a sub-Concept `1.1 `, its child `1.1.1 ` — numbering descending only concept-to-concept (is-a). The scope is the whole file normally; a Concept filed under an **Example or attribute** numbers only that parent's Concepts. A fully numbered scope keeps its numbers true to position (move a Concept and save; the numbers correct). **Deleting any one number strips the whole scope's numbering, parents included** — one number typed is the way in, one deleted is the way out. (A new *unnumbered* Concept added to a numbered scope reads the same as a deletion and switches numbering off; retype `1. ` on the top Concept to bring it all back.)

The prefix is **presentation, never identity**: every index that resolves names strips it, so an attribute `trip` still types by `1. Trip`, `@Trip@column` still resolves, the CSV mirror still matches its Concept, and `2. Animal` beside `Animal` is still the univocity error it should be. Numbering a tree — or un-numbering it — breaks no reference and rewrites none.

### Write
```aot
1. Getting Started
    1.1 Install
    1.2 Configure
2. Writing
    2.1 Draft
Note
    getting started: something    <- still typed by '1. Getting Started'
```

Delete the `2. ` from `Writing`, save, and every prefix above comes off. And a number without its dot is never a prefix — `- 35` and a Concept `3 Body Problem` keep their names whole.

### How it is tested
`out/test-derive.js` — `renumberConcepts: one '1. ' numbers every Concept, dotted down the is-a chain`, `…a fully numbered scope keeps its numbers true to position`, `…one deleted number strips the whole scope (parents too)`, `…a lone number that is not '1. ' reads as a deletion's leftover`, `…under an Example only that Example's Concepts number`, `…an unnumbered file is left exactly as written`. `out/test-extension.js` §6g runs Format Document over a numbered fixture and asserts the dotted rewrite, then `concept numbering: 'trip' still types by '1. Trip'` resolves the crosslink through the prefix. `out/test-linter.js` — `verify: a numbering prefix never makes a second name` holds univocity through it.

---

## A column can declare its width, and long cells wrap

### Before
A column was as wide as its widest cell, always. One long description blew the whole table out sideways; the only fix was shortening your data.

### What changed
A header cell may end in an org-style **width cookie** — `|description <24>|` caps that column at 24 characters. On the next re-render (Tab, save, Format Document) longer plain cells **wrap at word boundaries onto continuation rows**: data rows with an empty first cell, each fragment padded like any cell, the value reading back as its fragments joined by single spaces. Everything that reads values sees the whole value — crosslinks, formulas (`len(@description)` counts the joined text), the CSV mirror (which round-trips and re-wraps), rename, and the audits. Never wrapped: the name column (it is the Example's identity), header cells, and formula cells (the formula owns its text) — a long one simply widens the column past its cookie.

The cookie is the **per-table opt-in**: a table without one behaves byte-for-byte as before, an empty name cell staying the error it always was. One edge worth knowing: `desc <24` **without** the closing `>` reads as the constraint `< 24` — the closing bracket is what makes it a cookie. Cookies compose with the other header suffixes in the order `name (alias) >=bounds <N>`.

### Write
```aot
Note
    name|d <10>    |qty
    A   |a rather long note|3
```

saves as:

```aot
Note
    name|d <10>    |qty
    A   |a rather  |3
        |long note |
```

— and `=len(@d)` on row A answers **18**, the joined value's length.

### How it is tested
`out/test-table.js` — the *width cookies* block: `widthCookie` parse combos (after aliases and constraints; the unclosed `<24` pinned as a constraint), `widthsOf: a cookie caps its column`, `render: an over-wide plain cell wraps onto a continuation row` with the exact drawn lines, `…a wrapped table re-renders to itself (idempotent)`, `unwrapWithMap: continuation rows map onto their host row`, `tablesOf: a wrapped grid answers logical rows`, `align: wrapping that changes the line count is one whole-block edit`, `formulas: a formula over a wrapped column reads the joined value`, and `render: a cookie-less block never wraps`. `out/test-linter.js` — `table: a continuation row's fragment joins the value above` (with its exact span kept for the colouring) and `…without a cookie the empty first cell stays the error it was`.
