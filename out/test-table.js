// Unit tests for the org table editor's pure logic (src/table.js): block
// discovery, rendering, cursor math, and every operation the extension's
// commands apply — navigation, row/column surgery, sorting, region import.
//
// Plain Node script, no framework — run with: node out/test-table.js
const {
  cells, isSeparator, align, blockAt, widthsOf, render, cellStart, colAt,
  padRows, dataRow, nextCell, prevCell, nextRow, moveColumn, moveRow,
  insertColumn, deleteColumn, insertRow, deleteRow, insertSeparator,
  sortRows, fromRegion, cleanName, tablesOf, toCsv, fromCsv, updateTable,
  splitCell, evalFormula, formatValue, recompute, formulas,
} = require("../src/table");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const doc = [
  "Otter",                              // 0
  "    | name   | size | colour |",     // 1
  "    |--------+------+--------|",     // 2
  "    | Ollie  | 5    | brown  |",     // 3
  "    | Pebble | 3    | grey   |",     // 4
  "",                                   // 5
  "    | gegeg",                        // 6
];
const fresh = () => blockAt(doc, 3);

// ---------------------------------------------------------------------------
// blockAt, widthsOf, render, cellStart, colAt
// ---------------------------------------------------------------------------
{
  const block = fresh();
  check("blockAt: finds the run of pipe rows", block.start === 1 && block.end === 4);
  check("blockAt: keeps the indent", block.indent === "    ");
  check("blockAt: marks the separator", block.rows[1].sep === true && block.rows[0].sep === false);
  check("blockAt: reads the cells", block.rows[2].cells.join(",") === "Ollie,5,brown");
  check("blockAt: a non-pipe line is no block", blockAt(doc, 0) === null && blockAt(doc, 5) === null);
  const typing = blockAt(["| name | size |", "| -    |      |"], 1);
  check("blockAt: a lone '-' in the first cell reads as a separator being typed",
    typing.rows[1].sep === true && render(typing)[1] === "|------+------|");
  check("blockAt: the lone Example is its own block", blockAt(doc, 6).start === 6 && blockAt(doc, 6).end === 6);

  check("widthsOf: widest cell per column", widthsOf(block).join(",") === "6,4,6");
  check("render: redraws aligned", render(block)[2] === "    | Ollie  | 5    | brown  |");
  check("cellStart: column offsets on the aligned line", cellStart(block, 0) === 6 && cellStart(block, 1) === 15 && cellStart(block, 2) === 22);
  check("colAt: the cell under a character", colAt(doc[3], 7) === 0 && colAt(doc[3], 16) === 1 && colAt(doc[3], 2) === 0);
}

// ---------------------------------------------------------------------------
// navigation: nextCell / prevCell / nextRow
// ---------------------------------------------------------------------------
{
  let b = fresh();
  check("nextCell: moves along the row", JSON.stringify(nextCell(b, 2, 0)) === '{"row":2,"col":1}');
  check("nextCell: wraps to the next data row", JSON.stringify(nextCell(b, 2, 2)) === '{"row":3,"col":0}');
  check("nextCell: skips the separator downward", JSON.stringify(nextCell(b, 0, 2)) === '{"row":2,"col":0}');
  const t = nextCell(b, 3, 2);
  check("nextCell: at the last field a new row is appended", t.row === 4 && t.col === 0 && b.rows.length === 5 && b.rows[4].cells.length === 0);

  b = fresh();
  check("prevCell: moves back along the row", JSON.stringify(prevCell(b, 2, 2)) === '{"row":2,"col":1}');
  check("prevCell: wraps to the row above, skipping the separator", JSON.stringify(prevCell(b, 2, 0)) === '{"row":0,"col":2}');
  check("prevCell: stops at the first field", JSON.stringify(prevCell(b, 0, 0)) === '{"row":0,"col":0}');

  b = fresh();
  check("nextRow: same column, next data row", JSON.stringify(nextRow(b, 2, 1)) === '{"row":3,"col":1}');
  const r = nextRow(b, 3, 1);
  check("nextRow: appends a row at the bottom", r.row === 4 && r.col === 1 && b.rows.length === 5);
}

// ---------------------------------------------------------------------------
// column surgery: move / insert / delete
// ---------------------------------------------------------------------------
{
  let b = fresh();
  const t = moveColumn(b, 2, 1, 1);
  check("moveColumn: swaps the column in every row, header included",
    t.col === 2 && b.rows[0].cells.join(",") === "name,colour,size" && b.rows[2].cells.join(",") === "Ollie,brown,5");
  check("moveColumn: refuses to fall off the edge", moveColumn(fresh(), 2, 2, 1) === null && moveColumn(fresh(), 2, 0, -1) === null);

  b = fresh();
  insertColumn(b, 2, 1);
  check("insertColumn: an empty column where the cursor stands",
    b.rows[0].cells.join(",") === "name,,size,colour" && b.rows[2].cells.join(",") === "Ollie,,5,brown");

  b = fresh();
  deleteColumn(b, 2, 1);
  check("deleteColumn: kills the cursor's column",
    b.rows[0].cells.join(",") === "name,colour" && b.rows[3].cells.join(",") === "Pebble,grey");
}

