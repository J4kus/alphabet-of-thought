# -*- coding: utf-8 -*-
import io
p = 'README.md'
s = io.open(p, encoding='utf-8').read()
subs = [
# the section's opening claim
("Alpha recreates org-mode's plain-text spreadsheet: a pipe table the linter reads as ordinary Examples, so an axiomatic start can be written as the grid it already is. **The first header cell names the Concept the table describes** — the table stands exactly where that Concept's own line would, with no separate heading above it and no extra indent:",
 "Alpha recreates org-mode's plain-text spreadsheet: a pipe table the linter reads as ordinary Examples, so an axiomatic start can be written as the grid it already is. **The pipe divides, it never borders** — one between each pair of cells and none at either end, so a table is exactly as wide as its content and its first column starts where every other line of the language starts. **The first header cell names the Concept the table describes** — the table stands exactly where that Concept's own line would, with no separate heading above it and no extra indent:"),
# the separator, and one-column tables
("- As in org, the `|---+---|` separator row directly beneath a row is what marks that row as the header; the separator is layout, never a node. A single-cell header — just `|Concept|` — heads a one-column table: the Concept over a column of its Examples. A **lone** multi-cell row — nothing tabular on the line after it — is a header being typed: it is assumed, the separator and data rows still to come, so a fresh table never squiggles mid-keystroke.",
 "- As in org, the `---+---` separator row directly beneath a row is what marks that row as the header; the separator is layout, never a node. A **lone** row — nothing tabular on the line after it — is a header being typed: it is assumed, the separator and data rows still to come, so a fresh table never squiggles mid-keystroke."),
# what a row is, and what ends a table
("- A blank line, any non-pipe line, or a change of indent ends the table. A pipe row with a single cell stays a plain Example — the `- ` form written with `|`. **Two standalone tables in a row need a blank line between them**, or the second's header reads as more data rows of the first.",
 "- **One divider is what makes a row.** A blank line, or any line carrying no `|`, ends the table; a row written *deeper* than the header nests inside it rather than ending it. So a one-cell table is not a thing to write — that is a Concept with `- ` Examples, which is what it always meant — and a literal pipe inside a value is written `¦`, the broken bar the CSV mirror already bends it to. **Two standalone tables in a row need a blank line between them**, or the second's header reads as more data rows of the first."),
# what the formatter draws
("- **Format Document** (`Shift+Alt+F`) re-aligns every table as org's `TAB` does: each column padded to its widest cell, separator rows redrawn to match. Columns carry **no gutter spaces** around the pipes — a file's width is precious — but stay vertically aligned. Lone pipe Examples are left exactly as written.",
 "- **Format Document** (`Shift+Alt+F`) re-aligns every table as org's `TAB` does: each column padded to its widest cell, separator rows redrawn to match. Columns carry **no gutter spaces** around the pipes — a file's width is precious — but stay vertically aligned. A row ends at its last written cell, since padding past it is only trailing whitespace: a row that stops short keeps the dividers of the empty cells it stops before, and a row whose *name* cell is empty — a continuation row, or one still being filled — opens with the spaces of that cell, so the columns below still line up."),
("- **A column can declare its width.** A header cell ending in an org-style width cookie — `|description <24>|` — caps that column",
 "- **A column can declare its width.** A header cell ending in an org-style width cookie — `description <24>` — caps that column"),
# the table editor's keys
("Org's table automations are built in. While the cursor is on a table row (any pipe row with a second pipe, or a separator), the extension takes over these keys;",
 "Org's table automations are built in. While the cursor is on a table row (any line carrying a divider, or a separator), the extension takes over these keys;"),
# alignment is presentation
("so no crosslink, formula, CSV row, or Gödel number can tell an aligned column from a plain one — `|     1      |` is the value `1`.",
 "so no crosslink, formula, CSV row, or Gödel number can tell an aligned column from a plain one — `     1      ` is the value `1`."),
# the scaffold
("Attributes the enclosing line **inherits from its ancestors arrive as ready-made columns** — under an `Otter` filed beneath an `Animal` that declares `legs` and `habitat`, the skeleton grows as `|Otter|legs|habitat|`. Creation-time only: a table is never re-columned when attributes are declared later, and the parent's own attribute lines stay out (they already declare — a same-named column would be a duplicate). A `|` typed beside an existing table, or mid-line, is just a pipe. The org flow still works too: type `|Otter|size|`, press `Enter`, type `-`, press `Tab` — the half-typed rule becomes a full separator and the cursor lands in the first cell of a new data row.",
 "Attributes the enclosing line **inherits from its ancestors arrive as ready-made columns** — under an `Otter` filed beneath an `Animal` that declares `legs` and `habitat`, the skeleton grows as `Otter|legs|habitat`. With nothing to inherit it still grows one empty column beside the Concept, since a table without a divider is not a table. Creation-time only: a table is never re-columned when attributes are declared later, and the parent's own attribute lines stay out (they already declare — a same-named column would be a duplicate). A `|` typed beside an existing table, or mid-line, is just a pipe. The org flow still works too: type `Otter|size`, press `Enter`, type `--`, press `Tab` — the half-typed rule becomes a full separator and the cursor lands in the first cell of a new data row."),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:70], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
