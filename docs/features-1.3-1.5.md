# Alpha features 1.3 → 1.5 — what changed, what to write, edge cases

A per-feature reference for everything introduced across **1.3.0**, **1.4.1** and the **1.5.0** batch. It picks up where [features-1.1-1.2.md](features-1.1-1.2.md) leaves off. Each entry has four parts:

- **Before** — how it worked (or failed) without the feature. Worth reading: most of these exist because the old behaviour bit someone.
- **What changed** — the feature, plainly.
- **Write** — snippets you can paste into a `.aot` file: the case that works, and the neighbouring case that does **not**, with why.
- **How it is tested** — the check that holds it, and what that check actually does.

Every snippet uses the **current** syntax, so it runs as written. The file **verifies** when its violation total **V = 0**: errors count toward V, warnings and hints never do.

Run the whole suite with `npm test` (460 checks across nine plain Node scripts — no framework, each prints `PASS`/`FAIL` and exits non-zero on failure).

---

# 1.3.0 — the breaking three

## References are `@`, not `$`

### Before
Formula references were `$price`, `$2`, `$price@Acme`. The `$` also opens a currency value (`$1,200`), so the two collided in the reader's eye and in the parser's.

### What changed
Every reference is `@`. A `$` in a formula is now an error carrying the hint, rather than a silent misparse.

### Write
```aot
Order
    |name |price|vat            |
    |-----+-----+---------------|
    |Acme |$1,200|240 =@price*0.2|
```

```aot
Order
    |name |price|vat           |
    |-----+-----+--------------|
    |Acme |1200 |240 =$price*0.2|   <- ERROR: references use '@', not '$'
```

### How it is tested
`out/test-table.js` — `evalFormula: references and precedence` builds a fake context (`cell: (c) => String(c * 10)`) and asserts `@2+3*4 === 32`, so the reference resolves and `*` binds before `+`. A companion check feeds `$price` and asserts the thrown message names the change.

---

## Date-aware constraint comparisons

### Before
A constraint's comparison was numeric or textual. `due >=2025-01-01` compared two dates as text, which happens to work for ISO dates but was an accident of the format, not a rule.

### What changed
A comparison is **chronological when both sides read as dates** (ISO `YYYY-MM-DD`, optionally with a time), numeric when both read as numbers, else exact text. So `due >=\`2025-01-01\`` holds every `due` value to the calendar.

### Write
```aot
Person Record
    due >=`2025-01-01`
    - Good
        due: 2026-01-01
    - Bad
        due: 2024-06-01      <- WARNING: violates 'due >= `2025-01-01`'
```

A breached constraint is a **warning**, never counted in V — data out of bounds is worth knowing, not a broken file.

### How it is tested
`out/test-derive.js` — the *date-aware bounds* block lints a fixture and asserts the early date raises a warning pinned to the **value's** span while the compliant date raises nothing. `out/test-table.js` — `valueType / date-aware compare` fixes the unit: `compareValues(">=", "2026-01-01", "2025-06-01") === true`.

---

## Cross-file linting

### Before
Each `.aot` was an island. A crosslink to an Example defined in another file simply did not resolve.

### What changed
Every `.aot` in the workspace is indexed. Crosslinks, hover and go-to-definition resolve across files, the local file winning ties. A Concept defined in two files is a repo-wide **warning** — never an error, because splitting a model across files is legitimate; one name meaning two things is what is worth knowing.

### Write
```aot
# People.aot
Human
    - Socrates
```
```aot
# Census.aot
Record
    human: Socrates          <- Ctrl+click opens People.aot
```

### How it is tested
`out/test-extension.js` §7b writes two real files to a temp folder, indexes them through the mocked watcher (`_aotCreated`), then calls `definitionProvider.provideDefinition` and asserts the returned URI names `People.aot`. A second check asserts the duplicate-Concept **warning** appears and that `V` is unaffected.

---

# 1.4.1 — reaching another table

## Cross-table references

### Before
A formula could only see its own table. Totalling another table's column meant retyping its numbers, and the copy went stale silently.

### What changed
Name the table **first**: `@Order@price@Acme`. The table is named by the Concept/Example/Attribute it sits under (exactly as the CSV mirror files it), and it may live in any `.aot` in the workspace. Aggregates range over a foreign column too.

