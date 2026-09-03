# -*- coding: utf-8 -*-
import io
NL = chr(92) + 'n'
p = 'out/test-extension.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ('    && tableOps.includes("4,9,4,14:Purchases") // the table name inside the formula',
  '    && tableOps.includes("3,9,3,14:Purchases") // the table name inside the formula'),
 # the table editor: the block is two lines now, the cursor row is 2
 ('    selection: new vscode.Selection(3, 7, 3, 7), // inside \'Ollie\'',
  '    selection: new vscode.Selection(2, 7, 2, 7), // inside \'Ollie\''),
 ('      && applied.t.split("' + NL + '")[2] === "    Ollie|5"' + chr(10)
  + '      && editor.selection.active.line === 3 && editor.selection.active.character === 10;' + chr(10)
  + '    console.log(ok && registeredCommands.size === 36' + chr(10)
  + '      ? "PASS (table editor: 36 commands; Tab aligns and moves to the next cell)"',
  '      && applied.t.split("' + NL + '")[1] === "    Ollie|5"' + chr(10)
  + '      && editor.selection.active.line === 2 && editor.selection.active.character === 10;' + chr(10)
  + '    console.log(ok && registeredCommands.size === 31' + chr(10)
  + '      ? "PASS (table editor: 31 commands; Tab aligns and moves to the next cell)"'),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
