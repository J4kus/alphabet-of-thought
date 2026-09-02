# Alpha features 1.1 → 1.2 — what changed, what to write, edge cases

A per-feature reference for everything introduced across the **1.1.x** line and the **1.2.0** batch. Each entry has three parts:

- **What changed** — the feature.
- **Write** — a snippet you can put in a `.aot` file to exercise it.
- **Expected behaviour & edge cases** — what the linter/editor does, including the corner cases.

> **Reading this on the current build (1.3+).** A few 1.1/1.2 syntaxes were later changed. Where that happens it is flagged **⚠️ 1.3**. In short: formula references are now `@` not `$`; tables render with no gutter spaces; constraints are declared on the attribute, not the value; the CSV mirror is one `aot.files/` folder at the workspace root. Code snippets below use the **current** syntax so they run as written.

The file **verifies** when its violation total **V = 0**. Errors count toward V; warnings and hints never do.

---

## 1.1.0 — the arithmetic linter

The foundation: every idea gets a prime, its ancestry is encoded as a product, and structural facts become integer arithmetic checked as you type. Findings show as squiggles and in the Problems panel.

### Errors (counted in V)

| # | Rule | Write (a violating line) | Expected & edge cases |
|---|------|--------------------------|-----------------------|
| No tabs | A tab anywhere in indentation | `<TAB>Child` | Error; the linter treats the tab as 4 spaces to keep parsing. Only indentation tabs matter. |
| Indent multiple of 4 | Leading spaces not divisible by 4 | `  Two Spaces` | Error naming `spaces mod 4`. The line is re-based to the nearest level so downstream lines still parse. |
| No depth jumps | A line >1 level deeper than its parent | `Thing` then `        Deep` (8 spaces under a 0-indent line) | Error; the line is clamped to parent+1. A jump of exactly 1 is fine. |
| Well-formed Example | `-` not followed by a space | `-Apple` | Error ("0 spaces after '-'"); parser inserts the space to recover. `- Apple` is fine. **⚠️ 1.3**: the twin rule for `|Pear` was dropped — pipe rows carry no gutter, so `|Pear` is valid. |
| No empty value | `name:` with nothing after | `weight:` | Error. `weight: 5` is fine; `weight` (no colon) is a bare attribute, also fine. |
| Don't repeat the file name | A top-level line equal to the file name | in `Root.aot`: `Root` | Error — the file name is already the root Concept. |
| A Map holds only Maps | A `...` node with real children | `... todo` then an indented `real: x` | Error. Under a `...` only further `...` lines may appear. |
| No "and" in a Concept | A Concept name containing `and` | `Salt and Pepper` | Error — two kinds under one prime. Case-insensitive on the word `and`; `Andrew` is fine (word-boundary). |
| Univocity | The same Concept name twice | `Animal` under `Dog`, `Animal` under `Cat` | Error on the later one. A recurrence needs a distinguishing qualifier (`Farm Animal`). |
| No identical siblings | Two children with same kind+name+value | `colour: red` twice under one parent | Error. A **differing alias** sets them apart (`type (category)` vs `type (Tag)`). |

### Warnings (not counted in V)

| Rule | Write | Expected & edge cases |
|------|-------|-----------------------|
| Singular Concepts | `Animals` | Warning (via `pluralize`, catches irregulars: `People`, `Categories`). Ambiguous words (`Series`) may not fire. Silence with `aot.acceptedWords` (see 1.1.76). |
| Measurement needs both | `actual: 5` with no `target:` (and vice-versa) | Warning on the lone one. Both present → silent. |
| At most eight sub-Concepts | 9 sub-Concepts under one node | Warning. Examples and attributes may be any number. |
| No lone sub-Concept | Exactly one sub-Concept | Warning — a kind with one subtype *is* that subtype. Zero or ≥2 is fine. A `...` Map child excuses it. |
| No lone sub-Example | Exactly one sub-Example | Warning, same reasoning. |
| Differentia | Two sibling sub-Concepts with identical attribute/value slots | Warning — they differ by position only. A sub-Concept that declares no slot at all is excused (its `...` is implied). |

**Cross-cutting edge case:** a `...` Map child marks a node *intentionally incomplete* and excuses it from the child-count and differentia warnings.

---

## 1.1.14 — crosslinks (navigable references)

### What changed
Two inline references became underlined, hoverable links with go-to-definition.

### Write
```aot
Person
    - Socrates
Integer
Measurement
    age integer: 5        # attribute's trailing word 'integer' -> the Integer Concept
    subject: Socrates     # value 'Socrates' -> the - Socrates Example
```