### Write
```aot
Sales Ledger
    |name |price|
    |-----+-----|
    |Alpha|10   |
    |Beta |20   |
Ledger Check
    |name       |from the ledger              |
    |-----------+-----------------------------|
    |alpha price|10 =@Sales Ledger@price@Alpha|
    |price sum  |30 =sum(@Sales Ledger@price) |
```

```aot
Ledger Check
    total: =@Sales Ledger              <- ERROR: a foreign table reference
                                          names a cell — write @Table@column@Example
```

### How it is tested
`out/test-derive.js` — the *cross-table (line-form)* block builds a registry with `mergeRegistries(tableRegistry(lines, "Sheet"))`, runs `recomputeValues`, and asserts the value materialises as `cost: 10 =@Prices@price@Acme`. Crucially it also asserts the **negative**: `without a registry the foreign reference is #ERR` — so the test proves the registry is what makes it work, not a coincidence.

---

# 1.5.0 — referring to things

## A line-form Concept is referenced exactly like a table

### Before
`@Integer@35@is prime` failed with *unknown column, Example or table after '@'*. The registry a formula resolved against was built from `tablesOf()` alone, so a Concept written as `- Example` children — the ordinary way to write one — could not be referenced at all. To point a formula at a Concept you had to first rewrite it as a table.

### What changed
A Concept written line-form now offers the same scope a table does: its `- Example` children are the **rows**, the attribute names beneath it are the **columns**. Nothing in the evaluator changed — `conceptScope` hands back the same shape `foreignScope` does — because a Concept written line-form and one written as a table are the same idea, and should be referenced the same way.

Two rules fall out of that:

- An Example **silent** on an attribute answers the Concept's own default. That is just inheritance, which the tree already meant.
- Line form has **no columns to number**, so a number there names an **Example**. This is what a Concept whose Examples are numbers needs: `@Integer@35` can only sensibly mean the Example `- 35`.

A table still wins its own name in the registry — it is the sharper reading of the same rows.

### Write
```aot
Integer
    is prime: No                 <- the Concept's default
    - 1
        is prime: Yes
        weight: 4
    - 35
        is prime: No
        weight: 6
    - 7
        weight: 2                <- silent on 'is prime'
Measurement
    age: No     =@Integer@35@is prime      <- the Example's own value
    first: Yes  =@Integer@is prime@1       <- either order works
    heavy: 12   =sum(@Integer@weight)      <- aggregates range over the column
    quiet: No   =@Integer@is prime@7       <- inherits the Concept's default
```

Does **not** work — a Concept with no Examples has nothing to answer with:
```aot
Measurement
    span: 3
Report
    x: =@Measurement@span@anything    <- ERROR: Measurement lists no Examples,
                                         so it is not in the registry at all
```

Edge — a table of the same name shadows the line form, deliberately:
```aot
Person
    |name    |alias|
    |--------+-----|
    |Socrates|Paul |
Note
    a: Paul =@Person@alias@Socrates   <- read through the grid, where @1 also
                                         means the first column
```

### How it is tested
`out/test-derive.js` — the *line-form scope* block covers all four reference shapes above with `recomputeValues`, asserting each computed value. Three checks matter most:

- `a numeric Example` proves `@Integer@35@is prime` yields `No` — the case that used to fail.
- `an Example silent on an attribute inherits the default` proves `quiet: No` — inheritance, not an empty string.
- `without the Concept registry the reference is #ERR` re-runs the *same fixture* with only `tableRegistry` merged in, so the test demonstrates that `conceptRegistry` is exactly what makes the difference.

A fourth (`a table wins its Concept's name in the merged registry`) checks `reg.scopes.get("person").hasColumn(1) === true` — only the grid's scope numbers columns, so this is a precise way to ask *which* scope won.

---

## A Concept's own value is reachable

### Before
A Concept holds two kinds of thing: Examples, and **values of its own** — the defaults it states on its own lines, which its Examples inherit. Only the first was reachable. `@Measurement@alias` failed twice over: a Concept with no Examples was not registered at all (it was judged to have nothing to answer with), and even registered, a two-part foreign reference demanded an Example — *"a foreign table cell needs both a column and an Example"*. The value was sitting right there on the Concept's own line, and there was no way to name it.

