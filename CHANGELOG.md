# Change Log

All notable changes to the "aot" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.1.68] - 2026-07-03

- Org-mode plain-text spreadsheets (`src/table.js`): a pipe table is a grid of Examples, parsed by the linter into the exact tree that writing each row as `- Example` with `attribute: value` children would give
  - a header row followed by a `|---+---|` separator (org's rule) declares its cells after the first as **attributes** of the parent; the first cell only labels the name column; the separator is layout, never a node; a single-cell row above a separator heads a one-column table, and a lone multi-cell row (nothing tabular beneath it) is assumed to be a header being typed, so a fresh table never errors mid-keystroke
  - each data row is an **Example** named by its first cell, each further cell that Example's **Attribute Value** for its column; an empty cell asserts nothing; a blank line, a non-pipe line or a change of indent ends the table; a lone-cell pipe row stays a plain Example
  - new errors: a multi-cell row with no header, more cells than the header names, a capitalised column (a column names an attribute, and attributes are lowercase), an empty name cell
  - crosslinks resolve per cell with exact column offsets: a header cell that names a Concept links solid, a value cell that names an Example links dotted, both Ctrl+click to the definition
  - **Format Document** re-aligns every table as org's `TAB` does — each column padded to its widest cell, separators redrawn; lone pipe Examples untouched
  - the separator row recedes like a comment in the grammar; data rows keep their khaki table colour
  - because rows are ordinary Examples, the FCA audit, the Gödel clashes and the Armstrong dependency inference run straight off the grid — org's `#+TBLFM` derived column is exactly Alpha's derivable-column warning, a dependency to model once rather than a formula to store
- The org table editor: all of org-mode's table automations, live while the cursor is on a table row (the `aot.inTable` context — a pipe row with a second pipe, or a separator), every command re-aligning the whole table first
  - `Tab` / `Shift+Tab` next / previous field (`Tab` at the last field appends a row); `Enter` same column next row, appending at the bottom (`Shift+Enter` leaves the table with a plain newline)
  - `Alt+←/→` move column, `Alt+↑/↓` move row (rows hop the separator), `Alt+Shift+→/←` insert / delete column, `Alt+Shift+↓/↑` insert row above / delete row, `Alt+-` insert a separator below
  - Command Palette (**AOT Table**): *Sort Rows by Column at Cursor* (org `C-c ^`: the data run around the cursor, header safe; numeric when every key reads as a number, `$`/`%`/commas ignored) and *Create Table from Selected Lines* (org `C-c |`: CSV, TSV or multi-space lines; the first line lowercased into the header, separator drawn beneath)
  - org's creation flow: header row, `Enter`, type `-`, `Tab` — a lone dash run in the first cell (or a raw `|-` line) becomes a full separator on the next redraw
  - all the cursor math and row/column surgery is pure and tested in `src/table.js` (`out/test-table.js`); the extension only finds the block, applies one operation, redraws and places the cursor
- Full Alpha feature parity inside table cells:
  - **colouring**: a semantic-token provider paints header cells as attributes, name cells as Examples and value cells as Attribute Values; `semanticTokenScopes` maps the token types back to the grammar's own scopes (`variable.other.property.aot`, `constant.language.individual.aot`, `string.unquoted.value.aot`) so themes colour a table cell identically to its written-out line form — pipes and the name-column label stay as quiet khaki chrome
  - **aliases**: a header cell may carry a parenthetical alias (`size (length)`), stripped from the attribute name at parse time and crosslinked/coloured exactly as on a bare attribute line
  - **linting in place**: a finding may carry `{ startCol, endCol }`, and the table checks do — a capitalised column, a row's extra cells and an empty name cell squiggle the offending cell, not the whole line

## [1.1.43] - 2026-06-20

- Gödel-number query flags (`src/godel.js`), turning the content number into a small query language — all plain big-integer arithmetic:
  - `--find "a: v" ["b" …]`: query by example — every idea whose content satisfies a partial spec, as one divisibility test against a query number `Q` (a bare `attribute` means "present, any value"; `attribute: value` means that exact value)
  - `--common X Y`: the shared core of two ideas — every attribute they both set to the same value (the primes whose exponent is equal in both)
  - `--near X [k]`: the `k` ideas most like `X` by content distance — fewest primes whose exponents differ — with the slots that differ listed
- Armstrong's axioms / functional-dependency inference (`src/armstrong.js`), making the dependency reasoning part of the linter rather than only a discussion:
  - `--fd`: functional dependencies inferred from the Examples by projecting their Gödel numbers — `X → Y` when `Y`'s value is constant within every `X`-group, with a key antecedent ignored unless it is a genuine bijection; a determined attribute is **derivable**, a two-way dependency is the same distinction written twice
  - `--depends X`: the Concept-dependency graph from the crosslinks and its transitive closure (Armstrong transitivity) — what a Concept rests on directly and what it inherits through a chain
  - the strongest inferred dependency also surfaces as an advisory **hint** in the linter and VS Code, under the same `V = 0` gate as the FCA/clash suggestions, never counted in `V`

## [1.1.42] - 2026-06-20

- Gödel numbering (`src/godel.js`): a second characteristic number `G(n)` that encodes a line's **content**, complementing `chi`, which encodes only its **ancestry**. One prime per attribute, raised to a power that encodes the value — exponent 0 absent, 1 present-but-unvalued, ≥2 a stable value code — so a line becomes an integer like `2³ × 3⁵ × 5²`. chi answers *where* a line sits, G answers *what* it says, both as plain big-integer arithmetic
  - `verify.js --godel X`: prints the factorisation `prime^exponent * …` with a legend decoding each slot back to `attribute: value`
  - `--clashes`: two unrelated Concepts/Examples that carry the same attribute **names** (equal radicals) or the same attributes **and** values (equal `G`), reported as separate strengths
  - `--overrides`: every node that redeclares an inherited default with a new value — detected arithmetically as two p-adic valuations both ≥ 2 and unequal
  - `--diff old.aot new.aot`: version-diffing as factorisation comparison over a shared prime/value table — a prime gained or lost is an attribute added or removed, a changed exponent is a changed value
  - the strong, content-identical clash also surfaces as an advisory **hint** in the linter and VS Code (no squiggle, under the same `V = 0` gate as the FCA suggestions, never counted in `V`); the weaker same-names clash stays on demand via `--clashes`
  - the feature universe and the override-aware "nearest value wins" walk mirror `fca.buildContext`, so `G` and the FCA context agree on what a node carries

## [1.1.22] - 2026-06-12

- Child-count rule corrected: at most eight sub-Concepts per parent (a division into more kinds is not graspable at a glance); Individuals and attributes may come in any quantity — the old "no more than twelve children" warning counted everything

## [1.1.21] - 2026-06-12

- `proposed` findings over a bare attribute now offer the promotion remedy explicitly: declare the attribute under the nearest Concept itself, making it essential, when every one of its Individuals should carry it

## [1.1.20] - 2026-06-12

- FCA respects Maps: a `...` child marks a node intentionally incomplete (the linter's existing convention), so it is exempt from `differentia`, indistinguishable-siblings, and incomplete-division findings — what is missing is declared, not forgotten

## [1.1.19] - 2026-06-12

- FCA suggestions now explain themselves: every finding states the evidence, what it means, and the choice it puts to the modeller
  - `proposed` distinguishes a real candidate kind ("name a Concept for it under 'X', or ignore it") from an inheritance echo ("they only inherit this from their parents — name or promote it at that level, not here")
  - `drift` says what to do: move the Individual, or give the Concept a differentia that genuinely excludes it
  - new `differentia` finding replaces vacuous drift: a Concept whose Individuals share nothing beyond its ancestor's is grouped by position only, and the data cannot check the split
  - long member lists are capped at six with "… and N more"

## [1.1.18] - 2026-06-12

- `verify.js --suggest`: Formal Concept Analysis (after Wille) audits the hand-written tree against the concept lattice the Individuals' attributes support
  - the formal context's objects are the Individuals; its columns are attribute names and `attribute: value` pairs, inherited down the tree with the nearest declaration winning
  - crosslinks deepen the columns: a value naming an Individual elsewhere in the file also contributes that Individual's ancestry (`operation: Ratio` with Ratio filed under Formula > Arithmetic yields `operation: Formula` too), and an attribute whose trailing words name a Concept contributes that Concept (`age integer` yields `integer`)
  - reports: `confirmed` (a Concept's Individuals are exactly a formal concept), `proposed` (a grouping the data supports that no Concept names), `drift` (an Individual sharing a Concept's full intent but filed elsewhere), `exhaustion` (sub-Concepts that fail to cover, or to be distinguishable over, the parent's Individuals)
  - advisory: always exits 0 on a parseable file; suggestions are counted as `S`, not violations
- VS Code: the FCA suggestions appear in the Problems panel as information diagnostics (blue ⓘ), refreshed as you type — only when the file otherwise verifies (V = 0) and has at most 200 Individuals

## [1.1.14] - 2026-06-11

- Crosslinks: the two inline connections are now highlighted as links and navigable
  - `attribute-is-a-Concept`: an attribute's (or default's) trailing words matching a Concept name are underlined in the link colour, with the defining line shown on hover
  - `default-is-a-Individual`: a default value exactly matching an Individual name is underlined likewise
  - Ctrl+click (Go to Definition) on either jumps to the defining node's line

## [1.1.0] - 2026-06-10

- Linter: `.aot` files are now verified arithmetically (after Leibniz) as you type, with findings shown as squiggles and in the Problems panel
  - errors: tabs, indent not a multiple of 4, depth jumps, Maps with children, a Concept defined twice (univocity), identical siblings
  - warnings: a parent with exactly one child, a parent with more than twelve children
- `verify.js` command line: `node verify.js <file.aot>`, plus `--ask X Y` (is-a by divisibility), `--genus X Y` (genus by gcd), `--number X` (characteristic number)

## [Unreleased]

- Initial release