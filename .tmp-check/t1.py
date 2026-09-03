# -*- coding: utf-8 -*-
import io
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""  cells, isSeparator, align, blockAt, widthsOf, render, cellStart, colAt,
  padRows, dataRow, nextCell, prevCell, nextRow, moveColumn, moveRow,
  insertColumn, deleteColumn, insertRow, deleteRow, insertSeparator,
  sortRows, fromRegion, cleanName, tablesOf, toCsv, fromCsv, updateTable,""",
  """  cells, isSeparator, align, blockAt, widthsOf, render, cellStart, colAt,
  padRows, dataRow, nextCell, prevCell, nextRow, moveColumn, moveRow,
  insertColumn, deleteColumn, insertRow, deleteRow,
  sortRows, fromRegion, cleanName, tablesOf, toCsv, fromCsv, updateTable,"""),
 ("""  copyCell, moveCell, copyRow, copyColumn, alignColumn, alignmentsOf,""",
  """  copyCell, moveCell, copyRow, copyColumn, headerIndex,"""),
 ("""const doc = [
  "Otter",                              // 0
  "    name   | size | colour",     // 1
  "    Ollie  | 5    | brown",     // 3
  "    Pebble | 3    | grey",     // 4
  "",                                   // 5
  "    | gegeg",                        // 6
];
const fresh = () => blockAt(doc, 3);""",
  """const doc = [
  "Otter",                              // 0
  "    name   | size | colour",         // 1  the header: it stands first
  "    Ollie  | 5    | brown",          // 2
  "    Pebble | 3    | grey",           // 3
  "",                                   // 4
  "    | gegeg",                        // 5
];
const fresh = () => blockAt(doc, 2);"""),
 ("""  check("blockAt: finds the run of pipe rows", block.start === 1 && block.end === 4);
  check("blockAt: keeps the indent", block.indent === "    ");
  check("blockAt: marks the separator", block.rows[1].sep === true && block.rows[0].sep === false);
  check("blockAt: reads the cells", block.rows[2].cells.join(",") === "Ollie,5,brown");
  check("blockAt: a non-pipe line is no block", blockAt(doc, 0) === null && blockAt(doc, 5) === null);
  const typing = blockAt(["name | size"], 1);
  check("blockAt: a lone '-' in the first cell reads as a separator being typed",
    typing.rows[1].sep === true && render(typing)[1] ===);
  check("blockAt: a row with an empty name cell is a row like any other",
    blockAt(doc, 6).start === 6 && blockAt(doc, 6).end === 6
    && blockAt(doc, 6).rows[0].cells.join(",") === ",gegeg");""",
  """  check("blockAt: finds the run of pipe rows", block.start === 1 && block.end === 3);
  check("blockAt: keeps the indent", block.indent === "    ");
  check("blockAt: the header is the row that stands first", headerIndex(block) === 0);
  check("blockAt: reads the cells", block.rows[1].cells.join(",") === "Ollie,5,brown");
  check("blockAt: a non-pipe line is no block", blockAt(doc, 0) === null && blockAt(doc, 4) === null);
  // a leftover rule from before 1.12 is carried in the block and drawn away
  const ruled = blockAt(["name|size", "----+----", "Ollie|5"], 0);
  check("blockAt: a leftover rule is kept as layout and never drawn",
    ruled.rows[1].sep === true && render(ruled).join("/") === "name |size/Ollie|5");
  check("blockAt: a row with an empty name cell is a row like any other",
    blockAt(doc, 5).start === 5 && blockAt(doc, 5).end === 5
    && blockAt(doc, 5).rows[0].cells.join(",") === ",gegeg");"""),
 ("""  const ragged = blockAt(["Otter |size|colour", "Ollie |5", "      |3   |grey"], 0);
  check("render: a row that stops short keeps the dividers it stops before",
    render(ragged)[2] === "Ollie|5   |");
  check("render: an empty name cell is drawn as the spaces of its column",
    render(ragged)[3] === "     |3   |grey");""",
  """  const ragged = blockAt(["Otter |size|colour", "Ollie |5", "      |3   |grey"], 0);
  check("render: a row that stops short keeps the dividers it stops before",
    render(ragged)[1] === "Ollie|5   |");
  check("render: an empty name cell is drawn as the spaces of its column",
    render(ragged)[2] === "     |3   |grey");"""),
 ("""  const old = ["    |Otter |size|", "    |Ollie |5   |", "    |    Pup|1  |"];
  const legacy = blockAt(old, 0);
  check("blockAt: a bordered table is read without its borders",
    legacy.rows[0].cells.join(",") === "Otter,size" && legacy.rows[2].cells.join(",") === "Ollie,5"
    && legacy.rows[3].depth === 1);""",
  """  const old = ["    |Otter |size|", "    |------+----|", "    |Ollie |5   |", "    |    Pup|1  |"];
  const legacy = blockAt(old, 0);
  check("blockAt: a bordered table is read without its borders",
    legacy.rows[0].cells.join(",") === "Otter,size" && legacy.rows[2].cells.join(",") === "Ollie,5"
    && legacy.rows[3].depth === 1);"""),
 ("""  check("render: redraws aligned (no gutters)", render(block)[2] === "    Ollie |5   |brown");""",
  """  check("render: redraws aligned (no gutters)", render(block)[1] === "    Ollie |5   |brown");"""),
 ("""  check("colAt: the cell under a character", colAt(doc[3], 7) === 0 && colAt(doc[3], 16) === 1 && colAt(doc[3], 2) === 0);""",
  """  check("colAt: the cell under a character", colAt(doc[2], 7) === 0 && colAt(doc[2], 16) === 1 && colAt(doc[2], 2) === 0);"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
