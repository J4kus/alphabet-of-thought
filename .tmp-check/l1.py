# -*- coding: utf-8 -*-
import io
p = 'out/test-linter.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""  check("isSeparator: '---+---' yes, a name and a lone dash no",
    isSeparator() && !isSeparator("a") && !isSeparator("-"));""",
  """  check("isSeparator: a leftover rule yes, a name and a lone dash no",
    isSeparator("---+---") && !isSeparator("a") && !isSeparator("-"));"""),
 ("""  check("align: the separator is redrawn to match",
    edits.some((e) => e.text ===));
  check("align: a lone pipe Example is left exactly as written",
    align(aot("A", "     gegeg")).length === 0);""",
  """  check("align: a leftover rule is drawn away with the rest",
    align(aot("Otter", "    name|size", "    ----+----", "    Ollie|5"))
      .some((e) => e.text === "    name |size" + String.fromCharCode(10) + "    Ollie|5"));"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
