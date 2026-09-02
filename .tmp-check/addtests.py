# -*- coding: utf-8 -*-
import io
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()

a = '''  check("blockAt: the lone Example is its own block", blockAt(doc, 6).start === 6 && blockAt(doc, 6).end === 6);
'''
b = '''  check("blockAt: a row with an empty name cell is a row like any other",
    blockAt(doc, 6).start === 6 && blockAt(doc, 6).end === 6
    && blockAt(doc, 6).rows[0].cells.join(",") === ",gegeg");

  // the pipe divides, so a row ends at its last written cell — and a row
  // with nothing in its name cell opens with that cell's own spaces, which
  // is what keeps the columns under it lined up
  const ragged = blockAt(["Otter |size|colour", "------+----+------", "Ollie |5", "      |3   |grey"], 0);
  check("render: a row stops at its last written cell, dividers and all",
    render(ragged)[2] === "Ollie |5");
  check("render: an empty name cell is drawn as the spaces of its column",
    render(ragged)[3] === "      |3   |grey");

  // a table written in the pre-1.12 bordered form reads without its borders,
  // so drawing it again is what migrates the file
  const old = ["    |Otter |size|", "    |------+----|", "    |Ollie |5   |", "    |    Pup|1  |"];
  const legacy = blockAt(old, 0);
  check("blockAt: a bordered table is read without its borders",
    legacy.rows[0].cells.join(",") === "Otter,size" && legacy.rows[2].cells.join(",") === "Ollie,5"
    && legacy.rows[3].depth === 1);
  check("render: re-drawing a bordered table migrates it",
    render(legacy).join("|") === ["    Otter  |size", "    -------+----", "    Ollie  |5", "        Pup|1"].join("|"));
'''
assert s.count(a) == 1
s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