### Expected behaviour & edge cases
- **attribute-is-a-Concept** (solid underline): the **longest trailing run** of an attribute's words that names a Concept links. `age integer` links `integer`; `age` alone would not.
- **value-is-an-Example** (dotted underline): a value that matches an Example name links. **⚠️ 1.3**: originally case-**sensitive**; now case-insensitive (`subject: socrates` still finds `- Socrates`).
- **Ctrl+click** (Go to Definition) jumps to the defining line; **hover** shows the target and its line.
- Edge: a value only links to an Example **of a Concept**. **⚠️ 1.11.2**: the Example must be one of the Concept the attribute (or its alias) names — `subject: Socrates` links only when `subject` names the `Person` Concept and Socrates is one of Person's Examples. Examples listed beneath an *attribute* are that frame's own vocabulary and are no longer reachable, so an attribute that names no Concept links none of its values.

---

## 1.1.18–1.1.22 — Formal Concept Analysis audit (`--suggest`)

### What changed
`node verify.js <file> --suggest` (and blue ⓘ diagnostics in the editor) audit the hand-written tree against the concept lattice the Examples' attributes actually support.

### Write
```aot
Animal
    Fish
        - Goldfish
            has fins
            lays eggs
        - Salmon
            has fins
            lays eggs
    Bird
        - Sparrow
            has feathers
            lays eggs
```

### Expected behaviour & edge cases
- **confirmed**: a Concept whose Examples are *exactly* a formal concept (their shared attributes name no larger/smaller group).
- **proposed**: a grouping the data supports that no Concept names — distinguishes a real candidate kind from an *inheritance echo* (Examples that only share what they inherit).
- **drift**: an Example carrying every attribute another Concept's Examples share, but filed elsewhere → "move it, or give the Concept a differentia that excludes it."
- **exhaustion**: sub-Concepts that fail to cover the parent's Examples (a gap) or are indistinguishable by attributes (overlap).
- **Gates (edge cases):** runs **only when the file otherwise verifies (V = 0)** and has **2–200 Examples**. Fewer than 2 → "too few". A `...` Map child exempts a node (1.1.20). At most eight-sub-Concepts is the child-count rule (1.1.22 fixed it from the old "twelve children").
- **⚠️ 1.3 / 1.2**: originally advisory hints/info; in 1.2 the drift/exhaustion findings became **errors counted in V**.

---

## 1.1.42 — Gödel numbering (content, not ancestry)

### What changed
A second characteristic number `G(n)` encodes *what a line says* (one prime per attribute, exponent encodes the value), complementing `chi` which encodes *where it sits*. Exposed as query flags.

### Write / run
```
node verify.js file.aot --godel "Socrates"
node verify.js file.aot --clashes
node verify.js file.aot --overrides
node verify.js old.aot --diff old.aot new.aot
```

### Expected behaviour & edge cases
- `--godel X`: prints `2³ × 3⁵ × 5² …` with a legend decoding each prime back to `attribute: value`.
- `--clashes`: two unrelated ideas with equal **radicals** (same attribute names) or equal **G** (same attributes *and* values). Reported as two strengths.
- The strong **content clash** (equal G) also surfaces as a hint in the editor (in 1.2 → an **error**, rule 18/20), under the V=0 gate. The weaker same-names clash stays CLI-only.
- `--overrides`: a node redeclaring an inherited default with a new value (two p-adic valuations both ≥2 and unequal).
- `--diff old new`: a prime gained/lost = attribute added/removed; a changed exponent = a changed value.
- Edge: values are coded stably; `$`, commas, `%` are stripped so a money value and its number share a code.

---

## 1.1.43 — Gödel queries + Armstrong dependencies

### What changed
Content becomes a small query language, and functional-dependency reasoning joins the linter.

### Write / run
```
node verify.js file.aot --find "age: 5" "is alive"     # ideas matching a partial spec
node verify.js file.aot --common Socrates Plato        # attributes both set to the same value
node verify.js file.aot --near Socrates 3              # the 3 most similar ideas by content
node verify.js file.aot --fd                           # inferred functional dependencies
node verify.js file.aot --depends "City of Residence"  # what a Concept rests on, direct + transitive
```

