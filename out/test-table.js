// Unit tests for the org table editor's pure logic (src/table.js): block
// discovery, rendering, cursor math, and every operation the extension's
// commands apply — navigation, row/column surgery, sorting, region import.
//
// Plain Node script, no framework — run with: node out/test-table.js
const {
  cells, isSeparator, align, blockAt, widthsOf, render, cellStart, colAt,
  padRows, dataRow, nextCell, prevCell, nextRow, moveColumn, moveRow,
  insertColumn, deleteColumn, insertRow, deleteRow,
  sortRows, fromRegion, cleanName, tablesOf, toCsv, fromCsv, updateTable,
  splitCell, splitConstraint, formatValue, tableCtx,
  valueType, copyFormulaDown, copyFormulaAcross, referenceNames,
  copyCell, moveCell, copyRow, copyColumn, headerIndex,
  subtreeOf, prevSibling, demoteRow, promoteRow,
  mergeRegistries, readValue,
  isRowText, jumpCell, cornerCell, fillDown, fillRight,
  copyFormulaFromAbove, copyValueFromAbove, columnTerm,
} = require("../src/table");
const { lint } = require("../src/linter");
const { conceptRegistry } = require("../src/derive");

// The registry a text offers, exactly as the editor and the CLI build it:
// one scope kind over the parsed tree, tables and line form alike.
const regOf = (lines, rootName) => {
  const { root, nodes } = lint(lines.join("\n"), rootName);
  return mergeRegistries(conceptRegistry(root, nodes));
};

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

// --- an Example hierarchy: rows nested inside their name cell -----------------
// A row indented under the row above it is that row's sub-Example. The depth
// rides on the block as a number, never as text, so every reader that trims a
// cell sees the bare name exactly as it always did.
{
  const nested = [
    "Thing       |age",
    "Parent      |",
    "    Child 1 |10",
    "    Child 2 |12",
    "Other Parent|",
    "    Child 3 |7",
  ];
  const b = blockAt(nested, 0);
  check("nesting: blockAt reads each row's depth from its name cell",
    b.rows.map((r) => r.depth).join(",") === "0,0,1,1,0,1");
  check("nesting: the name stays trimmed, so every reader sees it unchanged",
    b.rows[2].cells[0] === "Child 1" && b.rows[4].cells[0] === "Other Parent");
  check("nesting: the name column is measured with the deepest row's indent",
    widthsOf(b)[0] === "Other Parent".length);
  check("nesting: a nested table re-renders byte for byte",
    render(blockAt(nested, 0)).join("\n") === nested.join("\n"));
  check("nesting: tablesOf hands each row's depth out with it",
    tablesOf(nested, "Zoo")[0].rowDepths.join(",") === "0,1,1,0,1");

  const flat = ["Otter |size", "Ollie |5", "Pebble|3"];
  check("nesting: a flat table is unchanged — every row is depth 0",
    blockAt(flat, 0).rows.every((r) => !r.depth)
    && render(blockAt(flat, 0)).join("\n") === flat.join("\n"));

  // every operation that moves a row moves the branch under it
  const op = (fn, row, col) => {
    const block = blockAt(nested, 0);
    return fn(block, row, col === undefined ? 0 : col) ? render(block) : null;
  };
  check("nesting: deleting a row takes its sub-Examples with it",
    op(deleteRow, 1).join("\n") === ["Thing       |age", "Other Parent|", "    Child 3 |7"].join("\n"));
  check("nesting: moving a row down hops the whole next branch, not one line",
    op((x, r, c) => moveRow(x, r, c, 1), 1).join("\n")
    === ["Thing       |age", "Other Parent|", "    Child 3 |7",
         "Parent      |", "    Child 1 |10", "    Child 2 |12"].join("\n"));
  check("nesting: moving a row up carries its own children over the sibling above",
    op((x, r, c) => moveRow(x, r, c, -1), 4).join("\n")
    === ["Thing       |age", "Other Parent|", "    Child 3 |7",
         "Parent      |", "    Child 1 |10", "    Child 2 |12"].join("\n"));
  check("nesting: a new row joins the generation it is typed into",
    op(insertRow, 3)[3] === "            |");

  // Tab and Shift+Tab at the head of a name cell
  check("nesting: promoting a row lifts it out of its parent",
    op(promoteRow, 3).join("\n").includes("\nChild 2     |12"));
  check("nesting: demoting a row files it under the sibling above",
    op(demoteRow, 3).join("\n").includes("        Child 2|12"));
  check("nesting: the first row of a generation has no sibling to nest under",
    op(demoteRow, 2) === null && op(promoteRow, 1) === null);
  check("nesting: demoting carries the row's own children along",
    (() => {
      const block = blockAt(["T    |a", "P    |", "    C1|1", "    C2|2", "        D|3"], 0);
      demoteRow(block, 3, 0);
      return block.rows[3].depth === 2 && block.rows[4].depth === 3;
    })());

  // sorting orders siblings against each other, never across generations
  const unsorted = ["Thing   |age", "Zeta    |3", "    Yak |9", "    Ant |1", "Alpha   |5", "    Owl |2"];
  const sorted = (col) => {
    const block = blockAt(unsorted, 0);
    sortRows(block, 1, col);
    return render(block);
  };
  check("nesting: sorting orders each generation and keeps every branch whole",
    sorted(0).join("\n") === ["Thing  |age", "Alpha  |5", "    Owl|2",
      "Zeta   |3", "    Ant|1", "    Yak|9"].join("\n"));
  check("nesting: sorting by a value column sorts the parents by their own cell",
    sorted(1).join("\n") === ["Thing  |age", "Zeta   |3", "    Ant|1",
      "    Yak|9", "Alpha  |5", "    Owl|2"].join("\n"));
  check("nesting: a flat table sorts exactly as it always did",
    (() => {
      const block = blockAt(["Thing|age", "Zeta |3", "Alpha|5", "Mid  |1"], 0);
      sortRows(block, 1, 0);
      return render(block).join("\n") === ["Thing|age", "Alpha|5", "Mid  |1", "Zeta |3"].join("\n");
    })());
}

