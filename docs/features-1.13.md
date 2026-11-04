# Alpha features 1.13 — tables that stay flat, a mirror that follows the last save, names that follow you

A per-feature reference for the **1.13.0** batch. It picks up where [features-1.12.md](features-1.12.md) leaves off. Each entry has four parts:

- **Before**: how it worked, or failed, without the feature.
- **What changed**: the feature, plainly.
- **Try it**: what to do in the editor (or the terminal), and what you should see.
- **How it is tested**: the check that holds it.

Every snippet uses the 1.13 syntax. Run the whole suite with `npm test`: seventeen plain Node scripts, each printing `PASS`/`FAIL` and exiting non-zero on failure.

The batch has three halves:
- **Tables:** flat, nesting through a `parent` column, with dividers, and a flip that keeps your place.
- **Agreement:** a CSV mirror where the file saved last overrides the other, a rename that follows a name typed over, and findings that wait while you write.
- **Syntax:** Concept defaults, `=` for definitions and `==` for a literal `=`, and Gödel numbers computed without building them.

---

## Tables never nest by indentation

### Before

A row indented under the row above was its sub-Example. The tree lived in leading spaces, which no CSV, spreadsheet or DataFrame keeps. `Tab` sometimes indented instead of moving. Copying a row, or folding a CSV into a nested table, quietly flattened the tree.

### What changed

A sub-Example names the row it sits under in the table's **`parent (thing)`** column: named `parent`, with an `(alias)` that is the table's own Concept, lowercased. It is the same `parent` column the CSV mirror has always written.
- A parent cell names the nearest row above of that name, else the first below, never the row itself.
- A name no row carries, a row naming itself, and a circle of parents are errors (rule 25).
- Parent cells link to their rows, and rename with them.
- `Tab` in a table always moves between cells, even with lines selected.
- **Nest Row Under the Row Above** and **Lift Row Out of Its Parent Row** write the parent cell.
- Deleting a row takes every row whose parents lead back to it.

A row's indent means nothing: this column is the only way a table nests. An indented row is only a row, and Format Document draws it flush.

### Try it

```aot
Thing  |parent (thing)|age
Parent |              |
Child 1|Parent        |10
Child 2|Parent        |12
```

Sort the rows by name: `Child 1` and `Child 2` now stand above `Parent`, and still name it. Hover `Parent` in a parent cell, then Ctrl+click it.

### How it is tested

- `out/test-linter.js`, *the parent column*: filing by name, case aside; a parent written below its child; a child named like its parent; the errors; an alias with numbering; a `parent` typed by another Concept; numbering under a forward reference.
- `out/test-table.js`, *nesting*: an indented row read as a row and drawn flush, nest and lift, deleting a branch, moving and sorting.
- `out/test-linter.js`, *indent*: an indented row raises nothing and files nothing.
- `out/test-extension.js`, *5b*: `Tab` with lines selected.
- `out/test-merge.js`: a removed row taking the rows naming it.

---

## Dividers

### Before

A `---+---` rule from before 1.12 was skipped, then dropped on the next redraw. Blank lines in line form were lost by the flip.

### What changed

Dashes between the pipes, `-----|---`, group a table's rows. A divider is kept and redrawn to its columns' widths. Every key steps over it, and a sort stays within its group. In the flip, a blank line above an Example's line becomes a divider above its row, and back.

### Try it

```aot
Order|price
Acme |100
-----|-----
Bolt |50
Cog  |7
```

Sort by `price` with the cursor on `Cog`: only the group under the divider reorders. Flip the Concept (`Ctrl+Alt+T`): a blank line stands where the divider stood.

### How it is tested

`out/test-table.js`, *dividers*: redrawing, the one-column closing pipe, the linter reading past one, sorting in a group, `Tab` stepping over one, deletion, `tablesOf`'s breaks, and `updateTable` keeping them. `out/test-derive.js`: blank lines and dividers round trip through the flip.

