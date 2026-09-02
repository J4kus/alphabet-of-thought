// Unit tests for parking derivations out of the data (src/park.js): the
// addresses, the round trip through both notations, what deliberately stays,
// and the store's own format.
//
// Plain Node script, no framework — run with: node out/test-park.js
const { park, unpark, parkedSpans, addressOf, nodeAt, serialise, parse } = require("../src/park");
const { lint, KIND } = require("../src/linter");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const parsed = (lines, rootName) => {
  const { root, nodes } = lint(lines.join("\n"), rootName || "Sheet");
  return { root, nodes };
};

// ---------------------------------------------------------------------------
// addresses: the '@' path the language already uses for references
// ---------------------------------------------------------------------------
{
  const lines = [
    "Invoice",
    "    tax rate: 0.2 =1/5",
    "    - INV-1",
    "        vat: 20 =@price*@tax rate",
    "        - line 1",
    "            amount: 5 =1+4",
  ];
  const { nodes } = parsed(lines);
  const of = (line) => {
    const n = nodes.find((x) => x.line === line && x.kind === KIND.DEFAULT);
    return addressOf(n, "Sheet");
  };
  check("address: a value on the Concept is @Concept@attribute",
    of(2) === "@Invoice@tax rate");
  check("address: a value on an Example names the Example last",
    of(4) === "@Invoice@vat@INV-1");
  check("address: a nested Example adds a segment, outermost first",
    of(6) === "@Invoice@amount@INV-1@line 1");
}

// ---------------------------------------------------------------------------
// the line form: park, then put it back exactly
// ---------------------------------------------------------------------------
{
  const lines = [
    "Invoice",
    "    tax rate: 0.2",
    "    - INV-1",
    "        price: 100",
    "        vat: 20 =@price*@tax rate",
  ];
  const { nodes } = parsed(lines);
  const out = park(lines, nodes, "Sheet");
  check("park: the derivation leaves and the value it computed stays",
    out.lines[4] === "        vat: 20" && out.parked.length === 1);
  check("park: the store carries the address and the formula as written",
    out.parked[0].address === "@Invoice@vat@INV-1"
    && out.parked[0].formula === "=@price*@tax rate");

  const back = unpark(out.lines, parsed(out.lines).nodes, "Sheet", out.parked);
  check("unpark: the line comes back exactly as it was",
    back.lines.join("\n") === lines.join("\n") && back.missing.length === 0);
}

// ---------------------------------------------------------------------------
// tables: several formulas on one row, and one address for either notation
// ---------------------------------------------------------------------------
{
  const lines = [
    "Invoice",
    "    Invoice|price|vat           |total",
    "    -------+-----+--------------+-------------",
    "    INV-1  |100  |20 =@price*0.2|120 =@price+@vat",
    "    INV-2  |50   |10 =@price*0.2|60 =@price+@vat",
  ];
  const { nodes } = parsed(lines);
  const out = park(lines, nodes, "Sheet");
  check("park: every cell of every row gives up its derivation, values kept",
    out.lines[3] === "    INV-1|100|20|120" && out.lines[4] === "    INV-2|50|10|60");
  check("park: one row's two formulas are both taken, addressed by their column",
    out.parked.length === 4
    && out.parked[0].address === "@Invoice@vat@INV-1"
    && out.parked[1].address === "@Invoice@total@INV-1");

  const back = unpark(out.lines, parsed(out.lines).nodes, "Sheet", out.parked);
  check("unpark: the cells carry their formulas again (widths left to align)",
    back.lines[3] === "    INV-1|100|20 =@price*0.2|120 =@price+@vat"
    && back.missing.length === 0);

  // the same address finds the Example whichever way it is written
  const asLines = ["Invoice", "    - INV-1", "        vat: 20"];
  check("unpark: one address serves both notations — a grid row and a '- ' line",
    nodeAt(parsed(asLines).nodes, "Sheet", "@Invoice@vat@INV-1") !== null);
}