// --- what Excel hands back ---------------------------------------------------
// A CSV is the one file in the mirror another program owns as much as this
// one does, so the reader takes the spellings Excel writes: a byte-order
// mark in front of the first cell, and the list separator of a locale where
// the comma is the decimal mark.
{
  check("fromCsv: a leading BOM is dropped, not carried into the Concept's cell",
    JSON.stringify(fromCsv("\uFEFFPerson,age\nAristotle,10\n")) === JSON.stringify([["Person", "age"], ["Aristotle", "10"]]));

  check("fromCsv: a BOM with CRLF endings reads the same as plain LF",
    JSON.stringify(fromCsv("\uFEFFPerson,age\r\nAristotle,10\r\n")) === JSON.stringify(fromCsv("Person,age\nAristotle,10\n")));

  check("fromCsv: a semicolon-delimited file (Excel's other locale) reads as cells",
    JSON.stringify(fromCsv("Person;age\nAristotle;10\n")) === JSON.stringify([["Person", "age"], ["Aristotle", "10"]]));

  // the sniff is narrow on purpose: a comma file whose cells merely hold
  // semicolons is still a comma file
  check("fromCsv: semicolons inside a comma file's cells never switch the delimiter",
    JSON.stringify(fromCsv("Person,note\nAristotle,\"a; b; c\"\n")) === JSON.stringify([["Person", "note"], ["Aristotle", "a; b; c"]]));

  // one column and no delimiter at all is a comma file with a single cell
  check("fromCsv: a one-column file is unaffected by the sniff",
    JSON.stringify(fromCsv("Philosopher\nAristotle\n")) === JSON.stringify([["Philosopher"], ["Aristotle"]]));

  // and the mirror keeps writing commas whatever it was handed
  check("toCsv: the mirror always writes commas, never the locale's separator",
    toCsv([["Person", "age"], ["Aristotle", "10"]]) === "Person,age\nAristotle,10\n");
}

const doc = [
  "Otter",                              // 0
  "    name   | size | colour",         // 1  the header: it stands first
  "    Ollie  | 5    | brown",          // 2
  "    Pebble | 3    | grey",           // 3
  "",                                   // 4
  "    | gegeg",                        // 5
];
const fresh = () => blockAt(doc, 2);

// ---------------------------------------------------------------------------
// blockAt, widthsOf, render, cellStart, colAt
// ---------------------------------------------------------------------------
{
  const block = fresh();
  check("blockAt: finds the run of pipe rows", block.start === 1 && block.end === 3);
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
    && blockAt(doc, 5).rows[0].cells.join(",") === ",gegeg");

  // the pipe divides, so a row ends at its last written cell — and a row
  // with nothing in its name cell opens with that cell's own spaces, which
  // is what keeps the columns under it lined up
  const ragged = blockAt(["Otter |size|colour", "Ollie |5", "      |3   |grey"], 0);
  check("render: a row that stops short keeps the dividers it stops before",
    render(ragged)[1] === "Ollie|5   |");
  check("render: an empty name cell is drawn as the spaces of its column",
    render(ragged)[2] === "     |3   |grey");

  // a table written in the pre-1.12 bordered form reads without its borders,
  // so drawing it again is what migrates the file
  const old = ["    |Otter |size|", "    |------+----|", "    |Ollie |5   |", "    |    Pup|1  |"];
  const legacy = blockAt(old, 0);
  check("blockAt: a bordered table is read without its borders",
    legacy.rows[0].cells.join(",") === "Otter,size" && legacy.rows[2].cells.join(",") === "Ollie,5"
    && legacy.rows[3].depth === 1);
  check("render: re-drawing a bordered table migrates it",
    render(legacy).join("|") === ["    Otter  |size", "    Ollie  |5", "        Pup|1"].join("|"));

  check("widthsOf: widest cell per column", widthsOf(block).join(",") === "6,4,6");
  check("render: redraws aligned (no gutters)", render(block)[1] === "    Ollie |5   |brown");
  check("cellStart: column offsets on the aligned line", cellStart(block, 0) === 4 && cellStart(block, 1) === 11 && cellStart(block, 2) === 16);
  check("colAt: the cell under a character", colAt(doc[2], 7) === 0 && colAt(doc[2], 16) === 1 && colAt(doc[2], 2) === 0);
}

