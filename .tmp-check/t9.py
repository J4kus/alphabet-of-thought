# -*- coding: utf-8 -*-
import io
NL = chr(92) + 'n'
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""    drawn.length === 5
    && drawn[2] === "    A   |a rather  |3"
    && drawn[3] === "        |long note |"
    && drawn[4] === "    B   |short     |4");
  check("render: physStart maps each logical row to its first drawn line",
    JSON.stringify(block.physStart) === "[0,1,2,4]");""",
  """    drawn.length === 4
    && drawn[1] === "    A   |a rather  |3"
    && drawn[2] === "        |long note |"
    && drawn[3] === "    B   |short     |4");
  check("render: physStart maps each logical row to its first drawn line",
    JSON.stringify(block.physStart) === "[0,1,3]");"""),
 ("""    JSON.stringify(unwrapWithMap(b2)) === "[0,1,2,2,3]");
  check("unwrap: fragments join back with single spaces",
    b2.rows[2].cells[1] === "a rather long note");""",
  """    JSON.stringify(unwrapWithMap(b2)) === "[0,1,1,2]");
  check("unwrap: fragments join back with single spaces",
    b2.rows[1].cells[1] === "a rather long note");"""),
 ("""    && JSON.stringify(grids[0].rowLines) === "[4,6]");""",
  """    && JSON.stringify(grids[0].rowLines) === "[3,5]");"""),
 ("""    aligned.length === 1 && aligned[0].line === 2 && aligned[0].to === 4
    && aligned[0].text.split("''' + NL + '''").length === 4);""".replace("''' + NL + '''", NL),
  """    aligned.length === 1 && aligned[0].line === 2 && aligned[0].to === 3
    && aligned[0].text.split("''' + NL + '''").length === 3);""".replace("''' + NL + '''", NL)),
 ("""    render(plain).length === 3 && headerWidths(plain) === null);""",
  """    render(plain).length === 2 && headerWidths(plain) === null);"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
