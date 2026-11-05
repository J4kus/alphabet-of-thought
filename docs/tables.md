# Tables

[Back to the README](../README.md)

Alphabet of Thought recreates org-mode's plain-text spreadsheet: a pipe table the linter reads as ordinary Examples, so an axiomatic start can be written as the grid it already is. **The pipe divides, it never borders** — one between each pair of cells and none at either end, so a table is exactly as wide as its content and its first column starts where every other line of the language starts. (One table has no pair of cells to divide — a Concept with **no attributes**, one column of names and nothing else — and there the pipe *closes* the row instead, `Alice|`, which is what keeps such a table a table rather than plain outline lines.) **The first header cell names the Concept the table describes** — the table stands exactly where that Concept's own line would, with no separate heading above it and no extra indent:

```aot
Order           |country|currency|basket size
Acme March Order|France |EUR     |$1,200
Bolt March Order|Germany|EUR     |$3,100
Kite March Order|Japan  |JPY     |$780
```

- The header row's **first cell names the Concept** — capitalised, like any Concept — and the cells after it declare the columns as **attributes** of that Concept, exactly as bare lowercase lines would. So a capitalised column, or a lowercase first cell, is an error. *(Before 1.9 the table was indented beneath a separate `Concept` line and its first cell was a `name` label; that label is gone — write the Concept's name in its place.)*
- **What no row says stands one level under the table.** The first cell names the Concept, so one level under the table is one level under the Concept. A value, a `...` line or a sub-Concept written there is the Concept's, never the last row's, and a cell's derivation reads a value there by name:

  ```aot
  Order|price|vat =@price*@tax rate
  Acme |100  |20
      tax rate: 0.2
      total: 20 =@Order@vat.sum()
  ```

  A row holds only its cells. A row that needs a line of its own is written in line form, where it has a line to hang one under. A line under a table ends it, so a row written after one starts another table.
- **A Concept may also keep a line of its own beside its grid.** Give the Concept its own line and repeat its name in the first header cell: the table then *fills that Concept in* rather than declaring a twin, so its default values, its `- ` Examples, and the grid's rows all belong to the one Concept:

  ```aot
  Order
      tax rate: 0.2
      - Loose
          price: 50
      Order|price|vat
      Acme |100  |20 =@price*@tax rate
  ```
