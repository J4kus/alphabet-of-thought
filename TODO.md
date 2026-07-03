# TODO

## Theoretical upgrades (from Claude discussion)

- [ X ] Description logics — from declared facts to inferred ones: allow Concepts to carry conjunction-only definitions over attributes and other Concepts, then replace the divisibility check with a subsumption reasoner that derives the hierarchy and proves it consistent (catches misfiled Concepts, e.g. Whale ⊑ Mammal). Keep prime numbers as a cache of the reasoner's output; preserve the single-file plain-text ethos
    - [x] First version in the linter (`src/subsumption.js`): each Concept's definition is derived, no new syntax, from the attributes and Concepts it declares; a subsumption reasoner audits the written tree and warns on misfiled Concepts (Whale ⊑ Mammal) and equivalent definitions. Runs in the default lint pass as warnings, so primes still cache the written tree
    - [x] Replace the divisibility/single-inheritance check outright with the reasoner: the tautological `gcd` sibling check is gone, findings are now errors counted in V (misfiling, two kinds under one name, equivalence, cycle), `name: value` refinements are folded in (literal pairs, value-ancestry expansion, and override-aware inheritance where a child's `: hot` shadows an ancestor's `: cold`), and `verify.js` prints a consistency verdict. Primes stay as the cache the reasoner clears
- [x] Gödel numbering — encode the whole line, not just the ancestry: primes raised to powers so the characteristic number also encodes which attributes/values are set (e.g. 2³ × 3⁵ × 5² …). Tooling-only change in `verify.js` (big-integers); buys arithmetic queries like "find all Examples that override the parent default" and version-diffing as factorisation comparison. Make a list of all of the things it can do in alpha. I can think of checking that two examples or concepts do not carry the same attributes or attribute values
    - [x] Landed in `src/godel.js`: a second characteristic number `G(n)` complementary to `chi` — one prime per attribute, the exponent encoding the value (1 = present/unvalued, ≥2 = a value code). chi answers "where", G answers "what". CLI: `--godel X` prints the factorisation + legend, `--clashes` reports two nodes carrying the same attributes (same radical) or the same attributes-and-values (G equal, reported separately), `--overrides` lists nodes redeclaring an inherited default, `--diff old.aot new.aot` is version-diffing as factorisation comparison. The strong content-identical clash also surfaces as an advisory hint in the linter (no squiggle, never counted in V). The full capability list is the "Gödel numbering" table in the README
    - [ ] Add a diff in version checker is some whay
