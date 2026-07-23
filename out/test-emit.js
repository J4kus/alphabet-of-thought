// Unit tests for the token-lean emit view (src/emit.js) and the compact
// table renderer behind it (table.setCompact): the emitted text must parse
// to the identical tree — same names, kinds and values, same findings —
// while never being longer than the original.
//
// Plain Node script, no framework — run with: node out/test-emit.js
const fs = require("fs");
const path = require("path");
const { lint } = require("../src/linter");
const { emit } = require("../src/emit");
const table = require("../src/table");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const aot = (...lines) => lines.join("\n");

// The tree two texts must share: every node's kind, name and value in
// document order — lines are allowed to differ (blank lines go), content is not.
const treeOf = (text, rootName) => {
  const { nodes, errors, warnings } = lint(text, rootName);
  return {
    shape: JSON.stringify(nodes.map((n) => [n.kind, n.name, n.value || ""])),
    errors: errors.length,
    warnings: warnings.length,
  };
};

// ---------------------------------------------------------------------------
// the three transforms: trailing whitespace, compact tables, blank lines
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Concept   ",
    "    attribute: value  ",
    "",
    "    - Example",
    "",
  );
  const out = emit(text);
  check("emit: trailing whitespace is stripped from every line",
    out === "Concept\n    attribute: value\n    - Example\n");
}

{
  const text = aot(
    "Order",
    "    |name            |country|basket size|",
    "    |----------------+-------+-----------|",
    "    |Acme March Order|France |$1,200     |",
    "    |Bolt March Order|       |           |",
  );
  const out = emit(text);
  check("emit: table cells lose their padding, the separator collapses to |-|",
    out.includes("|name|country|basket size|")
    && out.includes("    |-|\n")
    && out.includes("|Acme March Order|France|$1,200|"));
  check("emit: a data row's trailing empty cells are dropped",
    out.includes("|Bolt March Order|\n"));
  check("emit: the header keeps its cell count",
    out.includes("|name|country|basket size|"));
}

{
  const text = aot(
    "Order",
    "    |name|qty|",
    "    |----+---|",
    "    |A   |1  |",
    "",
    "    |name 2|qty 2|",
    "    |------+-----|",
    "    |B     |2    |",
    "",
    "Other",
  );
  const out = emit(text);
  const lines = out.split("\n");
  check("emit: the blank line between two tables stays — it ends the first",
    lines.filter((l) => l === "").length === 1
    && lines[lines.indexOf("")] === "" && lines[lines.indexOf("") - 1].includes("|A|1|"));
  check("emit: the blank line before a non-table line goes",
    out.includes("|B|2|\nOther"));
}

{
  const text = aot(
    "Concept",
    "    |lone pipe Example    |",
    "    plain: value",
  );
  check("emit: a lone pipe row (no separator) is only whitespace-stripped, never redrawn",
    emit(text).includes("    |lone pipe Example    |") === false
    && emit(text).includes("    |lone pipe Example |") === false
    && emit(text).includes("    |lone pipe Example"));
}

// ---------------------------------------------------------------------------
// the contract: same tree, same findings, never longer, stable
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Vehicle",
    "    wheel count",
    "    Land Vehicle   ",
    "        wheel count: 4",
    "        - Cart",
    "",
    "        - Wagon",
    "            wheel count: 6",
    "    |name   |wheel count|colour|",
    "    |-------+-----------+------|",
    "    |Bicycle|2          |      |",
    "    |Sled   |0          |red   |",
  );
  const out = emit(text);
  const a = treeOf(text, "Vehicle"), b = treeOf(out, "Vehicle");
  check("emit: the emitted text parses to the identical tree", a.shape === b.shape);
  check("emit: errors and warnings survive unchanged", a.errors === b.errors && a.warnings === b.warnings);
  check("emit: never longer than the original", out.length <= text.length);
  check("emit: idempotent — emitting the emit changes nothing", emit(out) === out);
}

{
  for (const name of ["example.aot", "spreadsheet.aot", "alphabet of thought.aot"]) {
    const file = path.join(__dirname, "..", "examples", name);
    const text = fs.readFileSync(file, "utf8");
    const rootName = name.replace(/\.[^.]*$/, "");
    const a = treeOf(text, rootName), b = treeOf(emit(text), rootName);
    check(`emit: ${name} round-trips — same tree, same findings`,
      a.shape === b.shape && a.errors === b.errors && a.warnings === b.warnings);
  }
}

// ---------------------------------------------------------------------------
// the compact renderer itself: what the aot.tableAlignment setting switches
// ---------------------------------------------------------------------------
{
  const lines = [
    "    |name|qty|note|",
    "    |----+---+----|",
    "    |Acme|10 |a   |",
  ];
  const block = table.blockAt(lines, 0);
  const was = table.setCompact(true);
  try {
    const rows = table.render(block);
    check("setCompact: render writes unpadded cells and a |-| separator",
      rows[0] === "    |name|qty|note|" && rows[1] === "    |-|" && rows[2] === "    |Acme|10|a|");
    check("setCompact: cellStart walks the row's own cells",
      table.cellStart(block, 2, 2) === "    |Acme|10|".length);
  } finally { table.setCompact(was); }
  check("setCompact: restoring the mode re-aligns",
    table.render(block)[2] === "    |Acme|10 |a   |");
}

process.exit(failures ? 1 : 0);
