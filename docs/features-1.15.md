# Alphabet of Thought features 1.15 — Excel's keys, one language in lines and tables, and no row limit

A per-feature reference for the **1.15.0** batch. It picks up where [features-1.14.md](features-1.14.md) leaves off. Each entry has four parts:

- **Before**: how it worked, or failed, without the feature.
- **What changed**: the feature, plainly.
- **Try it**: what to do in the editor (or the terminal), and what you should see.
- **How it is tested**: the check that holds it.

Run the whole suite with `npm test`: twenty-four plain Node scripts, each printing `PASS`/`FAIL` and exiting non-zero on failure. What a test can't reach, a mouse click, a real completion list, a fold on screen, is listed in [`examples/release 1.15.aot`](../examples/release%201.15.aot) to try by hand.

The batch has three parts:
- **Excel under the hands:** selecting, copying, inserting, sorting, adding up, folding and filtering, as a spreadsheet does them.
- **One language:** what lines can say, a table can say too, and the reverse.
- **No row limit:** a long table is no longer a special case.

---

## Selecting cells, as in a spreadsheet

### Before

A click left a caret, so typing added to a value rather than replacing it. `Ctrl+Shift+`arrow selected text, pipes and all, and `Ctrl+←` jumped cells even while you were editing a word. Moves, copies and fills took one row or column at a time. `Ctrl++` zoomed.

### What changed

- **Ready and Edit.** A whole cell highlighted is Ready: `Ctrl+←`/`→` jump cells, and typing replaces the cell. A caret in the text is Edit: `Ctrl+←`/`→` step a word. A click highlights the value, the Example's name, or the formula alone when the cell has one; a second click gives a caret.
- **A formula you can't see** in the cell, one on the header or a parked one, shows in the status bar as Excel's formula bar does.
- **Rectangles of cells.** `Ctrl+Shift+`arrow selects to the edge of the data and `Shift+`arrow grows it, one selection per cell, so no pipe is ever selected. Typing and `Delete` act on every cell.
- **Copy and paste.** `Ctrl+C` copies the values as tab-separated rows that Excel pastes as cells. `Ctrl+V` spreads tabbed text over the cells from the cursor's, adding rows as it needs.
- **Moves and inserts take the selection.** `Alt+`arrow moves every row or column it touches, and `Alt+Shift+`arrow inserts or deletes as many.
- **`Ctrl++` and `Ctrl+-`** insert and delete as in Excel: whole rows, whole columns, or cells shifted, chosen from a list. In line form, rows and columns.
- **`Ctrl+A`, then `Tab`,** indents the whole table and the lines under it that are its Concept's.

