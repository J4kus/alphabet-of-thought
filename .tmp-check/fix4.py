# -*- coding: utf-8 -*-
import io
p = 'out/test-extension.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 # the border is gone, so every cell sits two columns to the left
 ('''  const headerOk = headerLink && headerLink.startCol === 13 && headerLink.target.line === 1;
  const cellOk = cellLink && cellLink.startCol === 14 && cellLink.text === "Ratio" && cellLink.target.line === 2;''',
  '''  const headerOk = headerLink && headerLink.startCol === 11 && headerLink.target.line === 1;
  const cellOk = cellLink && cellLink.startCol === 12 && cellLink.text === "Ratio" && cellLink.target.line === 2;'''),
 ('''    "    Ollie | 5 | brown",
    "",
    "    | Loner",
  ].join("''' + chr(92) + '''n");''',
  '''    "    Ollie | 5 | brown",
  ].join("''' + chr(92) + '''n");'''),
 ('''  const tokensOk = has([2, 13, 4, 0])   // header 'size' as attribute
    && has([2, 19, 6, 0])               // header alias 'length' as attribute
    && has([2, 29, 6, 0])               // header 'colour' as attribute
    && has([4, 6, 5, 1])                // name cell 'Ollie' as Example
    && has([4, 14, 1, 2])               // value cell '5' as value
    && has([4, 18, 5, 2])               // value cell 'brown' as value
    && has([6, 6, 5, 1]);               // lone-cell '| Loner' as Example too
  console.log(tokensOk
    ? "PASS (table: cells coloured as attribute / Example / value; lone cell as Example)"''',
  '''  const tokensOk = has([2, 11, 4, 0])   // header 'size' as attribute
    && has([2, 17, 6, 0])               // header alias 'length' as attribute
    && has([2, 27, 6, 0])               // header 'colour' as attribute
    && has([4, 4, 5, 1])                // name cell 'Ollie' as Example
    && has([4, 12, 1, 2])               // value cell '5' as value
    && has([4, 16, 5, 2]);              // value cell 'brown' as value
  console.log(tokensOk
    ? "PASS (table: cells coloured as attribute / Example / value)"'''),
 ('''  console.log(aliasLink && aliasLink.startCol === 19 && aliasLink.target.name === "Length"''',
  '''  console.log(aliasLink && aliasLink.startCol === 17 && aliasLink.target.name === "Length"'''),
]
for a, b in subs:
    assert s.count(a) == 1, (a, s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