// ---------------------------------------------------------------------------
// row surgery: move / insert / delete / separator
// ---------------------------------------------------------------------------
{
  let b = fresh();
  const t = moveRow(b, 2, 0, -1);
  check("moveRow: hops the separator", t.row === 1 && b.rows[1].cells[0] === "Ollie" && b.rows[2].sep === true);
  check("moveRow: refuses to leave the block", moveRow(fresh(), 0, 0, -1) === null);

  b = fresh();
  insertRow(b, 2, 1);
  check("insertRow: an empty row above the cursor's", b.rows.length === 5 && b.rows[2].cells.length === 0 && b.rows[3].cells[0] === "Ollie");

  b = fresh();
  deleteRow(b, 2, 0);
  check("deleteRow: kills the cursor's row", b.rows.length === 3 && b.rows[2].cells[0] === "Pebble");

  b = fresh();
  insertSeparator(b, 2, 0);
  check("insertSeparator: a rule below the cursor's row", b.rows[3].sep === true && b.rows.length === 5);
}

// ---------------------------------------------------------------------------
// sortRows: the data run around the cursor, header safe behind its separator
// ---------------------------------------------------------------------------
{
  const money = [
    "    | name | basket size |",
    "    |------+-------------|",
    "    | Bolt | $3,100      |",
    "    | Acme | $1,200      |",
    "    | Kite | $780        |",
  ];
  let b = blockAt(money, 2);
  sortRows(b, 2, 1);
  check("sortRows: numeric when every key reads as a number ($ and , ignored)",
    b.rows.slice(2).map((r) => r.cells[0]).join(",") === "Kite,Acme,Bolt");
  check("sortRows: the header keeps its place", b.rows[0].cells[0] === "name" && b.rows[1].sep === true);

  b = blockAt(money, 2);
  sortRows(b, 2, 0);
  check("sortRows: alphabetic otherwise", b.rows.slice(2).map((r) => r.cells[0]).join(",") === "Acme,Bolt,Kite");
  check("sortRows: a separator row cannot anchor a sort", sortRows(blockAt(money, 2), 1, 0) === null);
}

// ---------------------------------------------------------------------------
// fromRegion: delimited lines become a table, header lowercased
// ---------------------------------------------------------------------------
{
  const csv = fromRegion(["    Name,Size", "    Ollie,5", "    Pebble,3"]);
  check("fromRegion: CSV becomes an aligned table with a separator",
    csv[0] === "    | name   | size |" && csv[1] === "    |--------+------|" && csv[2] === "    | Ollie  | 5    |");
  const tsv = fromRegion(["a\tb", "1\t2"]);
  check("fromRegion: tabs win over commas", tsv[0] === "| a | b |");
  const spaced = fromRegion(["name  size", "Ollie  5"]);
  check("fromRegion: multi-space columns as a last resort", spaced[2] === "| Ollie | 5    |");
  check("fromRegion: nothing from blank lines", fromRegion(["   ", ""]) === null);
}

// ---------------------------------------------------------------------------
// formulas: `10 =$1+10` — the value first, its derivation after it
// ---------------------------------------------------------------------------
{
  check("splitCell: value and formula part at the ' ='",
    JSON.stringify(splitCell("10 =$1+10")) === '{"value":"10","eq":3}'
    && splitCell("=$2*2").value === "" && splitCell("=$2*2").eq === 0
    && splitCell("plain text").eq === -1);

  const ctx = { cell: (c) => c * 10, column: () => [1, 2, 3] };
  check("evalFormula: references and precedence", evalFormula("$2+3*4", ctx) === 32);
  check("evalFormula: parentheses and unary minus", evalFormula("-(2+3)*$1", ctx) === -50);
  check("evalFormula: sum/avg over a column", evalFormula("sum($3)", ctx) === 6 && evalFormula("avg($3)", ctx) === 2);
  check("evalFormula: bad syntax throws",
    (() => { try { evalFormula("$2+", ctx); return false; } catch { return true; } })());

  check("formatValue: keeps the $ and thousands commas of the old value",
    formatValue(1500, "$1,000") === "$1,500" && formatValue(20, "") === "20" && formatValue(1.256, "") === "1.26");

  const b = {
    indent: "",
    rows: [
      { sep: false, cells: ["name", "price", "qty", "total"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "$1,200", "2", "=$2*$3"] },
      { sep: false, cells: ["B", "$100", "1", "100 =$2*$3"] },
      { sep: false, cells: ["Total", "", "", "=sum($4)"] },
    ],
  };
  recompute(b);
  check("recompute: fills an empty value from its formula", b.rows[2].cells[3] === "2400 =$2*$3");
  check("recompute: an already true value stays put", b.rows[3].cells[3] === "100 =$2*$3");
  check("recompute: sum() totals the other rows, fresh values included", b.rows[4].cells[3] === "2500 =sum($4)");

  const broken = {
    indent: "",
    rows: [
      { sep: false, cells: ["name", "x"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "=$1*2"] },
    ],
  };
  recompute(broken);
  check("recompute: a formula that cannot compute shows #ERR and keeps the formula",
    broken.rows[2].cells[1] === "#ERR =$1*2");

  const sheet = [
    "Order",
    "    | name | price | total    |",
    "    |------+-------+----------|",
    "    | A    | 10    | 20 =$2*2 |",
    "    | B    | 10    | 5 =$2/   |",
    "    | C    | 10    | 15 =$2*2 |",
  ];
  const found = formulas(sheet);
  check("formulas: audits every formula cell", found.length === 3);
  check("formulas: a true value raises nothing", !found[0].stale && !found[0].error);
  check("formulas: the span runs from the '=' to the cell's end",
    found[0].line === 4 && found[0].startCol === 24 && sheet[3][found[0].startCol] === "=");
  check("formulas: bad syntax is an error", found[1].error === true && /does not compute/.test(found[1].message));
  check("formulas: a stale value warns with the fresh result",
    found[2].stale === true && found[2].message.includes("= 20"));

  check("align: recomputes formulas before padding",
    align(["| name | b     |", "|------+-------|", "| 2    | =$1*2 |"].join("\n")).some((e) => e.text.includes("4 =$1*2")));
}