See [Selecting cells, as in a spreadsheet](tables.md#selecting-cells-as-in-a-spreadsheet).

### Try it

```aot
Order|region|price
Acme |North |$100
Bolt |South |$250
Kite |North |$1,000
```

Click `$250`: it highlights whole, and typing `$300` replaces it. Click it again for a caret. From the `price` header, press `Ctrl+Shift+↓`: the three prices are selected, and the status bar says `Sum $1,350 · Average $450 · Count 3`. Press `Ctrl+C` and paste into Excel: three cells. Put the cursor on Bolt's row, select the whole row and press `Ctrl++`: an empty row goes in above it.

### How it is tested

- `out/test-cells.js`: cell spans, Ready and Edit, edges, rectangles and the statistics, without an editor.
- `out/test-table.js`: moving, inserting and deleting several rows and columns, and shifting cells.
- `out/test-extension.js`, *cells*: a click, a second click and a header cell; `Ctrl+Shift+↓` and `Shift+→`; copy, paste and moves; `Ctrl++` and `Ctrl+-`; `Ctrl+A` then `Tab`; and the status bar's formula.

---

## Sorting, adding up, folding and filtering

### Before

**Sort Rows** had no key, and read a numeric column with one blank cell as text, so `10` sorted before `9`. Nothing added up a column without a formula, and a long table could only be scrolled.

### What changed

- **`Ctrl+Alt+S` sorts** by the cursor's column, by name on the name column, the other way when pressed again, and every group when pressed on the header. Blanks go last, and the rest sort as numbers when they all are. See [Sorting](tables.md#sorting).
- **The status bar adds up the selected cells**, and `Alt+=` writes the total under the table as a formula: `total price: =@Order@price.sum()`. **Summarise Column** offers average, count, min, max and median. See [Adding up a column](tables.md#adding-up-a-column).
- **A column's header hovers** with its profile: cells, blanks, distinct values, the commonest, and its numbers added up.
- **Folds.** A table folds to its header, and each divider's group to its divider.
- **`Ctrl+Shift+L` filters** a table to the cursor's value, folding the other rows away, and a second column narrows it. The status bar says `12 of 5,000 rows`. Nothing in the file changes. See [Folding and filtering](tables.md#folding-and-filtering).

### Try it

In the table above, put the cursor on `price` and press `Ctrl+Alt+S`: `$100`, `$250`, `$1,000`. Again: the other way. Press `Alt+=`: `total price: =@Order@price.sum()` appears under the table and calculates `$1,350`. Put the cursor on a `North` cell and press `Ctrl+Shift+L`: Bolt's row folds away. Press it on the header to show every row again.

### How it is tested

- `out/test-table.js` and `out/test-lineform.js`: the sort order, blanks last, numbers among blanks, and the second press.
- `out/test-cells.js`: the sum, the average, mixed units and the profile.
- `out/test-extension.js`, *cells*, *free text*, *filter* and *profile*: the sort key, the status bar's sum and its click, `Alt+=` in free text, the folds, the filter and what closing the file does to it.

---

## Tab indents in line form

### Before

`Tab` off a table was VS Code's own: it put 4 spaces where the cursor stood, so pressed in the middle of an Example's name it split the name.

### What changed

`Tab` indents the line and `Shift+Tab` outdents it, wherever the cursor stands, as VS Code's Indent Line does. A suggestion list or a snippet keeps `Tab` as usual. In a table `Tab` still travels the cells.

### Try it

Put the cursor in the middle of `- Bolt` in line form and press `Tab`. The whole line moves in a level, and the name is untouched.

### How it is tested

`out/test-extension.js`, *free text: Tab indents the line*.

---

## A row's name may hold a colon

### Before

`re: invoice 12|sent` under a table's header read as a value holding a pipe, which ended the table, and the next row became a header of its own.

### What changed

Inside a table, a line at the rows' indent with a pipe is a row, whatever colons it holds. Outside a table, `note: a|b` is still a value holding a pipe, and so is such a line one level under a table, which is the Concept's.

### Try it

```aot
Message|status
re: invoice 12|sent
re: invoice 13|draft
```

Both lines are rows of `Message`, and Format Document lines them up.

### How it is tested

`out/test-linter.js`, *colon rows*, and `out/test-table.js`, *rowName*.

---

## Dividers drawn `---+---`

### Before

A divider was drawn `---|---`, which reads as a row of dashes.

### What changed

A divider is drawn with `+` where a pipe would stand, and a one-column table's ends in `+`. The old form still reads as a divider, and any redraw writes it with `+`.

### How it is tested

`out/test-table.js`, `out/test-linter.js` and `out/test-derive.js`: drawn, read, and flipped both ways.

---

## No tab in a name or a value

### Before

A tab inside a value was only text. It showed as blank space, so two values that looked alike were not, and it split the cell in two in a spreadsheet.

### What changed

A tab in a name or a value is an error. The lightbulb replaces it with a space, and offers **Create Table** for tab-separated lines pasted outside a table. A CSV arriving and a formula's result write a space instead. A tab inside a formula is the formula's own.

### How it is tested

`out/test-linter.js`, *tabs*; `out/test-messages.js`; `out/test-extension.js`, the tab lightbulbs.

---

## `...` in a table

### Before

A table had no place for a row's `...`. Flipping lines to a table left out an Example with `...` under it, and turned `- ...` into a row that read back as a Map named `|`, at the wrong indent.

### What changed

- A header cell `...` heads a **`...` column**: a row with anything in that cell has a `...` under it, the cell holding what that line would, `...` or `... terms still open`.
- The flip writes one as the other. A `...` or `- ...` between Examples becomes a `...` line in place in the table, and comes back as `...`.
- The column stays out of the CSV, and an edit coming back from the CSV leaves it as it is.

### Try it

```aot
Order
    - Acme
        price: 100
    - Bolt
        price: 200
        ... terms still open
```

Press `Ctrl+Alt+T` on `Order`: a table with a `...` column, `... terms still open` in Bolt's cell. Press it again, and the lines come back, with `price` declared under `Order`, as a flip back always writes a column.

### How it is tested

`out/test-linter.js`, *the `...` column*, and `out/test-derive.js`, *flipForm*.

---

## Identical Examples

### Before

Two rows stating the same values under different names passed every check. Before 1.12 any two Examples of one content were a clash, an error, which flagged every ledger holding two equal payments, so 1.12 narrowed the clash to Examples that share a name as well, and duplicates under two names went unseen.

### What changed

A warning when sibling Examples state the same three or more values, at least one of them uncommon in its column. Blanks, inherited values, formula results and structural columns don't count. A `...` on either row, or under their parent, excuses them, and the lightbulb writes it. See [the checks](checks.md#warnings--yellow-squiggle-in-the-problems-panel-but-not-counted-in-v), warning 18.

### Try it

```aot
Payment|payee|amount|date
P1     |Acme |$4,210|2026-03-02
P2     |Acme |$4,210|2026-03-02
P3     |Bolt |$90   |2026-03-04
```

`P1` and `P2` get the warning, each naming the other. Choose the lightbulb's `...`, and it goes.

### How it is tested

`out/test-linter.js`, *identical rows*: the threshold, blanks, formulas and the excuses; `out/test-extension.js`, *identical rows: the lightbulb*.

---

## A lone subtype, and the first one you type

### Before

A Concept with one sub-Concept warned even when another file's copy of it wrote the siblings. Typing a first subtype showed the warning at once, before you had a chance to type the second.

### What changed

- No warning when another file's copy of the Concept writes a different subtype, in the editor and `check.js`.
- When you type a first subtype, a `...` goes under its parent as the cursor leaves the parent's lines, so the warning never shows while you write. It stays until you delete it, and deleted, it does not come back.

### How it is tested

`out/test-repo.js`, the lone subtype across files; `out/test-extension.js`, *first subtype*.

---

## Your own units and formats

### Before

About 80 units were built in. A unit of your own could be named, as a Concept under `Unit`, but it converted to nothing and was written only as `<number> <unit>`.

### What changed

Rows of a kind under `Unit`, with a `factor` and a `format`. They convert within their kind, win over a built-in unit of the same name, and every file of the repository reads them: the editor, `verify.js` and `check.js`, and the formulas' runtime. A definition that can't be read is rule 27. See [Your own units](formulas.md#your-own-units).

### Try it

```aot
Unit
    Money|factor|format
    CHF  |1     |CHF #
    Rappen|0.01 |# Rp
        measures: worth

Bill
    a: CHF 10
    b: 50 Rp
    total: =@a+@b
```

`total` calculates `CHF 10.5`. Hover `(CHF)` in a column alias such as `price (CHF)` for where it sits and what it is worth.

### How it is tested

`out/test-units.js`, *own*: reading the rows, the lint errors, formats, a mark in front and behind, the command line's reading of every file, and the real runtime: conversion, a built-in kind, no factor, a column's alias, a rule's bound, and forgetting them. `out/test-extension.js`: the editor sends them with the formulas.

---

## No row limit

### Before

A file with more than 200 Examples lost the checks for misfiled rows, overlapping sub-Concepts and gaps, for every table in it. The limit protected a lattice the findings never read, and three more passes grew with the square of the rows, so a 50,000-row file stalled for about twelve seconds on each reading.

### What changed

- The row checks run on a file of any length. Only inferred dependencies stop, at 5,000 rows, since they compare rows pairwise, and say so on the first line. Only `verify.js --suggest` builds the lattice.
- The passes that grew with the square of the rows grow with the rows. On one test machine:

  | Rows | A reading in the editor | `verify.js` | `check.js` |
  |---|---|---|---|
  | 5,000 | 0.15 s | 0.4 s | 1.4 s |
  | 50,000 | 1.5 s | 2.5 s | 8.5 s |

- The pause before a reading grows with how long the last one took, from 300 ms to 2 s.
- Twenty or more findings alike show as one in the Problems panel, the others under Related. The counts stay true.

### How it is tested

`out/test-mistakes.js`: a 205-row file is told nothing of a limit, and a 5,005-row one that the dependency inference stopped. `out/test-extension.js`: the roll-up. `node out/bench-rows.js` measures every pass at 1,000 to 50,000 rows; it is not part of `npm test`.

---

## Smaller fixes

- **A file name with spaces links.** `Q3 report.pdf` in a value opens the file beside the `.aot`. A name links only with an extension that starts with a letter, so `3.14` no longer costs a look on disk. Tested in `out/test-urls.js`.
- **The "came from outside this editor" notice.** A formula you wrote could be asked about after you picked from the `@` list and saved, if VS Code's will-save step didn't run. A save the editor didn't see through that step now counts as yours, measured against the file as it was last on disk, and code that arrives from outside is still asked about. Tested in `out/test-extension.js`, *consent*. This couldn't be reproduced outside a real editor: if the notice still shows, its text and the steps before it are what's needed.
- **Picking from the `@` list replaces what you typed.** `@list p`, then `list price` picked, wrote `@list list price`. Tested in `out/test-extension.js`, *completion*.
