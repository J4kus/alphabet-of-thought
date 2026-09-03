# -*- coding: utf-8 -*-
import io
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""    foreign.some((r) => r.text === "Acme" && r.nodes && r.nodes[0] && r.nodes[0].line === 4));""",
  """    foreign.some((r) => r.text === "Acme" && r.nodes && r.nodes[0] && r.nodes[0].line === 3));"""),
 ("""      const s = blockAt(mixed, 6);
      recompute(s); // no registry, no outer: @tax rate cannot resolve
      return s.rows[2].cells[2] === "#ERR =@price*@tax rate";""",
  """      const s = blockAt(mixed, 5);
      recompute(s); // no registry, no outer: @tax rate cannot resolve
      return s.rows[1].cells[2] === "#ERR =@price*@tax rate";"""),
 ("""  check("no alignment: every column is padded on its right, whatever the old rule said",
    drawn[1] === "1      |1   |1    |1     ");""",
  """  check("no alignment: every column is padded on its right, whatever the old rule said",
    drawn[1] === "1      |1   |1    |1");"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
