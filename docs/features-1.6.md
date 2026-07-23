# Alpha features 1.6 — tables and free text are one notation

A per-feature reference for the **1.6.0** batch. It picks up where [features-1.3-1.5.md](features-1.3-1.5.md) leaves off. Each entry has four parts:

- **Before** — how it worked (or failed) without the feature. Worth reading: most of these exist because the old behaviour bit someone.
- **What changed** — the feature, plainly.
- **Write** — snippets you can paste into a `.aot` file: the case that works, and the neighbouring case that does **not**, with why.
- **How it is tested** — the check that holds it, and what that check actually does.

Every snippet uses the **current** syntax, so it runs as written. The file **verifies** when its violation total **V = 0**: errors count toward V, warnings and hints never do.

Run the whole suite with `npm test` (496 checks across nine plain Node scripts — no framework, each prints `PASS`/`FAIL` and exits non-zero on failure).

The batch has one idea behind it: **a table and free text are two spellings of the same model, so nothing should work in one and not the other.** Everything below is that idea applied — to references, to formulas, to constraints, to links, to the CSV mirror, and to the table scaffold. One change is breaking (`@N`); it is first.

---

## Positional `@N` references are removed (breaking)

### Before
`@2` named a table column by position (1 = the name column) — but only in tables. The same `@2` in a line-form value was an error (“numeric @N references are table-only”), so the two notations read the same formula differently. Positions also silently broke when a column was inserted or moved.

### What changed
References are **name-only, everywhere**. A digits lead after `@` still names an **Example** — a Concept whose Examples are numbers (`- 1`, `- 35`) needs exactly that — it just never numbers a column. A formula still carrying `@2` errors with a migration hint naming the change.

### Write
```aot
Order
    |name|price|total       |
    |----+-----+------------|
    |A   |10   |20 =@price*2|
```

```aot
Order
    |name|price|total   |
    |----+-----+--------|
    |A   |10   |=@2*2   |   <- ERROR: positional column numbers were removed
                             (changed in 1.6), reference the column by its
                             attribute name
```

A number that **names an Example** still resolves — in tables and free text alike:

```aot
Integer
    - 35
        is prime: No
Check
    verdict: No =@Integer@35@is prime
```

### How it is tested
`out/test-table.js` — `evalFormula: positional @N no longer numbers a column (removed in 1.6)` feeds `@2+1` to a context with named columns only and asserts the thrown message names the removal; `evalFormula: a digits lead still names an Example ('- 35'), never a column` resolves `@price@35` through `matchRow`. `out/test-derive.js` — `audit: positional @N is gone — a digits lead that names nothing errors` holds the line form to the same message, and the numeric-Example blocks (`@Integer@35@is prime`) keep passing untouched.

---

## One reference registry for both notations

### Before
Two registries answered cross-references: a grid-built one for tables (`tableRegistry`) and a tree-built one for line-form Concepts (`conceptRegistry`), the table **shadowing** the Concept of the same name. The shadowing had a cost: a table-formed Concept lost the readings only the tree has — `@Order@price` with no Example named errored with “a foreign table cell needs both a column and an Example” even when the Concept stated `price` right above its grid.

### What changed
With `@N` gone, the grid registry had nothing left the tree does not have, so it was **deleted**. Every Concept answers through one scope built over the parsed tree — its Examples are the rows whether they arrived as `- ` lines, table rows, or both. So a table-formed Concept now answers its **own stated default** (`@Person@alias`), cross-references and aggregates see the **merged** Example set, and a table filed under an `- Example` (`@test 1@…`) keeps answering — any line holding Examples registers.

### Write
```aot
Person
    alias: Someone
    |name    |alias|
    |--------+-----|
    |Socrates|Paul |
Check
    who: Someone =@Person@alias            <- the Concept's own default
    his: Paul =@Person@alias@Socrates      <- the row's cell still overrides
```

```aot
Person
    |name    |alias|
    |--------+-----|
    |Socrates|Paul |
Check
    who: =@Person@alias    <- ERROR: 'Person' states no value of its own here
                              — name one of its Examples too
```

