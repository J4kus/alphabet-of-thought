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
  splitCell, splitConstraint, evalFormula, formatValue, recompute, recomputeAll, formulas, tableCtx,
  formulaReferences,
  valueType, compareValues, copyFormulaDown, copyFormulaAcross, referenceNames,
  copyCell, moveCell, copyRow, copyColumn, headerIndex,
  subtreeOf, prevSibling, demoteRow, promoteRow,
  mergeRegistries, readValue, truthOf,
  columnDefinitions, isRowText, jumpCell, cornerCell, fillDown, fillRight,
  copyFormulaFromAbove, copyValueFromAbove, autoSum, columnTerm,
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
// formulas: `10 =@price+10` — the value first, its derivation after it
// ---------------------------------------------------------------------------
{
  check("splitCell: value and formula part at the ' ='",
    JSON.stringify(splitCell("10 =@price+10")) === '{"value":"10","eq":3,"op":"="}'
    && splitCell("=@price*2").value === "" && splitCell("=@price*2").eq === 0
    && splitCell("plain text").eq === -1 && splitCell("plain text").op === null);
  check("splitCell: values never split on comparison operators (constraints live on attributes)",
    splitCell("25 >=18").eq === -1 && splitCell("90 <=@price*1.5").eq === -1
    && splitCell("active ==`active`").eq === -1);
  check("splitCell: scans left to right, so an in-formula '==' never splits",
    JSON.stringify(splitCell("10 =if(@price == 3,1,0)")) === '{"value":"10","eq":3,"op":"="}');
  check("splitConstraint: an attribute's trailing bound is recognised",
    (() => { const c = splitConstraint("age >=18"); return c.value === "age" && c.eq === 4 && c.op === ">=" && c.formula === "18"; })()
    && splitConstraint("cap <=@price*1.5").op === "<="
    && splitConstraint("status ==`active`").op === "=="
    && splitConstraint("150 <= 200").op === "<=");
  check("splitConstraint: prose comparisons stay plain terms",
    splitConstraint("10 < 20 knots").eq === -1
    && splitConstraint("wind speed > none noted").eq === -1
    && splitConstraint("plain term").op === null);
  check("splitConstraint: 'is <word>' phrases stay plain attribute names",
    splitConstraint("birth date is date").eq === -1
    && splitConstraint("car is red").eq === -1);
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
  check("splitConstraint: an operator inside a bound's or() never splits it",
    (() => {
      const c = splitConstraint("status ==or(`a <= b`,`sent`)");
      return c.constraints.length === 1 && c.constraints[0].formula === "or(`a <= b`,`sent`)";
    })());
  check("splitConstraint: an operator quoted inside a reference-bearing bound never splits it",
    (() => {
      const c = splitConstraint("n ==countifs(@note, `a > b`)");
      const d = splitConstraint("v ==@price*or(`a <= b`,1)");
      return c.value === "n" && c.constraints.length === 1
        && d.value === "v" && d.constraints.length === 1;
    })());
  check("splitConstraint: a bound that cannot compute is still a bound (its error is reported, not swallowed)",
    splitConstraint("v ==@price*(2").constraints.length === 1);
  check("splitConstraint: a single bound still answers a one-entry chain",
    (() => {
      const c = splitConstraint("age >=18");
      return c.constraints.length === 1 && c.constraints[0].op === ">=" && c.constraints[0].eq === c.eq;
    })());
  check("valueType / date-aware compare",
    valueType("2025-01-01") === "date" && valueType("$1,200") === "number" && valueType("hello") === "text"
    && compareValues(">=", "2026-01-01", "2025-06-01") === true
    && compareValues("<", "2024-01-01", "2025-01-01") === true);

  // name → 1-based column id, the shape headerNameCands answers; the mock's
  // cell(c) answers c*10, so @qty reads 10, @price 20, @tally 30
  const mockCols = [{ key: "qty", id: 1 }, { key: "price", id: 2 }, { key: "tally", id: 3 }];
  const ctx = {
    matchColumn: (rest) => {
      const low = rest.toLowerCase();
      const hit = mockCols.find((c) => low.startsWith(c.key));
      return hit ? { id: hit.id, length: hit.key.length } : null;
    },
    matchRow: () => null,
    cell: (c) => String(c * 10), cellAt: () => "7", column: () => ["1", "2", "3"],
  };
  check("evalFormula: references and precedence", evalFormula("@price+3*4", ctx) === 32);
  check("evalFormula: parentheses and unary minus", evalFormula("-(2+3)*@qty", ctx) === -50);
  check("evalFormula: sum/avg over a column", evalFormula("sum(@tally)", ctx) === 6 && evalFormula("avg(@tally)", ctx) === 2);
  check("evalFormula: bad syntax throws",
    (() => { try { evalFormula("@price+", ctx); return false; } catch { return true; } })());
  check("evalFormula: positional @N no longer numbers a column (removed in 1.6)",
    (() => { try { evalFormula("@2+1", ctx); return false; } catch (e) { return /positional column numbers were removed/.test(e.message); } })());
  check("evalFormula: count tallies non-empty cells",
    evalFormula("count(@tally)", { ...ctx, column: () => ["a", "", " ", "4"] }) === 2);
  check("evalFormula: round and abs",
    evalFormula("round(1.256,2)", ctx) === 1.26 && evalFormula("round(1.6)", ctx) === 2 && evalFormula("abs(-(3))", ctx) === 3);
  check("evalFormula: '^' binds tighter than '*' and associates right",
    evalFormula("2^3", ctx) === 8
    && evalFormula("2+3^2", ctx) === 11
    && evalFormula("2*3^2", ctx) === 18
    && evalFormula("2^3^2", ctx) === 512
    && evalFormula("(2^3)^2", ctx) === 64
    && evalFormula("-2^2", ctx) === 4);
  check("evalFormula: ln() of a positive number, e.g. ln(1)=0",
    evalFormula("ln(1)", ctx) === 0
    && Math.abs(evalFormula("ln(2.718281828459045)", ctx) - 1) < 1e-12
    && evalFormula("round(ln(2^10)/ln(2))", ctx) === 10);
  check("evalFormula: ln() rejects zero and negatives",
    (() => {
      const throws = (f) => { try { evalFormula(f, ctx); return false; } catch { return true; } };
      return throws("ln(0)") && throws("ln(-3)") && throws("ln(`x`)");
    })());
  check("evalFormula: string literals, & concatenation and case helpers",
    evalFormula("upper(`ab`)&`c`", ctx) === "ABc"
    && evalFormula("lower(`AB`)", ctx) === "ab"
    && evalFormula("`a`&1+1", ctx) === "a2");
  check("evalFormula: trim/len/left/right/mid/replace",
    evalFormula("len(trim(` xy `))", ctx) === 2
    && evalFormula("left(`abcdef`,2)", ctx) === "ab"
    && evalFormula("right(`abcdef`,2)", ctx) === "ef"
    && evalFormula("mid(`abcdef`,2,3)", ctx) === "bcd"
    && evalFormula("replace(`a-b-c`,`-`,`+`)", ctx) === "a+b+c");
  check("evalFormula: comparisons yield 1 or 0, numeric when both sides read as numbers",
    evalFormula("@price>=3", ctx) === 1 && evalFormula("@price<3", ctx) === 0
    && evalFormula("`b`>`a`", ctx) === 1 && evalFormula("`10`==10", ctx) === 1);

  // the logical operators: and/not/xor answer a truth outright, or() answers
  // a Choice that reads as a truth here and as a set in a constraint
  check("evalFormula: and/not/xor answer 1 or 0",
    evalFormula("and(1,1)", ctx) === 1 && evalFormula("and(1,0)", ctx) === 0
    && evalFormula("not(0)", ctx) === 1 && evalFormula("not(1)", ctx) === 0
    && evalFormula("xor(1,0)", ctx) === 1 && evalFormula("xor(1,1)", ctx) === 0);
  check("evalFormula: the truth words read as themselves, empty is false, other text is true",
    truthOf("yes") === true && truthOf("TRUE") === true
    && truthOf("no") === false && truthOf("False") === false
    && truthOf("") === false && truthOf("  ") === false
    && truthOf("widget") === true && truthOf("0") === false && truthOf(0) === false);
  check("evalFormula: or() reads as a truth wherever a truth is wanted",
    evalFormula("or(0,0)+0", ctx) === 0 && evalFormula("or(0,1)+0", ctx) === 1
    && evalFormula("if(or(0,1),`y`,`n`)", ctx) === "y"
    && evalFormula("if(or(0,0),`y`,`n`)", ctx) === "n"
    && evalFormula("not(or(0,0))", ctx) === 1);
  check("evalFormula: or() reads as a set wherever '==' compares against it",
    compareValues("==", "sent", evalFormula("or(`draft`,`sent`)", ctx)) === true
    && compareValues("==", "void", evalFormula("or(`draft`,`sent`)", ctx)) === false
    && compareValues(">=", "5", evalFormula("or(1,9)", ctx)) === true);
  check("evalFormula: and/or/xor want at least two arguments, not() exactly one",
    (() => {
      const throws = (f) => { try { evalFormula(f, ctx); return false; } catch { return true; } };
      return throws("and(1)") && throws("or(1)") && throws("not(1,2)");
    })());
  check("evalFormula: a formula's or() value formats as its truth, not its set",
    formatValue(evalFormula("or(0,1)", ctx), "") === "1"
    && formatValue(evalFormula("or(0,0)", ctx), "") === "0");

  // the string functions
  check("evalFormula: concat/find/contains/starts/ends",
    evalFormula("concat(`a`,`b`,`c`)", ctx) === "abc"
    && evalFormula("find(`hello world`,`world`)", ctx) === 7
    && evalFormula("find(`abc`,`z`)", ctx) === 0
    && evalFormula("find(`a-a`,`a`,2)", ctx) === 3
    && evalFormula("contains(`hello`,`ell`)", ctx) === 1
    && evalFormula("starts(`hello`,`he`)", ctx) === 1
    && evalFormula("ends(`hello`,`lo`)", ctx) === 1);
  check("evalFormula: find() reads as a truth, being 0 exactly when absent",
    (() => {
      const noted = (text) => ({
        ...ctx,
        matchColumn: (rest) => (rest.toLowerCase().startsWith("note") ? { id: 1, length: 4 } : null),
        cell: () => text,
      });
      return evalFormula("if(find(@note,`urgent`),`!`,`-`)", noted("urgent job")) === "!"
        && evalFormula("if(find(@note,`urgent`),`!`,`-`)", noted("calm job")) === "-";
    })());
  check("evalFormula: proper/repeat/pad",
    evalFormula("proper(`jane DOE`)", ctx) === "Jane Doe"
    && evalFormula("repeat(`ab`,3)", ctx) === "ababab"
    && evalFormula("pad(`x`,4)", ctx) === "x   "
    && evalFormula("pad(`x`,4,`left`)", ctx) === "   x"
    && evalFormula("pad(`toolong`,3)", ctx) === "toolong");
  check("evalFormula: split() takes the nth field, counting back from the end when negative",
    evalFormula("split(`Doe, Jane`,`, `,2)", ctx) === "Jane"
    && evalFormula("split(`Doe, Jane`,`, `)", ctx) === "Doe"
    && evalFormula("split(`a/b/c`,`/`,-1)", ctx) === "c"
    && evalFormula("split(`a`,`/`,9)", ctx) === "");
  check("evalFormula: substitute() replaces the nth, replace() replaces all",
    evalFormula("substitute(`a-a-a`,`a`,`X`,2)", ctx) === "a-X-a"
    && evalFormula("substitute(`a-a-a`,`a`,`X`)", ctx) === "X-X-X"
    && evalFormula("replace(`a-a-a`,`a`,`X`)", ctx) === "X-X-X");
  check("evalFormula: text() and value() say the coercion out loud",
    evalFormula("text(42)&`!`", ctx) === "42!"
    && evalFormula("value(`$1,200`)+1", ctx) === 1201);

  // an escaped '=' is a value's own character, not the derivation operator
  check("splitCell: an escaped '=' never splits the cell",
    splitCell("a \\= b").eq === -1 && splitCell("a \\= b").value === "a \\= b"
    && splitCell("4 =2*2").eq === 2);
  check("readValue: the backslash comes off when the value is read as data",
    readValue("a \\= b") === "a = b" && readValue("plain") === "plain"
    && readValue("4") === "4");
  check("evalFormula: if() is lazy — the untaken branch may not compute",
    evalFormula("if(count(@tally)>0,avg(@tally),0)", { ...ctx, column: () => [] }) === 0
    && evalFormula("if(@qty>5,`big`,`small`)", ctx) === "big");
  check("evalFormula: named columns and @Row refs resolve through ctx",
    evalFormula("@price*2", ctx) === 40
    && evalFormula("@price@Acme", { ...ctx, matchRow: (r) => (r.startsWith("Acme") ? { id: "row", length: 4 } : null) }) === "7");
  check("evalFormula: a digits lead still names an Example ('- 35'), never a column",
    evalFormula("@price@35", { ...ctx, matchRow: (r) => (r.startsWith("35") ? { id: "row", length: 2 } : null) }) === "7");
  check("evalFormula: arithmetic on a non-numeric operand throws",
    (() => { try { evalFormula("`a`+1", ctx); return false; } catch { return true; } })());

  check("formatValue: keeps the $ and thousands commas of the old value",
    formatValue(1500, "$1,000") === "$1,500" && formatValue(20, "") === "20" && formatValue(1.256, "") === "1.26");

  const b = {
    indent: "",
    rows: [
      { sep: false, cells: ["name", "price", "qty", "total"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "$1,200", "2", "=@price*@qty"] },
      { sep: false, cells: ["B", "$100", "1", "100 =@price*@qty"] },
      { sep: false, cells: ["Total", "", "", "=sum(@total)"] },
    ],
  };
  recompute(b);
  check("recompute: fills an empty value from its formula", b.rows[2].cells[3] === "2400 =@price*@qty");
  check("recompute: an already true value stays put", b.rows[3].cells[3] === "100 =@price*@qty");
  check("recompute: sum() totals the other rows, fresh values included", b.rows[4].cells[3] === "2500 =sum(@total)");

  const broken = {
    indent: "",
    rows: [
      { sep: false, cells: ["name", "x"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "=@nope*2"] },
    ],
  };
  recompute(broken);
  check("recompute: a formula that cannot compute shows #ERR and keeps the formula",
    broken.rows[2].cells[1] === "#ERR =@nope*2");

  const sheet = [
    "Order",
    "    name|price|total",
    "    A   |10   |20 =@price*2",
    "    B   |10   |5 =@price/",
    "    C   |10   |15 =@price*2",
  ];
  const found = formulas(sheet);
  check("formulas: audits every formula cell", found.length === 3);
  check("formulas: a true value raises nothing", !found[0].stale && !found[0].error);
  check("formulas: the span runs from the '=' to the cell's end",
    found[0].line === 3 && found[0].startCol === 18 && sheet[2][found[0].startCol] === "=");
  check("formulas: bad syntax is an error", found[1].error === true && /does not compute/.test(found[1].message));
  check("formulas: a stale value warns with the fresh result",
    found[2].stale === true && found[2].message.includes("= 20"));

  check("align: recomputes formulas before padding",
    align(["N | a | b", "X | 2 | =@a*2"].join("\n")).some((e) => e.text.includes("4 =@a*2")));

  // the automatic fill: recomputeAll refreshes stale values, but a table
  // whose values are already right is left exactly as typed, ragged or not
  const autoFill = recomputeAll([
    "Order",
    "    name|price|total",
    "    A   |10   |15 =@price*2",
  ].join("\n"));
  check("recomputeAll: a stale value refreshes, only its line edited",
    autoFill.length === 1 && autoFill[0].line === 3 && autoFill[0].text === "    A   |10   |20 =@price*2");
  check("recomputeAll: a fresh table is never touched, however ragged",
    recomputeAll([
      "    name|price|total",
      "    A   |10 |20 =@price*2",
    ].join("\n")).length === 0);
  // the header ends at its own last cell, so widening the last column
  // redraws the rule and the row but leaves the header exactly as written
  check("recomputeAll: a value that widens its column redraws the block",
    recomputeAll([
      "    name|price|total",
      "    A   |10   |=@price*20",
    ].join("\n")).length === 1);

  // the instrumented walk: every '@' name in every formula, its exact span
  // and the declaration it resolves to — what the rename edits
  const refSheet = [
    "Order",
    "    name|price|total",
    "    A   |10   |=@price*2",
    "    B   |20   |=@total@A",
  ];
  const refs = formulaReferences(refSheet);
  const priceRef = refs.find((r) => r.text === "price");
  check("formulaReferences: a column name answers its span and its header cell",
    priceRef && priceRef.kind === "column" && priceRef.line === 3
    && refSheet[2].slice(priceRef.startCol, priceRef.endCol) === "price"
    && priceRef.site.line === 2 && priceRef.site.col === 9);
  const rowRef = refs.find((r) => r.text === "A");
  check("formulaReferences: an Example name answers its row's first cell",
    rowRef && rowRef.kind === "row" && rowRef.line === 4
    && rowRef.site.line === 3 && rowRef.site.col === 4);

  // a reference across tables points home to the other table's cells
  const two = [
    "Order",
    "    name|price",
    "    Acme|10",
    "Costs",
    "    name|spend",
    "    X   |=@Order@price@Acme",
  ];
  const foreign = formulaReferences(two, regOf(two, "Sheet"), "Sheet");
  check("formulaReferences: a table name records as a table reference",
    foreign.some((r) => r.kind === "table" && r.text === "Order" && r.id === "order"));
  check("formulaReferences: a foreign column resolves to its Concept and key",
    foreign.some((r) => r.text === "price" && r.conceptNode && r.conceptNode.name === "Order" && r.attrKey === "price"));
  check("formulaReferences: a foreign Example resolves to its declaring row's node",
    foreign.some((r) => r.text === "Acme" && r.nodes && r.nodes[0] && r.nodes[0].line === 3));

  // named references resolve against the header (aliases included), @Row
  // against the first column
  const named = {
    indent: "",
    rows: [
      { sep: false, cells: ["name", "price", "qty (amount)", "total"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["Acme", "10", "3", "=@price*@amount"] },
      { sep: false, cells: ["Bolt", "5", "2", "=@total@Acme"] },
    ],
  };
  recompute(named);
  check("recompute: @name and alias references resolve through the header",
    named.rows[2].cells[3] === "30 =@price*@amount");
  check("recompute: @col@Row reads the named row's cell",
    named.rows[3].cells[3] === "30 =@total@Acme");

  // cells with comparison text are plain values: never split, never
  // rewritten, never audited — the constraint lives on the header
  const bound = {
    indent: "",
    rows: [
      { sep: false, cells: ["name", "age >=18", "cap"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "25", "90 <=99"] },
      { sep: false, cells: ["B", "15", ""] },
    ],
  };
  recompute(bound);
  check("recompute: comparison text in a cell is a plain value, left alone",
    bound.rows[2].cells[2] === "90 <=99" && bound.rows[2].cells[1] === "25");
  check("formulas: only '=' cells are audited — header constraints are derive.js's",
    formulas([
      "name|age >=18",
      "A   |15",
    ]).length === 0);
  check("tableCtx: a header's constraint is not part of the column's name",
    (() => {
      const rows = bound.rows.slice(2);
      const ctx = tableCtx(rows, rows[0], bound.rows[0].cells);
      return ctx.matchColumn("age)").id === 2 && ctx.cell(2) === "25";
    })());
}

// ---------------------------------------------------------------------------
// '==' defines a column: a determinate bound on a header cell is the
// derivation for every cell beneath it, so no cell repeats the formula.
// '==or(…)' is not a definition — a Choice lists allowed values.
// ---------------------------------------------------------------------------
{
  check("columnDefinitions: a determinate '==' answers its formula, the first cell never",
    (() => {
      const defs = columnDefinitions(["Order", "price", "vat ==@price*2", "age >=18"]);
      return defs[0] === null && defs[1] === null && defs[2] === "@price*2" && defs[3] === null;
    })());

  const defined = {
    indent: "",
    rows: [
      { sep: false, cells: ["Order", "price", "tax rate", "vat ==@price*@tax rate"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "100", "0.2", ""] },     // empty: the definition fills it
      { sep: false, cells: ["B", "40", "0.5", "999"] },   // wrong: the definition wins
    ],
  };
  recompute(defined);
  check("recompute: a '==' column fills an empty cell and corrects a wrong one",
    defined.rows[2].cells[3] === "20" && defined.rows[3].cells[3] === "20");
  check("recompute: a defined cell carries the value alone, never the formula",
    !defined.rows[2].cells[3].includes("="));

  // a cell's own '=' is the nearer word, so it wins over the column's '=='
  const override = {
    indent: "",
    rows: [
      { sep: false, cells: ["Order", "price", "vat ==@price*2"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "10", "=@price*3"] },
    ],
  };
  recompute(override);
  check("recompute: an explicit cell formula wins over the column's definition",
    override.rows[2].cells[2] === "30 =@price*3");

  // '==or(…)' answers a Choice — allowed values, naming none, so no fill
  const choice = {
    indent: "",
    rows: [
      { sep: false, cells: ["Task", "status ==or(`draft`,`sent`)"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "draft"] },
      { sep: false, cells: ["B", ""] },
    ],
  };
  recompute(choice);
  check("recompute: '==or(…)' lists allowed values, so it never fills a cell",
    choice.rows[2].cells[1] === "draft" && choice.rows[3].cells[1] === "");

  // an uncomputable '==' is the declaration's problem: the cells stay put
  const broken = {
    indent: "",
    rows: [
      { sep: false, cells: ["Order", "vat ==@nope*2"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["A", "7"] },
    ],
  };
  recompute(broken);
  check("recompute: an uncomputable '==' leaves its cells alone (no #ERR)",
    broken.rows[2].cells[1] === "7");
}

// ---------------------------------------------------------------------------
// cross-table references: a formula reaching a table named by its parent
// (@Table@column@Example, sum(@Table@column)) through the registry
// ---------------------------------------------------------------------------
{
  const lines = [
    "Order",
    "    name |price|qty",
    "    Acme |10   |2",
    "    Bolt |20   |3",
    "Summary",
    "    name    |val",
    "    acmeTot |",
    "    allPrice|",
  ];
  const reg = regOf(lines, "cross");

  // through a mock ctx: the foreign table wins the leading @ only when the
  // name matches no local column/Example and a '@' follows. The foreign
  // scope is the registry's own — the parsed tree read as a grid.
  const foreign = reg.scopes.get("order");
  const ctx = {
    matchColumn: (r) => (r.toLowerCase().startsWith("total") ? { id: 2, length: 5 } : null),
    matchRow: () => null,
    cell: () => "99", cellAt: () => "99", column: () => ["99"],
    matchTable: (r) => (r.toLowerCase().startsWith("order") ? { id: "order", length: 5 } : null),
    table: (id) => (id === "order" ? foreign : undefined),
  };
  check("cross-table: @Table@column@Example reads the foreign cell (either order)",
    evalFormula("@Order@price@Bolt", ctx) === "20"
    && evalFormula("@Order@Bolt@price", ctx) === "20");
  check("cross-table: sum() ranges over the foreign column (all its rows)",
    evalFormula("sum(@Order@price)", ctx) === 30 && evalFormula("count(@Order@qty)", ctx) === 2);
  check("cross-table: a foreign cell composes in arithmetic",
    evalFormula("@Order@price@Acme*@total+1", ctx) === 991);
  check("cross-table: current table wins — a local column shadows a same-named table",
    evalFormula("@total", ctx) === "99");
  check("cross-table: a table name alone (no trailing column) is not a table reference",
    (() => { try { evalFormula("@Order", ctx); return false; } catch { return true; } })());
  check("cross-table: a foreign column needs an Example outside an aggregate",
    (() => { try { evalFormula("@Order@price", ctx); return false; } catch { return true; } })());

  // end to end: recompute a table that references another, via the registry
  const summary = blockAt(lines, 6);
  summary.rows[1].cells[1] = "=@Order@price@Acme";       // -> 10
  summary.rows[2].cells[1] = "=sum(@Order@price)";        // -> 30
  recompute(summary, reg);
  check("cross-table: recompute fills cells from a foreign table",
    summary.rows[1].cells[1] === "10 =@Order@price@Acme"
    && summary.rows[2].cells[1] === "30 =sum(@Order@price)");
  check("cross-table: without a registry the same formula cannot resolve (#ERR)",
    (() => {
      const s = blockAt(lines, 6);
      s.rows[1].cells[1] = "=@Order@price@Acme";
      recompute(s); // no registry
      return s.rows[1].cells[1] === "#ERR =@Order@price@Acme";
    })());
}

// ---------------------------------------------------------------------------
// tables and free text as one dataset: a table's cells see the parent's
// line-form attributes, defaults and Examples through the enclosing scope
// ---------------------------------------------------------------------------
{
  const mixed = [
    "Order",
    "    tax rate: 0.2",
    "    origin: EU",
    "    - Loose",
    "        price: 50",
    "    name|price|vat              |site     |all",
    "    A   |100  |=@price*@tax rate|=@origin |=sum(@price)",
    "    B   |40   |                 |US       |=@price@Loose",
  ];
  const reg = regOf(mixed, "Sheet");
  const edits = recomputeAll(mixed.join("\n"), reg, "Sheet");
  const filled = edits.map((e) => e.text).join("\n");
  check("outer scope: a cell formula reads the parent's line-form attribute",
    filled.includes("20 =@price*@tax rate"));
  check("outer scope: a cell reading an absent column inherits the parent's default",
    filled.includes("EU =@origin"));
  check("outer scope: an aggregate also ranges over the parent's line-form Examples",
    filled.includes("90 =sum(@price)"));
  check("outer scope: a line-form sibling Example can be named in a cell reference",
    filled.includes("50 =@price@Loose"));
  check("outer scope: a detached block (no registry) still computes grid-only",
    (() => {
      const s = blockAt(mixed, 5);
      recompute(s); // no registry, no outer: @tax rate cannot resolve
      return s.rows[1].cells[2] === "#ERR =@price*@tax rate";
    })());
}

// ---------------------------------------------------------------------------
// the lookups: xlookup, sumifs, countifs — the whole column, this row
// included, where the aggregates range over the other rows
// ---------------------------------------------------------------------------
{
  // a mock ctx whose two columns line up row for row: @country / @price
  const cols = [{ key: "country", id: 1 }, { key: "price", id: 2 }, { key: "status", id: 3 }];
  const data = { 1: ["FR", "DE", "FR"], 2: ["10", "20", "30"], 3: ["paid", "draft", "paid"] };
  const ctx = {
    matchColumn: (rest) => {
      const low = rest.toLowerCase();
      const hit = cols.find((c) => low.startsWith(c.key));
      return hit ? { id: hit.id, length: hit.key.length } : null;
    },
    matchRow: () => null,
    cell: (c) => data[c][0], cellAt: (c) => data[c][0],
    column: (c) => data[c].slice(1),  // the aggregates' reading: the others
    columnAll: (c) => data[c],        // the lookups' reading: every row
  };
  const throws = (f, re) => {
    try { evalFormula(f, ctx); return false; } catch (e) { return re ? re.test(e.message) : true; }
  };

  check("xlookup: answers the first matching row's cell in the other column",
    evalFormula("xlookup(`DE`,@country,@price)", ctx) === "20"
    && evalFormula("xlookup(`FR`,@country,@price)", ctx) === "10");
  check("xlookup: the answer composes as any value does",
    evalFormula("xlookup(`DE`,@country,@price)*2", ctx) === 40);
  check("xlookup: a miss is an error, saying a fourth argument answers it",
    throws("xlookup(`ZZ`,@country,@price)", /found no 'ZZ'.*fourth argument/));
  check("xlookup: the fourth argument is the answer when nothing matches",
    evalFormula("xlookup(`ZZ`,@country,@price,0)", ctx) === 0
    && evalFormula("xlookup(`ZZ`,@country,@price,`none`)", ctx) === "none");
  check("xlookup: matching is the language's own comparison (10 == `10`)",
    evalFormula("xlookup(20,@price,@country)", ctx) === "DE");

  check("sumifs: adds the rows meeting the test, this row included",
    evalFormula("sumifs(@price,@country,`FR`)", ctx) === 40);
  check("sumifs: several tests must all hold",
    evalFormula("sumifs(@price,@country,`FR`,@status,`paid`)", ctx) === 40
    && evalFormula("sumifs(@price,@country,`DE`,@status,`paid`)", ctx) === 0);
  check("sumifs: nothing matching is 0, not an error",
    evalFormula("sumifs(@price,@country,`ZZ`)", ctx) === 0);
  check("countifs: tallies the rows meeting every test",
    evalFormula("countifs(@country,`FR`)", ctx) === 2
    && evalFormula("countifs(@country,`FR`,@price,`>10`)", ctx) === 1);
  check("a criterion may open with a comparison operator",
    evalFormula("countifs(@price,`>=20`)", ctx) === 2
    && evalFormula("countifs(@price,`<20`)", ctx) === 1
    && evalFormula("countifs(@country,`<>FR`)", ctx) === 1
    && evalFormula("countifs(@country,`=FR`)", ctx) === 2);
  check("a plain criterion matches by equality, an or() list matches any of them",
    evalFormula("countifs(@country,`FR`)", ctx) === 2
    && evalFormula("countifs(@country,or(`FR`,`DE`))", ctx) === 3
    && evalFormula("countifs(@price,10)", ctx) === 1);
  check("a criterion may be computed — sumifs(@price,@country,@country) totals this row's group",
    evalFormula("sumifs(@price,@country,@country)", ctx) === 40);

  check("the lookups take a column, never one row's cell",
    throws("sumifs(@price,@country@x,`FR`)", /ranges over a column/)
    && throws("countifs(2,`FR`)", /takes a column reference/));
  check("countifs wants a criterion after each column",
    throws("countifs(@country)", /criterion after each column/));
  check("columns that do not line up are an error, not a silent mismatch",
    (() => {
      const ragged = { ...ctx, columnAll: (c) => (c === 1 ? ["FR"] : data[c]) };
      try { evalFormula("countifs(@country,`FR`,@price,`>1`)", ragged); return false; }
      catch (e) { return /different lengths/.test(e.message); }
    })());
  check("the lookups compute inside an untaken if() branch without ranging",
    evalFormula("if(0,xlookup(`ZZ`,@country,@price),7)", ctx) === 7);
  check("the aggregates keep their own reading — the other rows",
    evalFormula("sum(@price)", ctx) === 50 && evalFormula("count(@price)", ctx) === 2);

  // end to end, in a real grid: the whole column includes the formula's own
  // row, which is exactly what a conditional total needs
  const block = {
    indent: "",
    rows: [
      { sep: false, cells: ["Order", "country", "price", "group", "rate"] },
      { sep: true, cells: [] },
      { sep: false, cells: ["Acme", "FR", "100", "=sumifs(@price,@country,@country)", "=xlookup(@country,@Rate@code,@Rate@pct)"] },
      { sep: false, cells: ["Bolt", "DE", "200", "=sumifs(@price,@country,@country)", "=xlookup(@country,@Rate@code,@Rate@pct)"] },
      { sep: false, cells: ["Kite", "FR", "50", "=sumifs(@price,@country,@country)", "=xlookup(@country,@Rate@code,@Rate@pct)"] },
    ],
  };
  const reg = regOf([
    "Rate",
    "    Rate|code|pct",
    "    a   |FR  |20",
    "    b   |DE  |19",
  ], "Sheet");
  recompute(block, reg);
  check("recompute: a conditional total counts the row it stands in",
    block.rows[2].cells[3].startsWith("150 =")
    && block.rows[3].cells[3].startsWith("200 =")
    && block.rows[4].cells[3].startsWith("150 ="));
  check("recompute: xlookup reaches another Concept's grid through the registry",
    block.rows[2].cells[4].startsWith("20 =")
    && block.rows[3].cells[4].startsWith("19 ="));
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
  copyFormulaDown(b, 2, 3);
  recompute(b);
  check("copyFormulaDown: the column's other rows gain the formula, recomputed",
    b.rows[2].cells[3] === "20 =@a*2" && b.rows[3].cells[3] === "10 =@a*2");

  b = grid();
  copyFormulaAcross(b, 2, 3);
  check("copyFormulaAcross: the row's other cells gain the formula, keeping their values (name column spared)",
    b.rows[2].cells[0] === "R1" && b.rows[2].cells[1] === "10 =@a*2" && b.rows[2].cells[2] === "20 =@a*2" && b.rows[2].cells[3] === "=@a*2");
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

  const withFormula = [
    "Note",
    "    name|d|len",
    "    A   |a rather long note|18 =len(@d)",
  ];
  const audit = formulas(withFormula, undefined, "Sheet");
  check("formulas: len() counts the value where it stands, all 18 characters",
    audit.length === 1 && !audit[0].stale && !audit[0].error);
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
  check("copyFormulaFromAbove: the formula alone, for the recompute to value",
    copyFormulaFromAbove(x, 2, 2) !== null && x.rows[2].cells[2] === "=@price*2");
  x = blockAt(withFormula, 0);
  check("copyValueFromAbove: the value alone, its derivation left behind",
    copyValueFromAbove(x, 2, 2) !== null && x.rows[2].cells[2] === "4");
  check("copy from above: nothing from the header, no formula to copy is nothing",
    copyFormulaFromAbove(blockAt(withFormula, 0), 1, 2) === null
    && copyFormulaFromAbove(blockAt(withFormula, 0), 2, 1) === null);
  x = blockAt(withFormula, 0);
  fillDown(x, 2, 2);
  recompute(x);
  check("fillDown: a formula copied down computes in its new row",
    x.rows[2].cells[2] === "6 =@price*2");

  const priced = ["Sheet|price (cost) >=0|qty", "A|2|1", "B|3|1", "Total||"];
  x = blockAt(priced, 0);
  check("autoSum: the cell sums its column by the column's bare name",
    autoSum(x, 3, 1) !== null && x.rows[3].cells[1] === "=sum(@price)");
  recompute(x);
  check("autoSum: the sum computes over the other rows",
    x.rows[3].cells[1] === "5 =sum(@price)");
  check("autoSum: never on the header or a name",
    autoSum(blockAt(priced, 0), 0, 1) === null && autoSum(blockAt(priced, 0), 3, 0) === null);
  check("columnTerm: a header cell's name without its alias or constraint",
    columnTerm("price (cost) >=0") === "price" && columnTerm("tax rate") === "tax rate");
}


console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
