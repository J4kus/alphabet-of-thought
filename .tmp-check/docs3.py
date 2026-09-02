# -*- coding: utf-8 -*-
import io

p = 'src/table.js'
s = io.open(p, encoding='utf-8').read()
a = """// Re-align every table in the text so the pipes line up. A table is an
// unbroken run of pipe rows sharing one indent that contains a separator
// row — lone pipe Examples are left exactly as written.
// Returns the changed lines as { line, text } with 1-based line numbers."""
b = """// Re-align every table in the text so the pipes line up. A table is an
// unbroken run of rows containing a separator row; a rule with no rows
// around it is not one, and is left exactly as written.
// Returns the changed lines as { line, text } with 1-based line numbers."""
assert s.count(a) == 1
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(a, b))

p = 'docs/features-1.1-1.2.md'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("- The `|---+---|` **separator** directly below a row marks it the header; the separator is layout, never a node.",
  "- The `---+---` **separator** directly below a row marks it the header; the separator is layout, never a node."),
 ("- A **single-cell row** above a separator heads a one-column table. A **lone multi-cell row** (nothing tabular below it) is assumed to be a header being typed — so a fresh table never errors mid-keystroke.",
  "- A **single-cell row** above a separator heads a one-column table. A **lone multi-cell row** (nothing tabular below it) is assumed to be a header being typed — so a fresh table never errors mid-keystroke. **⚠️ 1.12**: the one-column table went with the borders — a row is a line carrying a divider, so a table has at least two columns; a Concept over a column of its Examples is written as `- ` lines."),
 ("- A **lone-cell pipe row** (`| Loner`) stays a plain Example.",
  "- A **lone-cell pipe row** (`| Loner`) stays a plain Example. **⚠️ 1.12**: dropped with the borders; a lone Example is written `- Loner`."),
 ("- A blank line, a non-pipe line, or a change of indent ends the table.",
  "- A blank line, a non-pipe line, or a change of indent ends the table. **⚠️ 1.12**: a row written *deeper* than the header nests inside the table instead of ending it; only a shallower line starts a new one."),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:50], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