### What changed
`@Concept@attribute`, with no Example named, reads the value the Concept states itself. A Concept now earns its place in the registry by holding **either** Examples **or** values of its own — the two things a Concept can answer with.

Only a Concept offers this reading. A table is rows and nothing else, so `@Order@price` still needs its Example named, and says so.

### Write
```aot
Person
    |name    |alias|
    |--------+-----|
    |Socrates|Paul |
Integer
    is prime: No                 <- Integer's own value
    - 1
        is prime: Yes            <- the Example's own overrides it
        weight: 4                <- an attribute only the Example carries
Measurement
    age (integer): 5
    alias: Paul
File
    borrowed: Paul =@Measurement@alias      <- the Concept's own value
    typed: 5       =@Measurement@integer    <- the attribute's alias reaches it
    default: No    =@Integer@is prime       <- Integer's own, not the Example's
    listed: Yes    =@Integer@is prime@1     <- naming an Example still wins
```

Does **not** work, and each says why:
```aot
File
    x: =@Person@alias      <- ERROR: a foreign table cell needs both a column
                              and an Example. A grid states no value of its
                              own — write @Person@alias@Socrates
    y: =@Integer@weight    <- ERROR: 'Integer' states no value of its own
                              here — name one of its Examples too, like
                              @Integer@…@1
```

### How it is tested
`out/test-derive.js` — the *own value* block runs all four working shapes through `recomputeValues` on one fixture, so the Concept's own value and its Example's override are asserted **side by side**: `default: No` and `listed: Yes` come from the same `is prime`, which is the whole distinction the feature draws.

Both error paths get a check too, and they are the interesting ones: `a grid has none, so a table still needs its Example named` is what stops the feature leaking into tables, and `a Concept stating no value there says so` pins the message that tells you to name an Example instead.

---

## A local attribute no longer shadows the Concept it points at

### Before
`leadPart()` read a leading name as a foreign table **only when it matched neither a local column nor a local Example**. The intent was safety — no formula that resolved before should change meaning. The cost was that a perfectly natural model broke:

```aot
Person
    |name    |alias|
    |--------+-----|
    |Socrates|Paul |
Measurement
    person: Socrates
    alias: #ERR =@Person@alias@Socrates
```

`Measurement` has its own `person` attribute, so `@Person@…` bound to *that*, then `alias` bound to the local `alias`, and the parse died on *"@ pairs a column with an Example — one of each, in either order"*. The better your model named things, the more likely it broke.

### What changed
The local reading is still tried **first**, so the old guarantee holds exactly. But a foreign Concept now also gets its turn when the local reading **cannot be completed**. The parser attempts the local reading, and on failure rewinds the cursor and tries the table. Since the readings only look values up, an abandoned attempt leaves nothing behind.

### Write
```aot
Person
    |name    |nationality|alias|
    |--------+-----------+-----|
    |Socrates|RSA        |Paul |
Measurement
    person: Socrates                            <- a local attribute named 'person'
    alias: Paul =@Person@alias@Socrates         <- reaches the table past it
    where: RSA  =@Person@nationality@Socrates
    mine: Socrates =@person                     <- the local attribute still wins
```

Still an error, and rightly — two local columns are not a cell:
```aot
Measurement
    holder: Socrates
    alias: Paul
    x: =@holder@alias        <- ERROR: @ pairs a column with an Example —
                                one of each, in either order
```

Worth knowing, because the backtracking shows through: when a Concept of the lead's name **does** exist, a broken reference is reported against the *foreign* reading, since that is the one the parser got furthest with.
```aot
Person
    |name    |alias|
    |--------+-----|
    |Socrates|Paul |
Measurement
    person: Socrates
    x: =@person@alias        <- ERROR: a foreign table cell needs both a
                                column and an Example — write
                                @Table@column@Example
```

### How it is tested
`out/test-derive.js` — the *shadowing* block. Its three checks are chosen to pin the rule from both sides:

- `@Person@alias@Socrates reaches the table past the local 'person'` — the bug, fixed.
- `a lone @person still reads the local attribute, not the table` — the guarantee, intact. This is the check that would catch an over-eager fix that made tables win outright.
- A separate block proves aggregates read the same way: `sum(@Prices@price)` past a local `prices` attribute.

---

## Values are answerable to the Concept that types them

