// Unit tests for the cells the keys and the mouse work on (src/cells.js):
// what a cell's span is, Ready and Edit, rectangles of cells over a table and
// over free text, and the numbers a status bar shows.
//
// Plain Node script, no framework — run with: node out/test-cells.js
const cells = require("../src/cells");
const table = require("../src/table");
const lineform = require("../src/lineform");
const { lint } = require("../src/linter");

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures++;
}

// --- one cell -------------------------------------------------------------------
{
  const row = "Acme |$100,000|30%|$70,000 =@list price*(1-@discount)|";
  const span = (col) => cells.rowCellSpan(row, col);
  check("rowCellSpan: a name cell is the name", JSON.stringify(span(0)) === JSON.stringify({ start: 0, end: 4, kind: "name" }), span(0));
  check("rowCellSpan: a value cell is the value", JSON.stringify(span(1)) === JSON.stringify({ start: 6, end: 14, kind: "value" }), span(1));
  check("rowCellSpan: a cell carrying a formula is the formula alone, the value in front left out",
    span(3).kind === "formula" && row.slice(span(3).start, span(3).end) === "=@list price*(1-@discount)", span(3));
  check("rowCellSpan: an empty cell is an empty span at the cell's start", JSON.stringify(span(4)) === JSON.stringify({ start: row.length, end: row.length, kind: "empty" }), span(4));
  check("rowCellSpan: a row stopping short of the column has no such cell", span(6) === null);
  const padded = "     |x";
  check("rowCellSpan: a row still waiting for its name puts the caret where the line starts",
    JSON.stringify(cells.rowCellSpan(padded, 0)) === JSON.stringify({ start: 0, end: 0, kind: "empty" }));
}
{
  const at = (t) => cells.lineCellSpan(t);
  const ex = at("    - Ann Lee");
  check("lineCellSpan: an Example's line is its name", ex.kind === "name" && ex.start === 6 && ex.end === 13);
  const v = at("        city: Paris");
  check("lineCellSpan: a value line is what follows the colon", v.kind === "value" && "        city: Paris".slice(v.start, v.end) === "Paris" && v.from === 13);
  const f = at("        vat: 20 =@price*0.2");
  check("lineCellSpan: a value carrying a formula is the formula alone",
    f.kind === "formula" && "        vat: 20 =@price*0.2".slice(f.start, f.end) === "=@price*0.2");
  check("lineCellSpan: a Concept's own line, a bare attribute, a '...' and a table-writing derivation are no cell",
    at("Person") === null && at("    age") === null && at("    ... later") === null && at("Sales =df[:3]") === null);
  check("lineCellSpan: a Concept's default is a value", at("Currency: EUR").kind === "value");
}
{
  const span = { start: 5, end: 13 };
  check("isWhole: the span selected either way round is Ready",
    cells.isWhole(span, 5, 13) && cells.isWhole(span, 13, 5));
  check("isWhole: part of it, or a caret in it, is Edit",
    !cells.isWhole(span, 5, 9) && !cells.isWhole(span, 7, 7));
  check("isWhole: a caret in an empty cell is Ready — it has nothing to select",
    cells.isWhole({ start: 9, end: 9 }, 9, 9) && !cells.isWhole({ start: 9, end: 9 }, 10, 10));
}

