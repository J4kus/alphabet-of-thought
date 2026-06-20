# Change Log

All notable changes to the "aot" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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