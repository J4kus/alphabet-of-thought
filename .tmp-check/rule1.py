# -*- coding: utf-8 -*-
import io
p = 'src/table.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""    if (!r.sep) [r.cells[col], r.cells[other]] = [r.cells[other], r.cells[col]];
  }
  // the alignment is the column's, so it travels with it
  eachSepAlign(block, numCols, (a) => { [a[col], a[other]] = [a[other], a[col]]; });
  return { row, col: other };""",
  """    if (!r.sep) [r.cells[col], r.cells[other]] = [r.cells[other], r.cells[col]];
  }
  return { row, col: other };"""),
 ("""    if (!r.sep) r.cells.splice(Math.min(col, r.cells.length), 0, "");
  }
  eachSepAlign(block, numCols, (a) => a.splice(Math.min(col, a.length), 0, null));
  return { row, col };""",
  """    if (!r.sep) r.cells.splice(Math.min(col, r.cells.length), 0, "");
  }
  return { row, col };"""),
 ("""    if (!r.sep) r.cells.splice(col, 1);
  }
  eachSepAlign(block, numCols, (a) => a.splice(col, 1));
  return { row, col: Math.max(0, Math.min(col, numCols - 2)) };""",
  """    if (!r.sep) r.cells.splice(col, 1);
  }
  return { row, col: Math.max(0, Math.min(col, numCols - 2)) };"""),
 ("""    if (!r.sep) r.cells.splice(at, 0, r.cells[col] || "");
  }
  eachSepAlign(block, numCols, (a) => a.splice(at, 0, a[col] || null));
  return { row, col: at };""",
  """    if (!r.sep) r.cells.splice(at, 0, r.cells[col] || "");
  }
  return { row, col: at };"""),
 # the rule is gone, and with it the key that inserted one and the
 # alignment that was written into it
 ("""// C-c -: a separator line below the cursor's row.
function insertSeparator(block, row, col) {
  block.rows.splice(row + 1, 0, { sep: true, cells: [] });
  return { row, col };
}

""",
  ""),
 ("""// Set (or clear, with null) the cursor column's alignment, writing the
// colons into every separator the table has. A table with no separator is
// not yet a table — its shape is still being typed — so there is nowhere to
// declare an alignment and nothing happens.
function alignColumn(block, row, col, how) {
  const numCols = widthsOf(block).length;
  if (col >= numCols || !block.rows.some((r) => r.sep)) return null;
  if (how !== null && !ALIGNMENTS.includes(how)) return null;
  eachSepAlign(block, numCols, (a) => { a[col] = how; });
  return { row, col };
}

""",
  ""),
 ("""  insertRow, deleteRow, insertSeparator, sortRows, fromRegion, copyFormulaDown, copyFormulaAcross,""",
  """  insertRow, deleteRow, sortRows, fromRegion, copyFormulaDown, copyFormulaAcross,"""),
 ("""  alignColumn, alignmentsOf, alignmentsFrom, padCell, sepCell, ALIGNMENTS,""",
  """  padCell, headerIndex,"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
