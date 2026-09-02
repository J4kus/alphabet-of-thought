# -*- coding: utf-8 -*-
import io
p = 'README.md'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("If a table is wide because one column is long rather than because it has many, the [width cookie](#working-with-text) (`|description <24>|`) caps that column",
  "If a table is wide because one column is long rather than because it has many, the [width cookie](#working-with-text) (`description <24>`) caps that column"),
 ("a bare line (`age >=18`) or a table header cell (`|name|qty >=1|`)",
  "a bare line (`age >=18`) or a table header cell (`name|qty >=1`)"),
 ("The bound's references resolve *per value* against its own Example or row — `|price|margin >=@price*0.1|` holds each row's margin to that row's price.",
  "The bound's references resolve *per value* against its own Example or row — `price|margin >=@price*0.1` holds each row's margin to that row's price."),
 ("A `|` inside a value bends to a broken bar, as an arriving CSV's does.",
  "A `|` arriving from a CSV bends to a broken bar, since the divider cannot live inside a cell."),
 # the scaffold sample block
 ("""```aot
Otter
-----
     |     <- cursor lands here (the Concept 'Otter' already filled in above)
```""",
  """```aot
Otter
Otter|
-----+-
     |     <- cursor lands here (the Concept 'Otter' already filled in above)
```"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('README ok')
