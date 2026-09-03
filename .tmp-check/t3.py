# -*- coding: utf-8 -*-
import io
NL = chr(92) + 'n'
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()
a = ('''// ---------------------------------------------------------------------------
// align: unchanged contract — tables with a separator only, 1-based lines
// ---------------------------------------------------------------------------
{
  const messy = ["Otter", "    name | size", "    Ollie | 5"].join("''' + NL + '''");
  const edits = align(messy);
  check("align: still pads, redraws, and reports 1-based lines",
    edits.length === 3 && edits[0].line === 2 && edits[1].text ===);
  check("align: still leaves lone pipe Examples alone", align("A''' + NL + '''    | gegeg").length === 0);
}''')
b = ('''// ---------------------------------------------------------------------------
// align: every table redrawn, 1-based lines
// ---------------------------------------------------------------------------
{
  const messy = ["Otter", "    name | size", "    Ollie | 5"].join("''' + NL + '''");
  const edits = align(messy);
  check("align: still pads, redraws, and reports 1-based lines",
    edits.length === 2 && edits[0].line === 2 && edits[0].text === "    name |size"
    && edits[1].text === "    Ollie|5");
  // a table carrying a leftover rule loses a line, so its block is rewritten whole
  const ruled = ["Otter", "    name|size", "    ----+----", "    Ollie|5"].join("''' + NL + '''");
  const ruledEdits = align(ruled);
  check("align: a leftover rule is drawn away, the block rewritten whole",
    ruledEdits.length === 1 && ruledEdits[0].line === 2 && ruledEdits[0].to === 4
    && ruledEdits[0].text === "    name |size''' + NL + '''    Ollie|5");
}''')
assert s.count(a) == 1
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(a, b))
print('ok')