### How it is tested
`out/test-derive.js` — the *unified scope* block (`unified scope: a table-formed Concept answers its stated default`, `…a row's own cell still overrides the stated default`) recomputes the snippet above; `own value: a Concept with no stated default says so, table-formed or not` pins the error message. The whole cross-table section of `out/test-table.js` now builds its registries through `lint` + `conceptRegistry` — the same pipeline the editor and `verify.js` use — and every 1.4-era cross-table check passes through the unified scope unchanged.

---

## Free-text attributes and values work in conjunction with a table

### Before
A table's cells could see only the grid. A Concept's `tax rate: 0.2` stated above its table was invisible to a cell formula (`unknown column or Example after '@'`), an empty cell did not inherit the Concept's default (though a silent `- Example` did — the same idea, different answer), and an in-table `sum()` ignored the Concept's `- ` Examples that an outside `sum()` counted.

### What changed
A table's evaluation context carries the **enclosing scope** — the Concept (or Example) the table is filed under. A cell formula reads the parent's line-form attributes by name, an **empty cell inherits the parent's default** exactly as a silent `- Example` does, an in-table aggregate also ranges over the parent's `- ` Examples, and a line-form sibling Example can be named in a cell reference. The grid always wins a shared name — the local reading first, as ever — so no existing formula changes meaning.

### Write
```aot
Order
    tax rate: 0.2
    origin: EU
    - Loose
        price: 50
    |name|price|vat              |site     |all          |
    |----+-----+-----------------+---------+-------------|
    |A   |100  |20 =@price*@tax rate|EU =@origin|90 =sum(@price)|
    |B   |40   |                 |US       |50 =@price@Loose|
```

- `@tax rate` reads the Concept's own line — free text, from inside a cell.
- `=@origin` finds no column named `origin`, so row A answers the inherited default `EU`; row B's plain `US` overrides it.
- `sum(@price)` from row A totals the *other* Examples of the Concept: row B (40) **and** `- Loose` (50).
- `@price@Loose` names a line-form sibling from inside a cell.

A detached grid (no enclosing scope — a block arriving through the CSV mirror mid-fold) still computes grid-only; `=@tax rate` there shows `#ERR` until it lands in the tree.

### How it is tested
`out/test-table.js` — the *outer scope* block (`outer scope: a cell formula reads the parent's line-form attribute`, `…an absent column inherits the parent's default`, `…an aggregate also ranges over the parent's line-form Examples`, `…a line-form sibling Example can be named in a cell reference`, `…a detached block (no registry) still computes grid-only`) recomputes exactly the fixture above through `recomputeAll` with the unified registry and asserts each filled value.

---

## The CSV mirror is one union file per Concept

### Before
The mirror was per **table**: each grid wrote a CSV of its own columns, named after whatever line sat above it — which could be an `- Example`, so `- test 1` kept a `test 1.csv`. A Concept whose Examples carried different attributes had no single file holding them all, and a Concept split across a table and `- ` lines mirrored only the table half.

### What changed
One CSV per **Concept**, named after it: rows are every Example in the Concept's **scope** — table rows and `- ` Examples together, and a table filed under an `- Example` mirrors into the **first Concept up the tree** — columns are the **union** of every attribute any of them carries, in document order. A row silent on a column answers the inherited default, else stays blank: different Examples carrying different attributes all fit, blank where undefined. Editing the CSV folds back **by Example name, wherever each lives**: a table row updates cell by cell within its table's own columns (redrawn aligned), a line-form Example updates attribute by attribute, and a fresh name lands in the Concept's own shape — a row of its table when it has one, else a `- ` block. A valued cell whose table lacks the column is **left to the tree**: columns arrive when a table is created, never from the mirror. The fold never deletes anything; a blank cell says nothing; a formula keeps its value. A pure line-form Concept mirrors exactly as a table-formed one does (since 1.7 — it used to wait for a CSV of its name to opt in), and the old per-Example CSVs are archived `_<name>.csv` on the next save, never deleted.

### Write
```aot
Order
    origin: EU
    - Loose
        weight: 7
    |name|price|
    |----+-----|
    |Acme|10   |
```

saves as `aot.files/Order.csv`:

```
name,origin,weight,price
Loose,EU,7,
Acme,EU,,10
```

