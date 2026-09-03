# -*- coding: utf-8 -*-
import io, json
p = 'package.json'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""      {
        "command": "aot.table.insertSeparator",
        "title": "Insert Separator Below",
        "category": "AOT Table",
        "enablement": "editorLangId == aot"
      },
""", ""),
 ("""      {
        "command": "aot.table.alignLeft",
        "title": "Align Column Left",
        "category": "AOT Table",
        "enablement": "editorLangId == aot"
      },
      {
        "command": "aot.table.alignRight",
        "title": "Align Column Right",
        "category": "AOT Table",
        "enablement": "editorLangId == aot"
      },
      {
        "command": "aot.table.alignCenter",
        "title": "Align Column Center",
        "category": "AOT Table",
        "enablement": "editorLangId == aot"
      },
      {
        "command": "aot.table.alignDefault",
        "title": "Clear Column Alignment",
        "category": "AOT Table",
        "enablement": "editorLangId == aot"
      },
""", ""),
 ("""      {
        "command": "aot.table.insertSeparator",
        "key": "alt+-",
        "when": "editorTextFocus && !editorReadonly && editorLangId == aot && aot.inTable"
      },
""", ""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
json.load(io.open(p, encoding='utf-8'))
print('package.json ok')