### Before
`age integer: 5`, where `Integer` lists `- 1` and `- 35`, said nothing. The crosslink simply did not resolve and the editor stayed quiet, so a value that named nothing looked exactly like a value that named something. Adding the missing Example meant scrolling to the Concept and matching its shape by hand.

### What changed
When an attribute names a Concept and that Concept **lists its Examples**, its values are answerable to that list. A value naming none of them is hinted, and the Quick Fix **Add '<value>' as an Example of '<Concept>'** lists it in whichever form the Concept is already written — a row on its table, or a `- value` line under its last Example — leaving the cursor on the new Example.

This is a **gap in the model, not a contradiction in it**, so it hints exactly as spelling does: on its span and on hover, never in the Problems panel, never in `V`. Off with `aot.exampleHints`.

### Write
Both of these hint, and both offer the fix:
```aot
Person
    |name    |nationality|
    |--------+-----------|
    |Socrates|RSA        |
Integer
    - 1
    - 35
Measurement
    person: James        <- hinted: not an Example of Person (Socrates)
    age integer: 5       <- hinted: not an Example of Integer (1, 35)
```

An attribute may name a Concept without being valued by one, so three guards keep the hint honest. Each of these is silent:

```aot
Worker Pool
    - Role
    - Asset
Open Name                       <- lists no Examples: an open vocabulary
Present In
    - Is Present In
Note
    maximum worker pool: 1      <- silent: a number is not the kind of value
                                   Role/Asset are; this measures the pool
    present open name: whatever <- silent: Open Name vouches for nothing
    present in: False           <- silent: a truth value asserts a fact about
                                   an Example, it never nominates one
    listed integer: =@Integer@1 <- silent: a derived value is its formula's
                                   business
```

### How it is tested
`out/test-extension.js` §3d is one fixture holding *all* of the above at once, and asserts `found.length === 2` — so it proves not only that the two real misses hint, but that the five quiet cases stay quiet. Getting either half wrong fails the check. It also asserts the hint's exact `startCol` against `indexOf("James")`, so the squiggle is pinned to the value and not the line.

A second check gives `present in: False` its own fixture, because the truth-value guard is the one most likely to be dropped by a future refactor.

`out/test-extension.js` §4b drives the Quick Fix end-to-end: it calls the registered `aot.addExample` command against a mock editor and asserts the line `    - 5` lands **after the last Example and before the next Concept**, with the cursor on it. `out/test-derive.js` covers the pure edit for both shapes — `a line-form Concept gains a '- value' after its last Example` and `a Concept written as a table gains a row instead`.

> Measured on the repo's own examples, these guards take the finding count on `examples/alphabet of thought.aot` from 8 down to 1. The one that remains — `maximum worker pool: many` — is a text value among text Examples, and is the honest limit of the rule.

---

## Logical operators, and constraints that list allowed values

### Before
There were comparisons (`==`, `<=`, …) and a lazy `if()`, but no way to combine two tests. `if(@qty>0 …)` and `if(@price>0 …)` could not be asked together. A constraint could bound a value but never enumerate it: there was no way to say *status is one of draft, sent, paid*.

### What changed
`and(a,b,…)`, `or(a,b,…)`, `not(a)`, `xor(a,b,…)` in any formula or constraint. A value is **true** when it is a non-zero number, `yes`/`true`, or any other non-empty text; **false** when `0`, `no`/`false`, or empty.

And a constraint can list the allowed values with `or()`. This is the *same* `or()`, not a second meaning: `or()` answers with its **alternatives held together**, and that one value reads as whichever the place asks for —

- as a **truth** in a formula: true when any alternative is true, which is exactly logical OR;
- as a **set** wherever `==` compares against it: the value must equal one of them.

One object read in the two places a value can be read, so there is no context rule to remember.

### Write
```aot
Order
    status ==or(`draft`, `sent`, `paid`)
    grade ==or(1, 2, 3)
    - A
        status: sent
        grade: 2
        qty: 3
        price: 10
        ok: yes  =if(and(@qty>0, @price>0), `yes`, `no`)
        any: yes =if(or(@qty>5, @price>5), `yes`, `no`)
        none: no =if(or(@qty>5, @price>50), `yes`, `no`)
```