- [x] Lattice theory / Formal Concept Analysis — derive the tree instead of writing it: a `--suggest` CLI mode that takes the Examples + attributes as FCA input, computes the concept lattice, and audits the hand-written tree against it (proposes Concepts you haven't named; makes the exhaustion test checkable: a partition is valid iff the children's attribute sets cover the parent's extent)
- [x] Make `--suggest` crosslink-aware: expand crosslinked values into their ancestry via src/crosslinks.js (e.g. `measurement operation used: Ratio` also yields the `Formula` column, since Ratio sits under Formula in the Measurement schema), and attribute names ending in a Concept contribute that Concept as a column
- [ ] Make `--suggest` primitive-aware: decide how the primitives' own Concept trees (Beneficiary, Measurement, …) enter the formal context when they live outside the modelled file (a `--schema <file.aot>` flag? bundled primitive definitions?) — without one, FCA judges Beneficiary Concepts like Subject/Audience by Measurement columns, a said-of category mistake
- [ ] Curry–Howard / type theory — make the Function tree executable: a specification is a type, an implementation a proof. Attach argument/result attributes to each objective so a parent objective is a product type of its children; verify children's outputs compose into the parent's claimed result; generate test skeletons / interface stubs from a `.aot` Function tree. Needs a minimal type vocabulary (`data type` subtree under Measurement) and a rule that sibling objectives declare what they consume and produce
- [ ] Embeddings — the fuzzy assistant around the exact core (tooling only, nothing in the language): catch synonym violations (flag `client` and `customer` appearing as different Concepts), suggest placement when writing a new Example (propose nearest existing parent), and power the AI-extends-the-model workflow where the LLM drafts by similarity and the prime linter referees exactly
- [ ] Epistemics via reserved attributes — make `confidence`, `status` (proposed / contested / accepted / deprecated), and `source` reserved attributes the tooling understands: `--ask` returns qualified answers ("yes, at confidence 0.6, contested"), confidence propagates down inheritance by multiplication, and `--list contested` becomes a meeting-agenda generator
- [x] Make Armstrong's Axioms (Dependency Inference) part of the linter and not only a discussion — `src/armstrong.js`: `--fd` infers functional dependencies from the Examples via Gödel projections (with a derivability/redundancy hint), `--depends` walks the declared Concept-dependency closure (transitivity). See the [Armstrong's axioms](README.md#armstrongs-axioms-dependency-inference) section of the README.
#### Armstrong's Axioms (Dependency Inference)

| Rule | In Alpha Terms |
|------|----------------|
| Reflexivity | A Concept determines any subset of its own attributes |
| Augmentation | Adding an attribute to a Concept referencing another Concept preserves a dependency |
| Transitivity | If Concept Z depends on Concept Y and Concept Y depends on Concept X, then Concept Z depends on Concept X |
| Union | Multiple dependencies from same source combine into one |
| Decomposition | A composite dependency breaks into Example parts |
| Pseudotransitivity | A transitive chain extends by adding context to bridge a gap |

```aot
X
Y
    X
Z
    Y
    ... Z is transitively dependent on X (through Y)
```
[ ] Explain in the readme how to write in Alpha
- Model data as sets of facts
- Each Concept = one record type with a fixed number of attributes
- Non-nullable attributes listed first; attribute order otherwise meaningless
- A relational attribute referencing another Concept uses that Concept's name (lowercase)
- No many-to-many relations on attributes; use Event Associations
- Identify functional dependencies between attributes
- Use subset data to clarify scope
- Use aliases to describe Concepts
- Final names must be implementable
- Prioritise Concepts by relevance
- Create parent Concepts to group related children
- Look for likenesses and differences to form general structures
- Remove attributes that do not serve the model

## Language / spec
- [ ] Allow highlighting across all aot files in repo or local filesystem
- [x] ~~Remove the tables from the language (rather use links)~~ — decided the other way: tables grew into org-style spreadsheets (a header row + `|---|` separator declares the columns as attributes, each data row is an Example, each cell an Attribute Value; Format Document aligns the columns). See README → Tables
- [ ] All attributes have a has-a relationshio with more attributes for metadata and complex composite concepts directly in the attribute
- [ ] Allow negation inside the language (it is already with ~)
- [ ] Do not use maps for extra info; use aliases instead
- [ ] See if "Timing" and "domain" are still part of the language — remove or re-document accordingly
- [ ] See if the CLI/linter can do extra arithmetic (beyond `--ask`, `--genus`, `--number`)
- [ ] Re-add the `verify.js` command-line front-end (deleted to declutter). It wrapped the shared `src/` modules — nothing else imports it, so the extension is unaffected. Restore the whole-file check (`node verify.js <file>` with a `V = 0` verdict and exit code) plus the flags: `--ask X Y`, `--genus X Y`, `--number X`, `--godel X`, `--clashes`, `--overrides`, `--find "a: v"`, `--common X Y`, `--near X`, `--fd`, `--depends X`, `--diff old new`, `--suggest`. Two views are CLI-exclusive (not in the editor): `--suggest`'s `confirmed` line, and the on-demand `--fd` full set / `--clashes` weak same-name case. NOTE: the query helpers only `verify.js` used were removed from the shared modules too, so they must be restored alongside it — in `godel.js`: `overrides`, `diff` (+`pathOf`), `find`, `common`, `near`, `decode`, `decodeNumber`, `valueOfCode`, `distance`; in `armstrong.js`: `dependsOf`, `dependencyGraph`, `containedConcepts`, `conceptOf` (the last two need the `index`/`wordStarts` crosslinks import back). Their smoke tests were trimmed from `out/test-godel.js` and `out/test-armstrong.js` as well. The README's CLI docs were removed; CHANGELOG.md and this file (the restore plan below) still describe it, so restoring will need the README docs re-added too
Flag	What goes away
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

### Functionality currently gone (with `verify.js` deleted)

Detail behind the restore item above. Split by whether anything still provides it.

**Fully gone — no editor equivalent, these were CLI-only:**
- [ ] Whole-file pass/fail with a `V = 0` verdict and exit code — the scriptable CI gate / "objective referee" for AI-assisted edits
- [ ] `--ask X Y` — is-a test by divisibility
- [ ] `--genus X Y` — nearest common kind via gcd
- [ ] `--number X` — characteristic number as a prime product
- [ ] `--godel X` — Gödel factorisation with attribute/value legend
- [ ] `--overrides` — nodes overriding an inherited default
- [ ] `--find "a: v"` — search ideas by attribute/value
- [ ] `--common X Y` — shared attribute core of two ideas
- [ ] `--near X` — nearest ideas by content distance
- [ ] `--diff old new` — version diff as factorisation comparison
- [ ] `--depends X` — direct + transitive Concept dependencies
- [ ] `--suggest` `confirmed` report — positive FCA groupings the data supports exactly (advisory)
- [ ] `--fd` full set — every inferred dependency, including low-confidence / covariation-only ones
- [ ] `--clashes` weak case — same-attribute-name (equal radical, differing value) clashes

**Still available — runs automatically in the VS Code extension, just no CLI:**
- Syntactic and subsumption errors and warnings (rules 1–14)
- FCA drift and exhaustion errors (rules 15–17)
- The strong content clash error (rule 18)
- Confident, complete dependency warnings (rules 8–9)

## Linter / diagnostics
- [X] Exclude words ending in "us" from plural detection
- [ ] Make example/value matching not capitalisation-specific 
- [ ] `default-is-a-Example` now requires the Example to instantiate the attribute being valued: some ancestor of the Example must carry the attribute's name (or a trailing run of its words, the alias rule). `exponent: 1` no longer links to an unrelated `- 1` filed under another attribute; the same guard applies to the FCA value-ancestry expansion... Example value matching should only be allowed if the example is one that is the same concept as the one defined (need to carry the highlighting in the file even if it is partial)
- [x] Enforce a sub-Concept cap per parent (landed as: at most eight sub-Concepts; Examples and attributes unlimited — replaces the old twelve-children-of-any-kind warning)
- [ ] Detect same words used in a Concept that are not part of the same tree
- [ ] Reword the "Concept defined twice" diagnostic (say something more useful instead)
- [ ] Show how far an idea is on the dependency tree (depth indicator)

## Editor / highlighting (VS Code extension)
- [X] Highlight when the last words of a line are part of another Concept
- [X] Highlight when part of a Concept matches (partial matches, not just full)
- [ ] Colour aliases differently from other tokens
- [X] Investigate: why is the same colour term highlighted in different ways? [?]

## Docs / README
- [X] Use links on examples (make examples clickable / link to defining lines or files)
- [ ] Remove AI-generated tells from the prose
- [ ] Add a Parent → Child example
- [ ] Explain "jumbled up causes" generally (instead of case-by-case)
- [ ] Explain modeling intention using the four primitives [?]
- [ ] Work in: "All knowledge will straddle several of the primitives — if you don't produce them all, you're not an expert."
- [ ] Phrase explanations as "what happens" rather than "explanation of what happens"