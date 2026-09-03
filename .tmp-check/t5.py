# -*- coding: utf-8 -*-
import io
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""  const summary = blockAt(lines, 8);
  summary.rows[2].cells[1] = "=@Order@price@Acme";       // -> 10
  summary.rows[3].cells[1] = "=sum(@Order@price)";        // -> 30
  recompute(summary, reg);
  check("cross-table: recompute fills cells from a foreign table",
    summary.rows[2].cells[1] === "10 =@Order@price@Acme"
    && summary.rows[3].cells[1] === "30 =sum(@Order@price)");""",
  """  const summary = blockAt(lines, 6);
  summary.rows[1].cells[1] = "=@Order@price@Acme";       // -> 10
  summary.rows[2].cells[1] = "=sum(@Order@price)";        // -> 30
  recompute(summary, reg);
  check("cross-table: recompute fills cells from a foreign table",
    summary.rows[1].cells[1] === "10 =@Order@price@Acme"
    && summary.rows[2].cells[1] === "30 =sum(@Order@price)");"""),
 ("""    found[0].line === 4 && found[0].startCol === 18 && sheet[3][found[0].startCol] === "=");""",
  """    found[0].line === 3 && found[0].startCol === 18 && sheet[2][found[0].startCol] === "=");"""),
 ("""    autoFill.length === 1 && autoFill[0].line === 4 && autoFill[0].text === "    A   |10   |20 =@price*2");""",
  """    autoFill.length === 1 && autoFill[0].line === 3 && autoFill[0].text === "    A   |10   |20 =@price*2");"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
