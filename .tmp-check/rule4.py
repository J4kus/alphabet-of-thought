# -*- coding: utf-8 -*-
import io
p = 'src/extension.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""  if (block.rows.length < 2 || block.rows[0].sep || !block.rows[1].sep) return []; // headerless""",
  """  if (table.headerIndex(block) === -1) return []; // nothing but a leftover rule"""),
 ("""  "aot.table.insertSeparator": table.insertSeparator,
""",
  ""),
 ("""  "aot.table.copyColumnRight": (b, r, c) => table.copyColumn(b, r, c, 1),
  // the column's alignment, written as markdown's colons in the separator
  "aot.table.alignLeft": (b, r, c) => table.alignColumn(b, r, c, "left"),
  "aot.table.alignRight": (b, r, c) => table.alignColumn(b, r, c, "right"),
  "aot.table.alignCenter": (b, r, c) => table.alignColumn(b, r, c, "center"),
  "aot.table.alignDefault": (b, r, c) => table.alignColumn(b, r, c, null),
};""",
  """  "aot.table.copyColumnRight": (b, r, c) => table.copyColumn(b, r, c, 1),
};"""),
 ("""// an aligned table, org's C-c |: first line the header, separator beneath.""",
  """// an aligned table, org's C-c |: the first line is the header."""),
 # the skeleton: a header and a row, and nothing between them
 ("""// header, separator, empty data row — with the cursor in the data row when""",
  """// header and an empty data row — with the cursor in the data row when"""),
 ("""      { sep: false, cells: header },
      { sep: true, cells: [] },
      { sep: false, cells: header.map(() => "") },""",
  """      { sep: false, cells: header },
      { sep: false, cells: header.map(() => "") },"""),
 ("""    const ch = indent.length;
    const line = first ? at + 2 : at;""",
  """    const ch = indent.length;
    const line = first ? at + 1 : at;"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