— `origin` fills in from the Concept's default, `weight` and `price` are blank where an Example is silent. Change Acme's `price` to `12` in the CSV and the cell updates, aligned; give Loose a `price` and the value lands as a `price:` line under `- Loose`; give **Acme** a `weight` and nothing happens — the table has no `weight` column, and the mirror never adds columns.

### How it is tested
`out/test-derive.js` — the *mirror* block (`mirror: one union grid per Concept, a table under an Example included`, `…a row silent on a column answers the nearest default, else blank`, `…a pure line-form Concept grids exactly the same way`) pins `mirrorGrids`; the *fold* block (`fold: a table row updates within its own columns, redrawn aligned`, `…a formula cell keeps its formula`, `…a fresh name lands as a row of the Concept's own table`, `…a line-form Example updates attribute by attribute`, `…a valued cell whose table lacks the column is left to the tree`, `…a blank cell erases nothing`) applies `updateScope`'s ops and asserts the folded text. `out/test-extension.js` §7 runs the mirror end to end against real files in a temp folder — write, fold back, no self-chase, CRLF tolerance, orphan archiving.

---

## Multiple constraints chain on one declaration

### Before
An attribute took exactly one bound. `age >=18 <=65` did not error — worse, it silently misparsed: the whole tail `18 <=65` became the first bound's formula, which evaluates as a truth (`1`), so the effective constraint was `age >= 1`. A second `age <=65` line was a duplicate-attribute error.

### What changed
Bounds **chain** on the one declaration: `age >=18 <=65` holds the attribute both ways — bare lines and header cells alike, any number of bounds — each bound checked per value and reported on its **own** span, an uncomputable bound erroring on its own segment. An operator inside a bound's own formula (a backtick string, an `or()` list) never splits it, and a bound is still only believed when its right side reads as a formula, so prose terms stay plain names.

### Write
```aot
Person
    age >=18 <=65
    - Ada
        age: 15      <- WARNING: value '15' violates 'age >= 18'
    - Bea
        age: 70      <- WARNING: value '70' violates 'age <= 65'
    - Cal
        age: 30      <- inside both bounds: silent
```

The same chain in a header cell:

```aot
Ledger
    |name|qty >=1 <=5|
    |----+-----------|
    |A   |0          |   <- WARNING: violates 'qty >= 1'
    |B   |9          |   <- WARNING: violates 'qty <= 5'
    |C   |3          |
```

An operator inside a bound never splits it — this is **one** constraint:

```aot
Status Sheet
    status ==or(`a <= b`,`sent`)
```

### How it is tested
`out/test-table.js` — `splitConstraint: bounds chain on one declaration ('age >=18 <=65')` pins the parse (two bounds, each with its own operator column), `…three bounds chain too`, `…an operator inside a bound's or() never splits it`, and `…a single bound still answers a one-entry chain` holds the old shape steady. `out/test-derive.js` — the *chain* block asserts one warning per breached bound (floor and ceiling separately), silence inside both, both directions in a header cell, and an uncomputable second bound erroring **once, on its own span**.

---

## `^` and `ln()` in formulas

### Before
No power operator and no logarithm: `2^10` was `unexpected '^'`, and growth-rate arithmetic left the file.

### What changed
`^` is **power** — binding tighter than `*`, associating **right** (`2^3^2` is `2^(3^2)` = 512), with unary minus tightest (`-2^2` is `(-2)^2` = 4, as a spreadsheet reads it). `ln(x)` is the **natural log** and wants a positive number — `ln(0)` and `ln(-3)` are errors, not `-Infinity`.

### Write
```aot
Growth
    |name |value|doublings          |
    |-----+-----+-------------------|
    |cells|1024 |10 =ln(@value)/ln(2)|
    |power|512  |512 =2^3^2         |
```

```aot
Growth
    log of nothing: =ln(0)    <- ERROR: ln() takes a positive number, got 0
```

### How it is tested
`out/test-table.js` — `evalFormula: '^' binds tighter than '*' and associates right` pins `2+3^2 === 11`, `2*3^2 === 18`, `2^3^2 === 512`, `(2^3)^2 === 64`, `-2^2 === 4`; `evalFormula: ln() of a positive number, e.g. ln(1)=0` checks `ln(1)`, `ln(e)`, and the `ln(2^10)/ln(2)` round trip; `evalFormula: ln() rejects zero and negatives` asserts the throws.

