# -*- coding: utf-8 -*-
import io
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""    u.changed && u.from === 0 && u.to === 3
    && u.block[0] === "Order|country|currency"
    && u.block[2] === "Acme |France |EUR");""",
  """    u.changed && u.from === 0 && u.to === 2
    && u.block[0] === "Order|country|currency"
    && u.block[1] === "Acme |France |EUR");"""),
 ("""    folded !== null && folded.from === 0 && folded.to === 3);""",
  """    folded !== null && folded.from === 0 && folded.to === 2);"""),
 ("""    lone.changed && lone.from === 9 && lone.to === 9 && lone.block.length === 3);""",
  """    lone.changed && lone.from === 7 && lone.to === 7 && lone.block.length === 2);"""),
 ("""    ins.changed && ins.to < ins.from && ins.from === 1
    && ins.block.length === 3 && ins.block[0] === "    Person" && ins.block[2] === "    John");""",
  """    ins.changed && ins.to < ins.from && ins.from === 1
    && ins.block.length === 2 && ins.block[0] === "    Person" && ins.block[1] === "    John");"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