```aot
Order
    status ==or(`draft`, `sent`, `paid`)
    - B
        status: void     <- WARNING: value 'void' violates
                            'status == `draft` or `sent` or `paid`'
```

Edges worth knowing:
```aot
Note
    a: =and(1)           <- ERROR: and() takes 2 or more argument(s), got 1
    b: 1 =or(0, 1)       <- a Choice written into a value is read as its
                            truth: the value is 1, not "0 or 1"
    c: 1 =not(or(0,0))   <- or() nests as a truth anywhere one is wanted
```

An ordering distributes the same way — `>=or(1, 9)` holds when the value is at least one of them.

### How it is tested
`out/test-table.js` holds the unit level, and the two checks that matter are deliberately opposite:

- `or() reads as a truth wherever a truth is wanted` — `or(0,1)+0 === 1`, `if(or(0,1),…)`, `not(or(0,0)) === 1`.
- `or() reads as a set wherever '==' compares against it` — `compareValues("==", "sent", evalFormula("or(`draft`,`sent`)"))` is `true` and `"void"` is `false`.

Together they pin the *whole* of the design: one value, two readings. A check on `truthOf` fixes the truth table itself (`"yes"`, `"0"`, `""`, `"widget"`), and an arity check asserts `and(1)`/`or(1)`/`not(1,2)` all throw.

`out/test-derive.js` covers it in a real file: the *enumeration* block asserts `findings.length === 1` with the one finding a **warning** — so `sent` and `paid` passing is part of the assertion, not just `void` failing — and a second block does the same over a table header cell (`grade ==or(1,2,3)`), proving constraints work identically in both shapes.

---

## A value may hold a literal `=`

### Before
There was no escape. `note: a = b` split at the ` =` into the value `a` and the formula `b`, which then failed to compute — so a perfectly ordinary sentence became `#ERR`. Anything with an equals sign in it had to be reworded.

### What changed
`note: a \= b` is the value `a = b`. The backslash belongs to the **file**, not the model: the value reads as `a = b` everywhere it is read (crosslinks, Gödel numbers, a formula referencing it, a CSV export), while the line keeps its `\=` through every rewrite.

The implementation is deliberately one step rather than a new parser rule — `splitCell` needs no change, because the character before an escaped `=` is a backslash, never a space, so its scan already walks past it. All that was needed was `readValue`, called wherever a value becomes *meaning* rather than *characters*.

### Write
```aot
Note
    formula text: a \= b       <- the value is 'a = b'
    computed: 4 =2*2           <- still a derivation
    prose: speed > none noted  <- untouched: prose was always safe
    inline: a=b                <- no escape needed: no space before the '='
```

```aot
Note
    broken: a = b              <- the value is 'a', the formula 'b',
                                  and 'b' does not compute -> #ERR
```

### How it is tested
Three levels, because the feature crosses three:

- `out/test-table.js` — `splitCell: an escaped '=' never splits the cell` asserts `eq === -1` **and** that `splitCell` hands the value back still escaped (the rewrite paths depend on that); `readValue: the backslash comes off when the value is read as data` fixes the one step.
- `out/test-derive.js` — `escape: the model reads the value with its '=', and no formula` lints a real fixture and asserts `node.value === "a = b"` with `node.formula === undefined`. The neighbouring checks assert a recompute **leaves the escaped line alone** while still computing the line below it — which is the actual risk: an escape that a rewrite silently ate.

---

## Text is a first-class thing

### Before
`upper`, `lower`, `trim`, `len`, `left`, `right`, `mid`, `replace` and `&`. Enough to tidy a value, not enough to build one: no way to join three pieces readably, find a substring, split a packed value, or check a prefix.

### What changed
`concat` `proper` `find` `contains` `starts` `ends` `substitute` `split` `repeat` `pad` `text` `value`. The full table with an example each is in the README's [Working with text](../README.md#working-with-text).

Two decisions worth naming. **Positions are 1-based** (`mid`, `find`, `split`) — matching how the rest of Alpha counts — though `find` still answers `0` for "not there", so it reads as a truth. And `substitute(x,a,b,n)` replaces the **nth** occurrence where `replace(x,a,b)` replaces them all, the way Excel splits the same pair.

