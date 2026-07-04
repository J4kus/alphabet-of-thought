# TODO

## Theoretical upgrades (from Claude discussion)


- [ ] Make `--suggest` primitive-aware: decide how the primitives' own Concept trees (Beneficiary, Measurement, …) enter the formal context when they live outside the modelled file (a `--schema <file.aot>` flag? bundled primitive definitions?) — without one, FCA judges Beneficiary Concepts like Subject/Audience by Measurement columns, a said-of category mistake
- [ ] Curry–Howard / type theory — make the Function tree executable: a specification is a type, an implementation a proof. Attach argument/result attributes to each objective so a parent objective is a product type of its children; verify children's outputs compose into the parent's claimed result; generate test skeletons / interface stubs from a `.aot` Function tree. Needs a minimal type vocabulary (`data type` subtree under Measurement) and a rule that sibling objectives declare what they consume and produce
- [ ] Embeddings — the fuzzy assistant around the exact core (tooling only, nothing in the language): catch synonym violations (flag `client` and `customer` appearing as different Concepts), suggest placement when writing a new Example (propose nearest existing parent), and power the AI-extends-the-model workflow where the LLM drafts by similarity and the prime linter referees exactly
- [ ] Epistemics via reserved attributes — make `confidence`, `status` (proposed / contested / accepted / deprecated), and `source` reserved attributes the tooling understands: `--ask` returns qualified answers ("yes, at confidence 0.6, contested"), confidence propagates down inheritance by multiplication, and `--list contested` becomes a meeting-agenda generator
- [ ] Make all of Armstrong's Axioms part of the linter as far as pssible and not only a discussion — `src/armstrong.js`: `--fd` infers functional dependencies from the Examples via Gödel projections (with a derivability/redundancy hint),

- [ ] Generalise table calculations and csv saving
- [ ] make tabs better to use for tables

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

## Linter / diagnostics
- [ ] Make example/value matching not capitalisation-specific 
- [ ] `default-is-a-Example` now requires the Example to instantiate the attribute being valued: some ancestor of the Example must carry the attribute's name (or a trailing run of its words, the alias rule). `exponent: 1` no longer links to an unrelated `- 1` filed under another attribute; the same guard applies to the FCA value-ancestry expansion... Example value matching should only be allowed if the example is one that is the same concept as the one defined (need to carry the highlighting in the file even if it is partial)
- [ ] Reword the "Concept defined twice" diagnostic (say something more useful instead)
- [ ] Have a javascript file that can highlight wording differences
- [ ] Show how far an Concept is on the dependency tree (depth indicator) when you hover over it

## Editor / highlighting (VS Code extension)
- [ ] Colour aliases differently from other tokens
