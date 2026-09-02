# -*- coding: utf-8 -*-
import io
NL = chr(92) + 'n'
p = 'out/test-extension.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ('  const grown = grow.join("' + NL + '") === ["Otter", "", "", ""].join("' + NL + '");'
  + chr(10) + '  const cursorOk = edG.selection.active.line === 1 && edG.selection.active.character === 1;',
  '  const grown = grow.join("' + NL + '") === ["Otter", " |", "-+-", " |"].join("' + NL + '");'
  + chr(10) + '  const cursorOk = edG.selection.active.line === 1 && edG.selection.active.character === 0;'),
 ('  const named = under.join("' + NL + '") === ["Otter", "    Otter", "    -----", ""].join("' + NL + '");'
  + chr(10) + '  console.log(named && edU.selection.active.line === 3 && edU.selection.active.character === 5',
  '  const named = under.join("' + NL + '") === ["Otter", "    Otter|", "    -----+-", "         |"].join("' + NL + '");'
  + chr(10) + '  console.log(named && edU.selection.active.line === 3 && edU.selection.active.character === 4'),
]
for a, b in subs:
    assert s.count(a) == 1, (a, s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