### Write
```aot
Contact
    - Ada
        first: Ada
        last: Lovelace
        email:  ADA@Maths.org
        display: Lovelace, Ada     =concat(@last, `, `, @first)
        initials: AL               =left(@first,1)&left(@last,1)
        tidy email: ada@maths.org  =lower(trim(@email))
        domain: maths.org          =split(lower(trim(@email)), `@`, 2)
        flag: ok                   =if(and(len(@last)>0, find(@email,`@`)), `ok`, `check`)
```

Edges:
```aot
Note
    a: =split(`a`, `/`, 9)      <- the empty value: a field that is not there
    b: =pad(`toolong`, 3)       <- 'toolong': pad never truncates
    c: =`a` == `A`              <- 0: text comparison is exact and
                                   case-sensitive. Fold it yourself:
                                   lower(@name) == `ada`
```

### How it is tested
`out/test-table.js` has one check per family, each asserting several calls at once so a regression in any one fails the line. The subtle ones get their own:

- `split() takes the nth field, counting back from the end when negative` pins `-1` and the out-of-range `9` → `""`.
- `substitute() replaces the nth, replace() replaces all` asserts both against the *same* input, so the pair can never drift into meaning the same thing.
- `find() reads as a truth, being 0 exactly when absent` builds a context whose cell says `urgent job` and then `calm job`, and asserts `if(find(@note,\`urgent\`), …)` picks each branch — testing the property the design leans on, not just the number.

Every example in the README's snippet above is executed by the same engine and was verified to compute before it was written down.

---

## The CSV mirror reaches line-form Concepts

### Before
The mirror was table-only in both directions. `findOwningAots` looked for a **table** of the CSV's name, so a `Integer.csv` dropped into `aot.files` next to a line-form `Integer` Concept did nothing at all. There was no way to bring a spreadsheet's rows into a Concept without first rewriting that Concept as a table.

### What changed
A table and a `- Example` list are the same idea in two shapes, so both answer for the same CSV.

- **CSV → `.aot`**: the rows fold in **as Examples, merged by name** — an Example already there is updated attribute by attribute, one that is not is appended whole. The Concept keeps the form its author chose: a CSV arriving is data, and data is no reason to restructure somebody's tree into a table.
- **`.aot` → CSV**: the Concept mirrors out on save whenever **any Example carries an attribute value** — a value is data, and data earns its CSV (rule relaxed in 1.7: it used to wait for a CSV of its name to opt in). Only a Concept listing **bare names** stays quiet — a name-only list has no data a CSV would add — until a CSV of its name in the folder opts it in.

Two things a CSV is never allowed to do: a **blank cell says nothing** rather than erasing (a CSV cannot tell "empty" from "unsaid"), and a value carrying a **formula** is left to its formula.

### Write
```
aot.files/Integer.csv          Integer
    name,is prime                  - 1
    1,Yes                              is prime: Yes
    35,No                          - 35
    7,Yes      <- added                is prime: No
                                   - 7            <- folded in as an Example
                                       is prime: Yes
```

Does **not** happen:
```aot
Colour           <- bare names, no attribute values: saving writes none.
    - Red           Put an (even empty) Colour.csv there to opt in.
    - Blue
```
```
name,is prime    Integer
1,               <- the blank does NOT erase 'is prime: Yes'
```

### How it is tested
`out/test-derive.js` — the *updateExamples* block runs one grid against a fixture holding every case at once (a value to correct, an attribute to add, a derived value to leave alone, a new Example) and asserts each op individually, including two negatives: `a grid that changes nothing edits nothing` and `a blank cell says nothing rather than erasing` both assert `length === 0`.

It then **applies** the ops bottom-up and re-lints the result, asserting the folded file reads back as the grid that made it *and* that `!applied.some((l) => l.trim().startsWith("|"))` — the Concept is still line form. That last assertion is the whole point of the feature, so it is stated as a test rather than left to a comment.

`out/test-extension.js` §6c drives both directions against real files in a temp folder: it asserts the first save writes `Integer.csv` unbidden (the Examples carry values), that a name-only Concept writes nothing until a CSV of its name opts it in, then that a new CSV row folds back as `    - 7` with `is prime: Yes` beneath it.

---

## Archived CSVs feed the completions

### Before
A `_Person.csv` was inert: kept on disk so nothing was lost, skipped by the watcher, invisible to the editor. The values in it — real once — were unreachable without opening the file.

