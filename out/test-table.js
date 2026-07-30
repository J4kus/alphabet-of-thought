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
  splitCell, splitConstraint, evalFormula, formatValue, recompute, recomputeAll, formulas, tableCtx,
  formulaReferences,
  valueType, compareValues, copyFormulaDown, copyFormulaAcross, referenceNames,
  copyCell, moveCell, copyRow, copyColumn,
  mergeRegistries, readValue, truthOf,
  widthCookie, headerWidths, unwrap, unwrapWithMap, columnDefinitions,
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
    typing.rows[1].sep === true && render(typing)[1] === "|----+----|");
  check("blockAt: the lone Example is its own block", blockAt(doc, 6).start === 6 && blockAt(doc, 6).end === 6);

  check("widthsOf: widest cell per column", widthsOf(block).join(",") === "6,4,6");
  check("render: redraws aligned (no gutters)", render(block)[2] === "    |Ollie |5   |brown |");
  check("cellStart: column offsets on the aligned line", cellStart(block, 0) === 5 && cellStart(block, 1) === 12 && cellStart(block, 2) === 17);
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
  check("fromRegion: CSV becomes a table, the first cell (the Concept) kept, the rest lowercased",
    csv[0] === "    |Name  |size|" && csv[1] === "    |------+----|" && csv[2] === "    |Ollie |5   |");
  const tsv = fromRegion(["a\tb", "1\t2"]);
  check("fromRegion: tabs win over commas", tsv[0] === "|a|b|");
  const spaced = fromRegion(["name  size", "Ollie  5"]);
  check("fromRegion: multi-space columns as a last resort", spaced[2] === "|Ollie|5   |");
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
    "    |name|price|total   |",
    "    |----+-----+--------|",
    "    |A   |10   |20 =@price*2|",
    "    |B   |10   |5 =@price/  |",
    "    |C   |10   |15 =@price*2|",
  ];
  const found = formulas(sheet);
  check("formulas: audits every formula cell", found.length === 3);
  check("formulas: a true value raises nothing", !found[0].stale && !found[0].error);
  check("formulas: the span runs from the '=' to the cell's end",
    found[0].line === 4 && found[0].startCol === 19 && sheet[3][found[0].startCol] === "=");
  check("formulas: bad syntax is an error", found[1].error === true && /does not compute/.test(found[1].message));
  check("formulas: a stale value warns with the fresh result",
    found[2].stale === true && found[2].message.includes("= 20"));

  check("align: recomputes formulas before padding",
    align(["| N | a | b     |", "|---+---+-------|", "| X | 2 | =@a*2 |"].join("\n")).some((e) => e.text.includes("4 =@a*2")));

  // the automatic fill: recomputeAll refreshes stale values, but a table
  // whose values are already right is left exactly as typed, ragged or not
  const autoFill = recomputeAll([
    "Order",
    "    |name|price|total       |",
    "    |----+-----+------------|",
    "    |A   |10   |15 =@price*2|",
  ].join("\n"));
  check("recomputeAll: a stale value refreshes, only its line edited",
    autoFill.length === 1 && autoFill[0].line === 4 && autoFill[0].text === "    |A   |10   |20 =@price*2|");
  check("recomputeAll: a fresh table is never touched, however ragged",
    recomputeAll([
      "    |name|price|total|",
      "    |----+-----+-----|",
      "    |A   |10 |20 =@price*2|",
    ].join("\n")).length === 0);
  check("recomputeAll: a value that widens its column redraws the block",
    recomputeAll([
      "    |name|price|total|",
      "    |----+-----+-----|",
      "    |A   |10   |=@price*20|",
    ].join("\n")).length === 3);

  // the instrumented walk: every '@' name in every formula, its exact span
  // and the declaration it resolves to — what the rename edits
  const refSheet = [
    "Order",
    "    |name|price|total    |",
    "    |----+-----+---------|",
    "    |A   |10   |=@price*2|",
    "    |B   |20   |=@total@A|",
  ];
  const refs = formulaReferences(refSheet);
  const priceRef = refs.find((r) => r.text === "price");
  check("formulaReferences: a column name answers its span and its header cell",
    priceRef && priceRef.kind === "column" && priceRef.line === 4
    && refSheet[3].slice(priceRef.startCol, priceRef.endCol) === "price"
    && priceRef.site.line === 2 && priceRef.site.col === 10);
  const rowRef = refs.find((r) => r.text === "A");
  check("formulaReferences: an Example name answers its row's first cell",
    rowRef && rowRef.kind === "row" && rowRef.line === 5
    && rowRef.site.line === 4 && rowRef.site.col === 5);

  // a reference across tables points home to the other table's cells
  const two = [
    "Order",
    "    |name|price|",
    "    |----+-----|",
    "    |Acme|10   |",
    "Costs",
    "    |name|spend             |",
    "    |----+------------------|",
    "    |X   |=@Order@price@Acme|",
  ];
  const foreign = formulaReferences(two, regOf(two, "Sheet"), "Sheet");
  check("formulaReferences: a table name records as a table reference",
    foreign.some((r) => r.kind === "table" && r.text === "Order" && r.id === "order"));
  check("formulaReferences: a foreign column resolves to its Concept and key",
    foreign.some((r) => r.text === "price" && r.conceptNode && r.conceptNode.name === "Order" && r.attrKey === "price"));
  check("formulaReferences: a foreign Example resolves to its declaring row's node",
    foreign.some((r) => r.text === "Acme" && r.nodes && r.nodes[0] && r.nodes[0].line === 4));

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
      "|name|age >=18|",
      "|----+--------|",
      "|A   |15      |",
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
    "    |name |price|qty|",
    "    |-----+-----+---|",
    "    |Acme |10   |2  |",
    "    |Bolt |20   |3  |",
    "Summary",
    "    |name    |val|",
    "    |--------+---|",
    "    |acmeTot |   |",
    "    |allPrice|   |",
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
  const summary = blockAt(lines, 8);
  summary.rows[2].cells[1] = "=@Order@price@Acme";       // -> 10
  summary.rows[3].cells[1] = "=sum(@Order@price)";        // -> 30
  recompute(summary, reg);
  check("cross-table: recompute fills cells from a foreign table",
    summary.rows[2].cells[1] === "10 =@Order@price@Acme"
    && summary.rows[3].cells[1] === "30 =sum(@Order@price)");
  check("cross-table: without a registry the same formula cannot resolve (#ERR)",
    (() => {
      const s = blockAt(lines, 8);
      s.rows[2].cells[1] = "=@Order@price@Acme";
      recompute(s); // no registry
      return s.rows[2].cells[1] === "#ERR =@Order@price@Acme";
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
    "    |name|price|vat              |site     |all          |",
    "    |----+-----+-----------------+---------+-------------|",
    "    |A   |100  |=@price*@tax rate|=@origin |=sum(@price) |",
    "    |B   |40   |                 |US       |=@price@Loose|",
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
      const s = blockAt(mixed, 6);
      recompute(s); // no registry, no outer: @tax rate cannot resolve
      return s.rows[2].cells[2] === "#ERR =@price*@tax rate";
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
    "|Order|country|",
    "|-----+-------|",
    "|Acme |France |",
    "|Bolt |Germany|",
    "",
    "|Refund (Return)|reason |",
    "|---------------+-------|",
    "|R1             |Damaged|",
    "",
    "|Organisation|full name|",
  ];
  const ts = tablesOf(sheet, "spreadsheet");
  check("tablesOf: names each table by its first header cell (the Concept)",
    ts.length === 2 && ts[0].name === "Order" && ts[1].name === "Refund");
  check("tablesOf: grid is header plus data rows",
    ts[0].header.join(",") === "Order,country" && ts[0].rows[1].join(",") === "Bolt,Germany");
  check("tablesOf: an assumed lone header is skipped (still being typed)",
    !ts.some((t) => t.name === "Organisation"));
  check("tablesOf: a table whose first cell names no Concept falls back to the root",
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

  const u = updateTable(sheet, "Order", ["Order", "country", "currency"], [["Acme", "France", "EUR"]]);
  check("updateTable: replaces the Concept's block in place",
    u.changed && u.from === 0 && u.to === 3
    && u.block[0] === "|Order|country|currency|"
    && u.block[2] === "|Acme |France |EUR     |");
  const same = updateTable(sheet, "Refund", ["Refund (Return)", "reason"], [["R1", "Damaged"]]);
  check("updateTable: an identical grid changes nothing", same.changed === false);
  const folded = updateTable(sheet, "ORDER", ["Order", "country", "currency"], [["Acme", "France", "EUR"]]);
  check("updateTable: the Concept name matches in any case",
    folded !== null && folded.from === 0 && folded.to === 3);
  const lone = updateTable(sheet, "Organisation", ["Organisation", "full name"], [["1", "Acme Ltd"]]);
  check("updateTable: completes an assumed lone header",
    lone.changed && lone.from === 9 && lone.to === 9 && lone.block.length === 3);
  const ins = updateTable(["Person"], "Person", ["Person"], [["John"]]);
  check("updateTable: inserts a merge-form grid beneath a table-less Concept",
    ins.changed && ins.to < ins.from && ins.from === 1
    && ins.block.length === 3 && ins.block[0] === "    |Person|" && ins.block[2] === "    |John  |");
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
    edits.length === 3 && edits[0].line === 2 && edits[1].text === "    |-----+----|");
  check("align: still leaves lone pipe Examples alone", align("A\n    | gegeg").length === 0);
}

// ---------------------------------------------------------------------------
// width cookies and cell wrapping: `<N>` on a header cell caps its column,
// over-wide plain cells wrap onto continuation rows (empty first cell)
// ---------------------------------------------------------------------------
{
  check("widthCookie: '<24>' comes off the end of the cell",
    widthCookie("description <24>").text === "description" && widthCookie("description <24>").width === 24);
  check("widthCookie: rides after aliases and constraints alike",
    widthCookie("desc (d) <24>").text === "desc (d)" && widthCookie("qty >=1 <8>").text === "qty >=1");
  check("widthCookie: an unclosed '<24' is not a cookie",
    widthCookie("desc <24").width === null);
  check("splitConstraint: 'desc <24' without the closing '>' reads as a '<' bound (the documented edge)",
    splitConstraint("desc <24").op === "<" && splitConstraint("desc <24").formula === "24");
  check("splitConstraint: 'desc <24>' is never a constraint — the '>' spoils the bound",
    splitConstraint("desc <24>").eq === -1);

  const src = [
    "Note",
    "    |name|d <10>|qty|",
    "    |----+------+---|",
    "    |A   |a rather long note|3|",
    "    |B   |short|4|",
  ];
  const block = blockAt(src, 3);
  check("headerWidths: the block reads its per-column cookies",
    JSON.stringify(headerWidths(block)) === "[null,10,null]");
  check("widthsOf: a cookie caps its column at the cookie's width",
    JSON.stringify(widthsOf(block)) === "[4,10,3]");
  const drawn = render(block);
  check("render: an over-wide plain cell wraps onto a continuation row",
    drawn.length === 5
    && drawn[2] === "    |A   |a rather  |3  |"
    && drawn[3] === "    |    |long note |   |"
    && drawn[4] === "    |B   |short     |4  |");
  check("render: physStart maps each logical row to its first drawn line",
    JSON.stringify(block.physStart) === "[0,1,2,4]");
  check("render: a wrapped table re-renders to itself (idempotent)",
    render(blockAt(drawn, 2)).join("\n") === drawn.join("\n"));

  const b2 = blockAt(drawn, 2);
  check("unwrapWithMap: continuation rows map onto their host row",
    JSON.stringify(unwrapWithMap(b2)) === "[0,1,2,2,3]");
  check("unwrap: fragments join back with single spaces",
    b2.rows[2].cells[1] === "a rather long note");

  const grids = tablesOf(["Note", ...drawn], "Sheet");
  check("tablesOf: a wrapped grid answers logical rows on their first lines",
    grids.length === 1
    && JSON.stringify(grids[0].rows) === JSON.stringify([["A", "a rather long note", "3"], ["B", "short", "4"]])
    && JSON.stringify(grids[0].rowLines) === "[4,6]");

  // a formula over a wrapped column reads the joined value; align expresses
  // a line-count change as one whole-block edit ({ line, to })
  const withFormula = [
    "Note",
    "    |name|d <10>|len|",
    "    |----+------+---|",
    "    |A   |a rather long note|18 =len(@d)|",
  ];
  const aligned = align(withFormula.join("\n"), undefined, "Sheet");
  check("align: wrapping that changes the line count is one whole-block edit",
    aligned.length === 1 && aligned[0].line === 2 && aligned[0].to === 4
    && aligned[0].text.split("\n").length === 4);
  const applied = withFormula.slice();
  applied.splice(aligned[0].line - 1, aligned[0].to - aligned[0].line + 1, ...aligned[0].text.split("\n"));
  const audit = formulas(applied, undefined, "Sheet");
  check("formulas: a formula over a wrapped column reads the joined value",
    audit.length === 1 && !audit[0].stale && !audit[0].error);

  // no cookie, no change: the old behaviour byte for byte
  const plain = blockAt(["    |a|b|", "    |-+-|", "    |x|a much longer cell|"], 0);
  check("render: a cookie-less block never wraps",
    render(plain).length === 3 && headerWidths(plain) === null);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
