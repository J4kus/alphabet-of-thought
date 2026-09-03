# -*- coding: utf-8 -*-
import io
NL = chr(92) + 'n'
p = 'out/test-extension.js'
s = io.open(p, encoding='utf-8').read()
a = ('  const atCol = tbl.split("' + NL + '")[3].indexOf("@") + 1;' + chr(10)
     + '  const items = completionProvider.provideCompletionItems(docC, new vscode.Position(3, atCol));')
b = ('  const atCol = tbl.split("' + NL + '")[2].indexOf("@") + 1;' + chr(10)
     + '  const items = completionProvider.provideCompletionItems(docC, new vscode.Position(2, atCol));')
assert s.count(a) == 1, s.count(a)
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(a, b))
print('ok')
