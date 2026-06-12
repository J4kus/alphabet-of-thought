# TODO

## Theoretical upgrades (from Claude discussion)
- [ ] Gödel numbering — encode the whole line, not just the ancestry: primes raised to powers so the characteristic number also encodes which attributes/values are set (e.g. 2³ × 3⁵ × 5² …). Tooling-only change in `verify.js` (big-integers); buys arithmetic queries like "find all Individuals that override the parent default" and version-diffing as factorisation comparison
- [x] Lattice theory / Formal Concept Analysis — derive the tree instead of writing it: a `--suggest` CLI mode that takes the Individuals + attributes as FCA input, computes the concept lattice, and audits the hand-written tree against it (proposes Concepts you haven't named; makes the exhaustion test checkable: a partition is valid iff the children's attribute sets cover the parent's extent)
- [x] Make `--suggest` crosslink-aware: expand crosslinked values into their ancestry via src/crosslinks.js (e.g. `measurement operation used: Ratio` also yields the `Formula` column, since Ratio sits under Formula in the Measurement schema), and attribute names ending in a Concept contribute that Concept as a column
- [ ] Make `--suggest` primitive-aware: decide how the primitives' own Concept trees (Beneficiary, Measurement, …) enter the formal context when they live outside the modelled file (a `--schema <file.aot>` flag? bundled primitive definitions?) — without one, FCA judges Beneficiary Concepts like Subject/Audience by Measurement columns, a said-of category mistake
- [ ] Description logics — from declared facts to inferred ones: allow Concepts to carry conjunction-only definitions over attributes and other Concepts, then replace the divisibility check with a subsumption reasoner that derives the hierarchy and proves it consistent (catches misfiled Concepts, e.g. Whale ⊑ Mammal). Keep prime numbers as a cache of the reasoner's output; preserve the single-file plain-text ethos
- [ ] Curry–Howard / type theory — make the Function tree executable: a specification is a type, an implementation a proof. Attach argument/result attributes to each objective so a parent objective is a product type of its children; verify children's outputs compose into the parent's claimed result; generate test skeletons / interface stubs from a `.aot` Function tree. Needs a minimal type vocabulary (`data type` subtree under Measurement) and a rule that sibling objectives declare what they consume and produce
- [ ] Embeddings — the fuzzy assistant around the exact core (tooling only, nothing in the language): catch synonym violations (flag `client` and `customer` appearing as different Concepts), suggest placement when writing a new Individual (propose nearest existing parent), and power the AI-extends-the-model workflow where the LLM drafts by similarity and the prime linter referees exactly
- [ ] Epistemics via reserved attributes — make `confidence`, `status` (proposed / contested / accepted / deprecated), and `source` reserved attributes the tooling understands: `--ask` returns qualified answers ("yes, at confidence 0.6, contested"), confidence propagates down inheritance by multiplication, and `--list contested` becomes a meeting-agenda generator

## Language / spec
- [ ] Add the `Allow` attribute (it is unclear)
- [ ] All attributes have a has-a relationshio with more attributes for metadata and complex composite concepts directly in the attribute
- [ ] Allow negation inside the language
- [ ] Do not use maps for extra info; use aliases instead
- [ ] See if "Timing" and "domain" are still part of the language — remove or re-document accordingly
- [ ] See if the CLI/linter can do extra arithmetic (beyond `--ask`, `--genus`, `--number`)

## Linter / diagnostics
- [ ] Exclude words ending in "us" from plural detection
- [ ] Make example/value matching not capitalisation-specific 
- [ ] `default-is-a-Individual` now requires the Individual to instantiate the attribute being valued: some ancestor of the Individual must carry the attribute's name (or a trailing run of its words, the alias rule). `exponent: 1` no longer links to an unrelated `- 1` filed under another attribute; the same guard applies to the FCA value-ancestry expansion
- [x] Enforce a sub-Concept cap per parent (landed as: at most eight sub-Concepts; Individuals and attributes unlimited — replaces the old twelve-children-of-any-kind warning)
- [ ] Detect same words used in a Concept that are not part of the same tree
- [ ] Reword the "Concept defined twice" diagnostic (say something more useful instead)
- [ ] Show how far an idea is on the dependency tree (depth indicator)

## Editor / highlighting (VS Code extension)
- [ ] Highlight when the last words of a line are part of another Concept
- [ ] Highlight when part of a Concept matches (partial matches, not just full)
- [ ] Colour aliases differently from other tokens
- [ ] Investigate: why is the same colour term highlighted in different ways? [?]

## Docs / README
- [ ] Use links on examples (make examples clickable / link to defining lines or files)
- [ ] Remove AI-generated tells from the prose
- [ ] Add a Parent → Child example
- [ ] Explain "jumbled up causes" generally (instead of case-by-case)
- [ ] Explain modeling intention using the four primitives [?]
- [ ] Work in: "All knowledge will straddle several of the primitives — if you don't produce them all, you're not an expert."
- [ ] Phrase explanations as "what happens" rather than "explanation of what happens"
- [ ] Page 2 (clarify scope: second page of docs?)