---

## A `- ` Example that is a file path links (and a picture shows)

### Before
A file path in a **value** (`report: aot.files/q2.pdf`) or a **table cell** was Ctrl+clickable, with an inline image preview on hover for a `.png` and kin. The same path as a `- ` Example was plain text — the one notation where an Example could not *be* a file, even though a table row (the same idea) could.

### What changed
Everything after the `- ` marker is a link candidate under the same gate as ever: it must look like a path **and** resolve to a real file. A `- ` Example that is a file Ctrl+clicks open; one that is an **image** shows its picture on hover, exactly as value and cell links do. Plain Examples (`- Ada Lovelace`) are untouched — a name is only a link when a file actually answers it.

### Write
```aot
Evidence
    - aot.files/Person.csv     <- Ctrl+click opens the CSV
    - diagram.png              <- hover shows the picture
    - Ada Lovelace             <- a name, not a path: plain Example
```

### How it is tested
`out/test-urls.js` — `findFiles: a '- ' Example that is a file resolves, exactly spanned` pins the span to the path alone (marker excluded), `…a '- ' Example that is an image resolves (the hover shows it)` routes the result through `isImage` (the exact predicate the hover uses to decide on the preview), and the prose/plain-Example counter-cases assert nothing false-positives.

---

## Drift needs both sides to assert something

### Before
Drift already required the Concept drifted **toward** to own part of its shared intent (the `vacuous` and all-inherited guards). But the Concept the Example was filed **under** could be a bare shelf: an Example sitting in a `Crate` that declares nothing — inheriting its attributes from an ancestor — was still reported as drifting toward any Concept whose intent it matched, though the crate never claimed to hold a kind of anything.

### What changed
Drift fires only between Concepts that each own **at least one explicit attribute** — declared on the Concept or beneath it (its Examples included); **inherited attributes never count** toward eligibility. A home that declares nothing states no differentia to hold or release an Example by, so no drift is reported from it. The intent comparison itself is unchanged. If no attributes are defined, there cannot be drift.

### Write
```aot
Fish
    lives in water
    - Trout
    - Salmon
Rock
    - Pebble
        hard: yes
Wet Storage
    lives in water
    Crate
        - Goldfish       <- silent: Crate owns no attribute of its own
```

Give the crate something to say and the finding returns:

```aot
        - Goldfish
            sealed: yes  <- drift: '- Goldfish' carries every attribute the
                            Examples of 'Fish' share, yet it is filed under 'Crate'
```

### How it is tested
`out/test-fca.js` — `drift: silent when the home Concept owns no explicit attribute` runs `suggest()` over the wet-storage fixture and asserts no Goldfish finding; `drift: an attribute declared beneath the home brings the finding back` adds `sealed: yes` and asserts the finding names `'Fish'`. The original misfiled-Goldfish fixture (its Bird declares `has wings`, so both sides assert) and `examples/warning.aot` (Fowl owns attributes) keep firing unchanged.

---

## A new table arrives with its inherited columns

### Before
Typing `|` on an empty line grew the three-line skeleton with a lone `name` column, whatever the enclosing Concept inherited — every inherited attribute was a column to type by hand.

### What changed
The scaffold parses the document, finds the line the table is filed under, and pre-fills the header with the attributes that line **inherits from its ancestors** — outermost first, deduped. Creation-time only: a table is never re-columned when attributes are declared later. The parent's **own** attribute lines stay out — they already declare, and a same-named column under the same parent would be a duplicate-declaration error.

### Write
```aot
Animal
    legs
    habitat: land
    Otter
        whiskered
        |            <- type the pipe here…
```

…and the skeleton grows as:

```aot
        |name|legs|habitat|
        |----+----+-------|
        |    |    |       |
```

`legs` and `habitat` ride in from `Animal`; `whiskered` stays out — `Otter` already declares it, one line above the table.

### How it is tested
`out/test-extension.js` §5c — `scaffold: inherited attributes pre-fill the header, the parent's own stay out` types a `|` into the nested fixture above through the mocked change event and asserts the exact three scaffolded lines; the original checks (a bare context still scaffolds the plain `|name|` skeleton; a `|` beside a table or mid-line scaffolds nothing) hold the guards.