### Expected behaviour & edge cases
- `--find`: a bare `attribute` means "present, any value"; `attribute: value` means that exact value. One divisibility test.
- `--fd`: `X → Y` when Y's value is constant within every X-group across enough Examples. A **key** antecedent (distinct on every Example) is ignored unless it's a genuine bijection. A two-way dependency = "the same distinction written twice."
- **⚠️ 1.2**: the inferred FD hint became an off-by-default **warning** (`aot.dependencyFindings`); `--fd` still prints the full set.
- **⚠️ 1.3**: `--depends` edges now come **only from attributes/values**, not concept-name-containment or aliases.

---

## 1.1.68 — tables, the table editor, cell formulas, the CSV mirror

The largest 1.1 addition: org-mode plain-text spreadsheets that parse to ordinary Examples.

### 1.1.68a — pipe tables

**What changed.** A pipe table is a grid of Examples: the header names attributes, each data row is an Example, each cell an Attribute Value.

**Write**
```aot
Otter
    name |size|colour
    -----+----+------
    Ollie|5   |brown
    Pebble|3  |grey
```
> **⚠️ 1.3**: tables render with **no gutter spaces** (`|Ollie |5   |`), columns still padded. Pre-1.3 they had `| Ollie | 5 |`.

**Expected & edge cases**
- The `---+---` **separator** directly below a row marks it the header; the separator is layout, never a node.
- First cell = the Example's name; each further cell = its value for that column. An **empty cell** asserts nothing.
- A **single-cell row** above a separator heads a one-column table. A **lone multi-cell row** (nothing tabular below it) is assumed to be a header being typed — so a fresh table never errors mid-keystroke. **⚠️ 1.12**: the one-column table went with the borders — a row is a line carrying a divider, so a table has at least two columns; a Concept over a column of its Examples is written as `- ` lines.
- A **lone-cell pipe row** (`| Loner`) stays a plain Example. **⚠️ 1.12**: dropped with the borders; a lone Example is written `- Loner`.
- New **errors** (pin the offending cell): a multi-cell row with no header; more cells than the header names; a **capitalised column** (columns name attributes, which are lowercase); an empty name cell.
- A blank line, a non-pipe line, or a change of indent ends the table. **⚠️ 1.12**: a row written *deeper* than the header nests inside the table instead of ending it; only a shallower line starts a new one.
- Because rows are ordinary Examples, FCA / Gödel / Armstrong all run straight off the grid.

### 1.1.68b — the table editor

**What changed.** Org's table automations, live while the cursor is on a table row (`aot.inTable`). Every command re-aligns the whole table first.

**Write / keys** (cursor inside a table)
- `Tab` / `Shift+Tab` — next / previous field (`Tab` at the last field appends a row).
- `Enter` — same column, next row (appends at the bottom); `Shift+Enter` leaves the table with a plain newline.
- `Alt+←/→` move column, `Alt+↑/↓` move row (rows hop the separator).
- `Alt+Shift+→/←` insert / delete column, `Alt+Shift+↓/↑` insert row above / delete row, `Alt+-` insert a separator below.
- Command Palette **AOT Table**: *Sort Rows by Column at Cursor*, *Create Table from Selected Lines*.

**Expected & edge cases**
- *Sort*: the data run around the cursor only (header safe behind its separator); numeric when every key reads as a number (`$`/`%`/commas ignored), else alphabetic.
- *Create Table*: CSV, TSV, or multi-space columns; the first line is lowercased into the header, separator drawn beneath.
- **Creation flow:** header row, `Enter`, type `-`, `Tab` → a lone dash run (or a raw `|-` line) becomes a full separator. **⚠️ 1.2** adds the one-keystroke scaffold (type `|` on an empty line).

### 1.1.68c — cell formulas

**What changed.** A cell can derive its value: value first, formula after it — `20 =sum(...)`.

**Write**
```aot
Order
    name |price|qty|total
    -----+-----+---+------------
    Alpha|10   |2  |20 =@price*@qty
    Total|     |   |20 =sum(@4)
```
> **⚠️ 1.3**: references are `@` not `$`. Pre-1.3 you'd write `=$2*$3`, `=sum($4)`.

**Expected & edge cases**
- Grammar: `@N` (column N, 1 = name column), `sum/avg/min/max(@N)` over the *other* data rows, `+ - * / ( )`, numbers. `$`, commas, `%` in referenced values are ignored.
- **Every table keystroke recalculates** (multi-pass, so chained formulas converge). A fresh value keeps the old one's `$`/comma formatting.
- A cell that **cannot compute** shows `#ERR` and keeps its formula → **error** on its span. A **stale** value (referenced cell changed) → **warning** naming the fresh result.
- The model sees only the value part — crosslinks/FCA/Gödel/dependencies run on clean data.
- Edge: `sum()` over a column with no numeric values errors; a non-numeric operand in arithmetic errors.

