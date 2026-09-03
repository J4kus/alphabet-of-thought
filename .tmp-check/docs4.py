# -*- coding: utf-8 -*-
import io
p = 'docs/features-1.1-1.2.md'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("- The `---+---` **separator** directly below a row marks it the header; the separator is layout, never a node.",
  "- The `---+---` **separator** directly below a row marks it the header; the separator is layout, never a node. **⚠️ 1.12**: the rule is gone — the header is the row that stands first, and a rule left in an older file is skipped and drawn away."),
 ("- `Alt+Shift+→/←` insert / delete column, `Alt+Shift+↓/↑` insert row above / delete row, `Alt+-` insert a separator below.",
  "- `Alt+Shift+→/←` insert / delete column, `Alt+Shift+↓/↑` insert row above / delete row, `Alt+-` insert a separator below. **⚠️ 1.12**: `Alt+-` went with the rule."),
 ("- **Creation flow:** header row, `Enter`, type `-`, `Tab` → a lone dash run (or a raw `|-` line) becomes a full separator. **⚠️ 1.2** adds the one-keystroke scaffold (type `|` on an empty line).",
  "- **Creation flow:** header row, `Enter`, type `-`, `Tab` → a lone dash run (or a raw `|-` line) becomes a full separator. **⚠️ 1.2** adds the one-keystroke scaffold (type `|` on an empty line). **⚠️ 1.12**: with no rule to draw, `Enter` at the end of the header is the whole flow."),
 ("- Type `|` on an otherwise-empty line → a 3-line skeleton (header / separator / empty data row), cursor in the data row; one `Ctrl+Z` undoes it all.",
  "- Type `|` on an otherwise-empty line → a 3-line skeleton (header / separator / empty data row), cursor in the data row; one `Ctrl+Z` undoes it all. **⚠️ 1.12**: two lines now, header and empty row."),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:50], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
