# TODO

## Theoretical upgrades (from Claude discussion)


- [ ] Make `--suggest` rationale-aware: decide how the rationales' own Concept trees (Beneficiary, Measurement, …) enter the formal context when they live outside the modelled file (a `--schema <file.aot>` flag? bundled rationale definitions?) — without one, FCA judges Beneficiary Concepts like Subject/Audience by Measurement columns, a said-of category mistake
- [ ] Curry–Howard / type theory — make the Function tree executable: a specification is a type, an implementation a proof. Attach argument/result attributes to each objective so a parent objective is a product type of its children; verify children's outputs compose into the parent's claimed result; generate test skeletons / interface stubs from a `.aot` Function tree. Needs a minimal type vocabulary (`data type` subtree under Measurement) and a rule that sibling objectives declare what they consume and produce
- [ ] Embeddings — the fuzzy assistant around the exact core (tooling only, nothing in the language): catch synonym violations (flag `client` and `customer` appearing as different Concepts), suggest placement when writing a new Example (propose nearest existing parent), and power the AI-extends-the-model workflow where the LLM drafts by similarity and the prime linter referees exactly
- [ ] Epistemics via reserved attributes — make `confidence`, `status` (proposed / contested / accepted / deprecated), and `source` reserved attributes the tooling understands: `--ask` returns qualified answers ("yes, at confidence 0.6, contested"), confidence propagates down inheritance by multiplication, and `--list contested` becomes a meeting-agenda generator
- [ ] Make all of Armstrong's Axioms part of the linter as far as pssible and not only a discussion — `src/armstrong.js`: `--fd` infers functional dependencies from the Examples via Gödel projections (with a derivability/redundancy hint),

- [x] Generalise table calculations and csv saving — **done 2026-07-12 (1.2.0)**: formulas/constraints on any attribute value (`src/derive.js`), named `$column` and `$col@Row` references, string functions, `count/round/abs/if`, comparisons; CSVs now live in `tables.<file>` with auto-migration and orphan cleanup on save
- [x] make tabs better to use for tables — **done 2026-07-12 (1.2.0)**: Tab/Shift+Tab in the leading indent indent/unindent the whole table; typing `|` on an empty line scaffolds header+separator+data row with the cursor placed; tables render aligned with no gutter spaces

- [ ] Explain in the readme how to write in Alpha
- [ ] add a rule that there are not a many to many relationship. No many-to-many relations on attributes; use Event Associations


## Language / spec
- [ ] Allow Ordered Numbers as Examples
- [ ] Allow hiding of data
- [ ] Allow highlighting across all aot files in repo or local filesystem
- [ ] Make sure the first column values are the same colour as examples and fill in a incremental number if there is no other value
- [ ] All attributes have a has-a relationshio with more attributes for metadata and complex composite concepts directly in the attribute
- [ ] Allow negation inside the language (it is already with ~)
- [ ] Do not use maps for extra info; use aliases instead
- [ ] See if "Timing" and "domain" are still part of the language — remove or re-document accordingly
- [ ] See if the CLI/linter can do extra arithmetic (beyond `--ask`, `--genus`, `--number`)
- [x] Re-add the `verify.js` command-line front-end — **restored 2026-07-06**: `verify.js` is back with all flags; the trimmed helpers were restored verbatim in `godel.js` (`overrides`, `diff`+`pathOf`, `find`, `common`, `near`, `decode`, `decodeNumber`, `valueOfCode`, `distance`) and `armstrong.js` (`dependsOf`, `dependencyGraph`, `containedConcepts`, `conceptOf`, with the `index`/`wordStarts` crosslinks import); the trimmed smoke tests are back in `out/test-godel.js` and `out/test-armstrong.js`; the README's CLI docs were re-added ("The command line" section). The default pass was reconciled with today's editor: table formula errors now count in `V` and dependency warnings apply the editor's confidence/incompleteness filter (`--fd` still shows the full set)
Flag	What it does
node verify.js <file>	Whole-file check with a V = 0 verdict + exit code (0 = verifies) — the "objective referee" the README leans on for AI-assisted edits
--ask X Y	Is-a test by divisibility
--genus X Y	Nearest common kind via gcd
--number X	Characteristic number as a prime product
--godel X	Gödel factorisation with attribute/value legend
--clashes	Both strengths of clash (editor shows only the strong content clash)
--overrides	Nodes overriding an inherited default
--find "a: v"	Search ideas by attribute/value
--common X Y	Shared attribute core of two ideas
--near X	Nearest ideas by content distance
--fd	Full set of inferred functional dependencies (editor flags only the confident/complete ones)
--depends X	Direct + transitive Concept dependencies
--diff old new	Version diff as factorisation comparison
--suggest	FCA audit + the positive confirmed report (only surfaced here, not in the editor)

