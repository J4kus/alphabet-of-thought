# -*- coding: utf-8 -*-
import io
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()

start = s.index("""{
  let b = fresh();
  check("nextCell: moves along the row",""")
end = s.index("""// ---------------------------------------------------------------------------
// fromRegion: delimited lines become a table, header lowercased""")

new = """{
  let b = fresh();
  check("nextCell: moves along the row", JSON.stringify(nextCell(b, 1, 0)) === '{"row":1,"col":1}');
  check("nextCell: wraps to the next data row", JSON.stringify(nextCell(b, 1, 2)) === '{"row":2,"col":0}');
  check("nextCell: leaves the header for the first row", JSON.stringify(nextCell(b, 0, 2)) === '{"row":1,"col":0}');
  const t = nextCell(b, 2, 2);
  check("nextCell: at the last field a new row is appended", t.row === 3 && t.col === 0 && b.rows.length === 4 && b.rows[3].cells.length === 0);

  b = fresh();
  check("prevCell: moves back along the row", JSON.stringify(prevCell(b, 1, 2)) === '{"row":1,"col":1}');
  check("prevCell: wraps to the row above", JSON.stringify(prevCell(b, 1, 0)) === '{"row":0,"col":2}');
  check("prevCell: stops at the first field", JSON.stringify(prevCell(b, 0, 0)) === '{"row":0,"col":0}');

  b = fresh();
  check("nextRow: same column, next data row", JSON.stringify(nextRow(b, 1, 1)) === '{"row":2,"col":1}');
  const r = nextRow(b, 2, 1);
  check("nextRow: appends a row at the bottom", r.row === 3 && r.col === 1 && b.rows.length === 4);
}

// ---------------------------------------------------------------------------
// column surgery: move / insert / delete
// ---------------------------------------------------------------------------
{
  let b = fresh();
  const t = moveColumn(b, 1, 1, 1);
  check("moveColumn: swaps the column in every row, header included",
    t.col === 2 && b.rows[0].cells.join(",") === "name,colour,size" && b.rows[1].cells.join(",") === "Ollie,brown,5");
  check("moveColumn: refuses to fall off the edge", moveColumn(fresh(), 1, 2, 1) === null && moveColumn(fresh(), 1, 0, -1) === null);

  b = fresh();
  insertColumn(b, 1, 1);
  check("insertColumn: an empty column where the cursor stands",
    b.rows[0].cells.join(",") === "name,,size,colour" && b.rows[1].cells.join(",") === "Ollie,,5,brown");

  b = fresh();
  deleteColumn(b, 1, 1);
  check("deleteColumn: kills the cursor's column",
    b.rows[0].cells.join(",") === "name,colour" && b.rows[2].cells.join(",") === "Pebble,grey");
}

// ---------------------------------------------------------------------------
// row surgery: move / insert / delete
// ---------------------------------------------------------------------------
{
  let b = fresh();
  const t = moveRow(b, 2, 0, -1);
  check("moveRow: carries the row over its neighbour", t.row === 1 && b.rows[1].cells[0] === "Pebble" && b.rows[2].cells[0] === "Ollie");
  check("moveRow: refuses to leave the block", moveRow(fresh(), 0, 0, -1) === null);

  b = fresh();
  insertRow(b, 1, 1);
  check("insertRow: an empty row above the cursor's", b.rows.length === 4 && b.rows[1].cells.length === 0 && b.rows[2].cells[0] === "Ollie");

  b = fresh();
  deleteRow(b, 1, 0);
  check("deleteRow: kills the cursor's row", b.rows.length === 2 && b.rows[1].cells[0] === "Pebble");
}

// ---------------------------------------------------------------------------
// sortRows: the data rows around the cursor, the header standing first
// ---------------------------------------------------------------------------
{
  const money = [
    "    name | basket size",
    "    Bolt | $3,100",
    "    Acme | $1,200",
    "    Kite | $780",
  ];
  let b = blockAt(money, 1);
  sortRows(b, 1, 1);
  check("sortRows: numeric when every key reads as a number ($ and , ignored)",
    b.rows.slice(1).map((r) => r.cells[0]).join(",") === "Kite,Acme,Bolt");
  check("sortRows: the header keeps its place", b.rows[0].cells[0] === "name");

  b = blockAt(money, 1);
  sortRows(b, 1, 0);
  check("sortRows: alphabetic otherwise", b.rows.slice(1).map((r) => r.cells[0]).join(",") === "Acme,Bolt,Kite");
  check("sortRows: the header cannot anchor a sort", sortRows(blockAt(money, 1), 0, 0) === null);
}

"""
s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