// --- a grid, and rectangles over it ------------------------------------------------
const tableLines = [
  "Otter |size|colour",
  "Ollie |5   |brown",
  "Pebble|    |grey",
  "-----+----+------",
  "Pup   |3   |",
];
const block = table.blockAt(tableLines, 1);
const grid = cells.tableGrid(tableLines, block);
check("tableGrid: the header is row 0, a divider holds no row", grid.rows === 4 && grid.cols === 3 && grid.lineOf(3) === 4);
check("tableGrid: at() reads a position as its cell", JSON.stringify(grid.at(4, 7)) === JSON.stringify({ r: 3, c: 1 }));
check("edge: from a filled cell over a gap, the next filled cell — the divider stepped over",
  JSON.stringify(cells.edge(grid, 3, 1, -1, 0)) === JSON.stringify({ r: 1, c: 1 }));
{
  // Ctrl+Shift+↓ from the header: the values below it, the header left out
  const s = cells.extend(grid, { anchor: { r: 0, c: 1 }, active: { r: 0, c: 1 } }, 1, 0, true);
  check("extend: Ctrl+Shift+↓ from a header selects the values below it, not the header",
    s.anchor.r === 1 && s.anchor.c === 1 && s.active.r === 1, s);
  const again = cells.extend(grid, s, 1, 0, true);
  check("extend: pressed again, it runs on to the next edge", again.active.r === 3, again);
  const right = cells.extend(grid, { anchor: { r: 1, c: 0 }, active: { r: 1, c: 0 } }, 0, 1, true);
  check("extend: Ctrl+Shift+→ from a name selects the values beside it, the name left out",
    right.anchor.c === 1 && right.active.c === 2 && right.anchor.r === 1, right);
  const shift = cells.extend(grid, { anchor: { r: 1, c: 1 }, active: { r: 1, c: 1 } }, 0, 1, false);
  check("extend: Shift+→ grows the rectangle by one cell", shift.active.c === 2 && shift.anchor.c === 1);
  const sels = cells.rectSelections(grid, { anchor: { r: 1, c: 1 }, active: { r: 3, c: 2 } });
  check("rectSelections: one selection a cell, the active cell's first, an empty cell a caret",
    sels.length === 6 && sels[0].r === 3 && sels[0].c === 2 && sels[0].start === sels[0].end
    && sels.some((s) => s.r === 2 && s.c === 1 && s.start === s.end), sels);
  const texts = cells.rectTexts(grid, cells.rectOf({ r: 1, c: 1 }, { r: 3, c: 1 }));
  check("rectTexts: the cells of a rectangle, row by row", JSON.stringify(texts) === JSON.stringify([["5"], [""], ["3"]]));
}
{
  // a Concept written as lines is a grid too
  const lines = ["Person", "    - Ann", "        age: 30", "        city: Paris", "    - Bob", "        city: Rome"];
  const { nodes } = lint(lines.join("\n"), "T");
  const g = lineform.gridAt(lines, nodes, 1, {});
  const lg = cells.lineGrid(g);
  check("lineGrid: rows are the Examples, columns the attributes after the name",
    lg.rows === 2 && lg.cols === 3 && lg.text(1, 2) === "Rome" && lg.text(1, 1) === "");
  check("lineGrid: a value nobody wrote has no place to stand", lg.span(1, 1) === null);
  check("lineGrid: at() reads a value line as its cell", JSON.stringify(lg.at(3)) === JSON.stringify({ r: 0, c: 2 }));
  const col = cells.rectSelections(lg, { anchor: { r: 0, c: 2 }, active: { r: 1, c: 2 } });
  check("lineGrid: a column selected is the value of each Example that states it",
    col.length === 2 && col.every((s) => lines[s.line].slice(s.start, s.end) === (s.r === 0 ? "Paris" : "Rome")), col);
}

// --- the status bar's numbers -----------------------------------------------------
{
  const s = cells.stats(["$100", "$1,200", "", "$50 =@x*2"]);
  check("stats: Sum, Average and Count over the numbers, in their unit; a blank is no cell, a formula's value is read",
    s.count === 3 && s.numbers === 3 && cells.statsText(s) === "Sum $1,350 · Average $450 · Count 3", cells.statsText(s));
  check("stats: percents stay percents", cells.statsText(cells.stats(["30%", "10%"])) === "Sum 40% · Average 20% · Count 2");
  check("stats: two units are counted, never added up",
    cells.statsText(cells.stats(["$100", "€200"])) === "Count 2 · mixed units");
  check("stats: text and dates are counted, not summed",
    cells.statsText(cells.stats(["North", "2026-01-05"])) === "Count 2");
  check("stats: a repeating average shows its first useful digits",
    cells.statsText(cells.stats(["1", "1", "2"])) === "Sum 4 · Average 1.3̅ · Count 3");
  const p = cells.profile(["North", "South", "North", "", "North"]);
  check("profile: cells, blanks, distinct values and the commonest",
    p.cells === 5 && p.blanks === 1 && p.distinct === 2 && p.top[0][0] === "North" && p.top[0][1] === 3, p);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