---

## The flip keeps your place, and works with no Examples

### Before

After `Ctrl+Alt+T` the cursor jumped to the Concept's first line. A table above that the re-align redrew could leave it on the wrong row. A Concept with no Examples said there was nothing to flip. A row with an empty name lost its values on the way out. The new grid swallowed a table written straight after it.

### What changed

The cursor's idea is named before the flip and found after it: the value, cell, Example, column or default, and how far into it.
- An empty cell lands on its Example's name in line form, and comes back as that cell.
- A Concept with no Examples flips to its header alone.
- A nameless row keeps its values under a `- ` waiting for a name.
- A blank line keeps the grid apart from a table that follows it.
- A maintained `... N more in a.aot:3` note stays under the table's last row, so a table carrying one flips and flips back unchanged.

### Try it

Put the cursor in `110` below and flip, then flip back:

```aot
Invoice: EUR
    tax rate: 0.2
    price
    - Acme
        price: 110
```

The cursor is in `110` both times. Flip `Colour` with only `    hue` under it: `Colour|hue`.

### How it is tested

`out/test-derive.js`, *ideaAt / positionOf* (value lines, Example lines, declarations, the Concept's default, cells, the parent cell, an empty cell both ways), and the flips with no Examples, a swallowed table, a nameless row and a maintained note. `out/test-extension.js`, *flip*, end to end.

---

## The file saved last overrides the other

### Before

Every difference between a `.aot` and its CSV was settled the CSV's way, whichever was newer:
- A `.aot` changed while the editor was closed was reverted.
- A CSV older than the `.aot` could overwrite it.
- A fold saved unsaved work, as a side effect.
- An emptied cell meant nothing, and a dropped row was ignored.

### What changed

One rule: the file saved last overrides the other, even where the other was edited too. The two files' save times decide, so nothing is merged and nothing is remembered, and a fresh clone, a moved folder and a new profile behave like anywhere else.
- Saved last, the `.aot` rewrites the CSV.
- Saved last, the CSV gives the `.aot` every cell where the two differ. An emptied cell empties, a new row arrives, and a row it no longer lists is deleted with nothing asked. A row whose sub-row the CSV still lists stays, and a notice says so.
- No notice says what was overwritten. In a `.aot` open in the editor, `Ctrl+Z` brings it back. Otherwise only git can.
- A column comes from the `.aot` alone.
- Unsaved text is no save, so a CSV saved last overrides it too: the table in the open `.aot` ends up saying what the CSV says, your unsaved edits to it included. Anything else unsaved in that file stays, and the file is left for you to save.
- A CSV saying what the saved `.aot` says has no word of its own, however late it was saved. The mirror writes the CSV after every `.aot` save, so this is what keeps it from wiping what you type next.
- A `.aot` saved by another program counts as soon as the file watcher hears it, and the catch-up at startup finds what happened with the editor closed.
- A Concept in several files mirrors their union, and each row's edit goes to the file that lists it.

`aot.tableCsvSyncMode: manual` syncs only on **AOT: Sync CSVs Now** (`Ctrl+K Y`), where the same rule decides.

### Try it

Save a `.aot` with `Order|price|qty` / `Acme |100  |1`. Close VS Code, change `100` to `110` in the `.aot`, reopen: the CSV says `110`.

Now edit both files: in the `.aot` change `1` to `2`, and then in the CSV change `110` to `120`. The CSV was saved last, so the `.aot` says `120` and its `qty` is back to `1`. Do the same the other way about, the `.aot` saved last: the CSV takes every value from the `.aot`.

### How it is tested

`out/test-csvsync.js`: every cell a CSV saved last changes, erasures, deleted rows, new rows, the parent column, unsaved edits overridden, the union, and the fold and deletion edits applied. `out/test-extension.js`, *6e*: end to end in a temporary repository with the save times set by the test. It covers both orders with edits on both sides, a value set back to an earlier one, a CSV older than its `.aot`, a dropped row, a document with unsaved edits, the mirror's own write heard back, a `.aot` saved by another program, two files, manual mode, and a first meeting with nothing known.

---

## Rename by typing, and F2 across the workspace

### Before

F2 renamed in the current file only. Typing over a name stranded every use of it, and the ghost text could only say "F2 renames them all".

### What changed

Typing over a used name is a rename in progress. When the cursor leaves the name, its uses are counted across the workspace and one notice offers to update them: one edit, other files left unsaved. The offer stays on the lightbulb until taken, dismissed or moot. F2 renames across the workspace too, a Concept's spelling in other files included.

### Try it

With `person: Socrates` in another file, change `Socrates` to `Sokrates` on its `- ` line and move away: *'Socrates' is now 'Sokrates' — 3 uses still say 'Socrates' — 2 here, 1 in Other.aot*.

### How it is tested

`out/test-extension.js`, *8f*: the count across files, the lightbulb, the one edit, undo starting nothing, and F2 reaching a peer and a third file. *8e*: the ghost text.

---

## Findings elsewhere wait while you write

### Before

Only the two lone-child warnings waited, for a 600 ms grace after the last keystroke, and only those two.

### What changed

From the first edit, a finding that is new and not on a line you edited waits until the cursor leaves the family of what you edited (the edited node's parent and everything under it), you save, or you switch editors. A finding already on screen stays. A fix shows at once. A status item counts what waits.

### Try it

Under `Parent`, type `    Child`: no "1 sub-Concept" squiggle, and `1 waiting — leave 'Parent' to see it` in the status bar. Type a second child: nothing ever showed. Delete it and move to another Concept: the warning shows.

### How it is tested

`out/test-hold.js`: keys surviving line shifts, edited lines carried through edits, Enter at a line's end, the family. `out/test-extension.js`, *9d*: the whole sequence end to end.

---

## Concept defaults, and `=` and `==`

### Before

`Currency: EUR` made `EUR` an inline Example: a CSV row, an `@Currency` row, an FCA object. A header could state no default. A definition was `==`, and a literal `=` in a value was `\=`.

### What changed

- `Currency: EUR` is the Concept's default: what an attribute typed by `Currency` reads where nothing values it.
- A header states defaults: `Currency: EUR|symbol`, `Order|tax rate: 0.2|price`.
- On a declaration `=` defines: `vat =@price*0.2`, `status =("draft", "sent")`.
- In a value a doubled `=` is a literal one: `note: a == b` reads `a = b`.
- `\=` is no escape now, only a backslash and an `=`, and `==` on a declaration is part of its name.

### How it is tested

`out/test-linter.js` (Concept defaults; the 1.13 `=` and the escape), `out/test-table.js` (`readValue`, `writtenValue`, `splitConstraint`), `out/test-derive.js` (type defaults through every reader; the flips), `out/test-park.js`, `out/test-python.js`.

---

## Gödel numbers, computed as exponent vectors

`G` is kept as the primes a node carries and their exponents, and built as an integer only when one is shown. On a 2,000-row table a hover went from 6.7 s to 0.6 ms. See [godel-numbers.md](godel-numbers.md) for the method and the measurements. Tested in `out/test-godel.js`, blocks 15–16.

---

## Smaller changes

- The `... N more in …` note: file names with spaces link, links follow the Concept's current line, a hover per span, and an Example two peers list counts once.
- A Concept's alias links the Concepts its words name: `Human (Natural Person)` links `Person`.
- A sub-Example inherits nothing from its parent Example: a part inherits nothing from its whole.
- The table editor and the linter agree where a table ends at a row shallower than its header.

---

## A checklist for the Extension Development Host (F5)

Open [`examples/release 1.13.aot`](../examples/release%201.13.aot) and work down its entries; each says what to do and what you should see.