## Linter / diagnostics
- [x] Example linking may only be to Examples of Concepts, not Examples of attributes — **done 2026-07-30**: `default-is-a-Example` and `example-is-a-Example` now require the attribute (or its alias) to name a Concept, and the target to be an Example *of that Concept*. The walk up from the target may pass through Examples and narrower Concepts only; an attribute on the way stops it, so one frame's `allow special value override: Ellipsis` no longer reaches another frame's `- Ellipsis`
- [x] Make example/value matching not capitalisation-specific — **done 2026-07-12 (1.2.0)**: all Example links resolve case-insensitively (crosslinks, FCA, subsumption); case-only twin Examples warn
- [x] `default-is-a-Example` value matching is allowed only when the Example is one of the Concept the attribute names — **done 2026-07-30** (see above). The attribute-name ancestry route is gone: an attribute that names no Concept states no vocabulary, so its values link to nothing. The FCA / subsumption value-ancestry expansion still walks by attribute name (a reasoner's generalisation, not a navigable link) — revisit if the two should agree
- [ ] Reword the "Concept defined twice" diagnostic (say something more useful instead)
- [ ] Have a javascript file that can highlight wording differences
- [ ] Show how far an Concept is on the dependency tree (depth indicator) when you hover over it

## Editor / highlighting (VS Code extension)
- [ ] Colour aliases differently from other tokens



# Implement Armstrong's Axioms as fully as possible

## Context

The TODO's table maps Armstrong's six axioms (Reflexivity, Augmentation, Transitivity, Union, Decomposition, Pseudotransitivity) to Alpha terms, but reconciliation showed **none are implemented as inference rules**: `src/armstrong.js` only *mines* single-attribute FDs from Example data, and the one mechanized axiom (Transitivity, as the declared Concept-dependency closure behind the old CLI's `--depends`) was deleted in commit `1b58c33` ("refactor: declutter") along with `verify.js`. This plan makes all six axioms real. User decisions: restore the declared-dependency closure **plus an editor hover surface** (no CLI restore); mine **composite two-attribute determinants** (gives Augmentation/Decomposition/Pseudotransitivity material, enables candidate-key discovery); report via **minimal cover** (suppress derivable FDs, group by determinant).

Everything stays advisory (never counted in `V`), pure CommonJS, no new dependencies. The deleted code is recoverable verbatim from `git show 1b58c33^:src/armstrong.js` and `git show 1b58c33^:out/test-armstrong.js`.

## Step 1 — `src/armstrong.js`: restore + generalize (keep existing exports working)

**1a. Restore declared-dependency machinery** (verbatim from `1b58c33^`): `conceptOf`, `containedConcepts`, `dependencyGraph`, `dependsOf`. Requires re-adding `const { index, wordStarts } = require("./crosslinks")` (both still exported at `crosslinks.js:268`) and `CONCEPT` in the KIND destructure. `dependsOf(root, nodes, concept)` returns `{ direct: [node], transitive: [{ node, through: [node] }] }` — Armstrong Transitivity at the Concept level.

**1b. FD representation**: holds become `{ lhs: [sortedAttrKeys] (len 1–2), rhs: attrKey, x, y, support, confirms, incomplete }` where `x`/`y` are back-compat aliases (`x = lhs.length===1 ? lhs[0] : undefined`, `y = rhs`) so existing tests (`out/test-armstrong.js`, `out/test-linter.js:306`) keep passing. Dedup key: join lhs with `"\n"` (attr keys are multi-word, never multi-line).

**1c. Pair mining** in `inferFDs`: factor the group-check into a shared `mine(lhsKeys, yKey, …)` helper (group Examples by lhs code-tuple, check y constant per group). Singleton pass unchanged semantically; build `determinedBy: Map(y -> Set(x))` while emitting. Pair pass, for each unordered attr pair `{a,b}` and each other `y`:
- **Augmentation-prune**: skip if `a` or `b` alone already determines `y`
- support ≥ `MIN_SUPPORT` (3) on Examples valued on all three; pre-check the `a∩b` intersection before the y-loop
- variation guards: y ≥ 2 codes, the tuple ≥ 2 values, **and each of a, b individually ≥ 2 codes** (else it's a disguised singleton with an extraneous attribute)
- **pair key-guard**: tuple distinct on every Example ⇒ skip unconditionally (no bijection exception — a real `{a,b}↔y` implies `y→a`, `y→b`, which the singleton pass reports)
- `confirms = support − distinctTuples`; `incomplete` as today (ellipsis-marked parents)

Complexity: O(A³·N) worst case; fine at the existing gates (N ≤ 200 via `MAX_FCA_OBJECTS`, few dozen attrs), and the prunes cut most of it. State this in a comment.

**1d. `closure(attrs, fds)`** — attribute-set closure X⁺, the sound-and-complete embodiment of all six axioms: seed with X (Reflexivity), fixpoint-fire every fd whose lhs ⊆ set (Augmentation/Transitivity/Pseudotransitivity via chaining; Union/Decomposition free since rhs is atomic). Naive loop is fine at this scale.

**1e. `minimalCover(fds)`** (returns a new array):
1. *Left-reduction* (Reflexivity/Augmentation): for 2-attr lhs, if `closure(lhs∖{a}, fds)` contains rhs, reduce to the singleton (dedupe via key, keep higher confirms / less incomplete).
2. *Redundancy elimination* (Transitivity/Pseudotransitivity): weakest-first (ascending confirms, incomplete first), drop `f` if `closure(f.lhs, rest)` contains `f.rhs` — where `rest` excludes `f` **and** (evidence guard) any `g` with `g.confirms < min(f.confirms, MIN_CONFIDENCE)` or `g.incomplete && !f.incomplete`. This guarantees an editor-grade squiggle is never suppressed in favour of sub-threshold/incomplete chains.

**1f. `findings(root, nodes)` rework**:
1. Equivalence pass first, over the **raw** singleton holds (current `byPair` logic, messages unchanged — `covaries` + equivalence `derivable`), recording reported pairs; this guarantees the "same distinction written twice" message survives the cover.
2. `minimalCover(holds)`, skip members already reported as equivalences.
3. **Union grouping** by determinant: editor-grade members (confirms ≥ `MIN_CONFIDENCE` && !incomplete) sharing a determinant merge into one finding — `kind: "derivable"`, `confidence = min(members)`, `line = max(lineOf(rhs))`, message `dependency: 'country' determines 'currency' and 'dialing code' — …` (single-member groups keep the **current one-way message verbatim**, so `out/test-linter.js:306` passes untouched). Composite-lhs findings get a new message: `'price' looks derivable from 'brand' and 'model' together — … while neither alone determines it …`. Weak members emit individually with today's messages (filtered from the editor at `extension.js:48` as before).
4. Finding shape stays `{ line, kind, confidence, incomplete, message }` — **no change to `extension.js:48`'s filter**.

**1g. `candidateKeys(root, nodes)`** — hover-only, **not** a finding (a key is descriptive, not a fixable redundancy; it has no natural confidence for the filter). Per Example table (parent with ≥ 3 godel-numbered INDIVIDUAL children): fully-populated columns only; singleton keys = all-distinct codes; pair keys = all-distinct tuples with neither member already a key (minimality). Returns `Map(parentNode -> [[attrKey,…],…])`. Factor the `valuedOn` builder out of `inferFDs` for reuse.

**1h. Exports**: add `closure, minimalCover, candidateKeys, dependsOf, dependencyGraph, containedConcepts, conceptOf` to the existing three.

**1i. Header comment**: rewrite lines 1–21 (currently says the module does NOT apply the axioms) — it now does: closure = all six axioms; mining = singleton + pairs with the Augmentation-prune; findings = minimal cover (left-reduction, redundancy drop) + Union grouping, atomic rhs = Decomposition; `dependsOf` restored, surfaced as the Concept hover. Keep the "advisory, never counted in V; pure" paragraph, add `./crosslinks` to the dependency list.

## Step 2 — `src/extension.js`: Concept hover

- Extend the cache at line 22: `linksByDoc` → `analysisByDoc = new Map(); // uri -> { links, root, nodes, clean }`; update touchpoints at lines 28, 74, 120, 333. Hover reuses the last analysis — never re-lints per hover.
- New `hoverProvider` next to `definitionProvider` (line 118): on a line whose node is `kind === KIND.CONCEPT` (`n.line === position.line + 1`), build a `vscode.MarkdownString` from `armstrong.dependsOf(root, nodes, node)` — direct deps, then transitive as `` `X` (via `Y` → `Z`) `` — plus, when `cached.clean` and the Concept's Example count is within the 2–200 gate, its `candidateKeys` (recomputing buildGodel on demand is milliseconds; comment it). Return `null` when there's nothing to show. Coexists with decoration `hoverMessage`s (VS Code stacks hovers).
- Register in `activate()` beside line 338: `vscode.languages.registerHoverProvider({ language: "aot" }, hoverProvider)`.

## Step 3 — Tests (plain Node scripts, no framework)

- **`out/test-armstrong.js`**: restore the deleted `dependsOf`/`dependencyGraph` fixture verbatim (`git show 1b58c33^:out/test-armstrong.js`). New fixtures: transitive chain city→country→currency (mined `city→currency` exists in `.holds` but **no finding** pairs city with currency — cover suppresses it, plain suppression, no chain narration); Union grouping (exactly one `/'country' determines/` finding containing both dependents, confidence = min); composite pair (brand+model→price where neither alone works); pair key-guard (all-distinct tuple determines nothing); Augmentation-prune (no 2-attr lhs containing country with rhs currency); candidateKeys (code unique, brand+model unique, minimality).
- **`out/test-extension.js`**: extend the vscode mock (near line 32) with `registerHoverProvider`, `Hover`, `MarkdownString` stubs — **required in the same change as Step 2 or `activate()` crashes the smoke test**. Add a hover smoke check (provideHover on a Concept line → markdown mentions direct + transitive deps). The line-137 assertion (`/^dependency:/` among warnings for `examples/alphabet of thought.aot`) must still pass — grouped messages keep the prefix; if that file's warning set changes shape, inspect what merged vs. vanished before touching the assertion.
- **`out/test-linter.js`**: no edits expected; its `/determines 'currency'/` and covariation regexes are preserved by the verbatim single-member message path.

## Step 4 — Docs

- **README.md** (recently rewritten — locate by heading, not line number): section `Armstrong's axioms (dependency inference)` — the axioms are now applied: name which axiom does what (per 1f/1e); add composite determinants and candidate keys to the "Inferred from the Examples" paragraph; rewrite the "Declared by the Concept references" paragraph (no longer "currently gone" — restored, surfaced as the Concept hover; CLI itself still deleted per TODO). Mention the hover in the tooling section's dependency-inference bullet.
- **TODO.md** — *optional/careful: the user's buffer may hold unsaved edits.* If touched: note in the line-37 restore item that armstrong.js's four helpers are back (only godel.js helpers remain for verify.js), and move `--depends X` from "Fully gone" to "Still available (as the Concept hover)".

## Verification

```
node out/test-armstrong.js
node out/test-linter.js
node out/test-extension.js
node out/test-godel.js
node out/test-fca.js
node out/test-table.js
```

All must exit 0 / print PASS. Manual: `code --extensionDevelopmentPath=. examples`, open `examples/alphabet of thought.aot` (dependency warnings still squiggle, now grouped per determinant), hover a Concept whose attributes reference other Concepts (direct + through-chain list), hover a table's parent Concept in `examples/spreadsheet.aot` (candidate keys), Ctrl+click a crosslink (DefinitionProvider still works off the renamed cache).

## Implementation order

1. Restore the four dependency functions + exports + restored smoke test (green suite, no behavior change).
2. Mining/closure/cover/findings/candidateKeys + header comment + new armstrong tests.
3. Hover provider + cache rename + test-extension mock update, together.
4. Docs.
