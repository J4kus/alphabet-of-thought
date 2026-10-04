# Alpha features 1.12 — Python that reaches further, and numbers that hold still

A per-feature reference for the **1.12.0** batch. It picks up where [features-1.10.md](features-1.10.md) leaves off. Each entry has four parts:

- **Before**: how it worked, or failed, without the feature.
- **What changed**: the feature, plainly.
- **Try it**: what to do in the editor (or the terminal), and what you should see.
- **How it is tested**: the check that holds it.

Every snippet uses the current syntax. Run the whole suite with `npm test` (sixteen plain Node scripts; each prints `PASS`/`FAIL` and exits non-zero on failure). Two of them reach real tools when they are there: `test-python.js` a Python on PATH, `test-merge.js` a `git`.

The batch has two halves. The first makes the Python half reach what the language already says — sub-Examples, several derivations in one table row, several Concepts from one line — and cleans up three rough edges in the editor. The second puts the Gödel numbers to work: stable across edits and branches, shown on hover, read for three new warnings, and used to diff and merge by meaning.

---

## Python sees sub-Examples

### Before

`@Thing` gave a DataFrame of `Thing`'s *direct* Examples only. A `- Child` under `- Parent` was invisible to Python, so was a nested table row, and a value on `- Parent` could not name the Examples beneath it.

### What changed

A Concept's rows are every Example in its scope, sub-Examples included, depth-first — the rows the [CSV mirror](../README.md#the-csv-mirror) writes. Where they nest, the frame carries the tree in a `parent` column, as the mirror does. A value on an Example reaches the Examples under it by name, after its siblings (a sibling keeps a shared name).

### Try it

```aot
Thing
    age
    - Parent
        age: 40
        total: =@Child 1@age + @Child 2@age
        - Child 1
            age: 10
        - Child 2
            age: 12
    count: =len(@Thing)
```

`Ctrl+Enter` on `count` writes `3`. `total` writes `22`. `@Thing` in Python has a `parent` column: `Child 1`'s row says `Parent`.

### How it is tested

`out/test-python.js`, *6a. Python sees sub-Examples*: the frame's rows and its `parent` column, a column spanning sub-Examples, `@Thing@Child@age`, a parent's value reading its children, nested table rows, and a flat Concept left exactly as it was.

---

## Two derivations in one table row

### Before

Several places assumed one derivation per line. `Ctrl+Enter` on the right-hand cell ran the left-hand one. The hover answered only for the first cell. Two `✓` notes piled up at the row's end with nothing saying which cell each was about. A `|` inside a later cell's Python split the cell.

### What changed

- `Ctrl+Enter` runs the derivation in the cell the cursor stands in; on the row's name, every derivation on the row.
- One inlay per row names its cells: `✓ vat, net · 3 ms · 16:04`, or the first in trouble, `✗ net: NameError… · 16:04`. The tooltip has a line for each.
- Hover answers for the cell it is over.
- A `|` inside any cell's open brackets or strings is the Python's. A cell whose Python is still open reads every pipe as a divider, so the row stays a row.
- **Calculated columns.** When every row of a column carries the same derivation, the lightbulb offers **Define 'vat' for the whole column**. The derivation moves onto the header as `vat ==@price*0.2`, each cell keeps its value, and the next run fills the empty ones.

### Try it

```aot
Invoice|price|vat        |net
A      |100  |=@price*0.2|=@price-1
B      |50   |=@price*0.2|=@price-1
```

`Ctrl+Enter` inside `=@price-1` on row A: only `net` runs, `99`. On `B`'s name, both run. Put the cursor on a `vat` cell and press `Ctrl+.`: **Define 'vat' for the whole column (vat ==@price*0.2)**. The header becomes `vat ==@price*0.2` and the cells read `20` and `10`.

### How it is tested

`out/test-extension.js`, *two derivations side by side*, against the fake runtime: the right-hand run, the row run, the one inlay, the per-cell hover, and the calculated column end to end. `out/test-table.js`: the pipe cases and `columnDefinition`/`defineColumn`.

---

## A bare `=` line writes several Concepts, and parks

### Before

`=load_all()` on a line of its own parsed as a Concept named `=load_all`. There was no way for one derivation to write more than one table.

### What changed

A line holding only `=<python>` is a derivation that writes **Concepts**. It returns tables by name: a dict of name to DataFrame, list of dicts or `aot.grid`, or a list of `aot.grid(...)`.

- **A new name** is written as a table at the line's own indent, directly under it (after the tables it already wrote).
- **A name the file already has** is filled where it stands. One with a derivation of its own is left to it: the line still succeeds (its inlay says the name was left to its own derivation), and a warning says the Concept is returned from two places.
- **Nothing is deleted.** A Concept it no longer returns stays, and its inlay says so.
- `@Sales` elsewhere reads the live table.
- The line is no node of the model. A lone `=` is an error, and so is `==(…)` with no attribute.

**It parks.** The park key takes the whole line out, filed by where it stood and what it wrote (`@=Sales@Region: =load_all()`), and puts it back above the Concept that stood directly beneath it — normally the first table it wrote. A line with no Concept beneath it stays, and the park key says why.

