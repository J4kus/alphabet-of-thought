# -*- coding: utf-8 -*-
import io
NL = chr(92) + 'n'   # the two characters a backslash-n is written with
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ('check("cellStart: column offsets on the aligned line", cellStart(block, 0) === 5 && cellStart(block, 1) === 12 && cellStart(block, 2) === 17);',
  'check("cellStart: column offsets on the aligned line", cellStart(block, 0) === 4 && cellStart(block, 1) === 11 && cellStart(block, 2) === 16);'),
 ('    found[0].line === 4 && found[0].startCol === 19 && sheet[3][found[0].startCol] === "=");',
  '    found[0].line === 4 && found[0].startCol === 18 && sheet[3][found[0].startCol] === "=");'),
 ('''  check("recomputeAll: a value that widens its column redraws the block",
    recomputeAll([
      "    name|price|total",
      "    ----+-----+-----",
      "    A   |10   |=@price*20",
    ].join("''' + NL + '''")).length === 3);''',
  '''  // the header ends at its own last cell, so widening the last column
  // redraws the rule and the row but leaves the header exactly as written
  check("recomputeAll: a value that widens its column redraws the block",
    recomputeAll([
      "    name|price|total",
      "    ----+-----+-----",
      "    A   |10   |=@price*20",
    ].join("''' + NL + '''")).length === 2);'''),
 ('    && priceRef.site.line === 2 && priceRef.site.col === 10);',
  '    && priceRef.site.line === 2 && priceRef.site.col === 9);'),
 ('    && rowRef.site.line === 4 && rowRef.site.col === 5);',
  '    && rowRef.site.line === 4 && rowRef.site.col === 4);'),
 ('    cellStart(b, 2, 2) === "default|left align".length);',
  '    cellStart(b, 2, 2) === "default|left align|          ".length);'),
 ('    cellStart(b, 2) === "default|left align".length);',
  '    cellStart(b, 2) === "default|left align|".length);'),
]
for a, b in subs:
    assert s.count(a) == 1, (a, s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