// ---------------------------------------------------------------------------
// what stays: bounds are rules about values, not recipes for one
// ---------------------------------------------------------------------------
{
  const lines = [
    "Person",
    "    age >=18",
    "    status ==or(`draft`,`sent`)",
    "    - Socrates",
    "        age: 70",
    "        note: a \\= b",
  ];
  const { nodes } = parsed(lines);
  const out = park(lines, nodes, "Sheet");
  check("park: a bound on an attribute declaration never parks",
    out.parked.length === 0 && out.lines.join("\n") === lines.join("\n"));
  check("park: an escaped '=' is a value, not a derivation",
    out.lines[5] === "        note: a \\= b");
}

// ---------------------------------------------------------------------------
// a cell that is formula only, and an address that no longer resolves
// ---------------------------------------------------------------------------
{
  const lines = [
    "Invoice",
    "    Invoice|price|vat",
    "    -------+-----+----------",
    "    INV-1  |100  |=@price*2",
  ];
  const { nodes } = parsed(lines);
  const out = park(lines, nodes, "Sheet");
  check("park: a cell holding only a formula leaves an empty cell behind",
    out.lines[3] === "    INV-1|100|" && out.parked[0].formula === "=@price*2");

  const renamed = out.lines.map((l) => l.replace("INV-1", "INV-9"));
  const back = unpark(renamed, parsed(renamed).nodes, "Sheet", out.parked);
  check("unpark: an address whose row was renamed is reported, never invented",
    back.missing.length === 1 && back.missing[0] === "@Invoice@vat@INV-1"
    && back.lines.join("\n") === renamed.join("\n"));
}

// ---------------------------------------------------------------------------
// where the parked values sit: the spans an editor marks, so a computed
// number is never mistaken for a typed one
// ---------------------------------------------------------------------------
{
  const lines = [
    "Invoice",
    "    tax rate: 0.2",
    "    Invoice|price|vat|note",
    "    -------+-----+---+----",
    "    INV-1  |100  |20 |ok",
    "    - INV-9",
    "        price: 50",
    "        vat: 10",
  ];
  const { nodes } = parsed(lines);
  const parked = [
    { address: "@Invoice@vat@INV-1", formula: "=@price*0.2" },
    { address: "@Invoice@vat@INV-9", formula: "=@price*0.2" },
  ];
  const spans = parkedSpans(lines, nodes, "Sheet", parked);
  const cell = spans.find((s) => s.address === "@Invoice@vat@INV-1");
  const line = spans.find((s) => s.address === "@Invoice@vat@INV-9");
  check("spans: a grid cell's span covers the value, not the padding around it",
    cell && cell.line === 5 && lines[4].slice(cell.startCol, cell.endCol) === "20");
  check("spans: a line-form value's span starts after the colon",
    line && line.line === 8 && lines[7].slice(line.startCol, line.endCol) === "10");
  check("spans: each span carries the formula that computes it",
    spans.length === 2 && spans.every((s) => s.formula === "=@price*0.2"));
  check("spans: document order, whichever order the store lists them in",
    parkedSpans(lines, nodes, "Sheet", parked.slice().reverse()).map((s) => s.line).join() === "5,8");

  // the same silence unpark keeps: an address naming nothing has no span
  check("spans: an address that no longer names anything is skipped, never guessed",
    parkedSpans(lines, nodes, "Sheet", [{ address: "@Invoice@vat@INV-404", formula: "=1" }]).length === 0);

  // a cell whose derivation computed nothing is the one most worth marking
  const empty = lines.slice();
  empty[4] = "    INV-1  |100  |   |ok";
  const blank = parkedSpans(empty, parsed(empty).nodes, "Sheet", [parked[0]])[0];
  check("spans: a cell left empty by its formula is marked across its interior",
    blank && empty[4].slice(blank.startCol, blank.endCol) === "   ");
}

// ---------------------------------------------------------------------------
// the store's own format
// ---------------------------------------------------------------------------
{
  const text = serialise([{ address: "@Invoice@vat@INV-1", formula: "=@price*0.2" }]);
  check("store: the notice leads, then one line per derivation",
    text.startsWith("// Derivations parked") && text.includes("@Invoice@vat@INV-1: =@price*0.2"));
  const read = parse(text);
  check("store: it reads back exactly what was written",
    read.length === 1 && read[0].address === "@Invoice@vat@INV-1" && read[0].formula === "=@price*0.2");
  check("store: notice lines and blanks are not entries",
    parse("// hello\n\n   \n@A@b: =1\n").length === 1);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
