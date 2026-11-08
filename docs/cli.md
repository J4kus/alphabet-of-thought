# The command line

[Back to the README](../README.md)

`verify.js` is the extension's referee without the editor: it wraps the same `src/` modules, applies the same gates and filters, and prints every finding with its `file:line`. The whole-file check ends in a verdict and an exit code, which makes `V = 0` scriptable — in CI, in a git hook, or as the acceptance test in an LLM loop. It judges **what is in front of it** and nothing else — a file whose derivations are [parked](formulas.md#parking-the-derivations) is judged on the values it carries, and the store is never read. One thing comes from beside it: the [units a repository writes itself](formulas.md#your-own-units) are every file's, so it first reads them off the other `.aot` files of the file's repository, as the editor does, parsing only a file with a line that could open a Concept called `Unit`:

```
$ node verify.js examples/thought.aot
127 nodes, 127 edges, largest prime 719, violations V = 0
subsumption: 13 derived is-a edges, hierarchy consistent
V = 0: true — the file verifies
$ echo $?
0
```

The flags turn the arithmetic into queries:

| Flag | What it does |
|------|--------------|
| `node verify.js <file>` | Whole-file check with a `V = 0` verdict; exit code `0` iff the file verifies |
| `--ask X Y` | Is-a test by divisibility: does `chi(Y)` divide `chi(X)`? |
| `--genus X Y` | The nearest common kind of two ideas, via gcd |
| `--number X` | An idea's characteristic number as a prime product, with its ancestry |
| `--godel X` | An idea's Gödel factorisation, with a prime-by-prime legend of its attributes and values, the exact integer and its digit count |
| `--clashes` | Both strengths of content clash (the editor flags only the strong, content-identical case) |
| `--overrides` | Every node overriding an inherited default, detected arithmetically |
| `--find "a: v" ["b" …]` | Query by example: every idea whose content satisfies the terms, by one divisibility test |
| `--common X Y` | The shared content core of two ideas — every attribute both carry at the same value |
| `--near X [k]` | The `k` nearest ideas by content distance, with the slots that differ |
| `--fd` | The full set of inferred functional dependencies, including the covariations, provisional findings, and transitively implied ones (tagged `[implied by …]`) the editor holds back |
| `--depends X` | A Concept's declared dependencies, direct and transitive with a witnessing path |
| `--diff old new` | Version diff as factorisation comparison: added, removed, and changed nodes per attribute — and **renamed** and **moved** ones recognised, when the pairing is unambiguous, so a renamed Concept is one finding rather than everything under it removed and added again. It compares values and structure, so a changed rule or formula does not show: `git diff` shows those |
| `--diff-rev REV file` | The same, against the file as it stood at a git revision (`--diff-rev HEAD~1 "examples/godel.aot"`) |
| `--suggest` | The FCA audit, plus the positive report the editor never shows: which Concepts the Examples' attributes *confirm* |
| `--workspace [dir]` | The repo-wide check: every Concept written in more than one `.aot` under `dir` (default the current directory) is listed, file and line, and every [contradiction](language.md#concepts-across-files) — one attribute with two values, one Concept under two kinds — is reported on both sides. **Exits `1` when there is one**, so CI can gate on it |
| `--workspace [dir] --reconcile` | Writes the agreement in first, then checks: attributes a peer declares are filled in, the `...` line saying where the rest of a Concept's Examples live is kept true — and a stale one removed. Additive otherwise — nothing you wrote is deleted — and idempotent, so a second run over a repo already in step changes nothing. The headless form of what a save does in the editor. `--workspace` also prints the one-content-two-names warnings (rule 17), which never change the exit code |
| `--workspace [dir] --primes` | Extends the [stable Gödel numbers](checks.md#gödel-numbering) with every attribute and value under `dir` and writes `aot.files/godel.tsv` |
| `--merge %O %A %B %P` | git's merge driver — see [Merging with git](#merging-with-git) |

Two views are CLI-exclusive: `--suggest`'s `confirmed` line (the lattice agreeing with your tree is worth seeing, but it is not a squiggle), and the full `--fd` / `--clashes` sets (the editor surfaces only the confident, strong cases).

## The calculating check

`verify.js` judges what a file says, and runs nothing. `check.js` goes on and calculates:

```
$ node check.js "Q3 Revenue.aot"
check.js runs the formulas in these files and any Python they name, with your permissions.
Q3 Revenue.aot:10: error: change the value, or the formula — '$99,999' is written here, and its formula gives '$35,000'
Q3 Revenue.aot:14: error: change the value, or the formula — '$159,000' is written here, and its formula gives '$194,000'
Q3 Revenue.aot:10: error: change the value, or the bound — '30%' breaks 'discount <=@max discount': it is not <= 0.2

1 file: violations V = 0, 0 contradictions between files, 0 values naming no row
formulas: 5 calculated, 0 failed, 2 differ from what is written, 0 not written yet
rules: 8 values checked, 1 broken, 0 could not be checked
3 problems
$ echo $?
1
```

**To run it**, clone the repository, run `npm install` in it, then `node check.js <path>`. The extension's own folder holds a copy with its dependencies (`~/.vscode/extensions/jakus.alphabet-of-thought-<version>/check.js`). An npm package isn't out yet.

`node check.js [file or folder]` is one command for everything: every file, every agreement between files, every formula and every rule. Given one file it reports on that file, reading the rest of its repository, since a formula may reach any of it. It **exits `1`** on any of these:

- a violation (`V`), or a contradiction between files;
- a value naming a row its file's own list does not hold;
- a formula that fails, or a rule that does;
- a broken rule;
- a value differing from what its formula computes, to 15 significant digits.

An empty cell in front of a formula, or one holding only a unit, is a note: the formula has not written yet. A chart or a long text is only checked for running, and so is what a bare `=` line writes. It exits `2` when it could not look: no such path, no `.aot` files, no Python. It never writes to a file.

What it cannot see is a typed number with nothing stating what it should be. `total: 60000` with no formula is just a value, and so is `influence: Green` against a missed target. State the relationship, with a formula or a rule, and they are caught. **It can't tell you a number is true.** It tells you when your model disagrees with itself, with a rule you wrote, or with another file. A rule or a defined column governs the file it is written in, so rows in another file are not held to it. And an edited rule or formula passes, because the file still agrees with itself: `git diff` is where you see that.

**Running it runs the code in those files**, with your permissions, and that is its one consent: so never on a pull request you have not read. Python starts as the editor starts it: no other program may start, the places credentials are kept are refused, and the secrets in the environment are withheld. `--python <path>` chooses the interpreter; otherwise it is `python` on PATH, never one in the repository.

## Merging with git

A line merge sees text; two people who edit one Concept see an idea. **AOT: Set Up Git Merge for .aot Files** makes git merge an `.aot` by meaning:

- it adds `*.aot merge=aot` and `aot.files/godel.tsv merge=union` to `.gitattributes` (commit it: the repository says how its files merge), and
- it points the repository's **local** git config at `node "<extension>/verify.js" --merge %O %A %B %P` — a program on your machine, so never committed. It needs Node.js on PATH. Nothing is configured without the command, and a driver left pointing at an older copy of the extension is repointed on activation.

The driver tries **git's own line merge first**: when that is clean it is kept (and any error the merge brought that neither side had is printed). When it conflicts, the **semantic merge** (`src/merge.js`) reads both sides against the ancestor as changes to Concepts and Examples — found by name, and where a name changed, by content — and replays theirs onto ours:

| One side | The other | Result |
|---|---|---|
| renames `Dog` to `Hound` | changes Dog's `sound` on the next line | both apply — the case a line merge conflicts on |
| sets `sound: woof` | sets `colour: black` two lines down | both apply |
| changes one cell of a row | changes another cell of the same row | both apply, cell by cell |
| adds `- Fish` | adds `- Bird` | both land, each after the sibling it follows on its own side |
| sets `sound: woof` | sets `sound: yap` | **conflict**, marked on that one line |
| removes `Cat` | changes Cat's `sound` | **conflict**, marked on Cat's block |
| moves a Concept, reorders, edits a `...` | anything | **git's own merge**, conflicts and all |

Three checks decide whether it may answer at all. **Replay**: each side's changes, applied to the ancestor alone, must give back that side exactly — an edit it has no word for fails it. **Arithmetic**: every node's Gödel number in the result must be, prime by prime, theirs where theirs changed it, else ours — so a rename that would cut a link the other side made fails it. **No new errors**: two edits each fine alone can be wrong together — a rename onto the name the other side gave a new Concept — so a result with an error neither side had fails too. Whatever a check cannot vouch for goes back to git's own conflicted text — so the driver is never worse than git's default. A row added above every other row of a table is one of those: it has no row to follow, and git places it. Run by hand, it is `node verify.js --merge base.aot ours.aot theirs.aot path.aot`, writing into `ours.aot` and exiting `0` when clean.
