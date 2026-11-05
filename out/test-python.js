// Python behind the `=` operator: which text reads as a Python bound, how a
// derivation parses on a Concept line, that no keystroke ever runs it, that it parks and
// comes home byte for byte, how its references resolve, the order it runs
// in, the wire protocol (against a fake process — no Python needed), what a
// result writes back, the security invariants, and — when this machine has a
// Python — the real runtime.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { spawnSync, spawn } = require("child_process");
const { readsAsExpression } = require("../src/pyshape");
const { lint, KIND } = require("../src/linter");
const table = require("../src/table");
const derive = require("../src/derive");
const park = require("../src/park");
const python = require("../src/python");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

// --- 1. what reads as a bound ----------------------------------------------
// Every derivation is Python. What the text alone must decide is whether an
// attribute's trailing comparison is a bound or part of its name.
{
  const bounds = [
    "18", "@price*1.5", "(\"draft\", \"sent\")", "len(@note) < 40", "date(2026, 1, 1)", "@start",
    "@a if @c else @b", "[1, 2, 3]", "{\"a\": 1}", "f\"{@a}\"", "not @done", "a @ b", "-@x ** 2",
    "@basket size * @tax rate", "lambda x: x", "@price if \"a <= b\" else 1",
    "18 years", "20 knots", "5 km/h", "30%", "$5,000", "(5 km)", "@a + 5 km", "3 m²", "5 if @a else 6",
  ];
  const prose = [
    "none noted", "18 years old", "5 km 6", "", "   ", "(2", "\"open", "@price*", "a b c", "@ ",
  ];
  check("readsAsExpression: every bound reads as Python", bounds.every((s) => readsAsExpression(s)));
  check("readsAsExpression: prose, an open bracket or string, or a dangling operator does not",
    prose.every((s) => !readsAsExpression(s)));
  check("readsAsExpression: a reference's name holds spaces, but never a keyword",
    readsAsExpression("@basket size") && readsAsExpression("@price if @on else 0"));
  check("readsAsExpression: an '@' after an operand is the matrix operator", readsAsExpression("a @ b @ c"));
}