### What changed
An archive is still **never folded back** (that would silently undo the archiving), but it is now read: its first column is offered where a `person:` value is typed, after the Concept's live Examples and marked `archived in _Person.csv`.

### Write
```
aot.files/_Person.csv        World.aot
    name,nationality             Person
    Socrates,RSA                     - Socrates
    Plato,Greek                  Measurement
                                     person: |
                                              +-- Socrates  (Example of Person)
                                              +-- Plato     (archived in _Person.csv)
```

### How it is tested
`out/test-extension.js` §6d writes a real `_Person.csv` to a temp `aot.files`, then calls the value-completion provider at the cursor and asserts the labels are exactly `Socrates,Plato` **in that order**, with each `detail` naming where it came from. A second check asserts a formula (`person: =@x`) is offered nothing, which is the guard that keeps the provider out of the way while a derivation is being typed.

---

## A file you cite can be brought in

### Before
A file-path value that resolved to a real file was Ctrl+clickable — but only ever *opened*. A model citing `C:\Users\me\Desktop\report.pdf` was a model nobody else could read: clone the repo and the evidence stayed behind.

### What changed
The lightbulb on any file-path value outside `aot.files` offers **Copy '<name>' into aot.files**. The file is copied in and the value rewritten to `aot.files/<name>` — with forward slashes, so the same `.aot` reads on all three platforms.

Since 1.7, a value still naming the outside path — the same evidence cited from another file, never lightbulbed — Ctrl+clicks through to the `aot.files` copy of its name when one is there, and the hover names the same target the click opens. The written value is untouched; only the lightbulb rewrites it.

Never silently destructive: a file already there with the **same bytes** is relinked with no write at all; one that differs asks first, and offers to keep both under a numbered name (`report (2).txt`).

One consequence had to be fixed with it: `cleanupOrphans` archives any CSV no table claims, so a copied-in `evidence.csv` would have been archived on the next save — breaking the very link that named it. A CSV **any value points at** now counts as claimed.

### Write
```aot
Study
    evidence: C:/Users/me/Desktop/report.txt   <- lightbulb: Copy into aot.files
```
becomes
```aot
Study
    evidence: aot.files/report.txt             <- travels with the repo
```

### How it is tested
`out/test-extension.js` §4c is an end-to-end file-system test: it creates a real file *outside* a temp workspace, runs the registered `aot.copyFileIntoRepo` command against a mock editor, and asserts both halves — the bytes landed at `aot.files/report.txt`, and the line now reads `    evidence: aot.files/report.txt`. A third check cites the outside path from a second file and asserts the document link and the hover both answer with the `aot.files` copy.

The orphan guard gets a real test rather than a unit one, because the bug was in the interaction: it puts an `evidence.csv` (cited by a value) and a `stray.csv` (cited by nothing) in the folder, triggers a genuine save, and asserts the first survives while the second is archived `_stray.csv`. Asserting both directions is what makes it a test of the *rule* rather than of one file.

---

## Cross-platform correctness

### Before
Three latent bugs, all invisible on the machine each was written on:

1. **The workspace index was keyed by raw case.** On Windows the same file arrives as `C:\repo\A.aot` from VS Code's URIs and `c:\repo\A.aot` from a glob. Two keys for one file, and that file was flagged as **its own duplicate Concept** — every Concept in it warned against itself.
2. **`underWorkspace` compared path prefixes with `startsWith`.** `/home/me/repo-two/a.aot` starts with `/home/me/repo`, so a sibling folder read as *inside* the workspace. A bug on every platform.
3. **The CSV mirror compared bytes.** A CSV is exactly the file someone opens in Excel, which writes CRLF back on Windows. The mirror then saw an edit that never happened: it folded an unchanged grid and rewrote the file on every save.

### What changed
- `fileKey(p)` folds case **only where the file system does** (Windows and macOS; Linux holds names case-sensitively, so there the two paths really are different files). Every entry still carries its real `fsPath` — the key identifies, the path is what a link opens, and folding the two would open `people.aot` on a disk that spells it `People.aot`.
- `isInside(dir, file)` compares resolved paths via `path.relative`, so neither `..` nor a same-prefixed sibling can fool it. `underWorkspace` uses it.
- `sameCsvText(a, b)` treats CRLF and LF as the same data.

