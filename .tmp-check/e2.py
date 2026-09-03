# -*- coding: utf-8 -*-
import io
p = 'out/test-extension.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("  const inCell = valueCompletionProvider.provideCompletionItems(doc, new vscode.Position(4, 8));",
  "  const inCell = valueCompletionProvider.provideCompletionItems(doc, new vscode.Position(4, 9));"),
 ("  const inName = valueCompletionProvider.provideCompletionItems(doc, new vscode.Position(4, 2));",
  "  const inName = valueCompletionProvider.provideCompletionItems(doc, new vscode.Position(4, 5));"),
 ("  const inHeader = valueCompletionProvider.provideCompletionItems(doc, new vscode.Position(3, 11));",
  "  const inHeader = valueCompletionProvider.provideCompletionItems(doc, new vscode.Position(3, 10));"),
 ("  console.log(person && person.range.a[0] === 0 && person.range.a[2] === 4",
  "  console.log(person && person.range.a[0] === 0 && person.range.a[2] === 3"),
 ("  console.log(grid && grid.name === \"Person\" && grid.range.a[2] === 4",
  "  console.log(grid && grid.name === \"Person\" && grid.range.a[2] === 3"),
 ("    document: docT, selection: new vscode.Selection(3, 15, 3, 15),",
  "    document: docT, selection: new vscode.Selection(2, 15, 2, 15),"),
 ("  console.log(formulaTok && formulaTok[0] === 3 && formulaTok[1] === 22 && formulaTok[2] === 9",
  "  console.log(formulaTok && formulaTok[0] === 2 && formulaTok[1] === 22 && formulaTok[2] === 9"),
 ("  console.log(colOps.length === 2 && colOps[0] === \"1,9,1,14:cost\" && colOps[1] === \"3,20,3,25:cost\"",
  "  console.log(colOps.length === 2 && colOps[0] === \"1,9,1,14:cost\" && colOps[1] === \"2,20,2,25:cost\""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