### 1.1.68d — the CSV mirror

**What changed.** Every complete table is mirrored to a CSV named after its Concept, kept in sync both ways.

**Write / behaviour.** Save the `.aot` → CSVs written. Edit a CSV → the grid folds back into the table and the `.aot` saves.
> **⚠️ 1.3**: one `aot.files/` folder at the workspace root, plain `<Concept>.csv`. Pre-1.3 it was `<file>.tables/<Concept>.csv`.

**Expected & edge cases**
- RFC 4180 quoting; a top-level table is named after the file's root Concept.
- Both directions write **only on genuine content change**, so the mirrors never chase each other.
- A **pipe** in a CSV cell is bent to a broken bar `¦` (a pipe can't live in a grid).
- **⚠️ 1.2/1.3**: deleting a CSV never deletes a table; an orphaned CSV is **archived `_<name>.csv`** (1.3), not deleted.
- Off with `aot.tableCsvSync`.

### 1.1.68e — Alpha parity inside cells
- **Colouring**: header cells as attributes, name cells as Examples, value cells as values. **⚠️ 1.3**: custom semantic types so themes can't override the colour.
- **Aliases**: a header cell may carry `size (length)`, stripped and crosslinked like a bare attribute.
- **Linting in place**: a finding carries `{startCol,endCol}`, so a capitalised column / extra cells / empty name cell squiggle the offending cell, not the line.

---

## 1.1.76 — spelling, accepted words, alias crosslinks, dependency chains

### 1.1.76a — spelling hints

**What changed.** Prose words > 4 characters are checked against British + American Hunspell.

**Write**
```aot
Recieve Order
    note: the pakage arrived
    colour: gray
```

**Expected & edge cases**
- Surfaced as **Hint** diagnostics on the exact span with up to 3 suggestions; never in the Problems panel, never in V.
- Only prose-shaped words: ALLCAPS, CamelCase, digits, paths, URLs, and formulas are skipped. `colour`/`gray` pass (either dialect).
- **⚠️ 1.2**: a lowercase word passes if its Capitalised form is known (`december` ← `December`).
- Off with `aot.spellingHints`; the language's own terms (`differentia`, `univocity`, `crosslink`, `arity`) are built in.

### 1.1.76b — accepting a word (Quick Fix)

**What changed.** The lightbulb on a spelling hint *or* an "appears plural" warning adds the word to `aot.acceptedWords`.

**Expected & edge cases**
- An accepted word is skipped by spelling, and a Concept whose last word is accepted is no longer read as plural (`Asynchronous`). Case-insensitive. The CLI stays strict — acceptance is editor leniency only.

### 1.1.76c — aliases crosslink

**What changed.** A Concept's parenthetical alias resolves wherever its name would.

**Write**
```aot
Category (Type)
    label
Card
    type          # 'type' resolves to Category via its alias
```

**Expected & edge cases**
- `type` links to `Category` through the alias `Type`; a **real name always outranks an alias**.
- 1.1.76 also added **alias-is-a-Concept**: a Concept alias naming another Concept (`Auto (Car)`) links inside the parentheses and counted as a *dependency*.
- **⚠️ 1.3 reverses this**: `Auto (Car)` where `Car` is another Concept is now a **duplicate-identity error** (file the kind under it instead), and it's no longer a dependency. Attribute aliases still crosslink — and are now the *only* crosslink for that attribute.

### 1.1.76d — dependency chains on hover

**What changed.** Hovering a Concept lists its dependency chains.

**Write**
```aot
Trip
    driver person
Person
    home address
Address
    street
```

**Expected & edge cases**
- Hover `Trip` → `Trip ─driver person→ Person ─home address→ Address — 3 Concepts`. Each crosslinked attribute is one chain.
- A hop that revisits a Concept on the path marks the chain a **cycle** and stops.
- Works on a Concept's defining name and on any crosslink landing on a Concept.
- **⚠️ 1.2** adds an inlay hint (`→Person→Address`) at the line end; **⚠️ 1.3** restricts edges to attributes/values only.

---

## 1.2.0 — the ergonomics & language batch

### Constraints validate values

**What changed.** A comparison bounds an attribute's values.
> **⚠️ 1.3**: constraints live on the **attribute declaration** (`age >=18`, header `qty >=1`), not the value. Pre-1.3 you wrote `age: 25 >=18` on the value. Snippet below is 1.3-correct.

**Write**
```aot
Person
    age >=18
    - Ada
        age: 15
    - Bea
        age: 21
```

**Expected & edge cases**
- Every value of `age` is checked. `age: 15` → **warning** (never counted in V), pinned to the `15`, naming `age >= 18` and its line. `age: 21` → clean.
- An **empty value** asserts nothing → never checked.
- The bound's references resolve **per value** (`margin >=@price*0.1` holds each row's margin to its own price).
- A **prose** term is safe: `speed > none noted` stays a plain name (a constraint is only believed when its right side reads as a formula).
- An **uncomputable bound** errors once, on the declaration.