### Try it

With Python on and a sidecar function that returns `{"sales": df, "Region": [...]}`:

```aot
=load_all()
```

`Ctrl+Enter` writes `Sales|…` and `Region|…` under it, at the top level. Its inlay reads `✓ 2 Concepts · … rows · … ms`. `Ctrl+Shift+`` takes the line out and brings it back.

### How it is tested

- `out/test-linter.js`, *bare =*.
- `out/test-python.js`, *6c*: hosts, results, writing (new, hooked, own-derivation conflict, rerun, nothing deleted, under a Concept), and live reads. Plus the real runtime.
- `out/test-park.js`, *bare =*.
- `out/test-extension.js`: end to end against the fake runtime.

---

## Smaller changes

| Change | Try it | Tested in |
|---|---|---|
| **No flip lightbulb.** It lit the bulb on every line of every Concept with Examples. The flip stays on `Ctrl+Alt+T`, `Ctrl+K T`, the right-click menu and the Command Palette. | `Ctrl+.` inside a Concept offers no flip. | `test-extension.js` 7d2 |
| **The column keys work from a declaration line.** `age` under a Concept written as lines is the column's header, so `Alt+Shift+←` there deletes the column. `Tab` there still indents. In a table, no column key moves, copies or deletes the name column. | `Alt+Shift+←` on `    age`. | `test-lineform.js`, `test-table.js`, `test-extension.js` 7d4–7d6 (including a keybinding audit) |
| **A part is not its whole.** A sub-Example named like an Example it sits under is an error (rule 24). | `- Parent` then `    - Parent` beneath it. | `test-linter.js` |
| **Stale `...` notes go.** A maintained `... 4 more in b.aot:1` is deleted on save once no other file lists the Concept. With `aot.autoReconcile` off, it is a warning instead. | Rename the Concept in the other file, save this one. | `test-repo.js` |
| **Python in WSL.** `python3` is tried before `python` off Windows. Each OS gets its own uv environment (`.venv`, `.venv-linux`, `.venv-darwin`). Linux caps memory by data size, not address space, and numpy's BLAS is held to four threads. | In WSL with only `python3`: `Ctrl+Enter` runs. | `test-uv.js`; run by hand in WSL |

---

## The Gödel numbers, round 2

Try these in [`examples/godel.aot`](../examples/godel.aot) and [`examples/godel twins.aot`](../examples/godel%20twins.aot). Both verify at `V = 0`, so every deep-pass warning shows.

### Stable numbers: `aot.files/godel.tsv`

**Before.** Primes were handed out in sorted order on every run, so adding an attribute that sorts first renumbered everything, and two files numbered one attribute differently.

**What changed.**
- A registry keeps every prime and value code (`a⇥legs⇥2`, `v⇥legs⇥3⇥4`). A save adds what is new without renumbering (`aot.godelRegistry`).
- It merges with git's union driver. A merge's duplicate claims are repaired when it is read.
- Safe to delete.

**Try it.** Save `godel.aot` inside a git repository: `aot.files/godel.tsv` appears. Or run `node verify.js --workspace examples --primes`. `node verify.js examples/godel.aot --godel Parrot` prints the same numbers every time.

**Tested in.** `test-godel.js` 9–10 (round trip, append stability, self-repair, pooling); `test-extension.js` 7c2 (written on save).

### Hover: a node's content

Hover `Parrot` in `godel.aot`. You see:
- `G` as a factorisation;
- `legs: 2` as its own and overriding `4` from `Pet`;
- `coat` and `sound` as its own;
- its nearest sibling and how they differ.

Hover `Car`: a Concept with no dependency chains and no usages now shows its content too.

**Tested in.** `test-godel.js` 11; `test-extension.js` 7c2.

### Warnings 15–16: state a fact once

- `Vehicle`: both kinds set `wheels: 4`. The lightbulb **Move 'wheels: 4' up to 'Vehicle'** writes it once and takes it off both.
- `Payment`: the `currency` column is `EUR` in every row. The same fix drops the column and gives `Payment` a line of its own.
- `Drink`: `temperature: cold` is overridden by every child. **Keep just 'temperature'**.

Examples need three rows before their agreement counts, since two rows agreeing is as often chance. A `...` Map excuses a node, and derived values are never lifted.

**Tested in.** `test-godel.js` 12; `test-derive.js` (`hoistOps`); `test-extension.js` 7c2.

### Warning 17: one content, two names, two files

`Kettle` in `godel.aot` and `Boiler` in `godel twins.aot` carry the same attributes and values. Each file warns on its own side, with a link to the other, and the lightbulb offers **Rename** or **Keep apart**. `node verify.js --workspace examples` prints both.

**Tested in.** `test-godel.js` 13; `test-extension.js` 7c2.

### `--diff` recognises renames and moves

```
node verify.js --diff-rev HEAD~1 "examples/godel.aot"
```

A renamed Concept is one `renamed:` finding, carrying its changes, rather than itself and everything under it removed and added again. A move is one `moved:` finding. An ambiguous pairing is left as removed and added.

**Tested in.** `test-godel.js` 14.

---

## Merging with git: a walkthrough

Run **AOT: Set Up Git Merge for .aot Files** in a repository once, or set it up by hand as below. The driver needs Node.js on PATH.

### bash

```bash
AOT=/path/to/alphabet-of-thought        # this repository
cd "$(mktemp -d)" && git init -q -b main
git config core.autocrlf false
git config merge.aot.driver "node \"$AOT/verify.js\" --merge %O %A %B %P"
printf '*.aot merge=aot\naot.files/godel.tsv merge=union\n' > .gitattributes
printf 'Pet\n    legs: 4\n    Dog\n        sound: bark\n        colour: brown\n' > zoo.aot
git add . && git commit -qm base

