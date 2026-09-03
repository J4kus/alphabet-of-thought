# -*- coding: utf-8 -*-
import io
p = 'out/test-extension.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ('''  console.log(/=@price\\*0\\.2/.test(backLines[4]) && backLines[7] === "        vat: 10 =@price*0.2"''',
  '''  console.log(/=@price\\*0\\.2/.test(backLines[3]) && backLines[6] === "        vat: 10 =@price*0.2"'''),
 ('  console.log(lines[3] === "    A   |10   |20 =@price*2"',
  '  console.log(lines[2] === "    A   |10   |20 =@price*2"'),
 ('    selection: new vscode.Selection(3, 1, 3, 1), // inside the 4-space indent',
  '    selection: new vscode.Selection(2, 1, 2, 1), // inside the 4-space indent'),
 ('''  const indented = lines[1] === "        name |size" && lines[3] === "        Ollie|5";
  const selOk = editor.selection.active.line === 3 && editor.selection.active.character === 5;''',
  '''  const indented = lines[1] === "        name |size" && lines[2] === "        Ollie|5";
  const selOk = editor.selection.active.line === 2 && editor.selection.active.character === 5;'''),
 ('  const back = lines[1] === "    name |size" && lines[3] === "    Ollie|5";',
  '  const back = lines[1] === "    name |size" && lines[2] === "    Ollie|5";'),
 ('''    && gridLines[4] === "    INV-1  |100  |20 =@price*@tax rate"
    && gridLines[5] === "    INV-9  |50   |10 =@price*@tax rate"''',
  '''    && gridLines[3] === "    INV-1  |100  |20 =@price*@tax rate"
    && gridLines[4] === "    INV-9  |50   |10 =@price*@tax rate"'''),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
