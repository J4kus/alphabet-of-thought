# -*- coding: utf-8 -*-
import io

# --- derive ----------------------------------------------------------------
p = 'out/test-derive.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 # the row ends at its last cell, so the offending value ends the line
 ('''    && rowB.startCol === lines[3].indexOf("5 "));''',
  '''    && rowB.startCol === lines[3].lastIndexOf("5"));'''),
 # a row's unwritten trailing cells keep their dividers and nothing else
 ('''    row && row.changed && row.block.some((l) => /\\|James\\s*\\|\\s*\\|/.test(l)));''',
  '''    row && row.changed && row.block.some((l) => /^\\s*James\\s*\\|\\s*$/.test(l)));'''),
 # a '|' in a line-form value now opens a table row, so there is no such
 # value to bend any more — the CSV reader's own bend is tested in test-table
 ('''  // a pipe cannot survive inside a pipe table
  check("flipForm: a '|' in a value bends to a broken bar, as an arriving CSV's does",
    flip(aot("Sign", "    reads", "    - Gate", "        reads: in | out"), "Sign")
      .text.includes("in ¦ out"));

''',
  ''),
]
for a, b in subs:
    assert s.count(a) == 1, (a, s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)

# --- park ------------------------------------------------------------------
p = 'out/test-park.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ('''    "    Invoice|price|vat",
    "    -------+-----+---",
    "    INV-1  |100  |20",
    "    - INV-9",''',
  '''    "    Invoice|price|vat|note",
    "    -------+-----+---+----",
    "    INV-1  |100  |20 |ok",
    "    - INV-9",'''),
 ('''  empty[4] = "    INV-1  |100  |";''',
  '''  empty[4] = "    INV-1  |100  |   |ok";'''),
]
for a, b in subs:
    assert s.count(a) == 1, (a, s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
