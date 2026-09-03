# -*- coding: utf-8 -*-
import io
p = 'README.md'
s = io.open(p, encoding='utf-8').read()
subs = [
 # the rule row is gone
 ("- As in org, the `---+---` separator row directly beneath a row is what marks that row as the header; the separator is layout, never a node. A **lone** row — nothing tabular on the line after it — is a header being typed: it is assumed, the separator and data rows still to come, so a fresh table never squiggles mid-keystroke.",
  "- **The header is the row that stands first.** Nothing declares it: the first row of a table names the Concept and its columns, and every row under it is an Example. (Before 1.12 a `---+---` rule under the header said so. It said nothing the order did not, and drew a line no reader needed; a rule left in an older file is skipped, and the next re-draw takes it out.) So a table being typed is never wrong yet — one row is a header with its rows still to come."),
 ("- **Format Document** (`Shift+Alt+F`) re-aligns every table as org's `TAB` does: each column padded to its widest cell, separator rows redrawn to match. Columns carry",
  "- **Format Document** (`Shift+Alt+F`) re-aligns every table as org's `TAB` does: each column padded to its widest cell. Columns carry"),
 ("Org's table automations are built in. While the cursor is on a table row (any line carrying a divider, or a separator), the extension takes over these keys;",
  "Org's table automations are built in. While the cursor is on a table row — any line carrying a divider — the extension takes over these keys;"),
 ("| `Alt+↑` / `Alt+↓` | Move the cursor's row up / down (a row hops over the separator) |",
  "| `Alt+↑` / `Alt+↓` | Move the cursor's row up / down |"),
 ("| `Alt+-` | Insert a separator line below the cursor's row |\n", ""),
 # the alignment feature goes with the rule that carried it
 ("""**A column can declare its alignment**, with markdown's colons in the separator:

```aot
default|left align|right align|center align
1      |1         |          1|     1
2      |2         |          2|     2
```

`:---` left, `---:` right, `:--:` centre, a plain rule no preference. Write them by hand — `|` dividers as markdown does, or the `+` this editor draws — or use **AOT Table: Align Column Left / Right / Center / Clear Column Alignment** on the column at the cursor, which writes the colons for you. The alignment belongs to the **column**, so it travels with it: move a column and its marker moves, copy one and the copy is aligned the same, delete one and its marker goes too.

Like the [width cookie](#working-with-text) and the [numbering prefix](#numbering), the colon is **presentation only**. Every reader of a table trims its cells, so no crosslink, formula, CSV row, or Gödel number can tell an aligned column from a plain one — `     1      ` is the value `1`. It is written on the separator rather than the header because the separator is where the table's *shape* is already written; the header names the attribute. A column is never drawn narrower than its own marker (`:-:` needs three characters), and the cursor lands on a right- or centre-aligned cell's **text**, not in the padding in front of it.

""",
  """**Every column is drawn left.** Column alignment went with the rule that carried it (before 1.12 a column could declare `:---`, `---:` or `:--:` in the separator): a value is padded on its right to its column's width and nothing else, so the one thing a reader has to know about a cell is its text. Alignment was always presentation — every reader of a table trims its cells — so no crosslink, formula, CSV row or Gödel number ever saw it, and nothing that was written down is lost with it.

"""),
 ("Three more commands live in the Command Palette under **AOT Table**: *Sort Rows by Column at Cursor* (org's `C-c ^` — sorts the run of data rows around the cursor, header safe behind its separator; numeric",
  "Three more commands live in the Command Palette under **AOT Table**: *Sort Rows by Column at Cursor* (org's `C-c ^` — sorts the data rows around the cursor, the header safe where it stands; numeric"),
 ("select CSV, TSV, or multi-space-aligned lines and they become an aligned table, the first line the header with the separator drawn beneath: its **first cell is kept as written**",
  "select CSV, TSV, or multi-space-aligned lines and they become an aligned table, the first line the header: its **first cell is kept as written**"),
 ("A vertical copy skips the separator exactly as `Tab` and `Enter` do, and copying a cell **down past the last row appends one**",
  "Copying a cell **down past the last row appends one**"),
 ("**Creating a table takes one keystroke**: type `|` on an empty line and a skeleton grows in place — header, separator, and an empty data row — and one `Ctrl+Z` undoes the whole thing.",
  "**Creating a table takes one keystroke**: type `|` on an empty line and a skeleton grows in place — a header and an empty data row — and one `Ctrl+Z` undoes the whole thing."),
 ("""```aot
Otter|
     |     <- cursor lands here (the Concept 'Otter' already filled in above)
```""",
  """```aot
Otter|
     |     <- cursor lands here (the Concept 'Otter' already filled in above)
```"""),
 ("The org flow still works too: type `Otter|size`, press `Enter`, type `--`, press `Tab` — the half-typed rule becomes a full separator and the cursor lands in the first cell of a new data row.",
  "There is nothing else to draw: press `Enter` at the end of the header and the cursor is in the first cell of a new row."),
 ("- **What is presentation of a grid comes off with it** — a [width cookie](#working-with-text), a column's [alignment colons](#the-table-editor). They cap and align a column, and in free text there is no column to cap.",
  "- **What is presentation of a grid comes off with it** — a [width cookie](#working-with-text) caps a column, and in free text there is no column to cap."),
 ("Below about five Examples Alpha genuinely costs *more* than prose — the header and separator are overhead a single row cannot pay off.",
  "Below about five Examples Alpha genuinely costs *more* than prose — the header is overhead a single row cannot pay off."),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