// ---------------------------------------------------------------------------
// navigation: nextCell / prevCell / nextRow
// ---------------------------------------------------------------------------
{
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

  // the first column names the Concept and its Examples — no attribute to
  // move, delete or copy, and nothing is inserted in front of it
  const same = (x) => x.rows.map((r) => r.cells.join(",")).join("/") === fresh().rows.map((r) => r.cells.join(",")).join("/");
  b = fresh();
  check("name column: deleteColumn refuses it and changes nothing", deleteColumn(b, 1, 0) === null && same(b));
  b = fresh();
  check("name column: moveColumn neither moves it nor moves onto it",
    moveColumn(b, 1, 0, 1) === null && moveColumn(b, 1, 1, -1) === null && same(b));
  b = fresh();
  check("name column: copyColumn refuses it", copyColumn(b, 1, 0, 1) === null && same(b));
  b = fresh();
  const ins = insertColumn(b, 1, 0);
  check("name column: insertColumn puts the new column just after it",
    ins.col === 1 && b.rows[0].cells.join(",") === "name,,size,colour");
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

// ---------------------------------------------------------------------------
// fromRegion: delimited lines become a table, header lowercased
// ---------------------------------------------------------------------------
{
  const csv = fromRegion(["    Name,Size", "    Ollie,5", "    Pebble,3"]);
  check("fromRegion: CSV becomes a table, the first cell (the Concept) kept, the rest lowercased",
    csv[0] === "    Name  |size" && csv[1] === "    Ollie |5" && csv[2] === "    Pebble|3");
  const tsv = fromRegion(["a\tb", "1\t2"]);
  check("fromRegion: tabs win over commas", tsv[0] === "a|b");
  const spaced = fromRegion(["name  size", "Ollie  5"]);
  check("fromRegion: multi-space columns as a last resort", spaced[1] === "Ollie|5");
  check("fromRegion: nothing from blank lines", fromRegion(["   ", ""]) === null);
}

// ---------------------------------------------------------------------------
// derivations: `10 =@price+10` — the value first, its Python after it
// ---------------------------------------------------------------------------
{
  check("splitCell: value and derivation part at the ' ='",
    JSON.stringify(splitCell("10 =@price+10")) === '{"value":"10","eq":3,"op":"="}'
    && splitCell("=@price*2").value === "" && splitCell("=@price*2").eq === 0
    && splitCell("plain text").eq === -1 && splitCell("plain text").op === null);
  check("splitCell: values never split on comparison operators (constraints live on attributes)",
    splitCell("25 >=18").eq === -1 && splitCell("90 <=@price*1.5").eq === -1
    && splitCell('active =="active"').eq === -1);
  check("splitCell: scans left to right, so an in-derivation '==' never splits",
    JSON.stringify(splitCell("10 =(1 if @price == 3 else 0)")) === '{"value":"10","eq":3,"op":"="}');
  check("splitConstraint: an attribute's trailing bound is recognised",
    (() => { const c = splitConstraint("age >=18"); return c.value === "age" && c.eq === 4 && c.op === ">=" && c.formula === "18"; })()
    && splitConstraint("cap <=@price*1.5").op === "<="
    && splitConstraint('status =="active"').op === "=="
    && splitConstraint("150 <= 200").op === "<=");
  check("splitConstraint: prose comparisons stay plain terms",
    splitConstraint("10 < 20 knots").eq === -1
    && splitConstraint("wind speed > none noted").eq === -1
    && splitConstraint("age >= 18 years").eq === -1
    && splitConstraint("plain term").op === null);
  check("splitConstraint: 'is <word>' phrases stay plain attribute names",
    splitConstraint("birth date is date").eq === -1
    && splitConstraint("car is red").eq === -1);
  check("splitConstraint: a bound is Python — the formula language's backtick text is no bound",
    splitConstraint("status ==`active`").eq === -1);
  check("splitConstraint: bounds chain on one declaration ('age >=18 <=65')",
    (() => {
      const c = splitConstraint("age >=18 <=65");
      return c.value === "age" && c.constraints.length === 2
        && c.constraints[0].op === ">=" && c.constraints[0].formula === "18"
        && c.constraints[1].op === "<=" && c.constraints[1].formula === "65"
        && c.constraints[1].eq === "age >=18 ".length;
    })());
  check("splitConstraint: three bounds chain too",
    splitConstraint("q >=1 <=5 <9").constraints.length === 3);
  check("splitConstraint: an operator inside a bound's brackets or strings never splits it",
    (() => {
      const c = splitConstraint('status ==("a <= b", "sent")');
      return c.constraints.length === 1 && c.constraints[0].formula === '("a <= b", "sent")';
    })());
  check("splitConstraint: an operator quoted inside a reference-bearing bound never splits it",
    (() => {
      const c = splitConstraint('n ==len(@note.split("a > b"))');
      const d = splitConstraint('v ==@price if "a <= b" else 1');
      return c.value === "n" && c.constraints.length === 1
        && d.value === "v" && d.constraints.length === 1;
    })());
  check("splitConstraint: a bound still open is no Python yet, so no bound",
    splitConstraint("v ==@price*(2").eq === -1 && splitConstraint("v ==@price*(2)").constraints.length === 1);
  check("splitConstraint: a single bound still answers a one-entry chain",
    (() => {
      const c = splitConstraint("age >=18");
      return c.constraints.length === 1 && c.constraints[0].op === ">=" && c.constraints[0].eq === c.eq;
    })());
  check("valueType: dates, numbers, text",
    valueType("2025-01-01") === "date" && valueType("$1,200") === "number" && valueType("hello") === "text");

  // an escaped '=' is a value's own character, not the derivation operator
  check("splitCell: an escaped '=' never splits the cell",
    splitCell("a \\= b").eq === -1 && splitCell("a \\= b").value === "a \\= b"
    && splitCell("4 =2*2").eq === 2);
  check("readValue: the backslash comes off when the value is read as data",
    readValue("a \\= b") === "a = b" && readValue("plain") === "plain"
    && readValue("4") === "4");

  check("formatValue: keeps the $ and thousands commas of the old value",
    formatValue(1500, "$1,000") === "$1,500" && formatValue(20, "") === "20" && formatValue(1.256, "") === "1.26");
  // every computed number carries thousands separators, whatever the old
  // value looked like
  check("formatValue: a computed number always carries thousands separators",
    formatValue(1215.6, "1215.6") === "1,215.6" && formatValue(184540, "") === "184,540"
    && formatValue(-3200.25, "") === "-3,200.25" && formatValue(3628800, "7") === "3,628,800"
    && formatValue(-0.001, "") === "0" && formatValue(999, "") === "999");

  check("align: pads a derivation's cell like any other, computing nothing",
    (() => {
      const edits = align(["N | a | b", "X | 2 | =@a*2"].join("\n"));
      return edits.some((e) => e.text === "X|2|=@a*2") && !edits.some((e) => /\d =@a\*2/.test(e.text));
    })());

  // a header's constraint is not part of its column's name
  const bound = {
    indent: "",
    rows: [
      { sep: false, cells: ["name", "age >=18", "cap"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "25", "90 <=99"] },
      { sep: false, cells: ["B", "15", ""] },
    ],
  };
  check("tableCtx: a header's constraint is not part of the column's name",
    (() => {
      const rows = bound.rows.slice(2);
      const ctx = tableCtx(rows, rows[0], bound.rows[0].cells);
      return ctx.matchColumn("age)").id === 2 && ctx.cell(2) === "25";
    })());
}

// ---------------------------------------------------------------------------
// copyFormulaDown / copyFormulaAcross / referenceNames
// ---------------------------------------------------------------------------
{
  const grid = () => ({
    indent: "",
    rows: [
      { sep: false, cells: ["name", "a", "b", "c"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["R1", "10", "20", "=@a*2"] },
      { sep: false, cells: ["R2", "5", "8", ""] },
    ],
  });
  let b = grid();
  b.rows[3].cells[3] = "7";
  copyFormulaDown(b, 2, 3);
  check("copyFormulaDown: the column's other rows gain the derivation, without a value until it runs",
    b.rows[2].cells[3] === "=@a*2" && b.rows[3].cells[3] === "=@a*2");

  b = grid();
  copyFormulaAcross(b, 2, 3);
  check("copyFormulaAcross: the row's other cells gain the derivation alone (name column spared)",
    b.rows[2].cells[0] === "R1" && b.rows[2].cells[1] === "=@a*2" && b.rows[2].cells[2] === "=@a*2" && b.rows[2].cells[3] === "=@a*2");
  check("copyFormulaAcross: a cell without a formula copies nothing",
    copyFormulaAcross(grid(), 3, 3) === null);

  const names = referenceNames(grid());
  check("referenceNames: columns (header, minus name) then rows (first column)",
    names.columns.join(",") === "a,b,c" && names.rows.join(",") === "R1,R2");
}

// ---------------------------------------------------------------------------
// no rule, no alignment: every column is drawn left, and a leftover rule
// (colons and all) is layout the next draw takes out
// ---------------------------------------------------------------------------
{
  const written = [
    "default|left|right|centre",
    "-------|:---|----:|:----:",
    "1|1|1|1",
    "2|2|2|2",
  ];
  const b = blockAt(written, 0);
  const drawn = render(b);
  check("no alignment: every column is padded on its right, whatever the old rule said",
    drawn[1] === "1      |1   |1    |1");
  check("no rule: the leftover is dropped, so the drawn table is header and rows",
    drawn.length === 3 && drawn[0] === "default|left|right|centre");

  // the formatter must not churn: drawing an aligned table again changes
  // nothing, or every save would rewrite the file
  check("alignment: rendering is idempotent",
    render(blockAt(drawn, 0)).join("\n") === drawn.join("\n"));

  check("cellStart: a cell starts at its column's own edge",
    cellStart(b, 2) === "default|left|".length);

  // and the model cannot tell: every reader trims its cells
  check("alignment: the padding is presentation — the cells read the same",
    cells(drawn[1]).map((c) => c.text).join(",") === "1,1,1,1");
}

// ---------------------------------------------------------------------------
// the table with no attributes: nothing to divide, so the pipe closes the row
// ---------------------------------------------------------------------------
// A Concept with no attributes has one column of names and no pair of cells
// to put a divider between. Drawn as a pure divider it would carry no pipe
// at all, and the next reader would see plain outline lines — so there, and
// only there, the pipe closes the row.
{
  const tree = [
    "Org Structure|",
    "Department A|",
    "    Team 1|",
    "        Alice|",
    "        Charlie|",
  ];
  const b = blockAt(tree, 0);
  check("one column: the closing pipe reads as the empty last cell it looks like",
    cells("Alice|").map((c) => c.text).join(",") === "Alice," && b.rows[3].cells[0] === "Alice");
  check("one column: every row keeps its depth",
    b.rows.map((r) => r.depth).join(",") === "0,0,1,2,2");
  const drawn = render(b);
  check("one column: every row is drawn closed, so the table stays a table",
    drawn.every((l) => l.endsWith("|")) && blockAt(drawn, 0).rows.length === 5);
  check("one column: the closing pipes line up past the deepest name",
    drawn[0] === "Org Structure  |" && drawn[4] === "        Charlie|");
  check("one column: drawing it again changes nothing",
    render(blockAt(drawn, 0)).join("\n") === drawn.join("\n"));

  // a block built with one cell to the row — a one-column CSV folded back,
  // free text flipped over — is where the closing pipe is first written
  const built = render({ indent: "", rows: [{ sep: false, cells: ["Person"] }, { sep: false, cells: ["John"] }] });
  check("one column: a block built with a single cell per row draws closed",
    built.join("\n") === "Person|\nJohn  |");

  // with attributes there are dividers enough: a row ends at its last
  // written cell, and the padding past it is trailing whitespace
  const withAttr = render(blockAt(["Otter |size", "Ollie |5", "Pebble|"], 0));
  check("with attributes: a row ends at its last written cell",
    withAttr.join("\n") === "Otter |size\nOllie |5\nPebble|");
}

// ---------------------------------------------------------------------------
// copying and cutting the text itself: copyCell / moveCell / copyRow / copyColumn
// ---------------------------------------------------------------------------
{
  const grid = () => ({
    indent: "",
    rows: [
      { sep: false, cells: ["Order", "price", "note"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["R1", "10 =@price", "keep"] },
      { sep: false, cells: ["R2", "5", ""] },
    ],
  });

  // the cell, in each of the four directions — formula and all
  let b = grid();
  let at = copyCell(b, 2, 1, 1, 0);
  check("copyCell: down writes the neighbour and takes the cursor with it",
    b.rows[3].cells[1] === "10 =@price" && b.rows[2].cells[1] === "10 =@price"
    && at.row === 3 && at.col === 1);
  b = grid();
  at = copyCell(b, 3, 1, -1, 0);
  check("copyCell: up copies the other way", b.rows[2].cells[1] === "5" && at.row === 2);
  b = grid();
  copyCell(b, 2, 1, 0, 1);
  check("copyCell: right copies across the row", b.rows[2].cells[2] === "10 =@price");
  b = grid();
  copyCell(b, 2, 2, 0, -1);
  check("copyCell: left copies back, name column included",
    b.rows[2].cells[1] === "keep");

  // the separator is skipped, as TAB and RET skip it
  b = grid();
  copyCell(b, 2, 0, -1, 0);
  check("copyCell: a vertical step skips the separator and lands on the header",
    b.rows[0].cells[0] === "R1");

  // down past the last row grows the table; up past the first does not
  b = grid();
  at = copyCell(b, 3, 1, 1, 0);
  check("copyCell: down past the last row appends one, as TAB does",
    b.rows.length === 5 && b.rows[4].cells[1] === "5" && at.row === 4);
  check("copyCell: up from the top row has nowhere to go",
    copyCell(grid(), 0, 1, -1, 0) === null);
  check("copyCell: sideways never grows the table — a column needs a name",
    copyCell(grid(), 2, 2, 0, 1) === null && copyCell(grid(), 2, 0, 0, -1) === null);

  // the cut leaves the cell empty behind it
  b = grid();
  at = moveCell(b, 2, 1, 0, 1);
  check("moveCell: the value arrives and the cell it left is empty",
    b.rows[2].cells[2] === "10 =@price" && b.rows[2].cells[1] === "" && at.col === 2);

  // the whole row
  b = grid();
  at = copyRow(b, 2, 1, 1);
  check("copyRow: down duplicates the row beneath it, cursor on the copy",
    b.rows.length === 5 && b.rows[3].cells.join("|") === "R1|10 =@price|keep"
    && b.rows[2].cells.join("|") === "R1|10 =@price|keep" && at.row === 3 && at.col === 1);
  b = grid();
  at = copyRow(b, 3, 0, -1);
  check("copyRow: up duplicates it above, and the original follows down",
    b.rows[3].cells[0] === "R2" && b.rows[4].cells[0] === "R2" && at.row === 3);
  check("copyRow: the header is not a row to duplicate",
    copyRow(grid(), 0, 0, 1) === null && copyRow(grid(), 1, 0, 1) === null);

  // the whole column, header and all
  b = grid();
  at = copyColumn(b, 2, 1, 1);
  check("copyColumn: right duplicates header and every value, cursor on the copy",
    b.rows[0].cells.join("|") === "Order|price|price|note"
    && b.rows[2].cells.join("|") === "R1|10 =@price|10 =@price|keep"
    && at.col === 2);
  b = grid();
  at = copyColumn(b, 2, 2, -1);
  check("copyColumn: left duplicates it before the original",
    b.rows[0].cells.join("|") === "Order|price|note|note" && at.col === 2);
}

// ---------------------------------------------------------------------------
// the CSV mirror: tablesOf / toCsv / fromCsv / updateTable
// ---------------------------------------------------------------------------
{
  const sheet = [
    "Order|country",
    "Acme |France",
    "Bolt |Germany",
    "",
    "Refund (Return)|reason",
    "R1             |Damaged",
    "",
    "Organisation|full name",
  ];
  const ts = tablesOf(sheet, "spreadsheet");
  check("tablesOf: names each table by its first header cell (the Concept)",
    ts.length === 2 && ts[0].name === "Order" && ts[1].name === "Refund");
  check("tablesOf: grid is header plus data rows",
    ts[0].header.join(",") === "Order,country" && ts[0].rows[1].join(",") === "Bolt,Germany");
  check("tablesOf: an assumed lone header is skipped (still being typed)",
    !ts.some((t) => t.name === "Organisation"));
  check("tablesOf: a table whose first cell names no Concept falls back to the root",
    tablesOf(["name|size", "Solo|1"], "zoo")[0].name === "zoo");

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

  const u = updateTable(sheet, "Order", ["Order", "country", "currency"], [["Acme", "France", "EUR"]]);
  check("updateTable: replaces the Concept's block in place",
    u.changed && u.from === 0 && u.to === 2
    && u.block[0] === "Order|country|currency"
    && u.block[1] === "Acme |France |EUR");
  const same = updateTable(sheet, "Refund", ["Refund (Return)", "reason"], [["R1", "Damaged"]]);
  check("updateTable: an identical grid changes nothing", same.changed === false);
  const folded = updateTable(sheet, "ORDER", ["Order", "country", "currency"], [["Acme", "France", "EUR"]]);
  check("updateTable: the Concept name matches in any case",
    folded !== null && folded.from === 0 && folded.to === 2);
  const lone = updateTable(sheet, "Organisation", ["Organisation", "full name"], [["1", "Acme Ltd"]]);
  check("updateTable: completes an assumed lone header",
    lone.changed && lone.from === 7 && lone.to === 7 && lone.block.length === 2);
  const ins = updateTable(["Person"], "Person", ["Person"], [["John"]]);
  check("updateTable: inserts a merge-form grid beneath a table-less Concept",
    ins.changed && ins.to < ins.from && ins.from === 1
    && ins.block.length === 2 && ins.block[0] === "    Person|" && ins.block[1] === "    John  |");
  check("updateTable: an unknown Concept is null",
    updateTable(["Order"], "Ghost", ["a"], [], "root") === null);
}

// ---------------------------------------------------------------------------
// align: every table redrawn, 1-based lines
// ---------------------------------------------------------------------------
{
  const messy = ["Otter", "    name | size", "    Ollie | 5"].join("\n");
  const edits = align(messy);
  check("align: still pads, redraws, and reports 1-based lines",
    edits.length === 2 && edits[0].line === 2 && edits[0].text === "    name |size"
    && edits[1].text === "    Ollie|5");
  // a table carrying a leftover rule loses a line, so its block is rewritten whole
  const ruled = ["Otter", "    name|size", "    ----+----", "    Ollie|5"].join("\n");
  const ruledEdits = align(ruled);
  check("align: a leftover rule is drawn away, the block rewritten whole",
    ruledEdits.length === 1 && ruledEdits[0].line === 2 && ruledEdits[0].to === 4
    && ruledEdits[0].text === "    name |size\n    Ollie|5");
}

// ---------------------------------------------------------------------------
// no width cookie: a column is as wide as its widest cell, and one row of a
// table is one line of the file
// ---------------------------------------------------------------------------
// Between 1.8 and 1.12 a header cell could carry `<N>` to cap its column,
// and longer cells wrapped onto continuation rows. Both are gone: `<10>` is
// part of a column's name like any other characters, and nothing splits a
// cell across two lines.
{
  check("splitConstraint: 'desc <24' is the '<' bound it reads as",
    splitConstraint("desc <24").op === "<" && splitConstraint("desc <24").formula === "24");
  check("splitConstraint: 'desc <24>' is no constraint — the '>' spoils the bound",
    splitConstraint("desc <24>").eq === -1);

  const src = [
    "Note",
    "    name|d <10>|qty",
    "    A   |a rather long note|3",
    "    B   |short|4",
  ];
  const block = blockAt(src, 3);
  check("no cookie: '<10>' caps nothing — the column holds its widest cell whole",
    JSON.stringify(widthsOf(block)) === "[4,18,3]");
  const drawn = render(block);
  check("no wrapping: one row, one line, the long cell drawn whole",
    drawn.length === 3
    && drawn[1] === "    A   |a rather long note|3"
    && drawn[2] === "    B   |short             |4");
  check("no wrapping: drawing it again changes nothing",
    render(blockAt(drawn, 1)).join("\n") === drawn.join("\n"));

  const grids = tablesOf(["Note", ...drawn], "Sheet");
  check("tablesOf: every row answers on its own line",
    grids.length === 1
    && JSON.stringify(grids[0].rows) === JSON.stringify([["A", "a rather long note", "3"], ["B", "short", "4"]])
    && JSON.stringify(grids[0].rowLines) === "[3,4]");

}

// ---------------------------------------------------------------------------
// a pipe in a value: a colon before the first pipe keeps a line a line
// ---------------------------------------------------------------------------
{
  check("isRowText: 'name: value' with a pipe in the value is not a row",
    !isRowText("    rule: a | b") && !isRowText("- Ann: x|y") && !isRowText("Reload: Ctrl+K|T"));
  check("isRowText: rows keep their colons after the first divider",
    isRowText("Otter|size") && isRowText("|12:30") && isRowText("Ollie|http://x.org|5"));
  check("isRowText: a leftover rule with alignment colons is still a row",
    isRowText("---:|:---") && isRowText(":--+--:"));
  const lines = ["Otter|size", "Ollie|5", "    note: a | b", "Pebble|3"];
  const block = blockAt(lines, 0);
  check("blockAt: a value line holding a pipe ends the table",
    block && block.start === 0 && block.end === 1 && blockAt(lines, 2) === null);
}

// ---------------------------------------------------------------------------
// a pipe inside a cell's Python is the Python's, in any cell — not only the
// first — while the Python is open in a bracket or a string
// ---------------------------------------------------------------------------
{
  const texts = (line) => cells(line).map((c) => c.text);
  check("cells: a pipe inside a later cell's string is the Python's",
    texts('A|=len("a|b")|=@x').join(" ¶ ") === 'A ¶ =len("a|b") ¶ =@x');
  check("cells: ... and inside its brackets, the value in front of it kept",
    texts("A|3 =(@a | @b)|x").join(" ¶ ") === "A ¶ 3 =(@a | @b) ¶ x");
  check("cells: a closed derivation running to the line's end keeps its pipes",
    texts('A|1|=",".join(["x|y"])').join(" ¶ ") === 'A ¶ 1 ¶ =",".join(["x|y"])');
  check("cells: an escaped quote does not close the string, so the pipe after it is still the Python's",
    texts('A|=len("a\\"|b")|=@x').join(" ¶ ") === 'A ¶ =len("a\\"|b") ¶ =@x');
  check("cells: a derivation still open reads every pipe as a divider (the row stays a row)",
    texts("A|=f(@a|b|c").join(" ¶ ") === "A ¶ =f(@a ¶ b ¶ c");
  check("cells: a pipe outside the brackets still divides, and a plain cell is untouched",
    texts("A|=a() | b()|it's|x").join(" ¶ ") === "A ¶ =a() ¶ b() ¶ it's ¶ x");
  const parsed = lint(["Box|n|label", 'A  |1|=",".join(["x|y"])'].join("\n"), "t");
  check("lint: a row holding a pipe in its Python parses with no extra cell",
    parsed.errors.length === 0);
}

// ---------------------------------------------------------------------------
// a calculated column: one derivation shared by every row moves to the
// header as `==`, and each cell keeps its value alone
// ---------------------------------------------------------------------------
{
  const { columnDefinition, defineColumn } = require("../src/table");
  const grid = (...lines) => blockAt(lines, 0);
  const rowsOf = (b) => b.rows.map((r) => r.cells.join("|")).join(" / ");
  const b = grid("Invoice|price|vat           |net", "A      |100  |20 =@price*0.2|=@price-1", "B      |50   |=@price*0.2   |", "C      |10   |              |=@price-1");
  const def = columnDefinition(b, 2);
  check("define column: offered when every row derives the column alike (empty cells allowed)",
    def && def.source === "@price*0.2" && def.name === "vat" && columnDefinition(b, 3).source === "@price-1");
  defineColumn(b, 1, 2);
  check("define column: the derivation moves to the header as ==, each cell keeps its value",
    rowsOf(b) === "Invoice|price|vat ==@price*0.2|net / A|100|20|=@price-1 / B|50|| / C|10||=@price-1");
  check("define column: not once the header defines it already", columnDefinition(b, 2) === null);
  check("define column: not when two rows derive it differently, or a row typed its own value",
    columnDefinition(grid("T|a|b", "x|1 =f()|", "y|2 =g()|"), 1) === null
    && columnDefinition(grid("T|a", "x|=f()", "y|7"), 1) === null);
  check("define column: never the name column, nor a column with no derivation, nor an empty one",
    columnDefinition(grid("T|a", "=f()|1", "y|2"), 0) === null && columnDefinition(grid("T|a", "x|1"), 1) === null
    && columnDefinition(grid("T|a|b", "x||1", "y||2"), 1) === null);
  const plain = grid("T|a", "x|1");
  check("define column: with nothing to define, the edit changes nothing", defineColumn(plain, 1, 1) === null && rowsOf(plain) === "T|a / x|1");
  const other = grid("T|a >=0|b", "x|=f()|1", "y|=f()|2");
  defineColumn(other, 1, 1);
  check("define column: a header's own bound stays, the definition chained after it",
    other.rows[0].cells[1] === "a >=0 ==f()" && other.rows[1].cells[1] === "" && other.rows[2].cells[2] === "2");
}

// ---------------------------------------------------------------------------
// the spreadsheet keys: Ctrl+arrow, Ctrl+Home/End, fills, copies from above
// ---------------------------------------------------------------------------
{
  const lines = [
    "Otter |size|colour|note",
    "Ollie |5   |brown |",
    "Pebble|    |grey  |x",
    "Pup   |3   |      |",
    "Kit   |4   |red   |y",
  ];
  const b = () => blockAt(lines, 0);
  const at = (t) => t && `${t.row},${t.col}`;
  check("jumpCell: from a filled cell over a gap, to the next filled cell",
    at(jumpCell(b(), 1, 1, 1, 0)) === "3,1");
  check("jumpCell: from a filled cell with a filled neighbour, to the end of the run",
    at(jumpCell(b(), 3, 1, 1, 0)) === "4,1" && at(jumpCell(b(), 1, 0, 0, 1)) === "1,2");
  check("jumpCell: from an empty cell, to the next filled one",
    at(jumpCell(b(), 2, 1, 1, 0)) === "3,1" && at(jumpCell(b(), 2, 1, -1, 0)) === "1,1");
  check("jumpCell: the header is a row like any other",
    at(jumpCell(b(), 1, 1, -1, 0)) === "0,1");
  check("jumpCell: nothing filled that way reaches the table's edge",
    at(jumpCell(b(), 1, 2, 0, 1)) === "1,3" && at(jumpCell(b(), 4, 3, 1, 0)) === "4,3"
    && at(jumpCell(b(), 3, 2, 0, 1)) === "3,3");
  check("cornerCell: home is the header's first cell, end the last row's last column",
    at(cornerCell(b(), "home")) === "0,0" && at(cornerCell(b(), "end")) === "4,3");

  let x = b();
  check("fillDown: the cell above fills the cursor's cell",
    at(fillDown(x, 2, 1)) === "2,1" && x.rows[2].cells[1] === "5");
  check("fillDown: never from the header, never into a name",
    fillDown(b(), 1, 1) === null && fillDown(b(), 2, 0) === null);
  x = b();
  const down = fillDown(x, 4, 2, { anchor: { row: 1, col: 1 }, active: { row: 4, col: 2 } });
  check("fillDown: a selection's first row fills the rest, every selected column",
    down && down.anchor.row === 1 && down.row === 4
    && x.rows.slice(1).every((r) => r.cells[1] === "5" && r.cells[2] === "brown")
    && x.rows[2].cells[3] === "x");
  x = b();
  check("fillDown: a selection starting on the header fills from the first data row",
    fillDown(x, 3, 1, { anchor: { row: 0, col: 1 }, active: { row: 3, col: 1 } }) !== null
    && x.rows[3].cells[1] === "5" && x.rows[0].cells[1] === "size");
  x = b();
  check("fillRight: the cell to the left fills the cursor's cell",
    fillRight(x, 1, 2) !== null && x.rows[1].cells[2] === "5");
  check("fillRight: never from the name column",
    fillRight(b(), 1, 1) === null);
  x = b();
  check("fillRight: a selection's first column fills the rest of each row",
    fillRight(x, 4, 3, { anchor: { row: 3, col: 1 }, active: { row: 4, col: 3 } }) !== null
    && x.rows[3].cells.slice(1).join() === "3,3,3" && x.rows[4].cells.slice(1).join() === "4,4,4");

  const withFormula = ["Sheet|price|total", "A|2|4 =@price*2", "B|3|"];
  x = blockAt(withFormula, 0);
  check("copyFormulaFromAbove: the derivation alone, for the next run to value",
    copyFormulaFromAbove(x, 2, 2) !== null && x.rows[2].cells[2] === "=@price*2");
  x = blockAt(withFormula, 0);
  check("copyValueFromAbove: the value alone, its derivation left behind",
    copyValueFromAbove(x, 2, 2) !== null && x.rows[2].cells[2] === "4");
  check("copy from above: nothing from the header, no formula to copy is nothing",
    copyFormulaFromAbove(blockAt(withFormula, 0), 1, 2) === null
    && copyFormulaFromAbove(blockAt(withFormula, 0), 2, 1) === null);
  x = blockAt(withFormula, 0);
  fillDown(x, 2, 2);
  check("fillDown: a derivation copied down arrives alone — its value there is the next run's",
    x.rows[2].cells[2] === "=@price*2");
  check("columnTerm: a header cell's name without its alias or constraint",
    columnTerm("price (cost) >=0") === "price" && columnTerm("tax rate") === "tax rate");
}


console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