// ---------------------------------------------------------------------------
// the CSV mirror: tablesOf / toCsv / fromCsv / updateTable
// ---------------------------------------------------------------------------
{
  const sheet = [
    "Order",
    "    | name | country |",
    "    |------+---------|",
    "    | Acme | France  |",
    "    | Bolt | Germany |",
    "Refund (Return)",
    "    | name | reason  |",
    "    |------+---------|",
    "    | R1   | Damaged |",
    "Organisation",
    "    | # | full name |",
  ];
  const ts = tablesOf(sheet, "spreadsheet");
  check("tablesOf: finds complete tables under their parent names",
    ts.length === 2 && ts[0].name === "Order" && ts[1].name === "Refund");
  check("tablesOf: grid is header plus data rows",
    ts[0].header.join(",") === "name,country" && ts[0].rows[1].join(",") === "Bolt,Germany");
  check("tablesOf: an assumed lone header is skipped (still being typed)",
    !ts.some((t) => t.name === "Organisation"));
  check("tablesOf: a top-level table is named by the root",
    tablesOf(["| name |", "|------|", "| Solo |"], "zoo")[0].name === "zoo");

  check("cleanName: strips markers, values and aliases",
    cleanName("Refund (Return)") === "Refund" && cleanName("- Acme: x") === "Acme");

  check("toCsv: quotes only what needs it",
    toCsv([["name", "note"], ["Acme", 'a, "b"\nc']]) === 'name,note\nAcme,"a, ""b""\nc"\n');
  const grid = fromCsv('name,note\r\nAcme,"a, ""b""\nc"\r\n');
  check("fromCsv: quoted commas, doubled quotes and newlines survive",
    grid.length === 2 && grid[1][1] === 'a, "b"\nc');
  check("fromCsv: a pipe is bent to a broken bar", fromCsv("a|b,c")[0][0] === "a¦b");
  check("fromCsv round-trips toCsv",
    JSON.stringify(fromCsv(toCsv([["a", "b"], ["1", "x,y"]]))) === JSON.stringify([["a", "b"], ["1", "x,y"]]));

  const u = updateTable(sheet, "Order", ["name", "country", "currency"], [["Acme", "France", "EUR"]]);
  check("updateTable: replaces the Concept's block in place",
    u.changed && u.from === 1 && u.to === 4
    && u.block[0] === "    | name | country | currency |"
    && u.block[2] === "    | Acme | France  | EUR      |");
  const same = updateTable(sheet, "Refund", ["name", "reason"], [["R1", "Damaged"]]);
  check("updateTable: an identical grid changes nothing", same.changed === false);
  const lone = updateTable(sheet, "Organisation", ["#", "full name"], [["1", "Acme Ltd"]]);
  check("updateTable: completes an assumed lone header",
    lone.changed && lone.from === 10 && lone.to === 10 && lone.block.length === 3);
  const ins = updateTable(["Person"], "Person", ["name"], [["John"]]);
  check("updateTable: inserts beneath a table-less Concept",
    ins.changed && ins.to < ins.from && ins.from === 1
    && ins.block.length === 3 && ins.block[0] === "    | name |" && ins.block[2] === "    | John |");
  check("updateTable: an unknown Concept is null",
    updateTable(["Order"], "Ghost", ["a"], [], "root") === null);
}

// ---------------------------------------------------------------------------
// align: unchanged contract — tables with a separator only, 1-based lines
// ---------------------------------------------------------------------------
{
  const messy = ["Otter", "    | name | size |", "    |--+--|", "    | Ollie | 5 |"].join("\n");
  const edits = align(messy);
  check("align: still pads, redraws, and reports 1-based lines",
    edits.length === 3 && edits[0].line === 2 && edits[1].text === "    |-------+------|");
  check("align: still leaves lone pipe Examples alone", align("A\n    | gegeg").length === 0);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
