# -*- coding: utf-8 -*-
import io
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""      const s = blockAt(lines, 8);
      s.rows[2].cells[1] = "=@Order@price@Acme";
      recompute(s); // no registry
      return s.rows[2].cells[1] === "#ERR =@Order@price@Acme";""",
  """      const s = blockAt(lines, 6);
      s.rows[1].cells[1] = "=@Order@price@Acme";
      recompute(s); // no registry
      return s.rows[1].cells[1] === "#ERR =@Order@price@Acme";"""),
 # only the row is redrawn now: the header ends at its own last cell
 ("""    ].join("\\n")).length === 2);

  // the instrumented walk""",
  """    ].join("\\n")).length === 1);

  // the instrumented walk"""),
 ("""    priceRef && priceRef.kind === "column" && priceRef.line === 4
    && refSheet[3].slice(priceRef.startCol, priceRef.endCol) === "price"
    && priceRef.site.line === 2 && priceRef.site.col === 9);
  const rowRef = refs.find((r) => r.text === "A");
  check("formulaReferences: an Example name answers its row's first cell",
    rowRef && rowRef.kind === "row" && rowRef.line === 5
    && rowRef.site.line === 4 && rowRef.site.col === 4);""",
  """    priceRef && priceRef.kind === "column" && priceRef.line === 3
    && refSheet[2].slice(priceRef.startCol, priceRef.endCol) === "price"
    && priceRef.site.line === 2 && priceRef.site.col === 9);
  const rowRef = refs.find((r) => r.text === "A");
  check("formulaReferences: an Example name answers its row's first cell",
    rowRef && rowRef.kind === "row" && rowRef.line === 4
    && rowRef.site.line === 3 && rowRef.site.col === 4);"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