git checkout -qb theirs
sed -i 's/sound: bark/sound: woof/' zoo.aot && git commit -qam "Dog woofs"
git checkout -q main
sed -i 's/    Dog/    Hound/' zoo.aot && git commit -qam "Dog is a Hound"

git merge --no-edit theirs      # clean: Hound woofs
cat zoo.aot

# a real conflict, marked on its one attribute
git checkout -qb left  && sed -i 's/colour: brown/colour: black/' zoo.aot && git commit -qam left
git checkout -q main   && sed -i 's/colour: brown/colour: white/' zoo.aot && git commit -qam right
git merge --no-edit left        # exits 1; zoo.aot has <<<<<<< ours around colour alone
```

### PowerShell

```powershell
$AOT = "C:\path\to\alphabet-of-thought"
$dir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("aot-merge-" + (Get-Random)))
Set-Location $dir
git init -q -b main
git config core.autocrlf false
git config merge.aot.driver "node `"$($AOT -replace '\\','/')/verify.js`" --merge %O %A %B %P"
Set-Content .gitattributes "*.aot merge=aot`naot.files/godel.tsv merge=union" -Encoding utf8
Set-Content zoo.aot "Pet`n    legs: 4`n    Dog`n        sound: bark`n        colour: brown" -Encoding utf8
git add .; git commit -qm base

git checkout -qb theirs
(Get-Content zoo.aot) -replace 'sound: bark','sound: woof' | Set-Content zoo.aot -Encoding utf8; git commit -qam "Dog woofs"
git checkout -q main
(Get-Content zoo.aot) -replace '    Dog','    Hound' | Set-Content zoo.aot -Encoding utf8; git commit -qam "Dog is a Hound"

git merge --no-edit theirs      # clean: Hound woofs
Get-Content zoo.aot
```

### What you should see

The first merge is clean: git's line merge conflicts on the neighbouring lines, and the driver says `merged by meaning`. The second conflicts on `colour` alone. A move, a reordering or an edit to a `...` line falls back to git's own conflicted text: the driver is never worse than git's default. So does a merge whose two edits are each fine but wrong together: a rename onto the name the other side gave a new Concept (an error neither side had), or a rename that cuts a link the other side made (the arithmetic). A row added above every other row of a table has no row to follow, and falls back too.

**Tested in.** `test-merge.js`: the pure cases (neighbouring attributes, rename + value, same-attribute conflict, two added siblings, two cells of one row, two cells conflicting on one row, a cell emptied, a row added against a cell changed, removed vs modified, renamed two ways, and every fallback above), and both walkthrough merges through a real git, CRLF included. `test-extension.js` 7c3: the setup command and the path repair.

---

## A checklist for the Extension Development Host (F5)

`examples/release 1.12.aot` is this checklist as a file: entries A01–A32, each saying what to do and what you should see, with the fixtures they act on. It verifies at `V = 0` with three warnings on purpose (the `Boat` and `Receipt` hoists, the `Meal` dead default). `examples/release 1.12 peer.aot` is the other file of its cross-file entries (the stale `...` note, the `Toaster` / `Grill` twin). `examples/release 1.12 errors.aot` holds what must fail: three Examples named like the Example they sit under, a lone `=`, and a bound with no attribute (`V = 5`).

1. `examples/godel.aot`: hover `Parrot` and `Car`. Three warnings, each lightbulb working.
2. `examples/godel twins.aot`: the twin warning in both files.
3. Save `godel.aot`: `aot.files/godel.tsv` appears.
4. A table with `vat` and `net` derivations side by side: Ctrl+Enter per cell, one inlay per row, hover per cell, **Define … for the whole column**.
5. A nested `Thing` and `=len(@Thing)` gives the count including sub-Examples.
6. A bare `=load_all()` at the top of a file returning two tables. `Ctrl+Shift+`` parks it and brings it back.
7. No flip lightbulb anywhere. `Ctrl+K T` still flips.
8. `Alt+Shift+←` on a free-text declaration line deletes the column. On a table's name column it does nothing.
9. Delete the peer Concept in another file and save this one: its `...` note disappears.
10. **AOT: Set Up Git Merge for .aot Files**, then the walkthrough above in that repository.