- **The header is the row that stands first.** Nothing declares it: the first row of a table names the Concept and its columns, and every row under it is an Example. So a table being typed is never wrong yet — one row is a header with its rows still to come.
- **A header states defaults as the Concept's lines would.** `Currency: EUR|symbol` gives the Concept its [default](language.md#example--a-concrete-individual) in the first cell. `Order|price|tax rate: 0.2` gives the column `tax rate` the default `0.2`, which every empty cell under it reads, exactly as the line `tax rate: 0.2` under `Order` would. A header default is stated, not derived. A capitalised `Name: value|…` line is a header; a lowercase or `- ` line with a colon before its first pipe stays a value holding a pipe.
- Every data row is an **Example** named by its first cell — filed under the Concept the header names — and every further cell is that Example's **Attribute Value** for its column. An empty cell asserts nothing. A row with more cells than the header names, and an empty name cell, are both errors.
- **A row sits under another by naming it, and that is an Example hierarchy.** A table never nests by indentation. A sub-Example names the row it sits under in the table's **`parent (thing)`** column: named `parent`, its `(alias)` the table's own Concept, lowercased, so by the alias rule every cell under it names one of the table's rows. That is exactly what `- Child` under `- Parent` says in free text, so a grid can hold a tree and not only a list:

  ```aot
  Thing       |parent (thing)|age
  Parent      |              |
  Child 1     |Parent        |10
  Child 2     |Parent        |12
  Other Parent|              |
  Child 3     |Other Parent  |7
  ```

  - A parent cell names the nearest row *above* it with that name, case and numbering aside, else the first one below. A sort can leave a parent below its child, and the tree is the same.
  - It never names the row itself, so a child named like its parent is still filed under it, and meets [rule 24](checks.md#errors--red-squiggle-counted-in-v-the-file-does-not-verify).
  - A name no row of the table carries, a row naming itself, and a circle of parents are errors.
  - The column is structure, not an attribute: no value, no Gödel prime, no default.
  - Its cells link to the rows they name, so Ctrl+click, hover and rename follow them.
  - It is the column the [CSV mirror](#the-csv-mirror) has always written the tree in, so the table, its spreadsheet and a DataFrame of it are one shape.
  - A row's cells are its own: a child inherits none of its parent's.
  - A row's indent means nothing: this column is the only way a table nests. An indented row is only a row, and Format Document draws it flush.
- **A `...` line inside a table is a note, not a row.** It is kept where it stands and drawn as written by every sort, fold, flip and move, and it reaches neither the model nor the CSV. `Ctrl+/` on a row writes one.
- **A row's name may hold a colon**, so `10:30 Standup|Room 4` is a row. A lowercase first word followed by a colon (`note: a|b`) still reads as a value.
- **A divider groups rows.** Dashes between the pipes, `-----|---`, group a table's rows as a blank line groups an outline's lines; [the flip](#flipping-between-a-table-and-free-text) turns one into the other. A divider is drawn to its columns' widths, and holds no cells. Every key steps over it, and a sort stays within the group the cursor is in.
- **One pipe is what makes a row — unless a colon stands before it.** A blank line, any line carrying no `|`, or a row *shallower* than the header ends the table. A name never holds a colon, so a lowercase or `- ` line whose first pipe comes *after* a colon is a `name: value` line with a pipe in its value — `rule: a | b`, `- Ann: x|y` — and never a row; a row's own colons stand in its cells, after the first divider (`|12:30`, `Ollie|http://…`). Only inside a table **cell**, where a pipe divides, is a literal pipe written `¦`, the broken bar the CSV mirror already bends it to. **Two standalone tables in a row need a blank line between them**, or the second's header reads as more data rows of the first.
- **Format Document** (`Shift+Alt+F`) re-aligns every table as org's `TAB` does: each column padded to its widest cell. Columns carry **no gutter spaces** around the pipes — a file's width is precious — but stay vertically aligned. A row ends at its last written cell, since padding past it is only trailing whitespace: a row that stops short keeps the dividers of the empty cells it stops before, and a row whose *name* cell is empty — one still being filled — opens with the spaces of that cell, so the columns below still line up. A table with no attributes has no divider to draw, so its rows close with the pipe instead (`Org Structure|` over `Department A |`), and that pipe reads back as the empty last cell it looks like — which is why re-drawing it changes nothing.
- **One row is one line, and a cell is never broken to fit.** A column is as wide as its widest cell, however long that is. *(Between 1.8 and 1.12 a header cell could carry a width cookie — `description <24>` — capping its column and wrapping longer values onto continuation rows. It is gone: a cookie bought a narrow table at the price of the plainest rule the language has, and `<24>` is now nothing but part of a column's name.)*

## The table editor

Org's table automations are built in. While the cursor is on a table row — any line carrying a divider — the extension takes over these keys; every one of them re-aligns the whole table first, so a table never needs manual spacing:

| Key | What it does |
|-----|--------------|
| `Tab` | Re-align, then jump to the next field; at the table's last field a new empty row is appended |
| `Shift+Tab` | Previous field, wrapping to the row above |
| `Enter` | Same column, next row; appends a row at the bottom (`Shift+Enter` still inserts a plain newline to leave the table) |
| `Alt+←` / `Alt+→` | Move the cursor's column left / right, header and all |
| `Alt+↑` / `Alt+↓` | Move the cursor's row up / down |
| `Alt+Shift+→` | Insert an empty column where the cursor stands (on the name column, just after it) |
| `Alt+Shift+←` | Delete the cursor's column. The first column, which names the Concept and its Examples, is never moved, copied or deleted by a column key |
| `Alt+Shift+↓` | Insert an empty row above the cursor's |
| `Alt+Shift+↑` | Delete the cursor's row |
| `Ctrl+Alt+↑` / `Ctrl+Alt+↓` | **Copy** the cursor's whole row above / below it — the next Example is usually the last one with two fields changed |
| `Ctrl+Alt+←` / `Ctrl+Alt+→` | **Copy** the cursor's whole column to its left / right, header and every value |
| `Ctrl+Alt+Shift+` arrow | **Copy the cell** into its neighbour in that direction and follow it there, so holding the key fills a run |
| `Ctrl+]` / `Ctrl+[` | VS Code's own indent / outdent of the selected lines — how a whole table is re-filed under a different parent. `Tab` in a table always travels the cells, lines selected or not |
| `Ctrl+Alt+T` or `Ctrl+K T` | Write the Concept at the cursor out as free text, and the same key writes it back as a table — see [Flipping between a table and free text](#flipping-between-a-table-and-free-text). Also on the right-click menu and in the Command Palette, for a keyboard that loses the chord |

The keys a spreadsheet hand reaches for without looking work here too, inside a table row:

| Key | What it does |
|-----|--------------|
| `Ctrl+`arrow | Jump to the **edge of the data**: from a filled cell, to the last filled cell before a gap; from an empty one, to the next filled cell; with nothing that way, to the table's edge. Moves the cursor only — nothing is re-aligned |
| `Ctrl+Shift+`arrow | The same jump, **selecting** as it goes |
| `Ctrl+Home` / `Ctrl+End` | The table's first cell (the Concept's name) / its last (the last row's last column); pressed again from there, the top or bottom of the file. With `Shift`, selecting |
| `Ctrl+A` | Select the table; pressed again, the whole file |
| `Ctrl+D` | **Fill down**: the cell above into the cursor's cell — or, with rows selected, the first selected row into the rest, across every selected column |
| `Ctrl+R` | **Fill right**: the cell to the left into the cursor's cell — or, with cells selected, the first selected column into the rest of each row |
| `Ctrl+'` | Copy the **derivation** from the cell above, without a value until the file calculates |
| `Ctrl+Shift+'` | Copy the **value** from the cell above, its derivation left behind |
| `Ctrl+;` / `Ctrl+Shift+;` | Today's date (`YYYY-MM-DD`, the form a date constraint reads) / the time now — anywhere in a `.aot`, not only in tables |
| `F9` | **Calculate now**: everything out of date, whatever reads nothing in the file (a date, a random number, a file it loads), and anything that failed, then every constraint — anywhere in a `.aot`. See [Running](formulas.md#running) |

Fills move a cell's text as written — a derivation arrives alone, its value left for the next run to compute in the new place — and never take the header or the name column as their source — an attribute's name or an Example's is no value a cell means to hold. Inside a table row — and on an Example's line or value in free text, [below](#the-table-editor) — `Ctrl+←`/`Ctrl+→` no longer steps a word at a time (it jumps cells instead), `Ctrl+D` no longer adds the next match to the selection, `Ctrl+R` no longer opens a recent folder, and `Alt+↑`/`↓` and `Ctrl+Alt+↑`/`↓` move and copy rows instead of lines and cursors; anywhere else every one of them is VS Code's own again. Deliberately left out: `Ctrl+Space` / `Shift+Space` (they would cost the suggestion list and a Shift-held space), `Ctrl+PgUp` / `Ctrl+PgDn` (editor tabs), and `Ctrl+-` / `Ctrl++` (zoom — `Alt+Shift+`arrows already insert and delete).

**The same keys work in free text.** A table is [pure shorthand](#tables-are-pure-shorthand) for the `- Example` lines it parses to, so a Concept written as lines is a grid too: each **Example is a row** (its `- Name` line and the lines under it, sub-Examples after their parent), each **attribute a column** (in the order the Examples write them), and a **cell is an Example's `attribute: value` line** — a cell nobody wrote is a line nobody wrote. With the cursor on an Example's line or one of its values, every table key above but `Tab` and `Enter` works on that grid:

```aot
Person
    age
    - Ann             <- Alt+↓: Ann, values and sub-Examples, below Bob
        age: 30       <- Ctrl+Alt+Shift+↓: 'age: 30' into Bob, in column order
        city: Paris
    - Bob
        city: Rome    <- Ctrl+D: 'city: Paris', from the Example above
```

- **`Tab` and `Shift+Tab` are VS Code's own here**, as in any other file: they indent and outdent by 4 spaces. Only a table row takes them for its cells.
- **Rows:** `Alt+↑`/`↓` moves an Example over its neighbour (sub-Examples travel with it, a blank line between them stays between them), `Ctrl+Alt+↑`/`↓` copies one, `Alt+Shift+↓` inserts an empty `- ` above, `Alt+Shift+↑` deletes one with its sub-Examples.
- **Columns:** `Alt+←`/`→` swaps the attribute's lines with its neighbour's in every Example that states both, `Alt+Shift+←` deletes the attribute everywhere (declaration included), `Alt+Shift+→` opens an empty declaration line for a new one, `Ctrl+Alt+←`/`→` duplicates it. These column keys work from the attribute's **declaration line** too (`age` under the Concept), which is the column's header.
- **Cells and the spreadsheet keys** behave as in a table: a value filled or copied into an Example that lacks the attribute gets a new line, placed in column order under the name; a value emptied loses its line, since an empty cell asserts nothing. A derivation a key copies arrives alone and computes when the file next calculates.

Every operation edits the lines it is about and nothing else — no line is reordered, re-indented, declared or re-spelled that the key did not ask for (flipping the Concept to a table and back would do all four). Where the text looks like an Example's line but the parse says otherwise (an attribute's allowed values, `- draft` under `status`), the key does what VS Code does with it.

**Keyboard layouts.** VS Code does not tell a left modifier from a right one — but on a layout where the right `Alt` is **AltGr** (United Kingdom, US-International, most European layouts) that key is not `Alt` at all, and VS Code on Windows reads neither `Right Alt+↑` as `Alt+↑` nor `Right Ctrl+Right Alt+T` as `Ctrl+Alt+T`. No extension keybinding can tell AltGr apart, so use the left `Alt`, or switch the layout to US (*Settings → Time & language → Language & region →* your language *→ Language options → Keyboards*). The flip has `Ctrl+K T` and the right-click menu, which need no `Alt` at all. Windows' own **Left Alt+Shift** switches input languages, which is also the start of every `Alt+Shift+`arrow table key — if the layout seems to change under you, change that hotkey under *Settings → Time & language → Typing → Advanced keyboard settings → Input language hot keys*.

**`Tab` never moves the data.** Inside a table it travels the cells and nothing else — pressed in the leading spaces, at the head of a name cell, anywhere past it, or with lines selected. A table nests through its parent column, so there is no indent there for a key to mean. The cursor's row is nested or lifted by name from the Command Palette:
- **AOT Table: Nest Row Under the Row Above** writes the row above's name into the parent cell, and adds the column, second, when the table has none.
- **Lift Row Out of Its Parent Row** writes its parent's parent, or empties the cell.

The row's own sub-Examples name it, so they travel along. Off a table, `Tab` and `Shift+Tab` are VS Code's own, and in line form that is how an Example nests, since there the indent *is* the nesting.

**Several cursors move together.** `Tab`, `Shift+Tab` and `Enter` move each cursor in its own row, bottom-up so a new row shifts no other. If any cursor is off a table, the key does what VS Code does with it.

**Every column is drawn left.** A value is padded on its right to its column's width and nothing else, so the one thing a reader has to know about a cell is its text.

**A row moves alone, and its place in the tree goes with it.** A row names its parent rather than standing under it, so `Alt+↑` / `Alt+↓` move one row, hopping a divider into the next group, and **Sort Rows** orders the rows of the cursor's group as the flat list they are. A child sorted above its parent still names it. `Alt+Shift+↑` deletes a row with every row whose parents lead back to it, wherever they stand, as deleting a `- Parent` line takes the lines under it; one `Ctrl+Z` brings the branch back. A copied row (`Ctrl+Alt+↑`/`↓`) keeps its parent cell, so it lands as a sibling.

**Copy, cut, and move are three different keys.** `Alt+`arrow **moves** a row or column, `Ctrl+Alt+`arrow **copies** it, and `Ctrl+Alt+Shift+`arrow copies the **cell** — text and derivation exactly as written, unlike the derivation copies and fills, which carry the derivation alone. Cutting a *cell* into its neighbour (the value typed into the wrong column) is four more Command Palette entries, **AOT Table: Cut Cell Up / Down / Left / Right**, unbound by default. Nothing here is clever about what it copies: a duplicated row or column will report as a repeated Example name or a repeated attribute until you rename it, and that rename is usually the point of the copy.

Copying a cell **down past the last row appends one**, so a column fills into a table that is still growing. Sideways never grows the table — a new column needs an attribute name of its own.

Three more commands live in the Command Palette under **AOT Table**: *Sort Rows by Column at Cursor* (org's `C-c ^` — sorts the data rows around the cursor, the header safe where it stands; numeric when every key reads as a number, with `$`, `%`, and thousands commas ignored, alphabetic otherwise), *Create Table from Selected Lines* (org's `C-c |` — select CSV, TSV, or multi-space-aligned lines and they become an aligned table, the first line the header: its **first cell is kept as written** — that names the Concept — and the rest are lowercased into attribute columns), and *Copy Formula Down the Column* (see [Running](formulas.md#running); also offered by the lightbulb on any derivation in a cell).

**Creating a table takes one keystroke**: type `|` on an empty line and a skeleton grows in place — a header and an empty data row — and one `Ctrl+Z` undoes the whole thing. Typed under an existing Concept line, the first header cell is **filled with that Concept's name** and the cursor waits in the data row; typed at the top level, the first cell is left empty for you to name the Concept, and the cursor waits there:

```aot
Otter|
     |     <- cursor lands here (the Concept 'Otter' already filled in above)
```

Attributes the enclosing line **inherits from its ancestors arrive as ready-made columns** — under an `Otter` filed beneath an `Animal` that declares `legs` and `habitat`, the skeleton grows as `Otter|legs|habitat`. With nothing to inherit it still grows one empty column beside the Concept, since a table without a divider is not a table. Creation-time only: a table is never re-columned when attributes are declared later, and the parent's own attribute lines stay out (they already declare — a same-named column would be a duplicate). A `|` typed beside an existing table, or mid-line, is just a pipe. There is nothing else to draw: press `Enter` at the end of the header and the cursor is in the first cell of a new row.

### Keeping your place in a long or wide table

A text editor cannot freeze a column the way a spreadsheet does: there is one scroll surface and it carries the whole line. Two things stand in for it, and between them they answer both directions.

**Down the table, the header pins itself.** The extension publishes the parsed tree as document symbols, which makes a grid's header line the **parent** of its rows — so VS Code's own **sticky scroll** holds it at the top of the viewport while you scroll the rows, exactly as it holds an enclosing Concept. That is the freeze, done by the editor rather than faked, and it costs nothing because the tree is already parsed. Turn it on with `editor.stickyScroll.enabled` (VS Code ≥ 1.84 has it on by default); the same symbols also fill the **Outline** view and the **breadcrumbs**, which are worth having on an indented tree in their own right.

**Across the table, the status bar says where you are.** Nothing can pin the name column, so the right-hand end of the status bar names the cell instead — `Person ▸ Socrates ▸ occupation`: the Concept, the Example the row names, and the attribute the column declares. It reads the same however far right you have scrolled, and it tells you the *column* too, which a frozen name column never would.

## The CSV mirror

Every Concept with Examples lives twice: as the notation in the `.aot` — a table, `- ` lines, or both — and as **one union CSV named after the Concept** in **one `aot.files` folder at the repository root**, shared by every `.aot` in the repo. The CSV is per **Concept**, not per table (unified in 1.6): its rows are every Example in the Concept's scope — table rows and `- ` Examples together, and a table filed under an `- Example` mirrors into the **first Concept up the tree** — and its columns are the **union of every attribute** any of them carries. A row silent on a column answers the inherited default, else stays blank, so Examples carrying different attributes all fit one file. A Concept written in several files mirrors **their union**, and each row's edit goes back to the file that lists it.

**The file saved last overrides the other** (`src/csvsync.js`). That is the whole rule, and it holds even where the other file was edited too. The two files' save times decide, so nothing is merged, and it works the same in a moved folder and on a new profile.

**On a fresh clone, look at what changed.** Git writes files in no particular order. A CSV that says the same as its `.aot` changes nothing, but a committed CSV that differs can be the later of the two, and it overrides the `.aot` when the folder opens. Git shows that as a change, and restoring the `.aot` makes it the newest again.

| Saved last | What happens |
|---|---|
| the `.aot` | the CSV is rewritten from it, whatever the CSV said |
| the CSV | the `.aot` takes every cell where the two differ, and loses every row the CSV no longer lists |

So:
- **An edit in the other file is overwritten**, in any cell, and no notice says so. In a `.aot` open in the editor, `Ctrl+Z` brings it back. Otherwise only git can.
- **Only the time counts.** A CSV saved last wins even where it says an older value. A CSV whose time is older than the `.aot`'s loses, even one just copied into the folder, since a copy can keep its old time.
- An **emptied** cell empties, and a **new row** arrives.
- A row the CSV no longer lists is **deleted from the `.aot`** with nothing asked, along with everything written under it. The one exception is a row whose sub-row the CSV still lists: it stays, and a notice says so.
- **A CSV cut short, or replaced by another file, is still the file saved last.** The rows it does not list are deleted. `Ctrl+Z` brings them back if the `.aot` is open; otherwise only git can.
- A column comes from the `.aot` alone. One the CSV adds is not read.

Every sync point applies the same rule:
- **Saving the `.aot`** writes one CSV per Concept with Examples in its scope — a table, `- ` lines, or both (an assumed lone header still being typed is left alone) — over whatever the CSV says. Cells holding commas, quotes, or newlines are quoted per RFC 4180.
- **A `.aot` saved by another program, or a pull,** does the same as soon as the file watcher hears it.
- **Saving a CSV** — in Excel, a script, anything — folds it back **by Example name, wherever each lives**: a table row updates cell by cell within its table's own columns (redrawn aligned, dividers where they stood), a line-form Example updates attribute by attribute, and a fresh name lands in the Concept's own shape — a row of its table when it has one, else a `- ` block (under its parent's `- ` line, when its `parent` cell names one). A value the Example already reads from a default is not written down as its own. Columns arrive when a table is created, never from the mirror. A value carrying a **formula** is left to its formula.
- **Unsaved text is no save, so a CSV saved last overrides it too.** The table in the open `.aot` ends up saying what the CSV says, cells and rows alike, your unsaved edits to it included. `Ctrl+Z` brings them back. Anything else unsaved in that file stays, and the file is left for you to save. Saving it makes the `.aot` the file saved last, and the CSV is written.
- **Until you save that `.aot`, the CSV is still the file saved last.** **AOT: Sync CSVs Now** or a window reload applies it again, and anything typed in that table since goes; `Ctrl+Z` brings it back. Save the `.aot` to end this.
- **A CSV with nothing new overrides nothing.** A CSV saying what the saved `.aot` says has no word of its own, however late it was saved. The mirror writes the CSV after every `.aot` save, so this is what keeps it from wiping what you type next.
- **The mirror's own writes are nobody's save.** A CSV folding in saves its `.aot`, and a calculation saves what it computed. Neither counts against another CSV you edited, so two CSVs edited with the editor closed both arrive. And a CSV still saying exactly what the mirror wrote overrides nothing.
- **When the editor starts**, the folder is caught up by the same rule, so an edit made with VS Code closed, to either file, is not missed. The extension starts with any folder holding a `.aot`, so a CSV edit is heard whether or not a `.aot` is open. A folder already in step costs nothing.
- **AOT: Sync CSVs Now** (`Ctrl+K Y`) applies the rule by hand, to every CSV. With `aot.tableCsvSyncMode` set to `manual`, it is the only sync there is.

- **A nested scope carries its shape in a `parent` column.** Every reader of a CSV trims its cells, so an indent would not survive the trip out to a spreadsheet and back. Where a Concept's Examples nest, the mirror writes one extra column — `parent`, naming the row each row sits under, empty for a top-level one — which a spreadsheet cannot damage. It is the column a [table](#tables) nests through too, `parent (thing)`, so merging it back writes the row's parent cell, and re-parenting a row in Excel re-files it. A **flat** scope nests nothing and gains no column; a Concept that already states its own `parent` attribute keeps that one column, since it is the same fact under the same name.
- **A line break in a cell stays one cell.** `Alt+Enter` in Excel reads `↵` in the `.aot` (`Line 1↵Line 2`) and goes back as a real line break, so nothing is lost and no Example is invented.
- **A name stays a row, whatever a spreadsheet holds.** A new row's name that would read as a formula or a Map has its opening bent: `=x()` arrives as `＝x()`, and a leading `...` as `…`. So a CSV carries no code in through a name.
- **A Concept's name need not be a file name.** A file name cannot hold `\ / : * ? " < > |`, so `Input/Output` writes `Input-Output.csv`, and an edit to that file finds its Concept. Where two Concepts would write one file (`Input/Output` and `Input-Output`), neither is mirrored, and a warning says to rename one.
- **A Concept a file stops speaking for** has its CSV rewritten from the files that still do, straight away, so the rows you removed stay removed rather than moving to the other file. Deleting a `.aot` does the same.
- **A folder can have any name.** A model at `reports/out/Q3.aot` is found like any other. Only `node_modules`, `.git` and `aot.files` are not searched.
- **Hover a Concept to open its CSV.** Hovering its name, or anything that links to it, offers **Open Order.csv**, once the CSV exists.
- **Saving also tidies**: a CSV whose Concept no file *anywhere in the repo* still speaks for is not deleted — it is archived with a `_` prefix (`_Order.csv`) and skipped by the fold-back watcher.
- **One folder, one repository.** The root is the nearest `.git` above the `.aot` — so a subfolder opened on its own, a repository opened as several workspace folders, and a file opened with no folder at all all write to the same place, and a repository nested in another (a submodule) keeps its own. A file in no repository falls back to the workspace root.
- **Only `.csv` files are the mirror's business.** `aot.files` is the repo's one side-folder, so it also holds the [`.formulas` stores](formulas.md#parking-the-derivations) and any file a value cites by path. The mirror writes, archives, and folds back `*.csv` and nothing else.
- **What Excel writes is read as what it means.** A **byte-order mark** in front of the first cell (Excel's *CSV UTF-8*) is dropped rather than carried into the cell that names the Concept, and a **semicolon-delimited** file — all Excel writes where the comma is the decimal mark — is read as cells. The mirror itself always writes plain commas and LF. Excel holds a **lock** on the workbook it has open, so a save that cannot write the CSV says so and leaves it alone instead of failing silently (a workbook then saved over it is the file saved last, and overrides the `.aot`); and because Excel saves by renaming a temp file over the target, a fold-back that catches the file mid-swap retries rather than dropping the edit.
- Both directions write only when the content genuinely differs, so the two mirrors never chase each other. Line endings and a byte-order mark are not a difference: a CSV that came back from Excel or git with CRLF is the same data, and is left alone. A CSV you have open with **unsaved edits** is never overwritten — you get a warning to save or revert it first. A pipe typed into a CSV cell is bent to a broken bar (`¦`), since it cannot survive inside a pipe grid. Two files with a same-named Concept share one CSV — the repo-wide duplicate-Concept warning makes that visible; two same-named Examples at different levels of one Concept's scope merge by name on the fold, first one wins.

**A Concept written purely line-form mirrors exactly as a table does.** A table and a `- ` list are one idea in two spellings, so the Concept below writes `Integer.csv` on its first save with nothing placed there beforehand — and a Concept listing **bare names** writes its one-column CSV just as a table of names would.

Save the Concept below and it keeps `aot.files/Integer.csv` up to date; edit that CSV and the rows fold back — merged by name, so an Example already there is updated attribute by attribute and one that is not is appended whole:

```
aot.files/Integer.csv          Integer
    Integer,is prime               - 1
    1,Yes                              is prime: Yes
    35,No                          - 35
    7,Yes      <- added                is prime: No
                                   - 7            <- folded in
                                       is prime: Yes
```

A CSV arriving is data, and data is no reason to restructure a tree you wrote deliberately: the Concept keeps the form it is written in. A value carrying a **formula** is left to its formula. A blank cell empties a value only when it held one the last time the two agreed; otherwise it says nothing, since a CSV cannot tell "empty" from "unsaid".

**Archived CSVs are still worth reading.** A `_Person.csv` is never folded back — that would silently undo the archiving — but the values in it were real once, so they are offered as **completions** where a `person:` value is typed — line form or a typed column's table cell alike — listed after the Concept's live Examples and marked `archived in _Person.csv`.

**A file you cite can be brought in.** Put the cursor on any file-path value pointing outside `aot.files` and the lightbulb offers **Copy '<name>' into aot.files**: the file is copied in and the value rewritten to `aot.files/<name>`, so the model travels with its evidence instead of pointing into somebody's Desktop. A file already there with the same bytes is simply relinked; one that differs asks before replacing, and offers to keep both. A CSV that any value points at counts as claimed, so the tidy-up never archives the very file a link names.

The mirror means the same knowledge is at once a checked model and an ordinary spreadsheet any tool can read. Turn it off with the `aot.tableCsvSync` setting.

## Tables are pure shorthand

The tree a table parses to is identical to writing each row as a `- Example` with `attribute: value` children, so everything that reads the tree works over a table unchanged — inheritance, the crosslinks (a header cell that names a Concept underlines solid, a value cell that names an Example underlines dotted, and both Ctrl+click to the definition), the FCA audit, the Gödel numbers, and the dependency inference.

Every editor feature reaches inside the cells too:

- **Colouring**: the first header cell is painted as the **Concept** it names, the header cells after it as attributes, each row's first cell as an **Example**, and the rest as Attribute Values — the very colours their written-out line forms get — with the pipes left as quiet table chrome.
- **Aliases**: a header cell may carry a parenthetical alias, `size (length)`, which strips, colours, and crosslinks exactly as it would on a bare attribute line — the first header cell's `(alias)` naming the Concept.
- **Linting in place**: a table finding pins the offending cell rather than the whole line — a lowercase or empty first cell, a capitalised column, a row's extra cells, and an empty name cell each squiggle where they sit.

That last point is how Alphabet of Thought answers org's `#+TBLFM` formula line. Org's spreadsheet re-computes derived columns; Alphabet of Thought's linter audits them (a [Python](formulas.md) derivation computes a value when the file calculates, and the linter judges what it wrote like any other value). Two rows with the same name are an identical-siblings error; two rows with identical content are a Gödel clash; a row that carries every attribute another Concept's Examples share is drift; and a column whose values are pinned down by another column — the very thing org would compute with a formula — is what the Armstrong dependency warnings flag. In Alphabet of Thought a computed column is not a formula to store but a dependency to model once, against its determinant. See [`examples/features.aot`](../examples/features.aot).

## Flipping between a table and free text

If the two forms say the same thing, the choice between them is a question about the *data*, not about the model — and it is a question you answer differently as the data grows. Six short attributes across twenty Examples want to be a grid; two Examples carrying a paragraph each want to be lines. **`Ctrl+Alt+T` writes the Concept at the cursor out in the other form, and the same key writes it back.** Where the operating system or the keyboard layout takes `Ctrl+Alt+T` for itself, `Ctrl+K T` does the same, and so do the right-click menu and the Command Palette (**AOT: Flip Concept Between Table and Free Text**). It is not on the lightbulb: offered on every line of every Concept, it lit the bulb everywhere. The cursor may stand anywhere inside the Concept — its own line, a header cell, a row, an attribute name, a value — and **it stays on the same idea**. A value line's cursor lands in that value's cell, as far in as it was. A declaration's lands on its header cell, and an Example's line on its row's name, and back. An empty cell writes no line, so its cursor lands on the Example's name, and comes back to that cell.

```aot
Person                                  Person   |first name|age
    first name                          Aristotle|A         |10
    age                        <-->     Socrates |Sokrates  |20 =10+10
    - Aristotle
        first name: A
        age: 10
    - Socrates
        first name: Sokrates
        age: 20 =10+10
```

- **No Example and no value is ever lost**, and a derivation moves exactly as typed — `20 =@price*@tax rate` travels whole. An attribute's `(alias)` and its constraints ride on the header cell going out and on the declaration line coming back; a bound never lands on a value line, because it governs the attribute rather than each value of it. A `|` arriving from a CSV bends to a broken bar, since the divider cannot live inside a cell.
- **One thing does move: an attribute a single Example only *declares*.** A bare `nickname` under `- Socrates` states an attribute without giving it a value, and a table has exactly one place for an attribute name — the header — so it becomes a column of the Concept with Socrates's cell empty. The declaration widens from the one Example to all of them; the empty cell still asserts nothing. It is the one reading a grid cannot express, and it is why the flip tells you what it did rather than doing it silently.
- **What is presentation of a grid comes off with it** — a column is padded to its widest cell, and in free text there is no column to pad.
- **The flip computes nothing.** Every value stays exactly as it was written, and each derivation travels whole beside it; the next calculation runs them where they have landed.
- **The flip stops rather than lose anything, with an error on the exact line.** A table row holds one value per column, so two values for one attribute on one Example (`tag: red`, `tag: blue`) stop it: keep one. A table has no place for allowed values listed on lines, so `status` with `- draft` under it stops it too: write `status =("draft", "sent")` on one line, and flip again. Nothing changes until you do.
- **A sub-Example is a row too.** An Example carrying Examples of its own flips to a row naming its parent in the `parent (thing)` column — added, second, only when something nests — and back to a `- ` line under its parent's, so a tree written as lines and the same tree written as a grid are one idea in two spellings:

  ```aot
  Thing                                   Thing       |parent (thing)|age
      age                                 Parent      |              |
      - Parent                   <-->     Child 1     |Parent        |10
          - Child 1                       Child 2     |Parent        |12
              age: 10
          - Child 2
              age: 12
  ```

- **A blank line above an Example is a divider above its row**, and back: the blank between a Concept's declarations and its first Example is a divider under the header. Blank lines anywhere else (inside one Example's lines) are presentation and do not survive the round trip.
- **A Concept with no Examples flips too**, to its header alone (`Person|age|city`, or `Person|` with no attribute either), and back.
- **A default rides in the header when a row needs its column.** `Invoice: EUR` becomes the first cell, `Invoice: EUR|…`. `tax rate: 0.2` becomes a header cell when a row states its own `tax rate`, so the empty cells read the default.
- **The table always stands where the Concept's line stood, and what no row says stands [one level under it](#tables):** a value no row states, a value carrying a formula, a `...` Map, a sub-Concept, an attribute with children of its own, one both bounded and given a default (one cell cannot hold both), and any Example carrying a Map or a sub-*Concept* (which a grid has no row for):

  ```aot
  Trip                                         Trip|distance (km)|speed (km/h) =@distance/@time
      total: 195 km =@Trip@distance.sum()      A   |120          |80
      distance (km)                 <-->       B   |75           |75
      speed (km/h) =@distance/@time                total: 195 km =@Trip@distance.sum()
      - A
          distance (km): 120
          speed (km/h): 80
      - B
          distance (km): 75
          speed (km/h): 75
  ```

  Coming back, those lines are the Concept's first, so lines written that way flip back to exactly what they were. The maintained `... N more in a.aot:3` note stays last, where it is kept. A table beside the grid, above it or under it, is kept apart by a blank line, so the two never merge.
- Coming back, **a header cell is a declaration**, so it returns as the attribute line that declares the same column — which is why a Concept whose attributes were only ever stated on its Examples gains those declarations on the way back. That is the tree the table always parsed to, now written down. A row with no name keeps its values, under a `- ` that waits for one.
