# -*- coding: utf-8 -*-
import io
NL = chr(92) + 'n'
p = 'out/test-extension.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ('  const jamesOk = james && james.line === 13 && james.concept.name === "Person"' + chr(10)
  + '    && james.startCol === text.split("' + NL + '")[12].indexOf("James")',
  '  const jamesOk = james && james.line === 12 && james.concept.name === "Person"' + chr(10)
  + '    && james.startCol === text.split("' + NL + '")[11].indexOf("James")'),
 ('  const headerLink = links.find((l) => l.connection === "attribute-is-a-Concept" && l.line === 4);'
  + chr(10) + '  const cellLink = links.find((l) => l.connection === "default-is-a-Example" && l.line === 6);',
  '  const headerLink = links.find((l) => l.connection === "attribute-is-a-Concept" && l.line === 4);'
  + chr(10) + '  const cellLink = links.find((l) => l.connection === "default-is-a-Example" && l.line === 5);'),
 ('  const aCell = aLinks.find((l) => l.connection === "default-is-a-Example" && l.line === 6);',
  '  const aCell = aLinks.find((l) => l.connection === "default-is-a-Example" && l.line === 5);'),
 ('  console.log(aligned && edits.length === 3',
  '  console.log(aligned && edits.length === 2'),
 ('  const tokensOk = has([2, 11, 4, 0])   // header \'size\' as attribute' + chr(10)
  + '    && has([2, 17, 6, 0])               // header alias \'length\' as attribute' + chr(10)
  + '    && has([2, 27, 6, 0])               // header \'colour\' as attribute' + chr(10)
  + '    && has([4, 4, 5, 1])                // name cell \'Ollie\' as Example' + chr(10)
  + '    && has([4, 12, 1, 2])               // value cell \'5\' as value' + chr(10)
  + '    && has([4, 16, 5, 2]);              // value cell \'brown\' as value',
  '  const tokensOk = has([2, 11, 4, 0])   // header \'size\' as attribute' + chr(10)
  + '    && has([2, 17, 6, 0])               // header alias \'length\' as attribute' + chr(10)
  + '    && has([2, 27, 6, 0])               // header \'colour\' as attribute' + chr(10)
  + '    && has([3, 4, 5, 1])                // name cell \'Ollie\' as Example' + chr(10)
  + '    && has([3, 12, 1, 2])               // value cell \'5\' as value' + chr(10)
  + '    && has([3, 16, 5, 2]);              // value cell \'brown\' as value'),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