### How it is tested
`out/test-extension.js` §7c indexes `Kinfolk.aot` through the watcher and then opens the very same file under the path `kinfolk.aot`, asserting **no** self-duplicate warning. It is gated to `win32`/`darwin`, because on Linux those genuinely are two files and the check would be wrong.

The test was verified to **fail** with the fix reverted — printing *"Concept 'Otterkin' is also defined in Kinfolk.aot"*, the exact bug — which is the only way to know a regression test tests anything. It also uses a Concept name (`Otterkin`) no other fixture uses, since the index is module-level and an earlier block's leftovers would otherwise be mistaken for this file's duplicate.

The CRLF case is covered in the mirror block: it rewrites the CSV with `\r\n`, asserts the watcher folds **nothing** back, then that a save leaves the CRLF file alone.

---

## What Alpha costs an LLM, measured

### Before
The README claimed Alpha was economical with tokens. It gave no number, so the claim could not be checked, and nobody knew *where* the saving was.

### What changed
[`out/token-experiment.js`](../out/token-experiment.js) tokenises the same knowledge written as Alpha and as plain English and prints the comparison. The prose it compares against is what a careful person would actually type — the experiment is only worth anything if the prose is fair.

```
npm install --no-save gpt-tokenizer
node out/token-experiment.js
```

The findings, which are more interesting than the claim was:

| Shape | Alpha | Prose | Alpha saves |
|-------|-------|-------|-------------|
| Taxonomy, 155 ideas | 666 | 1,565 | **57%** |
| Grid, 100 Examples × 4 attributes | 2,330 | 3,007 | **23%** |
| Grid, 5 Examples × 4 attributes | 151 | 163 | **7%** |
| Grid, 1 Example × 4 attributes | 55 | 38 | **−45%** |

The saving is **mostly in the tree**: an is-a edge costs Alpha four spaces of indentation and prose a whole sentence — 4.3 tokens per edge against 10.1, steady at every size. The grid's saving is modest and **grows with size**, and below about five Examples Alpha genuinely costs *more* than prose. Alpha is not a compression trick for small facts; it earns its keep on structure and at scale.

The real economy is elsewhere: ten questions over a 100-Example record cost prose 30,070 tokens because every question re-reads the text, while in Alpha the questions a model is *for* are arithmetic — `verify.js --ask X Y` divides two integers at **zero** tokens, with no chance of a plausible wrong answer.

One practical finding: the aligned table's column padding is **19% of its cost** (2,330 against 1,892 as CSV), and the CSV mirror already writes exactly that file. Hand a model the tree for structure and `aot.files/*.csv` for rows.

### How it is tested
It is not a unit test — it is an experiment, and it prints its own evidence. It is kept in the repo so the README's numbers can be re-derived rather than trusted, and it reads the reference model straight off disk, so those figures track the file.

---

# The tests, as a whole

Nine plain Node scripts, no framework, run by `npm test`:

| Script | What it holds |
|--------|---------------|
| `out/test-linter.js` | Parsing, the rules, the V verdict |
| `out/test-table.js` | The table editor, the formula engine, `evalFormula` unit by unit |
| `out/test-derive.js` | Line-form formulas and constraints, the reference scopes, the CSV merge |
| `out/test-extension.js` | The editor end-to-end against a mocked `vscode` and real temp files |
| `out/test-armstrong.js` | Dependency inference |
| `out/test-fca.js` | The Formal Concept Analysis audit |
| `out/test-godel.js` | Gödel numbering and clashes |
| `out/test-urls.js` | URL and file-path spans, metadata |
| `out/test-hold.js` | The lone-child warning delay |

Two habits run through the ones added here, and both are worth keeping:

**Assert the negative.** `without the Concept registry the reference is #ERR` re-runs the same fixture with the feature removed. `a lone @person still reads the local attribute` guards the fix from over-reaching. `found.length === 2` makes the five quiet cases part of the assertion. A test that only shows the feature working cannot tell you the feature is what made it work.

**Test the property, not the example.** `find() reads as a truth` asserts the branch each way rather than the integer, because "0 exactly when absent" is the thing the design leans on. `or()` gets two opposite checks — truth and set — because one value read two ways *is* the design.
