# Repository layout

[Back to the README](../README.md)

| Path | What it is |
|------|------------|
| [`verify.js`](../verify.js) | [The command line](cli.md): whole-file check with exit code, plus the query flags. Runs nothing |
| [`check.js`](../check.js) | [The calculating check](cli.md#the-calculating-check): every file, every agreement, every formula and every rule, with an exit code |
| [`src/gates.js`](../src/gates.js) | The gates a verdict on one file goes through, shared by both commands |
| [`src/units.json`](../src/units.json), [`src/units.js`](../src/units.js) | The built-in [units](formulas.md#numbers-and-units) and the hierarchy they sit in, read by the editor and the formula engine alike |
| [`src/linter.js`](../src/linter.js) | Syntactic and arithmetic checks (error rules 1–12, 24 and 25) |
| [`src/primes.js`](../src/primes.js) | The primes every number is made of: one cached Sieve of Eratosthenes, sized by the Rosser–Schoenfeld bound |
| [`src/subsumption.js`](../src/subsumption.js) | Subsumption reasoner (error rules 13–16) |
| [`src/fca.js`](../src/fca.js) | Formal Concept Analysis audit (error rules 17–19) |
| [`src/godel.js`](../src/godel.js) | Gödel numbering: the content clash (error rule 20), values every child states and defaults no child keeps (warning rules 15–16), one content under two names across files (warning rule 17), the stable numbers of `aot.files/godel.tsv`, a node's content for the hover, and the rename-aware diff |
| [`src/merge.js`](../src/merge.js) | [Merging with git](cli.md#merging-with-git): the semantic three-way merge, its replay guard and its arithmetic check |
| [`src/git.js`](../src/git.js) | The two git calls the command line makes: a file at a revision, and git's own line merge |
| [`src/armstrong.js`](../src/armstrong.js) | Dependency inference (warning rules 12–13), the declared dependency graph, and the axiom checks (error rule 21, warning rule 11) |
| [`src/synonyms.js`](../src/synonyms.js) | Two names for one idea (warning rule 14): the synonym vocabulary, the stem rule, and the dismissal key |
| [`src/park.js`](../src/park.js) | Taking the `=` derivations out of the data and putting them back: the `@` addresses, the round trip, and the `.formulas` store |
| [`src/crosslinks.js`](../src/crosslinks.js) | Underlines, hover, references, and go-to-definition for crosslinks |
| [`src/table.js`](../src/table.js) | The table editor, the parent column and dividers, reading a cell's value and its derivation or bound apart, and the CSV mirror's grids |
| [`src/csvsync.js`](../src/csvsync.js) | [The CSV mirror](tables.md#the-csv-mirror)'s one rule: what a `.aot` takes from a CSV saved after it (cells, erasures, new rows, the rows to ask about), and a Concept's union across files |
| [`src/derive.js`](../src/derive.js) | Derivations on line-form values, the constraint that holds each value, the Example edits and the table/line flip |
| [`src/pyshape.js`](../src/pyshape.js) | Whether text reads as a Python expression, without running it — what tells a constraint's bound from prose (`speed > none noted`) |
| [`src/recalc.js`](../src/recalc.js) | [When a file calculates](formulas.md#running): a typed cell waiting for its cursor to leave, one pass at a time, and the smallest edits that land a result without moving a cursor |
| [`src/python.js`](../src/python.js) | The Python derivations and constraint checks of a file, their `@` references resolved, the functions they call, the order they run in, the JSON-lines session, what a result may write back (never code, never a credential), and a program found on PATH alone |
| [`src/uvenv.js`](../src/uvenv.js) | The [uv environment](formulas.md#the-environment-uv): where the project is, what a lock would install and what in it comes from outside PyPI, and uv run as a child process |
| [`src/aot_runtime.py`](../src/aot_runtime.py) | The Python side: one process per document, the typed values in and out, the lazy libraries, the sidecar loaded by its path, the constraint checks, and the guards it is held to |
| [`src/urls.js`](../src/urls.js) | URL and file-path spans, their hover metadata, and image detection |
| [`src/hold.js`](../src/hold.js) | [Findings elsewhere wait while you write](checks.md#warnings--yellow-squiggle-in-the-problems-panel-but-not-counted-in-v): which wait, the edited lines followed through edits, and the family whose leaving ends the wait |
| [`src/repo.js`](../src/repo.js) | [Concepts across files](language.md#concepts-across-files): the save-time reconcile and the two contradictions (error rules 22–23) |
| [`examples/thought.aot`](../examples/thought.aot) | A worked model that verifies at `V = 0` (all four rationales; tables) |
| [`examples/features.aot`](../examples/features.aot) | A `V = 0` showcase of the 1.3 additions — `@` references, cross-cell formulas, constraints, string functions — in the formula language since removed; it verifies, but its derivations are not Python |
| [`examples/lint.aot`](../examples/lint.aot), [`examples/warning.aot`](../examples/warning.aot) | The [conformance examples](team.md#the-conformance-examples) — one planted violation per rule |
| [`examples/numbering.aot`](../examples/numbering.aot) | A file to try [Numbering](language.md#numbering) on: save it and watch the Examples and Concepts number themselves |
| [`examples/accounting monthly close.aot`](../examples/accounting%20monthly%20close.aot), [`examples/accounting bank recon.aot`](../examples/accounting%20bank%20recon.aot) | One Concept written in two files: the same definition in both, the Examples split, a maintained `...` line in each |
| [`examples/godel.aot`](../examples/godel.aot), [`examples/godel twins.aot`](../examples/godel%20twins.aot) | The Gödel warnings to try by hand, in two files that verify |
| [`examples/python edge cases.aot`](../examples/python%20edge%20cases.aot) | The [Python](formulas.md) edge cases, each with what should happen — live where running it is harmless, escaped where it would break the file — with its sidecar in `aot.files` |
| [`out/test-*.js`](../out/) | Per-module smoke tests, plain Node scripts (`npm test` runs all twenty-three, `test-merge.js` a real git merge when there is a `git`; `test-python.js` runs the real Python runtime when there is a `python` on PATH, and `test-uv.js` the real uv when there is a `uv`, and each skips it when there is not) |
| [`docs/features-1.1-1.2.md`](features-1.1-1.2.md) | Per-feature reference for the 1.1 → 1.2 line: what changed, a snippet to exercise it, and its edge cases |
| [`docs/features-1.3-1.5.md`](features-1.3-1.5.md) | The same for 1.3 → 1.5: how each feature worked *before*, a snippet for the case that works and the neighbouring one that does not, and the test that holds it |
| [`docs/features-1.6.md`](features-1.6.md) | The same for 1.6: tables and free text as one notation — the unified registry, the outer scope, the union CSV mirror, chained constraints |
| [`docs/features-1.14.md`](features-1.14.md) | The same for 1.14: numbers as an analyst writes them, units of measure, roll-ups, and the check that can fail on a number |
| [`docs/features-1.13.md`](features-1.13.md) | The same for 1.13: flat tables and the parent column, dividers, the flip that keeps your place, the CSV mirror's last-save rule, rename by typing, findings that wait while you write, Concept defaults, `=` and `==` |
| [`docs/godel-numbers.md`](godel-numbers.md) | How the Gödel numbers are computed as exponent vectors: the method, the measurements, and the alternatives turned down |
| [`docs/features-1.12.md`](features-1.12.md) | The same for 1.12: Python across sub-Examples, table rows and bare `=` lines; the column keys; stable Gödel numbers, the hover, the Gödel warnings, the rename-aware diff and the git merge driver — with a merge walkthrough |
| [`docs/features-1.8.md`](features-1.8.md) | The same for 1.8: two-sided duplicates and reconcile, case- and number-insensitive names, [Numbering](language.md#numbering), width cookies and wrapped cells, the in-cell Example dropdown, one-stroke spelling fixes |
| [`out/token-experiment.js`](../out/token-experiment.js) | The measurement behind [What it costs to think in Alphabet of Thought](why.md#what-it-costs-to-think-in-alphabet-of-thought) — re-derive the numbers rather than trust them |
| [`docs/`](./) | The reference docs, the per-version feature notes and their assets (`edit-loop.svg` is the editable source of the illustration in the checks) |
| [`docs/language.md`](language.md), [`docs/tables.md`](tables.md), [`docs/formulas.md`](formulas.md), [`docs/trust.md`](trust.md), [`docs/checks.md`](checks.md), [`docs/settings.md`](settings.md), [`docs/cli.md`](cli.md), [`docs/llm.md`](llm.md), [`docs/team.md`](team.md), [`docs/why.md`](why.md) | The reference, linked from the [README](../README.md) |
| [`out/test-readme.js`](../out/test-readme.js) | Holds the README to what the tools do: its word limit, its example, every message it quotes, and every link in the docs |
| [`install.py`](../install.py) | Build and install the extension locally (`python install.py`) |
