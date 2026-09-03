# -*- coding: utf-8 -*-
import io
p = 'out/test-extension.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ('  console.log(parkedLines[2] === "    Invoice|price|vat" && parkedLines[4] === "    INV-1  |100  |20"',
  '  console.log(parkedLines[2] === "    Invoice|price|vat" && parkedLines[3] === "    INV-1  |100  |20"'),
 ('  console.log(parkedLines[7] === "        vat: 10" && !/=/.test(text)',
  '  console.log(parkedLines[6] === "        vat: 10" && !/=/.test(text)'),
 ('    : "UNEXPECTED parked line form " + JSON.stringify(parkedLines[7]));',
  '    : "UNEXPECTED parked line form " + JSON.stringify(parkedLines[6]));'),
 ('    const cell = at(5), lineForm = at(8);',
  '    const cell = at(4), lineForm = at(7);'),
 ('  console.log(after[3] === "    Ollie |5" && after[4] === "    Pebble|3"',
  '  console.log(after[2] === "    Ollie |5" && after[3] === "    Pebble|3"'),
 ('''  const editor8 = {
    document: doc8,
    selection: new vscode.Selection(3, 7, 3, 7),''',
  '''  const editor8 = {
    document: doc8,
    selection: new vscode.Selection(2, 7, 2, 7),'''),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