// --- 2. a Concept line carries a derivation ---------------------------------
{
  const text = [
    "Report",
    "    Sales =df[df.a | df.b][:10]",
    "        Sales|month  |units",
    "        Q1   |2026-01|1,204",
    "    Run Command: code ==x",
    "    Plain",
    "    rows =f()",
    "    Empty =",
    "    note = some words",
  ].join("\n");
  const r = lint(text, "t");
  const sales = r.nodes.find((n) => n.kind === KIND.CONCEPT && n.name === "Sales");
  check("Concept line: the derivation comes off the name", sales && sales.formula === "df[df.a | df.b][:10]" && sales.formulaCol === 10);
  check("Concept line: a colon inside the Python never becomes an inline Example",
    sales && !sales.children.some((c) => c.kind === KIND.INDIVIDUAL && c.line === sales.line));
  check("Concept line: a pipe inside the Python never makes the line a table row", !table.isRowText("    Sales =df[df.a | df.b]"));
  check("Concept line: the merge-form grid under it fills the same Concept",
    sales && sales.children.some((c) => c.kind === KIND.INDIVIDUAL && c.name === "Q1"));
  const run = r.nodes.find((n) => n.name === "Run Command");
  check("Concept line: a Concept's default is its text, a doubled '=' one literal '=' — no derivation, no Example",
    run && run.formula === undefined && run.value === "code =x" && !run.children.length);
  const derivedDefault = lint("Run Command: code =x", "t").errors;
  check("Concept line: an '=' opening a derivation on a Concept's default is an error — a default is stated",
    derivedDefault.some((e) => /derives the Concept's default/.test(e.message)));
  check("Concept line: a plain Concept is untouched", r.nodes.some((n) => n.name === "Plain" && n.formula === undefined));
  const rows = r.nodes.find((n) => n.kind === KIND.ATTRIBUTE && n.name === "rows");
  check("'=' on a bare attribute defines it: no error, one equality the attribute's every value is held to",
    !r.errors.some((e) => e.line === 7) && rows && rows.constraints && rows.constraints.length === 1
    && rows.constraints[0].op === "==" && rows.constraints[0].opText === "=" && rows.constraints[0].formula === "f()");
  const onAttr = r.errors.find((e) => e.line === 9);
  check("a definition that does not read as Python is an error that says so, and how to make it a value's derivation",
    onAttr && /does not read as Python/.test(onAttr.message) && /add a colon/.test(onAttr.message) && /note: =some words/.test(onAttr.message));
  const empty = r.errors.find((e) => e.line === 8);
  check("an empty Concept derivation is an error", empty && /nothing after '='/.test(empty.message));
  check("table.cleanName: a Concept line files under its name alone", table.cleanName("Sales =by_month(@raw)") === "Sales");
}

// --- 3. no keystroke runs Python --------------------------------------------
{
  const text = [
    "Report",
    "    tax rate: 0.2",
    "    total: 99 =load()",
    "    vat: =@total*@tax rate",
    "    Order|price|cost",
    "    A    |10   |7 =math.floor(@price*0.7)",
    "    B    |20   |=@price*2",
  ].join("\n");
  const r = lint(text, "t");
  const reg = table.mergeRegistries(derive.conceptRegistry(r.root, r.nodes));
  let t2 = text;
  for (let k = 0; k < 5; k++) {
    const aligned = table.align(t2, reg, "t");
    const ls = t2.split("\n");
    for (const e of aligned) ls[e.line - 1] = e.text;
    t2 = ls.join("\n");
  }
  check("inert: five table passes compute nothing — a value stays what it was, an empty one empty",
    t2.split("\n")[5].includes("7 =math.floor(@price*0.7)") && /\|=@price\*2$/.test(t2.split("\n")[6]));
  check("inert: every derivation is Python, the line-form one a formula used to take included",
    python.hostsOf(r.nodes, text.split("\n"), "t").map((h) => h.kind).join() === "value,value,cell,cell");
  check("inert: the formula engine is gone — nothing left to recompute with",
    table.recompute === undefined && table.formulas === undefined && derive.recomputeValues === undefined && derive.auditValues === undefined);
}

// --- 4. park and home again, byte for byte ----------------------------------
{
  const text = [
    "Sales Report",
    "    raw: <DataFrame 1,204 rows × 4 cols> =load()",
    "    revenue: 53,760 =@Sales.amount.sum()",
    "    Sales =by_month(@raw)",
    "        Sales|month  |amount",
    "        P1   |2026-01|15,000",
    "        Q1   |2026-01|18,060",
    "",
    "    Order|price|cost",
    "    A    |10   |7 =math.floor(@price*0.7)",
  ].join("\n");
  const lines = text.split("\n");
  const r = lint(text, "t");
  const parked = park.park(lines, r.nodes, "t");
  // park and unpark leave re-alignment to their caller, as every table edit does
  const aligned = (t) => {
    const ls = t.split("\n");
    for (const e of table.align(t, undefined, "t")) ls[e.line - 1] = e.text;
    return ls.join("\n");
  };
  const store = park.serialise(parked.parked);
  check("park: a value's, a cell's and a Concept's Python all leave the data",
    parked.lines.every((l) => !/ =[^=]/.test(l)));
  check("park: a Concept's derivation is addressed by the Concept alone", /^@Sales: =by_month\(@raw\)$/m.test(store));
  check("park: the store says it may hold executable Python", /PYTHON/.test(store));
  const r2 = lint(parked.lines.join("\n"), "t");
  const back = park.unpark(parked.lines, r2.nodes, "t", park.parse(store));
  check("park: every derivation comes home byte for byte", aligned(back.lines.join("\n")) === text && !back.missing.length);
  check("park: a Python cell is addressed by its own column", /^@Order@cost@A: =math\.floor/m.test(store));
  const marks = park.parkedSpans(parked.lines, r2.nodes, "t", park.parse(store));
  check("park: a parked Concept derivation marks every row of its table",
    marks.filter((m) => m.concept).map((m) => m.line).join(",") === "6,7");
  check("park: a one-segment address names nothing when the Concept is gone",
    park.unpark(["Other"], lint("Other", "t").nodes, "t", [{ address: "@Sales", formula: "=f()" }]).missing[0] === "@Sales");
}

// --- 5. a computed number, as the file writes one ---------------------------
{
  check("format: every computed number carries thousands separators",
    table.formatValue(1215.6, "") === "1,215.6" && table.formatValue(184540, "184540") === "184,540");
  check("format: a $ on the old value is kept", table.formatValue(1500, "$9") === "$1,500");
  check("format: a Python number takes the file's format, every digit of it",
    python.cellText(3628800) === "3,628,800" && python.cellText(0.1 + 0.2) === "0.30000000000000004" && python.cellText({ $n: "12345678901234567" }) === "12,345,678,901,234,567");
  check("format: an Example name is never separated (2026 names a year)", python.gridOf({ columns: [], rows: [[2026]] }, "Year").rows[0][0] === "2026");
}

// --- 6. references in Python ------------------------------------------------
{
  const starts = (s) => python.referenceStarts(s).map((x) => x.start);
  check("references: an '@' opening an operand is a reference", starts("@a + @b").join() === "0,5");
  check("references: an '@' after an operand is the matrix operator", starts("a @ b").length === 0 && starts("x@y").length === 0);
  check("references: never inside a string, an f-string, a triple quote or a comment",
    starts("'@a' + \"@b\" + f\"{x}@c\" + '''@d''' # @e").length === 0);
  check("references: after a keyword an '@' is a reference again", starts("x if @c else @d").length === 2);

  const text = [
    "Sales Report",
    "    tax rate: 0.2",
    "    raw: =load()",
    "    revenue: =@Sales.amount.sum() * (1 + @tax rate)",
    "    first: =str(@Order@price@A)",
    "    count: =len(@Order)",
    "    ghost: =@nobody.x + 1",
    "    Sales =by_month(@raw)",
    "        Sales|month  |amount",
    "        Q1   |2026-01|18,060",
    "    Order|price",
    "    A    |10",
  ].join("\n");
  const lines = text.split("\n");
  const r = lint(text, "t");
  const hosts = python.hostsOf(r.nodes, lines, "t");
  check("hosts: every value and the Concept line, each found once",
    hosts.map((h) => `${h.kind}:${h.address}`).join(" ") === "value:@Sales Report@raw value:@Sales Report@revenue value:@Sales Report@first value:@Sales Report@count value:@Sales Report@ghost concept:@Sales");
  const reg = derive.conceptRegistry(r.root, r.nodes);
  const ctx = { lines, registry: table.mergeRegistries(reg), rootName: "t", index: python.hostIndex(hosts) };
  const res = (a) => python.resolveHost(hosts.find((h) => h.address === a), ctx);
  const rev = res("@Sales Report@revenue");
  check("resolve: a derived Concept is its live frame, a plain value is its text",
    rev.targets[0].kind === "object" && rev.targets[0].address === "@Sales"
    && rev.targets[1].kind === "value" && rev.targets[1].text === "0.2"
    && rev.code === "_aot_ref(0).amount.sum() * (1 + _aot_ref(1))");
  check("resolve: a reference to another derivation is a dependency", rev.deps.join() === "@Sales");
  check("resolve: a cell of another Concept is its value", res("@Sales Report@first").targets[0].text === "10");
  check("resolve: a reference naming nothing says so", /@nobody names nothing/.test(res("@Sales Report@ghost").errors[0]));
  const sales = res("@Sales");
  check("resolve: a Concept line reads what its parent holds", sales.targets[0].kind === "object" && sales.deps.join() === "@Sales Report@raw");

  const plain = python.resolveHost({ kind: "value", source: "@Order", node: r.nodes.find((n) => n.name === "raw"), line: 3 }, ctx);
  check("resolve: a plain Concept is a frame of its Examples",
    plain.targets[0].kind === "frame" && plain.targets[0].header.join() === "Order,price" && plain.targets[0].rows[0].join() === "A,10");
}

// --- 6c. a bare `=` line writes Concepts -----------------------------------------
// Tables returned by name: a Concept already in the file is filled where it
// stands, a new one is written under the line at its indent, one with a
// derivation of its own is left to it, and nothing is ever deleted.
{
  const text = [
    "=load_all()",
    "",
    "Budget",
    "    Budget|amount",
    "    1     |9,000",
    "",
    "Plan =p()",
    "Report",
    "    =per_team()",
    "    total: =len(@Sales)",
  ].join("\n");
  const lines = text.split("\n");
  const r = lint(text, "t");
  const hosts = python.hostsOf(r.nodes, lines, "t");
  const gens = hosts.filter((h) => h.kind === "generator");
  check("bare =: a host of its own, addressed by its place among the bare lines",
    gens.map((h) => `${h.address}:${h.source}:${h.line}`).join() === "@=1:load_all():1,@=2:per_team():9");
  const grid = (name, columns, rows) => ({ name, columns, rows });
  const res = python.resultOf(gens[0], { kind: "grids", grids: [
    grid("sales_report", ["month", "amount"], [["1", "2026-01", 15000]]),
    grid("Region", ["code"], [["1", "EU"]]),
    grid("budget", ["amount"], [["1", 1], ["2", 2]]),
    grid("Plan", ["x"], [["1", "y"]]),
  ] });
  check("bare =: each table named as the language names a Concept — '_' a space, capitalised",
    res.grids.map((g) => g.name).join() === "Sales report,Region,Budget,Plan" && res.count === 5);
  check("bare =: anything but tables by name is an error saying what to return",
    /return them by name, \{"Sales": df, …\}/.test((() => { try { python.resultOf(gens[0], { kind: "number", value: 1, summary: "1" }); } catch (e) { return e.message; } return ""; })()));
  check("bare =: one name twice is an error",
    /returned twice/.test((() => { try { python.resultOf(gens[0], { kind: "grids", grids: [grid("A", [], []), grid("a", [], [])] }); } catch (e) { return e.message; } return ""; })()));
  const thrown = (fn) => { try { fn(); } catch (e) { return e.message; } return ""; };
  check("bare =: a table returned without a name is an error saying how to name one",
    /has no name — name each one/.test(thrown(() => python.resultOf(gens[0], { kind: "grids", grids: [grid(undefined, [], [])] })))
    && /has no name/.test(thrown(() => python.resultOf(gens[0], { kind: "grids", grids: [grid("__", [], [])] }))));
  check("bare =: what it produced instead is named as well as it can be — its summary, else its kind, else nothing",
    /produced number$/.test(thrown(() => python.resultOf(gens[0], { kind: "number", value: 1 })))
    && /produced nothing$/.test(thrown(() => python.resultOf(gens[0]))));
  check("bare =: no tables at all writes nothing", python.resultOf(gens[0], { kind: "grids" }).grids.length === 0);
  const lone = ["=", "Thing"];
  check("bare =: a lone '=' is the linter's error, never a run",
    !python.hostsOf(lint(lone.join("\n"), "t").nodes, lone, "t").some((h) => h.kind === "generator"));
  // what a bare line wrote is read by its name — unless that name has a
  // derivation of its own, which stays the one read
  const ix = python.hostIndex(hosts, new Map([["@=1", ["Plan", "Fresh"]]]));
  check("bare =: a Concept it wrote is found by name; one with its own derivation stays that derivation's",
    ix.byConcept.get("plan").kind === "concept" && ix.byConcept.get("fresh").address === "@=1" && ix.byConcept.get("fresh").node === null);
  const w = python.writeGenerated(lines, gens[0], res.grids, "t");
  check("bare =: a new Concept is written at the line's own indent, directly under it",
    w.lines.slice(0, 7).join("\n") === ["=load_all()", "Sales report|month  |amount", "1           |2026-01|15,000", "", "Region|code", "1     |EU", ""].join("\n"));
  check("bare =: a Concept already in the file is filled where it stands",
    w.lines.includes("Budget|amount") && w.lines.includes("2     |2") && !w.lines.includes("    1     |9,000"));
  check("bare =: a Concept with a derivation of its own is left to it — no failure, named among what it left",
    w.lines.includes("Plan =p()") && w.written.join() === "Sales report,Region,Budget" && w.left.join() === "Plan" && !w.errors.length);
  check("bare =: the file it writes verifies", lint(w.lines.join("\n"), "t").errors.length === 0);
  // a table somebody else wrote right under the line is not the line's: the
  // new one goes above it, directly under the line
  const foreign = ["=load()", "Ledger Note|text", "1          |kept"];
  const fl = lint(foreign.join("\n"), "t");
  const fw = python.writeGenerated(foreign, python.hostsOf(fl.nodes, foreign, "t")[0],
    [{ name: "Fresh", grid: { header: ["Fresh", "n"], rows: [["1", "5"]] } }], "t");
  const lost = python.writeGenerated(lines, Object.assign({}, gens[0], { ordinal: 7 }), res.grids, "t");
  check("bare =: a line that cannot be found again writes nothing, and says so",
    lost.lines.join("\n") === lines.join("\n") && /could not be found again/.test(lost.errors[0]));
  // a Concept whose own derivation has not written its table yet is in no
  // registry, but it is still the frame that derivation will make
  {
    const t2 = ["Report", "    rows: =len(@Pending)", "Pending =make()"];
    const r2 = lint(t2.join("\n"), "t");
    const h2 = python.hostsOf(r2.nodes, t2, "t");
    const reads = python.resolveHost(h2.find((h) => h.address === "@Report@rows"), {
      lines: t2, registry: table.mergeRegistries(derive.conceptRegistry(r2.root, r2.nodes)), rootName: "t", index: python.hostIndex(h2),
    });
    check("references: a Concept whose derivation has not run yet is its live frame, a dependency",
      !reads.errors.length && reads.targets[0].kind === "object" && reads.targets[0].address === "@Pending" && reads.deps.join() === "@Pending"
      && reads.names[0].nodes[0].name === "Pending");
    // the same from a table cell, whose references resolve through its row
    const t3 = ["Sheet|n", "S1   |=len(@Pending)", "", "Pending =make()"];
    const r3 = lint(t3.join("\n"), "t");
    const h3 = python.hostsOf(r3.nodes, t3, "t");
    const cellReads = python.resolveHost(h3.find((h) => h.kind === "cell"), {
      lines: t3, registry: table.mergeRegistries(derive.conceptRegistry(r3.root, r3.nodes)), rootName: "t", index: python.hostIndex(h3),
    });
    check("references: a table cell reads a Concept whose derivation has not run as its live frame",
      !cellReads.errors.length && cellReads.targets[0].kind === "object" && cellReads.targets[0].address === "@Pending"
      && cellReads.deps.join() === "@Pending" && cellReads.names[0].nodes[0].name === "Pending");
  }
  check("bare =: a table it did not write stays below the new one",
    fw.lines.join("\n") === ["=load()", "Fresh|n", "1    |5", "", "Ledger Note|text", "1          |kept"].join("\n"));
  const again = python.writeGenerated(w.lines, gens[0], res.grids, "t");
  check("bare =: a second run replaces in place — nothing moves, nothing doubles", again.lines.join("\n") === w.lines.join("\n"));
  const fewer = python.writeGenerated(w.lines, gens[0], res.grids.slice(1, 2), "t");
  check("bare =: a Concept it no longer returns is never deleted", fewer.lines.includes("Sales report|month  |amount"));
  const nested = python.writeGenerated(w.lines, python.hostsOf(lint(w.lines.join("\n"), "t").nodes, w.lines, "t").find((h) => h.address === "@=2"),
    [{ name: "Team", grid: { header: ["Team", "size"], rows: [["A", "3"]] } }], "t");
  check("bare =: under a Concept, its Concepts stand at the line's own indent, filed under that Concept",
    nested.lines.join("\n").includes(["    =per_team()", "    Team|size", "    A   |3"].join("\n"))
    && lint(nested.lines.join("\n"), "t").nodes.find((n) => n.name === "Team").parent.name === "Report");

  // what it wrote is read live by name: `@Sales report` is the table its Python made
  const lines2 = w.lines;
  const r2 = lint(lines2.join("\n"), "t");
  const hosts2 = python.hostsOf(r2.nodes, lines2, "t");
  const index = python.hostIndex(hosts2, new Map([["@=1", ["Sales report", "Region", "Budget"]]]), r2.nodes);
  const ctx = { lines: lines2, registry: table.mergeRegistries(derive.conceptRegistry(r2.root, r2.nodes)), rootName: "t", index };
  const reads = python.resolveHost({ kind: "value", source: "len(@Region)", node: r2.nodes.find((n) => n.name === "total"), line: 1 }, ctx);
  check("bare =: a Concept it wrote is read as its live table, by name, and depends on the line",
    reads.targets[0].kind === "object" && reads.targets[0].address === "@=1" && reads.targets[0].key === "Region" && reads.deps.join() === "@=1");
}

// --- 6a. Python sees sub-Examples ----------------------------------------------
// A Concept's rows are every Example in its scope, sub-Examples included, and
// where they nest the frame carries the tree in a `parent` column, as the CSV
// mirror does. A value on an Example reaches the Examples beneath it.
{
  const text = [
    "Thing",
    "    age",
    "    - Parent",
    "        age: 40",
    "        total: =@Child 1@age + @Child 2@age",
    "        - Child 1",
    "            age: 10",
    "        - Child 2",
    "            age: 12",
    "    - Other",
    "        age: 7",
    "    count: =len(@Thing)",
    "    kid: =@Thing@Child 2@age",
    "    ages: =@Thing@age",
    "    whose: =@Thing@Child 2@parent",
    "    parents: =@Thing@parent",
    "Flat",
    "    - A",
    "        n: 1",
    "    - B",
    "        n: 2",
    "    all: =@Flat",
    "Grid|parent (grid)|age",
    "Top |             |30",
    "Sub |Top          |3",
    "Reader",
    "    g: =@Grid",
    "Org",
    "    parent",
    "    - Board",
    "        - Finance",
    "    - Staff",
    "        parent: Board",
    "    found: =@Org@Finance@parent",
    "    stated: =@Org@Staff@parent",
  ].join("\n");
  const lines = text.split("\n");
  const r = lint(text, "t");
  const hosts = python.hostsOf(r.nodes, lines, "t");
  const ctx = { lines, registry: table.mergeRegistries(derive.conceptRegistry(r.root, r.nodes)), rootName: "t", index: python.hostIndex(hosts) };
  const res = (a) => python.resolveHost(hosts.find((h) => h.address === a), ctx);
  const frame = res("@Thing@count").targets[0];
  check("sub-Examples: a Concept's frame holds every Example, sub-Examples included",
    frame.kind === "frame" && frame.rows.map((row) => row[0]).join() === "Parent,Child 1,Child 2,Other");
  check("sub-Examples: where they nest, a parent column carries the tree",
    frame.header.slice(0, 3).join() === "Thing,parent,age" && frame.rows[1].slice(0, 3).join() === "Child 1,Parent,10"
    && frame.rows[0][1] === "" && frame.rows[3][1] === "");
  check("sub-Examples: a cell of a sub-Example resolves by name",
    res("@Thing@kid").targets[0].kind === "value" && res("@Thing@kid").targets[0].text === "12");
  check("sub-Examples: a column spans the sub-Examples too",
    res("@Thing@ages").targets[0].values.join() === "40,10,12,7");
  check("sub-Examples: the parent column reads like any other, a cell or the whole column",
    res("@Thing@whose").targets[0].text === "Parent" && res("@Thing@parents").targets[0].values.join() === ",Parent,Parent,");
  check("sub-Examples: a Concept stating its own 'parent' keeps one column — an Example's own value, else where it sits",
    res("@Org@found").targets[0].text === "Board" && res("@Org@stated").targets[0].text === "Board");
  const total = res("@Thing@total@Parent");
  check("sub-Examples: a value on an Example reads the Examples beneath it",
    !total.errors.length && total.targets.map((t) => t.text).join() === "10,12");
  const flat = res("@Flat@all").targets[0];
  // (the Concept's own attributes, 'all' here, are columns as they always were)
  check("sub-Examples: a flat Concept's frame is unchanged, no parent column",
    !flat.header.includes("parent") && flat.rows.map((row) => row[0] + "=" + row[flat.header.indexOf("n")]).join() === "A=1,B=2");
  const grid = res("@Reader@g").targets[0];
  check("sub-Examples: nested table rows are rows of the frame, with their parent",
    grid.header.join() === "Grid,parent,age" && grid.rows.map((row) => row.join()).join("|") === "Top,,30|Sub,Top,3");
}

// --- 6a. a cell naming no Concept reads the current one ----------------------
{
  const setup = (rows) => {
    const text = rows.join("\n");
    const lines = text.split("\n");
    const r = lint(text, "t");
    const hosts = python.hostsOf(r.nodes, lines, "t");
    const registry = table.mergeRegistries(derive.conceptRegistry(r.root, r.nodes));
    const ctx = { lines, registry, rootName: "t", index: python.hostIndex(hosts) };
    const resolved = (a) => python.resolveHost(hosts.find((h) => h.address === a), ctx);
    return { r, lines, hosts, ctx, registry, res: resolved, order: () => python.orderDerivations(hosts, (a) => resolved(a).deps).order };
  };

  const est = setup([
    "Cost Estimate  |quantum                        |amount",
    "corrigated pvc |=@meters to cover@quantum      |",
    "column first   |=@quantum@meters to cover      |",
    "meters to cover|56 =@Boundary Size@meters.sum()|",
    "wood           |40                             |7",
    "copy           |=@wood@quantum                 |=@amount@wood",
    "both           |=@wood@quantum+@copy@amount*2  |",
    "whole row      |=@wood                         |",
    "own            |3 =@own@quantum                |",
    "typo           |=@wod@quantum                  |",
    "",
    "Boundary Size|meters",
    "concrete wall|25",
  ]);
  const at = (row) => est.res(`@Cost Estimate@quantum@${row}`);
  const pvc = at("corrigated pvc");
  check("current Concept: @row@column in a cell resolves, no Concept named",
    !pvc.errors.length && pvc.code === "_aot_ref(0)");
  check("current Concept: a derived cell is its live result and a dependency",
    pvc.targets[0].kind === "object" && pvc.deps.join() === "@Cost Estimate@quantum@meters to cover");
  check("current Concept: @column@row means the same", at("column first").deps.join() === pvc.deps.join());
  const order = est.order();
  check("current Concept: what reads a derived cell runs after it, wherever it stands",
    order.indexOf("@Cost Estimate@quantum@meters to cover") < order.indexOf("@Cost Estimate@quantum@corrigated pvc"));
  check("current Concept: a typed cell reads as its value, in either order",
    at("copy").targets[0].text === "40" && est.res("@Cost Estimate@amount@copy").targets[0].text === "7");
  const both = at("both");
  check("current Concept: several in one expression, each ending where its name does",
    !both.errors.length && both.code === "_aot_ref(0)+_aot_ref(1)*2"
    && both.targets[0].text === "40" && both.deps.join() === "@Cost Estimate@amount@copy");
  const whole = at("whole row").targets[0];
  check("current Concept: @row alone is the row, as a dict",
    whole.kind === "record" && whole.name === "wood" && whole.fields.quantum === "40" && whole.fields.amount === "7");
  const own = at("own");
  check("current Concept: a cell naming itself reads what it holds, and is no cycle",
    own.targets[0].text === "3" && !own.deps.length && !python.orderDerivations(est.hosts, (a) => est.res(a).deps).cycles.length);
  check("current Concept: a name that is nothing still says so", /@wod names nothing/.test(at("typo").errors[0]));
  const [rowRef, colRef] = pvc.names;
  check("current Concept: a rename follows the row to its Example and the column to its header",
    rowRef.kind === "row" && rowRef.text === "meters to cover" && rowRef.nodes[0].name === "meters to cover"
    && colRef.kind === "column" && colRef.text === "quantum" && colRef.site.line === 1);

  const named = setup([
    "Widget",
    "    - One",
    "        qty: 99",
    "",
    "Stock |qty          |cost",
    "Widget|3            |4",
    "Reader|=@Widget@qty |=@Widget@cost",
    "Whole |=@Widget     |",
  ]);
  const concept = named.res("@Stock@qty@Reader").targets[0];
  check("a named Concept: a name that is a Concept and a row, reading as far both ways, stays the Concept",
    concept.kind === "column" && concept.values.join() === "99");
  check("a named Concept: alone, it stays the Concept's frame", named.res("@Stock@qty@Whole").targets[0].kind === "frame");
  const local = named.res("@Stock@cost@Reader");
  check("a named Concept: one without that column leaves it to the row",
    !local.errors.length && local.targets[0].text === "4" && local.code === "_aot_ref(0)");

  const outer = setup([
    "Ledger",
    "    tax: 5",
    "    - Gamma",
    "        qty: 9",
    "",
    "    Ledger|qty",
    "    Alpha |2",
    "    Beta  |=@Gamma@qty",
    "    Delta |=@Alpha@tax",
    "    Own   |=@tax",
  ]);
  const gamma = outer.res("@Ledger@qty@Beta");
  check("current Concept: a line-form Example of the Concept is named as a row is",
    gamma.targets[0].text === "9" && gamma.names[0].nodes[0].name === "Gamma");
  const tax = outer.res("@Ledger@qty@Delta");
  check("current Concept: a named row silent on an attribute answers the Concept's default",
    tax.targets[0].text === "5" && tax.names[1].attrKey === "tax");
  check("current Concept: @attribute alone is still this row's", outer.res("@Ledger@qty@Own").targets[0].text === "5");

  const longest = setup([
    "Prices    |price",
    "price list|1",
    "price     |5",
    "reader    |=@price list@price",
    "plain     |7 =@price",
  ]);
  const rd = longest.res("@Prices@price@reader");
  check("longest name: a row reading further than a column is the row", !rd.errors.length && rd.code === "_aot_ref(0)" && rd.targets[0].text === "1");
  check("longest name: a column and a row of one name, alone, is the column of this row", longest.res("@Prices@price@plain").targets[0].text === "7");

  const bound = setup([
    "Stock|qty >=@Base@qty",
    "Base |2",
    "Other|5",
  ]);
  const held = python.checkItems(python.constraintChecks(bound.r.nodes, bound.lines), bound.ctx);
  check("current Concept: a constraint's bound names a row of its table too",
    held.length === 2 && held.every((c) => !c.errors.length && c.item.targets[0].text === "2"));
}

// --- 6b. the repository's own Python, resolved as the runtime resolves it ---
{
  const root = path.resolve("/repo");
  const af = path.join(root, "aot.files");
  const index = [
    path.join(af, "helpers.py"), path.join(root, "tools", "finance.py"), path.join(root, "pkg", "__init__.py"),
    path.join(root, "pkg", "sub.py"), path.join(root, "dup", "a", "same.py"), path.join(root, "dup", "b", "same.py"),
    path.join(root, "top.py"),
  ];
  check("modules: aot.files first, then the root", python.moduleFiles("helpers", index, root, af).join() === index[0]
    && python.moduleFiles("top", index, root, af).join() === index[6]);
  check("modules: a name found anywhere else in the repository", python.moduleFiles("finance", index, root, af).join() === index[1]);
  check("modules: a package is every file beneath it", python.moduleFiles("pkg", index, root, af).length === 2);
  check("modules: two files of one name are both reached", python.moduleFiles("same", index, root, af).length === 2);
  check("modules: a name the repository has not is none", python.moduleFiles("nothing", index, root, af).length === 0);
  const refs = python.referencedModules('finance.revenue(@units) + tools.finance.f() + aot.use("tools/my helpers.py").g() + "x.y" + @rows.units');
  check("modules: a derivation names finance and tools, and the file it uses by path — never text in a string, a reference, or aot itself",
    refs.names.sort().join() === "finance,tools" && refs.paths.join() === "tools/my helpers.py");

  const calls = (s) => python.callSites(s).map((c) => `${s.slice(c.start, c.start + c.length)}=${c.module}|${c.name}|${c.used || ""}`);
  check("calls: a bare call, a module's, and one through aot.use, each spanning its callee as written",
    calls('by_month(@raw) + tools.finance.revenue(1) + aot.use("x y.py").hi()').join(" ")
      === 'by_month=|by_month| tools.finance.revenue=tools.finance|revenue| aot.use("x y.py").hi=|hi|x y.py');
  check("calls: a method on a reference or on a result is the object's, not a file's",
    calls("@Sales.amount.sum() + load().head()").join() === "load=|load|");
  check("calls: never inside a string or a comment, never a keyword",
    calls('"f(1)" + x # g(2)').length === 0 && calls("not ok(1)").join() === "ok=|ok|");
  check("calls: a reference's name may hold spaces, and ends at a keyword",
    calls("@basket size.sum() + g(2)").join() === "g=|g|" && calls("@p if check(@a) else 0").join() === "check=|check|");
}

// --- 7. the order ------------------------------------------------------------
{
  const hosts = ["@a", "@b", "@c", "@x", "@y"].map((address) => ({ address }));
  const deps = { "@b": ["@a"], "@c": ["@b"], "@x": ["@y"], "@y": ["@x"] };
  const { order, cycles } = python.orderDerivations(hosts, (a) => deps[a]);
  check("order: what a derivation reads runs first", order.indexOf("@a") < order.indexOf("@b") && order.indexOf("@b") < order.indexOf("@c"));
  check("order: a cycle runs nothing and names its members", !order.includes("@x") && cycles.length === 1 && cycles[0].sort().join() === "@x,@y");
  const hit = python.affected(hosts, (a) => deps[a], "@b", (a) => a === "@a");
  check("Ctrl+Enter: the line, everything downstream, and its stale upstream",
    [...hit].sort().join() === "@a,@b,@c");
  const fresh = python.affected(hosts, (a) => deps[a], "@b", () => false);
  check("Ctrl+Enter: a fresh upstream is left as it is", [...fresh].sort().join() === "@b,@c");
  const h1 = python.runHash("f()", [{ kind: "value", text: "1" }], "s", []);
  check("run hash: moves with the source, an input, the sidecar or upstream",
    h1 === python.runHash("f()", [{ kind: "value", text: "1" }], "s", [])
    && h1 !== python.runHash("g()", [{ kind: "value", text: "1" }], "s", [])
    && h1 !== python.runHash("f()", [{ kind: "value", text: "2" }], "s", [])
    && h1 !== python.runHash("f()", [{ kind: "value", text: "1" }], "t", [])
    && h1 !== python.runHash("f()", [{ kind: "value", text: "1" }], "s", ["u"]));
}

// --- 7b. the constraints, as the run checks them ---------------------------
{
  const text = [
    "Staff",
    "    age >=18 <=65",
    '    status =("draft", "sent")',
    "    grade =@level*2",
    "    - Ann",
    "        age: 30",
    "        status: draft",
    "        level: 3",
    "        grade: 6",
    "    - Bob",
    "        age: 15",
    "        status:",
    "        level: 1",
    "        grade: =@level*2",
    "",
    "    Team|lead|size =4",
    "    Red |Ann |",
    "    Blue|Bob |3",
  ].join("\n");
  const lines = text.split("\n");
  const r = lint(text, "t");
  const checks = python.constraintChecks(r.nodes, lines);
  const on = (line) => checks.filter((c) => c.host.line === line);
  check("checks: every value a constraint holds, with its chain",
    on(6).length === 1 && on(6)[0].chain.map((c) => c.op + c.formula).join(" ") === ">=18 <=65" && on(6)[0].value === "30");
  check("checks: a value with its own derivation is marked derived",
    on(14).length === 1 && on(14)[0].derived && !on(9)[0].derived);
  check("checks: a column a header defines with '==' holds its empty cells too",
    on(17).length === 1 && on(17)[0].definesOnly && on(17)[0].value === "" && on(18).length === 1);
  // a cell with a value AND a derivation of its own is derived too, so the
  // header's definition never writes over it (the nearer word wins)
  const own = lint(["Team|size =4", "Red |5 =2+3", "Blue|3"].join("\n"), "t");
  const ownChecks = python.constraintChecks(own.nodes, ["Team|size =4", "Red |5 =2+3", "Blue|3"]);
  check("checks: a cell's own derivation is marked derived, so a column definition leaves it be",
    ownChecks.find((c) => c.host.line === 2).derived === true && ownChecks.find((c) => c.host.line === 3).derived === false);
  const reg = table.mergeRegistries(derive.conceptRegistry(r.root, r.nodes));
  const hosts = python.hostsOf(r.nodes, lines, "t");
  const plan = python.checkItems(checks, { lines, registry: reg, rootName: "t", index: python.hostIndex(hosts) });
  const itemOn = (line, op) => plan.find((p) => p.check.host.line === line && p.clause.op === op);
  check("checks: each clause is one request, its value sent as written",
    itemOn(6, ">=").item.rel === ">=" && itemOn(6, ">=").item.code === "18" && itemOn(6, ">=").item.value === "30"
    && itemOn(6, "<=").item.code === "65");
  check("checks: a bound's reference resolves where its value stands",
    itemOn(9, "==").item.code === "_aot_ref(0)*2" && itemOn(9, "==").item.targets[0].text === "3");
  check("checks: an empty value is held to nothing, its definition's being the calculation's",
    !itemOn(12, "==") && !itemOn(17, "=="));
  const defined = python.calcHosts(r.nodes, lines, "t").filter((h) => h.defined);
  check("calculation: a definition computes each value it holds, in a cell or on a line",
    defined.some((h) => h.line === 17 && h.kind === "cell" && h.source === "4") && defined.some((h) => h.line === 12 && h.kind === "value"));
  check("calculation: a value with a derivation of its own is left to it",
    !defined.some((h) => h.line === 14));
  const emptyText = "S\n    n >=1\n    - A\n        n:";
  const emptyLines = emptyText.split("\n");
  check("checks: ...and held to no other bound",
    python.checkItems(python.constraintChecks(lint(emptyText, "t").nodes, emptyLines),
      { lines: emptyLines, registry: undefined, rootName: "t", index: python.hostIndex([]) }).length === 0);
  const bad = python.checkItems(python.constraintChecks(lint("S\n    n >=@nobody\n    - A\n        n: 3", "t").nodes, ["S", "    n >=@nobody", "    - A", "        n: 3"]),
    { lines: ["S", "    n >=@nobody", "    - A", "        n: 3"], registry: undefined, rootName: "t", index: python.hostIndex([]) });
  check("checks: a bound naming nothing has no request, only its error",
    bad.length === 1 && bad[0].item === null && /@nobody names nothing/.test(bad[0].errors[0]));
  const filled = python.writeValue(lines, on(17)[0].host, "4");
  check("checks: a defined value is written into an empty cell", /^    Red \|Ann \|4$/.test(filled[16]));
  const line = python.writeValue(lines, on(12)[0].host, "draft");
  check("checks: ...and into an empty line-form value", line[11] === "        status: draft");
}

// --- 7c. a column named for its Concept names the Examples -----------------
{
  const frame = { kind: "frame", columns: ["quarter", "units"], rows: [["1", "Q1", 10], ["2", "Q2", 1204]] };
  const g = python.gridOf(frame, "Quarter");
  check("Concept column: its values name the rows, and it is no column of its own",
    g.header.join() === "Quarter,units" && g.rows.map((r) => r.join("|")).join(" ") === "Q1|10 Q2|1,204");
  const plain = python.gridOf({ kind: "frame", columns: ["month", "units"], rows: [["1", "Jan", 5]] }, "Quarter");
  check("Concept column: without one the rows stay numbered 1, 2, 3",
    plain.header.join() === "Quarter,month,units" && plain.rows[0][0] === "1");
  const dup = python.gridOf({ kind: "frame", columns: ["quarter"], rows: [["1", "Q1"], ["2", "q1"]] }, "Quarter");
  check("Concept column: names two rows alike — numbers then, and the column stays",
    dup.header.join() === "Quarter,quarter" && dup.rows.map((r) => r[0]).join() === "1,2");
  const gap = python.gridOf({ kind: "frame", columns: ["quarter"], rows: [["1", "Q1"], ["2", null]] }, "Quarter");
  check("Concept column: leaves a row unnamed — numbers then too", gap.rows.map((r) => r[0]).join() === "1,2");
  const year = python.gridOf({ kind: "frame", columns: ["year", "n"], rows: [["1", 2026, 3]] }, "Year");
  check("Concept column: a number names a row as written (2026, not 2,026)", year.rows[0][0] === "2026");
  const named = python.gridOf({ kind: "frame", named: true, columns: ["quarter"], rows: [["A", "Q1"]] }, "Quarter");
  check("Concept column: a grid Python named row by row keeps its names",
    named.header.join() === "Quarter,quarter" && named.rows[0][0] === "A");
}

// --- 7d. data never becomes code, and no credential is written --------------
{
  const v = (text) => python.resultOf({ kind: "value", value: "", address: "@t@x" }, { kind: "text", text }, 120).text;
  const written = v("x =__import__('os').system('boom')");
  check("inert: a written value's '=' never opens a derivation — it is escaped as the language escapes one, doubled",
    written === "x ==__import__('os').system('boom')" && table.splitCell(written).eq === -1 && table.readValue(written) === "x =__import__('os').system('boom')");
  check("inert: a value opening with '=' is escaped too; a literal '==' gains one more so it reads back as itself; a=b was never a derivation",
    v("=evil()") === "==evil()" && v("a ==b") === "a ===b" && table.readValue(v("a ==b")) === "a ==b" && v("a=b") === "a=b");
  const g = python.gridOf({ kind: "frame", columns: ["n >=__import__('os').getpid()", "plain", "x =f()"], rows: [["1", "=boom()", 2, "k"]] }, "T");
  check("inert: a column that would read as a bound or a derivation has its operators made full-width",
    g.header[1] === "n ＞＝__import__('os').getpid()" && g.header[2] === "plain" && g.header[3] === "x ＝f()"
    && table.splitConstraint(g.header[1]).eq === -1);
  check("inert: a cell Python wrote can never be a derivation", g.rows[0][1] === "==boom()");
  check("inert: prose with an operator in it is no code, and is left alone", python.inertName("speed > none noted") === "speed > none noted");
  const secret = (text) => { try { v(text); return null; } catch (e) { return e.message; } };
  check("secrets: a private key is refused, and says why",
    /looks like a private key, so it is not written into the file/.test(secret("-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn...")));
  check("secrets: access keys and tokens are refused",
    /AWS access key/.test(secret("AKIAABCDEFGHIJKLMNOP")) && /GitHub token/.test(secret("ghp_" + "a".repeat(36)))
    && /Anthropic API key/.test(secret("sk-ant-api03-" + "b".repeat(30))) && /JWT/.test(secret("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4f")));
  check("secrets: ordinary text is written", secret("revenue grew 12% in Q2") === null && secret("sk-learn pipeline") === null);
  let gridRefused = null;
  try { python.gridOf({ kind: "frame", columns: ["key"], rows: [["1", "AKIAABCDEFGHIJKLMNOP"]] }, "T"); } catch (e) { gridRefused = e.message; }
  check("secrets: a table holding one is refused whole", /AWS access key/.test(gridRefused || ""));
}

// --- 8. the protocol, against a fake process --------------------------------
function fakeProcess(onLine) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.stdin = { write: (s) => onLine(proc, s), end() {} };
  proc.kill = () => { proc.killed = true; setImmediate(() => proc.emit("exit", null)); };
  return proc;
}
(async () => {
  const echo = (proc, s) => {
    const req = JSON.parse(s);
    setImmediate(() => proc.stdout.emit("data", JSON.stringify({ id: req.id, ok: true, echo: req.op }) + "\n"));
  };
  let seen = null;
  const s1 = new python.Session((cmd, args, opts) => { seen = { cmd, args, opts }; return fakeProcess(echo); },
    { python: "py3", runtime: "/rt.py", cwd: "/w" }).start();
  const r1 = await s1.request({ op: "hello" });
  check("protocol: a request is answered by its id", r1.echo === "hello");
  check("security: spawned with -E -B, no bytecode, the Agg backend",
    seen.cmd === "py3" && seen.args.slice(0, 2).join() === "-E,-B" && seen.opts.env.PYTHONDONTWRITEBYTECODE === "1"
    && seen.opts.env.MPLBACKEND === "Agg" && seen.opts.cwd === "/w");
  let seenIsolated = null;
  new python.Session((cmd, args) => { seenIsolated = args; return fakeProcess(echo); },
    { python: "venv-python", runtime: "/rt.py", cwd: "/w", isolated: true }).start().kill();
  check("security: an environment of the project's own starts isolated (-I), -E and all",
    seenIsolated && seenIsolated[0] === "-I" && !seenIsolated.includes("-E") && seenIsolated.includes("-B"));

  // two responses in one chunk, one split across two
  let held = [];
  const batch = new python.Session(() => fakeProcess((proc, s) => {
    held.push(JSON.parse(s).id);
    if (held.length === 2) {
      const [a, b] = held;
      const both = JSON.stringify({ id: a, ok: true, n: a }) + "\n" + JSON.stringify({ id: b, ok: true, n: b });
      setImmediate(() => {
        proc.stdout.emit("data", both.slice(0, both.length - 5));
        proc.stdout.emit("data", both.slice(both.length - 5) + "\n");
      });
    }
  }), {}).start();
  const [x, y] = await Promise.all([batch.request({ op: "a" }), batch.request({ op: "b" })]);
  check("protocol: two answers in one chunk, one split across two, each resolves once", x.n === 1 && y.n === 2);

  // a malformed frame rejects only the request it names
  const bad = new python.Session(() => fakeProcess((proc, s) => {
    const req = JSON.parse(s);
    const line = req.op === "bad" ? `{"id": ${req.id}, oops}` : JSON.stringify({ id: req.id, ok: true });
    setImmediate(() => proc.stdout.emit("data", line + "\n"));
  }), {}).start();
  let badErr = null;
  try { await bad.request({ op: "bad" }); } catch (e) { badErr = e.message; }
  const after = await bad.request({ op: "fine" }).then(() => true, () => false);
  check("protocol: a frame that is not JSON rejects its own request and the session lives", /not JSON/.test(badErr) && after && bad.alive);

  // an error answer carries its message and where it happened
  const err = new python.Session(() => fakeProcess((proc, s) => {
    const req = JSON.parse(s);
    setImmediate(() => proc.stdout.emit("data", JSON.stringify({ id: req.id, ok: false, error: "KeyError: 'units'", line: 12 }) + "\n"));
  }), {}).start();
  let e1 = null;
  try { await err.request({ op: "eval" }); } catch (e) { e1 = e; }
  check("protocol: a failed evaluation rejects with its message and line", e1 && e1.message === "KeyError: 'units'" && e1.line === 12);

  // a hang: the request times out and the process is stopped
  let hungProc = null;
  const hung = new python.Session(() => (hungProc = fakeProcess(() => {})), { timeoutMs: 50 }).start();
  let tErr = null;
  try { await hung.request({ op: "eval" }); } catch (e) { tErr = e.message; }
  check("protocol: a hang times out, and the session is stopped with it", /timed out/.test(tErr) && !hung.alive && hungProc.killed);

  // queued behind slow work: a request's clock starts when the one before
  // it is answered — the runtime answers one at a time — so a warm-up
  // importing pandas for longer than a run's timeout does not time out the
  // run waiting behind it (the fake answers in order, the first after 120 ms)
  const serial = new python.Session(() => fakeProcess((proc, s) => {
    const req = JSON.parse(s);
    const answer = () => proc.stdout.emit("data", JSON.stringify({ id: req.id, ok: true, op: req.op }) + "\n");
    if (req.op === "warm") setTimeout(answer, 120);
    else serial._afterWarm = serial._afterWarm.then(() => new Promise((r) => setTimeout(() => { answer(); r(); }, 10)));
  }), { timeoutMs: 60 }).start();
  serial._afterWarm = new Promise((r) => setTimeout(r, 125));
  const [warmed, opened] = await Promise.all([serial.request({ op: "warm" }, 1000), serial.request({ op: "open" })]).catch((e) => [null, e]);
  check("protocol: a request queued behind a slow one is not timed out while it waits",
    warmed && warmed.op === "warm" && opened && opened.op === "open" && serial.alive);

  // the process exits mid-request: everything pending is rejected
  const dying = new python.Session(() => fakeProcess((proc) => setImmediate(() => { proc.stderr.emit("data", "Traceback...\nMemoryError\n"); proc.emit("exit", 1); })), {}).start();
  let dErr = null;
  try { await dying.request({ op: "eval" }); } catch (e) { dErr = e.message; }
  check("protocol: an exit rejects what is pending, naming the last error line", /exited \(code 1\).*MemoryError/.test(dErr) && !dying.alive);

  // an answer past the size limit
  const big = new python.Session(() => fakeProcess((proc) => setImmediate(() => proc.stdout.emit("data", "x".repeat(200)))), { maxResultBytes: 100 }).start();
  let bErr = null;
  try { await big.request({ op: "eval" }); } catch (e) { bErr = e.message; }
  check("protocol: a result past aot.python.maxResultBytes is refused, not buffered forever", /larger than/.test(bErr));

  // no python at all
  const none = new python.Session(() => { const p = fakeProcess(() => {}); setImmediate(() => p.emit("error", Object.assign(new Error("spawn python ENOENT"), { code: "ENOENT" }))); return p; }, { python: "python" }).start();
  let nErr = null;
  try { await none.request({ op: "hello" }); } catch (e) { nErr = e.message; }
  check("protocol: no Python on PATH says how to fix it", /'python' was not found.*aot\.python\.path/.test(nErr));
  check("protocol: a request to a stopped session rejects at once",
    await none.request({ op: "x" }).then(() => false, (e) => /not running/.test(e.message)));

  results();
})().catch((e) => { console.log("FAIL protocol block threw — " + e.stack); failures++; results(); });

// --- 9. what a result writes ----------------------------------------------
function results() {
  const valueHost = { kind: "value", address: "@Report@total", value: "$9", node: {} };
  check("result: a number keeps the old value's $ and gains separators", python.resultOf(valueHost, { kind: "number", value: 1215.6 }).text === "$1,215.6");
  const long = python.resultOf(valueHost, { kind: "text", text: "line one\nline two" }, 120);
  check("result: a text with a line break goes to aot.files as .md", long.file === "Report.total.md" && long.body === "line one\nline two\n");
  check("result: a short text is the value, its pipes bent", python.resultOf(valueHost, { kind: "text", text: "a|b" }).text === "a¦b");
  const pic = python.resultOf(valueHost, { kind: "image", ext: "png", base64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64") });
  check("result: a picture goes to aot.files, named for its address", pic.file === "Report.total.png" && pic.bytes.length === 4);
  check("result: a frame on an attribute is its summary", python.resultOf(valueHost, { kind: "frame", summary: "<DataFrame 1,204 rows × 4 cols>" }).text === "<DataFrame 1,204 rows × 4 cols>");
  let refused = null;
  try { python.resultOf({ kind: "concept", address: "@S", node: { name: "S" } }, { kind: "number", value: 3 }); } catch (e) { refused = e.message; }
  check("result: a Concept derivation must produce a table", /must produce a table/.test(refused));

  const escaped = python.outputStem("@../../etc/passwd");
  check("security: an output name can never leave aot.files", !/[\\/]/.test(escaped) && !escaped.startsWith("."));
  check("security: an output name holds only safe characters",
    ["@a/b@c", "@..@..", "@C:\\x", "@x\u0000y"].every((a) => /^[A-Za-z0-9 ._-]+$/.test(python.outputStem(a)) && !python.outputStem(a).startsWith(".")));

  // writing a value, a cell, a table
  const lines = [
    "Report",
    "    total: 1 =load()",
    "    Order|price|cost",
    "    A    |10   |7 =math.floor(@price*0.7)",
  ];
  const r = lint(lines.join("\n"), "t");
  const hosts = python.hostsOf(r.nodes, lines, "t");
  let out = python.writeValue(lines, hosts.find((h) => h.kind === "value"), "3,628,800");
  out = python.writeValue(out, hosts.find((h) => h.kind === "cell"), "8");
  check("write: a value lands in front of its derivation", out[1] === "    total: 3,628,800 =load()");
  check("write: a cell's value lands in front of its derivation", out[3] === "    A    |10   |8 =math.floor(@price*0.7)");

  const concept = [
    "Report",
    "    Sales =frame()",
    "        tax: 0.2",
    "        - Old",
    "            units: 1",
    "    After",
  ];
  const rc = lint(concept.join("\n"), "t");
  const node = rc.nodes.find((n) => n.name === "Sales");
  const grid = python.gridOf({ columns: ["month", "units"], rows: [["Q1", "2026-01", 1204], ["Q2", "2026-04", 1380]] }, "Sales");
  const created = python.writeGrid(concept, node, grid);
  // a Concept with an attribute of its own keeps its line: a table has no
  // line to hold the attribute
  check("write: a Concept carrying its own attribute keeps its line, the table beneath it (the merge form)", created.join("\n") === [
    "Report",
    "    Sales =frame()",
    "        Sales|month  |units",
    "        Q1   |2026-01|1,204",
    "        Q2   |2026-04|1,380",
    "        tax: 0.2",
    "    After",
  ].join("\n"));
  const rc2 = lint(created.join("\n"), "t");
  const again = python.writeGrid(created, rc2.nodes.find((n) => n.name === "Sales"),
    python.gridOf({ columns: ["month", "units"], rows: [["Q3", "2026-07", 9]] }, "Sales"));
  check("write: a second run replaces the table wholesale — typed rows go", again.join("\n") === [
    "Report",
    "    Sales =frame()",
    "        Sales|month  |units",
    "        Q3   |2026-07|9",
    "        tax: 0.2",
    "    After",
  ].join("\n"));
  check("write: the written table verifies", lint(again.join("\n"), "t").errors.length === 0);

  // the ordinary case: the table IS the Concept
  const plain = ["Report", "    Sales =frame()", "        - Old", "        ... more to come", "    After"];
  const two = [["Q1", "2026-01", 1204], ["Q2", "2026-04", 1380]];
  const standalone = python.writeGrid(plain, lint(plain.join("\n"), "t").nodes.find((n) => n.name === "Sales"),
    python.gridOf({ columns: ["month", "units"], rows: two }, "Sales"));
  check("write: the Concept's line becomes the table's header, derivation and all, its rows at its own indent", standalone.join("\n") === [
    "Report",
    "    Sales =frame()|month  |units",
    "    Q1            |2026-01|1,204",
    "    Q2            |2026-04|1,380",
    "        ... more to come",
    "    After",
  ].join("\n"));
  const rs = lint(standalone.join("\n"), "t");
  const sales = rs.nodes.find((n) => n.name === "Sales");
  check("write: the header parses as the Concept, its derivation off its name", rs.errors.length === 0 && sales.formula === "frame()"
    && sales.children.filter((c) => c.kind === KIND.INDIVIDUAL).map((c) => c.name).join() === "Q1,Q2");
  const hs = python.hostsOf(rs.nodes, standalone, "t");
  check("write: the derivation in the header is still the Concept's", hs.length === 1 && hs[0].address === "@Sales"
    && standalone[1].slice(hs[0].startCol, hs[0].endCol) === "=frame()");
  const rerun = python.writeGrid(standalone, sales, python.gridOf({ columns: ["month", "units"], rows: [["Q3", "2026-07", 9]] }, "Sales"));
  check("write: the next run replaces the table in place", rerun.slice(1, 4).join("\n") === [
    "    Sales =frame()|month  |units",
    "    Q3            |2026-07|9",
    "        ... more to come",
  ].join("\n"));
  const parkedHead = park.park(rerun, lint(rerun.join("\n"), "t").nodes, "t");
  check("park: a Concept's derivation comes off its table's first header cell", parkedHead.lines[1] === "    Sales|month  |units"
    && parkedHead.parked.length === 1 && parkedHead.parked[0].formula === "=frame()");
  const home = park.unpark(parkedHead.lines, lint(parkedHead.lines.join("\n"), "t").nodes, "t", parkedHead.parked);
  check("park: ...and goes back into it", home.lines[1] === "    Sales =frame()|month  |units" && !home.missing.length);

  const piped = ["Report", "    Flags =[{\"name\": \"x\", \"on\": True | False}]", "    After"];
  const pipedTable = python.writeGrid(piped,
    lint(piped.join("\n"), "t").nodes.find((n) => n.name === "Flags"), python.gridOf({ columns: ["on"], rows: [["x", "Yes"]] }, "Flags"));
  check("write: a derivation holding a pipe inside its brackets heads its table like any other",
    pipedTable[1] === "    Flags =[{\"name\": \"x\", \"on\": True | False}]|on" && /^    x +\|Yes$/.test(pipedTable[2]) && pipedTable.length === 4);
  const rp = lint(pipedTable.join("\n"), "t");
  check("write: ...and parses back as the Concept, its derivation whole, one column", rp.errors.length === 0
    && rp.nodes.find((n) => n.name === "Flags").formula === "[{\"name\": \"x\", \"on\": True | False}]"
    && rp.nodes.filter((n) => n.kind === KIND.ATTRIBUTE).map((n) => n.name).join() === "on");
  check("rows: a pipe inside Python still open is the Python's, never a divider",
    table.cells("Flags =[{\"on\": True | False}]|on").map((c) => c.text).join("¦") === "Flags =[{\"on\": True | False}]¦on"
    && table.colAt("Flags =[{\"on\": True | False}]|on", 22) === 0 && table.colAt("Flags =[{\"on\": True | False}]|on", 31) === 1);
  check("rows: a pipe outside every bracket divides, even in a derivation — wrap the Python to keep it",
    table.isRowText("Flags =a() | b()") && !table.isRowText("Flags =(a() | b())"));
  const oldLayout = ["Report", "    Sales =frame()", "        Sales|month  |units", "        Q1   |2026-01|1", "    After"];
  check("write: a table the old layout wrote becomes the header on its next run", python.writeGrid(oldLayout,
    lint(oldLayout.join("\n"), "t").nodes.find((n) => n.name === "Sales"), python.gridOf({ columns: ["month", "units"], rows: [["Q1", "2026-01", 2]] }, "Sales"))
    .join("\n") === ["Report", "    Sales =frame()|month  |units", "    Q1            |2026-01|2", "    After"].join("\n"));
  const neighbours = ["Report", "    Sales =frame()", "    Other|units", "    X    |1"];
  check("write: a table never runs into the one after it", python.writeGrid(neighbours,
    lint(neighbours.join("\n"), "t").nodes.find((n) => n.name === "Sales"), python.gridOf({ columns: ["units"], rows: [["Q1", 5]] }, "Sales"))
    .join("\n") === ["Report", "    Sales =frame()|units", "    Q1            |5", "", "    Other|units", "    X    |1"].join("\n"));
  check("rows: a finished derivation before the first pipe heads a table; an open one keeps the pipe",
    table.isRowText("Quarter =quarters()|units") && table.isRowText("Top =rows()[:1]|units")
    && !table.isRowText("Sales =df[df.a | df.b]") && !table.isRowText("x: =a|b"));

  realRuntime();
}

// --- 10. security: verify.js runs no Python --------------------------------
{
  const verify = fs.readFileSync(path.join(__dirname, "..", "verify.js"), "utf8");
  check("security: verify.js never reaches the Python session", !/require\(["']\.\/src\/python["']\)|Session|child_process/.test(verify));
  const runtime = fs.readFileSync(path.join(__dirname, "..", "src", "aot_runtime.py"), "utf8");
  check("security: the sidecar is imported by its path, never put on sys.path",
    /spec_from_file_location/.test(runtime) && !/sys\.path\.(insert|append)/.test(runtime));
  const ignore = fs.readFileSync(path.join(__dirname, "..", ".vscodeignore"), "utf8");
  check("package: the runtime ships and no bytecode does", /!src\/aot_runtime\.py/.test(ignore) && /\*\*\/__pycache__\/\*\*/.test(ignore));
}

// --- 11. the real runtime, when this machine has a Python -------------------
function realRuntime() {
  // the interpreter the editor would find: python3 first off Windows, where a
  // stock system (WSL's Ubuntu) has no plain `python`
  const interpreter = (process.platform === "win32" ? ["python"] : ["python3", "python"]).find((p) => {
    const probe = spawnSync(p, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 15000 });
    return probe.status === 0 && String(probe.stdout).trim() === "3";
  });
  if (!interpreter) {
    console.log("SKIP real runtime (no python on PATH)");
    return done();
  }
  const runtime = path.join(__dirname, "..", "src", "aot_runtime.py");
  const s = new python.Session(spawn, { python: interpreter, runtime, cwd: os.tmpdir(), timeoutMs: 30000 }).start();
  // a number travels as its text, and is read back here as the number it is
  const numbers = (v) => {
    if (Array.isArray(v)) return v.map(numbers);
    if (v && typeof v === "object") {
      if (v.$n !== undefined) return Number(v.$n);
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = numbers(x);
      if (v.kind === "number") out.value = Number(v.text);
      return out;
    }
    return v;
  };
  const ev = (code, targets, host) => s.request({ op: "eval", address: "@t@x", code, targets: targets || [], host: host || "value" })
    .then((r) => numbers(r.result), (e) => ({ error: e.message }));
  (async () => {
    const hello = await s.request({ op: "hello" });
    check("runtime: hello names the protocol, the interpreter and the libraries", hello.protocol === 1 && /^3\./.test(hello.python) && "pandas" in hello.libraries);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-py-"));
    fs.writeFileSync(path.join(dir, "os.py"), "raise SystemExit('shadowed')\n");
    fs.writeFileSync(path.join(dir, "t.py"), "import os\ndef twice(x):\n    return 2 * x\nroot = aot.root\n");
    const sidecarFile = path.join(dir, "t.py");
    const openWith = (approved) => s.request({ op: "open", root: "t", aotFiles: dir, tree: { kind: "Concept", name: "t", children: [] }, sidecar: sidecarFile, sidecarMtime: 1, approved })
      .then((r) => r, (e) => ({ error: e.message, consent: e.consent }));
    const unallowed = await openWith({});
    check("runtime: a sidecar not yet allowed is not loaded, and says so", unallowed.consent && unallowed.consent.path === sidecarFile);
    const sidecarSha = require("crypto").createHash("sha256").update(fs.readFileSync(sidecarFile)).digest("hex");
    const opened = await openWith({ [sidecarFile]: sidecarSha });
    check("runtime: the sidecar loads, and an os.py beside it shadows nothing", opened.sidecar && opened.functions.includes("twice"));
    check("runtime: arithmetic", (await ev("math.factorial(10)")).value === 3628800);
    check("runtime: a sidecar function", (await ev("twice(21)")).value === 42);
    check("runtime: values arrive typed — $1,204 is 1204 in dollars", (await ev("_aot_ref(0).value + 1", [{ kind: "value", text: "$1,204" }])).value === 1205);
    check("runtime: 2026-01 stays text (strict numbers)", (await ev("_aot_ref(0)", [{ kind: "value", text: "2026-01" }])).text === "2026-01");
    check("runtime: a date arrives as a date and leaves as yyyy-mm-dd", (await ev("_aot_ref(0) + timedelta(days=1)", [{ kind: "value", text: "2026-09-22" }])).text === "2026-09-23");
    check("runtime: a datetime with a time keeps it", (await ev("datetime(2026, 9, 22, 14, 30)")).text === "2026-09-22 14:30");
    check("runtime: Yes/No arrive as booleans and leave as Yes/No", (await ev("not _aot_ref(0)", [{ kind: "value", text: "No" }])).text === "Yes");
    check("runtime: NaN is an empty value", (await ev("float('nan')")).text === "");
    const printed = await s.request({ op: "eval", address: "@t@p", code: "print('hi') or 7", targets: [], host: "value" });
    check("runtime: a print is captured, never written into the protocol", printed.stdout === "hi\n" && printed.result.text === "7");
    check("runtime: exit() ends the expression, not the session", /asked Python to exit/.test((await ev("exit()")).error) && (await ev("1+1")).value === 2);
    const records = await ev("[{'name': 'Q1', 'total_units': 1204}, {'name': 'Q2', 'total_units': 5}]", [], "concept");
    check("runtime: records become a table — rows numbered 1, 2, 3, every key a column, written the language's way",
      records.kind === "frame" && records.columns.join() === "name,total units" && records.rows[0].join() === "1,Q1,1204" && records.rows[1][0] === "2");
    check("runtime: a live result is read back by the next derivation",
      (await ev("len(_aot_ref(0))", [{ kind: "object", address: "@t@x" }])).value === 2);
    {
      // written above the cell it reads, whose saved 1 is out of date
      const text = ["Est   |q", "pvc   |=@meters@q", "meters|1 =50+6"].join("\n");
      const lines = text.split("\n");
      const r = lint(text, "t");
      const hosts = python.hostsOf(r.nodes, lines, "t");
      const ctx = { lines, registry: table.mergeRegistries(derive.conceptRegistry(r.root, r.nodes)), rootName: "t", index: python.hostIndex(hosts) };
      const resolved = (a) => python.resolveHost(hosts.find((h) => h.address === a), ctx);
      const results = {};
      for (const address of python.orderDerivations(hosts, (a) => resolved(a).deps).order) {
        const { code, targets } = resolved(address);
        results[address] = (await s.request({ op: "eval", address, code, targets, host: "cell" })).result;
      }
      check("runtime: a cell naming a row of its own table reads the live result, never last run's value",
        results["@Est@q@pvc"].text === "56");
    }
    const named = await ev("aot.grid(['Q', 'n'], [['A', 1], ['B', 2]])", [], "concept");
    check("runtime: a grid Python names row by row says so, and keeps its names", named.named === true && named.rows[1][0] === "B");

    // a bare `=` line: tables by name, each written as a Concept, and each
    // read back live by the name the file writes it under
    const genOut = await s.request({
      op: "eval", address: "@=1", host: "generator", targets: [],
      code: "{'sales': [{'month': '2026-01', 'amount': 15000}], 'Region': aot.grid(['Region', 'code'], [['EU', 'eu']])}",
    }).then((r) => r.result, (e) => ({ error: e.message }));
    check("runtime: a bare = line's tables come back by name, each as a table",
      genOut.kind === "grids" && genOut.grids.map((g) => g.name).join() === "sales,Region"
      && genOut.grids[0].columns.join() === "month,amount" && genOut.grids[1].named === true);
    check("runtime: one of them is read back live by its name, as the file writes it",
      (await ev("len(_aot_ref(0))", [{ kind: "object", address: "@=1", key: "Sales" }])).value === 1);
    check("runtime: a name it did not write says so",
      /not one of the Concepts it wrote/.test((await ev("_aot_ref(0)", [{ kind: "object", address: "@=1", key: "Nope" }])).error));
    const notTables = await s.request({ op: "eval", address: "@=2", host: "generator", targets: [], code: "{'a': 42}" })
      .then((r) => r.result, (e) => ({ error: e.message }));
    check("runtime: a bare = line naming something that is no table says which", /'a' is .*not a table/.test(notTables.error || ""));
    const gen = (address, code) => s.request({ op: "eval", address, host: "generator", targets: [], code })
      .then((r) => r.result, (e) => ({ error: e.message }));
    const oneGrid = await gen("@=3", "aot.grid(['Fleet', 'van'], [['F1', 'V1'], ['F2', 'V2']])");
    check("runtime: a bare = line returning one aot.grid writes the Concept its header names",
      oneGrid.kind === "grids" && oneGrid.grids.map((g) => g.name).join() === "Fleet" && oneGrid.grids[0].rows.length === 2);
    const grids = await gen("@=4", "[aot.grid(['Fleet', 'van'], [['F1', 'V1']]), aot.grid(['Depot', 'city'], [['D1', 'Durban']])]");
    check("runtime: ...and a list of them, one Concept each", grids.kind === "grids" && grids.grids.map((g) => g.name).join() === "Fleet,Depot");
    check("runtime: a Concept an aot.grid wrote is read back as a table, a row per Example",
      (await ev("len(_aot_ref(0))", [{ kind: "object", address: "@=3", key: "fleet" }])).value === 2);
    const noTables = await gen("@=5", "42");
    check("runtime: a bare = line returning no tables at all comes back an object, which the editor refuses to write",
      noTables.kind === "object" && /produced <int/.test((() => {
        try { python.resultOf({ kind: "generator", address: "@=5" }, noTables); } catch (e) { return e.message; }
        return "";
      })()));

    // the constraints: every bound in one round trip
    const chk = (items) => s.request({ op: "checks", items }).then((r) => numbers(r.results));
    const [ok18, young, oneOf, notOneOf, defines, wrong, broken] = await chk([
      { code: "18", targets: [], rel: ">=", value: "30" },
      { code: "18", targets: [], rel: ">=", value: "15" },
      { code: "('draft', 'sent')", targets: [], rel: "==", value: "draft" },
      { code: "('draft', 'sent')", targets: [], rel: "==", value: "void" },
      { code: "_aot_ref(0) * 2", targets: [{ kind: "value", text: "1,204" }], rel: "==", value: "" },
      { code: "6", targets: [], rel: "==", value: "7" },
      { code: "1/0", targets: [], rel: "<", value: "1" },
    ]);
    check("runtime checks: a value within its bound holds, one outside it does not",
      ok18.holds === true && young.holds === false && young.bound === "18");
    check("runtime checks: a collection lists the allowed values, and defines nothing",
      oneOf.holds && !notOneOf.holds && !oneOf.define && /one of 'draft', 'sent'/.test(notOneOf.bound));
    check("runtime checks: a '==' naming one value defines it", defines.define && defines.define.value === 2408);
    check("runtime checks: ...and says whether the value already is it", wrong.define && wrong.holds === false);
    check("runtime checks: a bound that fails is its own error, not the batch's, and carries no traceback",
      broken.ok === false && /ZeroDivisionError/.test(broken.error) && !broken.traceback);
    check("runtime checks: dates compare as dates",
      (await chk([{ code: "date(2026, 1, 1)", targets: [], rel: ">=", value: "2026-03-01" }]))[0].holds === true);
    const hasPandas = !!hello.libraries.pandas;
    if (hasPandas) {
      const f = await ev("pd.DataFrame({'m': ['2026-01'], 'units': [1204]})", [], "concept");
      check("runtime: a DataFrame's rows are numbered, and its first column stays a column", f.rows[0].join() === "1,2026-01,1204" && f.columns.join() === "m,units");
      const g = await ev("pd.DataFrame({'units': [3, 4]}, index=pd.Index(['Q1', 'Q2'], name='quarter'))", [], "concept");
      check("runtime: an index that means something becomes the first column", g.columns.join() === "quarter,units" && g.rows[1].join() === "2,Q2,4");
      check("runtime: a DataFrame on an attribute is summarised", (await ev("pd.DataFrame({'a': range(1204), 'b': 0})")).summary === "<DataFrame 1,204 rows × 2 cols>");
    } else {
      check("runtime: without pandas, pd says how to install it", /pandas is not installed — python -m pip install pandas/.test((await ev("pd.DataFrame()")).error));
      console.log("SKIP pandas cases (pandas is not installed here)");
    }
    // the repository's own Python: any file, by its module name, once allowed
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "aot-repo-"));
    const w = (rel, text) => { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
    const helpers = w("aot.files/helpers.py", "def twice(x):\n    return 2 * x\n");
    const financePy = w("tools/finance.py", "import helpers\ndef revenue(units):\n    return helpers.twice(units) * 10\n");
    const pkgInit = w("pkg/__init__.py", "LABEL = 'pkg'\n");
    const pkgSub = w("pkg/sub.py", "def f():\n    return 'sub'\n");
    const nsMod = w("ns/deep/mod.py", "def g():\n    return 'ns'\n");
    const dupA = w("dup/a/same.py", "X = 1\n");
    const dupB = w("dup/b/same.py", "X = 2\n");
    const osPy = w("os.py", "raise SystemExit('shadowed os')\n");
    const spaced = w("tools/my helpers.py", "def hi():\n    return 'hi'\n");
    const pyFiles = [helpers, financePy, pkgInit, pkgSub, nsMod, dupA, dupB, osPy, spaced];
    const sha = (p) => require("crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    const allow = (...ps) => s.request({ op: "approve", files: Object.fromEntries(ps.map((p) => [p, sha(p)])) });
    await s.request({ op: "open", root: "t", repo, aotFiles: path.join(repo, "aot.files"), pyFiles, approved: {}, tree: { kind: "Concept", name: "t", children: [] } });
    const evr = (code) => s.request({ op: "eval", address: "@t@r", code, targets: [], host: "value" })
      .then((r) => ({ ok: r.result }), (e) => ({ error: e.message, consent: e.consent, file: e.file }));
    let got = await evr("finance.revenue(3)");
    check("repository: a file not yet allowed does not run, and the question names it by path and hash",
      got.consent && got.consent.path.endsWith(path.join("tools", "finance.py")) && got.consent.digest === sha(financePy));
    await allow(financePy);
    got = await evr("finance.revenue(3)");
    check("repository: a module it imports is asked about in its turn", got.consent && got.consent.path.endsWith("helpers.py"));
    await allow(helpers, pkgInit, pkgSub, nsMod, spaced);
    check("repository: found anywhere by its name, its own import found in aot.files", (await evr("finance.revenue(3)")).ok.text === "60");
    check("repository: a dotted path from the root", (await evr("tools.finance.revenue(1)")).ok.text === "20");
    check("repository: a package, its submodule imported as it is reached", (await evr("pkg.LABEL + pkg.sub.f()")).ok.text === "pkgsub");
    check("repository: a folder without __init__ is a package too", (await evr("ns.deep.mod.g()")).ok.text === "ns");
    check("repository: two files of one name — an error naming both, and the dotted path to write",
      /names 2 files.*dup\.a\.same/.test((await evr("same.X")).error));
    check("repository: the standard library wins — the repository's os.py never runs", (await evr("os.sep in '/\\\\'")).ok.text === "Yes");
    check("repository: any installed module is there by its name", (await evr("csv.QUOTE_ALL")).ok.text === "1");
    check("repository: aot.use loads a file by its path, a space and all", (await evr('aot.use("tools/my helpers.py").hi()')).ok.text === "hi");
    check("repository: aot.use refuses a file outside the repository", !!(await evr('aot.use("../outside.py")')).error);
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(helpers, "def twice(x):\n    return 3 * x\n");
    await s.request({ op: "open", root: "t", repo, aotFiles: path.join(repo, "aot.files"), pyFiles, approved: {}, tree: { kind: "Concept", name: "t", children: [] } });
    got = await evr("finance.revenue(3)");
    check("repository: a file changed on disk is asked about again", got.consent && got.consent.path.endsWith("helpers.py"));
    await allow(helpers);
    check("repository: ...and once allowed, runs as it is now", (await evr("finance.revenue(3)")).ok.text === "90");

    // the guards, in a session of their own: set at hello, before anything
    // of the repository's runs, and never lifted
    const gs = new python.Session(spawn, { python: interpreter, runtime, cwd: os.tmpdir(), timeoutMs: 30000 }).start();
    const gev = (code) => gs.request({ op: "eval", address: "@g@x", code, targets: [], host: "value" })
      .then((r) => ({ ok: numbers(r.result) }), (e) => ({ error: e.message }));
    const gh = await gs.request({ op: "hello", guards: { memoryMb: 512, subprocess: false, network: false, credentials: true } });
    check("guards: hello reports what holds",
      /at most 512 MB/.test(gh.guards.memory) && /refused/.test(gh.guards.subprocess) && /refused/.test(gh.guards.network) && /protected/.test(gh.guards.credentials));
    check("guards: another program is refused, and says which setting allows it",
      /may not start another program here \(aot\.python\.allowSubprocess is off\)/.test((await gev(`__import__("subprocess").run([__import__("sys").executable, "-c", "1"])`)).error || ""));
    if (process.platform === "win32") {
      // past Python's own hook, straight to Windows: the job object refuses
      // what the same call does unguarded
      const createProcess = [
        '(lambda c: (lambda k, si, pi: (si.__setitem__(0, 104), k.CreateProcessW(None, c.create_unicode_buffer("cmd.exe /c exit 0"),',
        ' None, None, False, 0x08000000, None, None, c.byref(si), c.byref(pi)))[1])',
        '(c.WinDLL("kernel32"), (c.c_uint32 * 26)(), (c.c_byte * 24)()))(__import__("ctypes"))',
      ].join("");
      const unguarded = await ev(createProcess);
      const raw = await gev(createProcess);
      check("guards: on Windows the operating system refuses a second process, whatever Python is told",
        unguarded && unguarded.value === 1 && raw.ok && raw.ok.value === 0);
    }
    check("guards: the network beyond this machine is refused",
      /may not reach 192\.0\.2\.1 here \(aot\.python\.allowNetwork is off\)/.test((await gev('__import__("socket").create_connection(("192.0.2.1", 9), 1)')).error || ""));
    check("guards: this machine's own loopback still works (a socketpair, as asyncio makes)",
      (await gev('(lambda p: [s.close() for s in p] and 1)(__import__("socket").socketpair())')).ok !== undefined);
    check("guards: the places credentials are kept are refused",
      /is where credentials are kept, and a derivation may not read it/.test((await gev('open(__import__("os").path.expanduser("~/.ssh/id_rsa")).read()')).error || "")
      && /is where credentials are kept/.test((await gev('__import__("os").listdir(__import__("os").path.expanduser("~/.aws"))')).error || ""));
    check("guards: an ordinary file still reads", (await gev(`len(open(${JSON.stringify(path.join(__dirname, "test-python.js"))}, encoding="utf-8").read()) > 0`)).ok.text === "Yes");
    check("guards: past the memory limit an allocation fails, and the session goes on",
      /MemoryError/.test((await gev("len(bytearray(900 * 1024 * 1024))")).error || "") && (await gev("1 + 1")).ok.value === 2);
    const loosened = await gs.request({ op: "hello", guards: { memoryMb: 0, subprocess: true, network: true, credentials: false } });
    check("guards: a later hello cannot loosen them",
      /refused/.test(loosened.guards.subprocess) && /may not start another program/.test((await gev('__import__("os").system("exit 0")')).error || ""));
    await gs.request({ op: "bye" });
    gs.kill();
    // which limit caps memory off Windows is decided apart from setting it,
    // so every platform's answer is checked here, whatever this machine is
    const caps = spawnSync(interpreter, ["-I", "-B", "-c", [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('aot_runtime', sys.argv[1])",
      "rt = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(rt)",
      "sys.__stdout__.write(json.dumps([rt._memory_cap(p) for p in ('linux', 'darwin', 'freebsd14')]))",
    ].join("\n"), runtime], { encoding: "utf8", timeout: 60000 });
    const capOf = (() => { try { return JSON.parse(caps.stdout); } catch { return []; } })();
    check("guards: off Windows memory is capped by its data size on Linux, by address space elsewhere, and hello says which",
      capOf.length === 3 && capOf[0].join() === "RLIMIT_DATA,a data-size limit"
      && capOf[1][0] === "RLIMIT_AS" && /which macOS does not enforce$/.test(capOf[1][1]) && capOf[2].join() === "RLIMIT_AS,an address-space limit");

    // a formula asking for input says so at once: stdin is the protocol's, and
    // waiting on it would hold the session until the timeout killed it
    const started = Date.now();
    const asked = await ev('input("name? ")');
    check("input(): says why straight away, and the session goes on",
      /put the value in a cell and reference it with @/.test(asked.error || "") && Date.now() - started < 5000 && s.alive);
    const piped = await ev('__import__("sys").stdin.read()');
    check("stdin: user code finds it empty, and the next request still arrives", piped.text === "" && (await ev("1 + 1")).value === 2);
    // a column named with a pipe bends, as a cell does, so every value stays
    // under its own column
    const piped2 = python.gridOf({ columns: ["a|b", "c"], rows: [["1", 1, 2]] }, "Sales");
    check("gridOf: a pipe in a column's name bends to a broken bar", piped2.header.join() === "Sales,a¦b,c" && table.isRowText(piped2.header.join("|")));

    // every digit, all the way from Python to the text the file holds
    const written = async (code) => {
      const r = await s.request({ op: "eval", address: "@t@n", code, targets: [], host: "value" }).then((a) => a.result, (e) => ({ error: e.message }));
      return r.error ? r : python.resultOf({ kind: "value", value: "", address: "@t@n" }, r, 120).text;
    };
    check("digits: a long integer is exact", (await written("12345678901234567")) === "12,345,678,901,234,567");
    check("digits: 2**70 is exact", (await written("2**70")) === "1,180,591,620,717,411,303,424");
    const huge = await written("10**5000");
    check("digits: 10**5000 is a number with all its digits", typeof huge === "string" && huge.replace(/,/g, "").length === 5001);
    check("digits: a repeating decimal keeps all it has", (await written("1/3")) === "0.3333333333333333");
    check("digits: nothing collapses to 0", (await written("1/250")) === "0.004" && (await written("1e-7")) === "0.0000001");
    check("digits: no scientific notation", (await written("1e22")) === "10,000,000,000,000,000,000,000");
    check("digits: a whole float has no point", (await written("6.0")) === "6");
    check("digits: a Decimal is exact", (await written('Decimal("1.10")')) === "1.10");
    const dfDigits = await s.request({ op: "eval", address: "@t@g", code: 'aot.grid(["N", "v"], [["a", 12345678901234567], ["b", 1/3]])', targets: [], host: "concept" }).then((a) => a.result);
    check("digits: a table's cells keep every digit too", python.gridOf(dfDigits, "N").rows.map((r) => r[1]).join("|") === "12,345,678,901,234,567|0.3333333333333333");
    // what a formula reads is its typed value: every digit reads back as itself
    check("digits: written and read back, a number is the same number", (await ev("_aot_ref(0)", [{ kind: "value", text: "12,345,678,901,234,567" }])).text === "12345678901234567");

    // the build stops on a file outside what the extension is
    {
      const guard = spawnSync(interpreter, ["-I", "-B", "-c", [
        "import importlib.util, json, sys",
        "spec = importlib.util.spec_from_file_location('install', sys.argv[1])",
        "m = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(m)",
        "print(json.dumps(m.strays(['README.md', 'src/a.js', 'node_modules/x/y.js', 'alpha.png', 'verify.js', '.claude/settings.local.json', 'smoke-tmp.js', 'alpha old.png', 'docs/a.md', ''])))",
      ].join("\n"), path.join(__dirname, "..", "install.py")], { encoding: "utf8", timeout: 60000 });
      const found = (() => { try { return JSON.parse(guard.stdout); } catch { return null; } })();
      check("package: install.py stops on a stray, and passes what the extension is",
        JSON.stringify(found) === JSON.stringify([".claude/settings.local.json", "alpha old.png", "docs/a.md", "smoke-tmp.js"]));
    }

    // the first calculation is right, whatever a formula reads: a defined column,
    // a whole row, a path through a Concept, a column of other formulas
    {
      const text = ["Item|qty|price =@qty*2|cost", "Bob|3||=@price*10", "Ann|4||=@price*10", "",
        "total: =@Item@price.sum()", "bobprice: =@Item@Bob@price", "bobrow: =@Item@Bob['price']", "costsum: =@Item@cost.sum()", "rows: =len(@Item)", ""].join("\n");
      const r = lint(text, "Model");
      const lines = text.split("\n");
      const hosts = python.calcHosts(r.nodes, lines, "Model");
      const ctx = { lines, registry: table.mergeRegistries(derive.conceptRegistry(r.root, r.nodes)), rootName: "Model", index: python.hostIndex(hosts, undefined, r.nodes, lines) };
      const resolved = new Map(hosts.map((h) => [h.address, python.resolveHost(h, ctx)]));
      const { order, cycles } = python.orderDerivations(hosts, (a) => resolved.get(a).deps);
      check("graph: everything a formula reads comes first", !cycles.length
        && order.indexOf("@Item@price@Bob") < order.indexOf("@Item@cost@Bob") && order.indexOf("@Item@price@Ann") < order.indexOf("@Model@total")
        && order.indexOf("@Item@cost@Ann") < order.indexOf("@Model@costsum") && order.indexOf("@Item@cost@Bob") < order.indexOf("@Model@rows"));
      const targets = [];
      const items = order.map((a) => {
        const h = hosts.find((x) => x.address === a);
        const refs = resolved.get(a).targets.map((t) => {
          if (!targets.includes(t)) targets.push(t);
          return targets.indexOf(t);
        });
        return { address: a, code: resolved.get(a).code, refs, host: h.defined ? "defined" : h.kind, value: h.value };
      });
      const answers = new Map();
      const done = await s.request({ op: "evalBatch", targets, items }, undefined, (m) => answers.set(items[m.k].address, m));
      const value = (a) => { const m = answers.get(a); return m && m.result ? Number(m.result.text) : `failed: ${m && m.error}`; };
      check("batch: one line of answer per formula, then the end of it", done.count === items.length && answers.size === items.length);
      check("first run: a defined column computes", value("@Item@price@Bob") === 6 && value("@Item@price@Ann") === 8);
      check("first run: a cell reading a defined column reads what it computed", value("@Item@cost@Bob") === 60 && value("@Item@cost@Ann") === 80);
      check("first run: a total of a defined column is right, not 0", value("@Model@total") === 14);
      check("first run: a total of a column of formulas is right", value("@Model@costsum") === 140);
      check("first run: a path to one cell reads it", value("@Model@bobprice") === 6);
      check("first run: a whole row reads its computed cells", value("@Model@bobrow") === 6);
      check("first run: a whole table reads", value("@Model@rows") === 2);
    }

    // totals use every digit, however the cell is written
    {
      const text = ["T|v", "A|=1/3", "B|=1/3", "C|=1/3", "", "total: =@T@v.sum()", ""].join("\n");
      const r = lint(text, "Model");
      const lines = text.split("\n");
      const hosts = python.calcHosts(r.nodes, lines, "Model");
      const ctx = { lines, registry: table.mergeRegistries(derive.conceptRegistry(r.root, r.nodes)), rootName: "Model", index: python.hostIndex(hosts, undefined, r.nodes, lines) };
      const resolved = new Map(hosts.map((h) => [h.address, python.resolveHost(h, ctx)]));
      const { order } = python.orderDerivations(hosts, (a) => resolved.get(a).deps);
      const targets = [];
      const items = order.map((a) => ({
        address: a, code: resolved.get(a).code, host: "value",
        refs: resolved.get(a).targets.map((t) => { if (!targets.includes(t)) targets.push(t); return targets.indexOf(t); }),
      }));
      const answers = new Map();
      await s.request({ op: "evalBatch", targets, items }, undefined, (m) => answers.set(items[m.k].address, m));
      check("totals: three =1/3 cells total 1, not 0.99", answers.get("@Model@total").result.text === "1");
    }

    // a failure leaves nothing behind for what reads it to compute from
    await s.request({ op: "eval", address: "@t@was", code: "5", targets: [], host: "value" });
    await s.request({ op: "eval", address: "@t@was", code: "1/0", targets: [], host: "value" }).catch(() => {});
    const stale = await ev("_aot_ref(0)", [{ kind: "object", address: "@t@was" }]);
    check("failure: a formula that failed leaves no older result to read", /has not been computed/.test(stale.error || ""));
    // ...and what reads a failure does not start: no part of its code runs
    {
      const said = new Map();
      await s.request({
        op: "evalBatch",
        targets: [{ kind: "object", address: "@t@failing" }],
        items: [
          { address: "@t@failing", code: "1/0", refs: [], host: "value" },
          { address: "@t@reader", code: "print('it ran') or _aot_ref(0)", refs: [0], host: "value" },
        ],
      }, undefined, (m) => said.set(m.k, m));
      check("failure: what reads a failed formula does not run at all", said.get(1).ok === false && !said.get(1).stdout && /has not been computed/.test(said.get(1).error));
    }
    // 5,000 formulas: planned in moments, run a batch at a time, and after one cell
    // changes only what reads it is out of date
    {
      const planOf = (text) => {
        const r = lint(text, "Model");
        const lines = text.split("\n");
        const hosts = python.calcHosts(r.nodes, lines, "Model");
        const ctx = { lines, registry: table.mergeRegistries(derive.conceptRegistry(r.root, r.nodes)), rootName: "Model", index: python.hostIndex(hosts, undefined, r.nodes, lines) };
        const resolved = new Map(hosts.map((h) => [h.address, python.resolveHost(h, ctx)]));
        const { order, cycles } = python.orderDerivations(hosts, (a) => resolved.get(a).deps);
        const hashes = new Map();
        const byAddress = new Map(hosts.map((h) => [h.address, h]));
        for (const a of order) hashes.set(a, python.hostHash(byAddress.get(a), resolved.get(a), "", hashes));
        return { hosts, resolved, order, cycles, hashes };
      };
      const rows = Array.from({ length: 5000 }, (_, k) => `R${k}|${k}|=@a*2`);
      const text = ["Big|a|b", ...rows, "", "total: =@Big@b.sum()", ""].join("\n");
      const planStart = Date.now();
      const plan = planOf(text);
      const planMs = Date.now() - planStart;
      check(`scale: a plan of 5,001 formulas is linear work (${planMs} ms)`, plan.order.length === 5001 && !plan.cycles.length && planMs < 8000);
      const runStart = Date.now();
      const answered = new Map();
      for (let at = 0; at < plan.order.length; at += 64) {
        const addresses = plan.order.slice(at, at + 64);
        const targets = [];
        const seen = new Map();
        const items = addresses.map((a) => {
          const r = plan.resolved.get(a);
          const refs = r.targets.map((t) => {
            if (!seen.has(t)) { seen.set(t, targets.length); targets.push(t); }
            return seen.get(t);
          });
          return { address: a, code: r.code, refs, host: "value" };
        });
        await s.request({ op: "evalBatch", targets, items }, undefined, (m) => answered.set(addresses[m.k], m));
      }
      const runMs = Date.now() - runStart;
      const expected = String(2 * (4999 * 5000) / 2);
      check(`scale: 5,001 formulas run a batch at a time (${runMs} ms), and the total reads every one`,
        answered.size === 5001 && answered.get("@Model@total").result.text === expected);
      const changed = text.replace("R17|17|", "R17|18|");
      const again = planOf(changed);
      const stale = again.order.filter((a) => again.hashes.get(a) !== plan.hashes.get(a)).sort();
      check("scale: one cell changing puts out of date only what reads it", stale.join() === "@Big@b@R17,@Model@total");
    }
    // a definition naming what a value may be writes nothing, and the cell's value stands
    const allowed = new Map();
    await s.request({ op: "evalBatch", targets: [], items: [{ address: "@t@status", code: '("draft", "sent")', refs: [], host: "defined", value: "sent" }] }, undefined, (m) => allowed.set("a", m));
    check("definition: a collection is what a value may be, and writes nothing", allowed.get("a").many === true && !allowed.get("a").result);
    check("definition: ...and what reads it reads the cell's own value", (await ev("_aot_ref(0)", [{ kind: "object", address: "@t@status" }])).text === "sent");
    // and a table read by many formulas of one batch is built once, each with a copy
    const sharedAnswers = new Map();
    await s.request({
      op: "evalBatch",
      targets: [{ kind: "column", name: "n", index: ["a", "b"], values: ["1", "2"] }],
      items: [
        { address: "@t@s1", code: "_aot_ref(0).sum()", refs: [0], host: "value" },
        { address: "@t@s2", code: "_aot_ref(0).sum()", refs: [0], host: "value" },
      ],
    }, undefined, (m) => sharedAnswers.set(m.k, m));
    check("batch: a shared target reads the same for each", sharedAnswers.get(0).result.text === "3" && sharedAnswers.get(1).result.text === "3");
    // the limit is on one formula: a long batch of quick ones outlasts it, and one hung formula does not
    {
      const q = new python.Session(spawn, { python: interpreter, runtime, cwd: os.tmpdir(), timeoutMs: 1000 }).start();
      await q.request({ op: "hello" }, 30000);
      const quick = Array.from({ length: 6 }, (_, k) => ({ address: `@q@${k}`, code: '__import__("time").sleep(0.3) or 1', refs: [], host: "value" }));
      const heard = [];
      const long = await q.request({ op: "evalBatch", targets: [], items: quick }, undefined, (m) => heard.push(m.k)).then((r) => r, (e) => ({ error: e.message }));
      check("batch: the limit restarts with each formula, so a long batch of quick ones finishes", long.count === 6 && heard.length === 6);
      const hung = await q.request({ op: "evalBatch", targets: [], items: [{ address: "@q@h", code: '__import__("time").sleep(30)', refs: [], host: "value" }] }).then((r) => r, (e) => ({ error: e.message }));
      check("batch: one hung formula is stopped at the limit", /timed out after 1 s/.test(hung.error || "") && !q.alive);
      q.kill();
    }
    // no pandas: a column still totals
    {
      const fallback = spawnSync(interpreter, ["-I", "-B", "-c", [
        "import importlib.util, json, sys",
        "spec = importlib.util.spec_from_file_location('aot_runtime', sys.argv[1])",
        "rt = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(rt)",
        "c = rt._Column([1, 2, None, 3.5])",
        "sys.__stdout__.write(json.dumps([c.sum(), c.mean(), c.min(), c.max(), c.count(), rt._Column([]).sum(), rt._Column([]).mean()]))",
      ].join("\n"), runtime], { encoding: "utf8", timeout: 60000 });
      const got = (() => { try { return JSON.parse(fallback.stdout); } catch { return []; } })();
      check("no pandas: a column still sums, averages and counts", got.join() === "6.5,2.1666666666666665,1,3.5,3,0,");
    }

    await s.request({ op: "bye" });
    fs.rmSync(dir, { recursive: true, force: true });
    setTimeout(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* the process lets go late */ } }, 300);
  })().catch((e) => { console.log("FAIL runtime block threw — " + e.message); failures++; })
    .finally(() => { s.kill(); setTimeout(done, 400); });
}

function done() {
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