### Formulas on any attribute value

**What changed.** Line-form values (`attr: value =formula`) compute like table cells.

**Write**
```aot
Order
    total: =sum(@price)
    - A
        price: 10
    - B
        price: 20
```

**Expected & edge cases**
- `@attribute name` reads a sibling attribute; aggregates range over the *other* sibling Examples under the same parent. Here `total` → 30.
- **Fills itself in**: the value materialises when the cursor leaves the line, and on save. Never while a cursor holds the line (so it can't fight your typing). Also on Format Document / *AOT: Recompute Formulas*.
- `@N` by position is table-only → errors on a line-form value.

### Copy a derivation

**What changed.** Lightbulb + Command Palette actions.
- *Copy Formula Down the Column* (table), *Copy Formula to Sibling Examples* (line form). **⚠️ 1.3** adds *Copy Formula Across the Row*.
- **Edge:** each target keeps its own value part and gains the formula; all recompute. Copying a formula that references the column it lands in creates a self-reference (avoid, or use an absolute `@col@Example`).

### `|` scaffold + Tab-indents-table

**What changed.**
- Type `|` on an otherwise-empty line → a 3-line skeleton (header / separator / empty data row), cursor in the data row; one `Ctrl+Z` undoes it all.
- `Tab`/`Shift+Tab` in the **leading indent** indent/unindent the whole table one level; inside cells they still navigate.

**Expected & edge cases**
- The scaffold fires only for a lone `|` on an empty line, not adjacent to an existing table, not mid-line.
- A flush-left table has no indent zone — give it a level first.
- After the scaffold, the empty data row trips the "empty first cell" error once you pause (honest — the table is incomplete).

### Dependency visibility
- **Value links feed the graph**: `human: Socrates` (Socrates under `Human`) is now an edge to `Human` — a link through a value no longer hides the dependency.
- **Inlay hint**: `→Person→Address` in faint text at the end of each crosslinked line (off with `aot.chainHints`).
- **Example hover**: hovering an Example (as a value or on its `- ` line) shows its owner, defining line, values, and where it's used.
- **Find All References** (Shift+F12) on Concepts and Examples.

### URLs in values
**Write** `spec: https://example.com/x`
- **Ctrl+click** opens it; **hover** fetches status / content-type / last-modified (one cached HEAD request, off with `aot.urlMetadata`).
- **⚠️ 1.3** adds file-path values (Ctrl+click opens the file) and image previews on hover.

### Case-insensitive Example matching + alias rules
- `person: socrates` finds `- Socrates`. Two Examples differing **only in case** → **warning**.
- New **errors**: two Concepts sharing an alias; an alias repeating its own Concept's name. (`Auto (Car)` was still legal in 1.2 — **⚠️ 1.3** makes it a duplicate error.)

### Smaller 1.2 changes
- **Dependency findings off by default** — `aot.dependencyFindings`; `verify.js --fd` still prints all. Correlated attributes are allowed.
- **Spelling proper nouns** — `december` passes via `December`.
- **Table symbols one upright colour** — `|`, `-`, `+` as `punctuation` chrome (not `comment`, whose italics tilt a pipe).
- **Hold-near-cursor** *(refined in later 1.2.x)* — the lone-sub-Concept / sub-Example warnings wait a beat after typing settles so they don't nag before you can add the sibling; every other squiggle is immediate.

---

## Quick verification per feature

```
node verify.js <file.aot>        # V = 0 verdict + exit code (0 = verifies)
node verify.js <file> --suggest  # FCA audit (1.1.18)
node verify.js <file> --godel X  # content number (1.1.42)
node verify.js <file> --fd       # inferred dependencies (1.1.43)
node verify.js <file> --depends X
npm test                         # the smoke suites
```
