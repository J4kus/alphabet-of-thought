// Numbers as an analyst writes them, and units of measure: `30%` is 0.3, `€100` is a
// number, `n/a` × 2 is an error, and `120 km / 2 h` is `60 km/h`. A column takes its
// unit through its normal alias, `distance (km)`, from a built-in hierarchy.
//
// Plain Node script, no framework — run with: node out/test-units.js
// The formula engine is the real one, skipped where this machine has no Python.

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { lint, KIND } = require("../src/linter");
const python = require("../src/python");
const table = require("../src/table");
const derive = require("../src/derive");
const units = require("../src/units");
const csvsync = require("../src/csvsync");
const { readsAsExpression } = require("../src/pyshape");
const { unitOf, unitNamed, unitsFromTree } = require("../src/crosslinks");
const gates = require("../src/gates");

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures++;
}

// --- 1. the built-in hierarchy ---------------------------------------------------
check("units: km is built in, in the hierarchy", JSON.stringify(units.pathOf("km")) === JSON.stringify(["Unit", "Length", "km"]));
check("units: a long name finds the same unit", units.builtIn("kilometres").name === "km" && units.builtIn("miles").kind === "Length");
check("units: at three letters case is aside", units.builtIn("Hours").name === "h" && units.builtIn("KWH").name === "kWh" && units.builtIn("zar").name === "R");
check("units: under three it is not, so M is never m", units.builtIn("M") === null && units.builtIn("m").name === "m" && units.builtIn("S") === null);
check("units: currencies are there", ["$", "€", "£", "¥", "R", "USD", "EUR", "ZAR"].every((w) => units.builtIn(w).kind === "Currency"));
check("units: a compound reads word by word", JSON.stringify(units.wordsOf("kg*m/s^2")) === JSON.stringify(["kg", "m", "s"]) && JSON.stringify(units.wordsOf("m²")) === JSON.stringify(["m"]));
check("units: isUnit wants one word it knows", units.isUnit("km/h") && units.isUnit("$/client") && !units.isUnit("and/or") && !units.isUnit("clients") && !units.isUnit("Main Street"));
check("units: a bare digit is a power only on a unit it knows", !!units.wordsOf("m2") && units.wordsOf("CO2") === null);
{
  const seen = new Map();
  const dupes = [];
  for (const [kind, entry] of Object.entries(units.TABLE)) {
    for (const [, ...names] of entry.units) for (const n of names) {
      if (seen.has(n)) dupes.push(`${n}: ${seen.get(n)} and ${kind}`);
      seen.set(n, kind);
    }
  }
  check("units: one word names one unit", dupes.length === 0, dupes);
}

// --- 2. the alias types the attribute ----------------------------------------------
{
  const text = [
    "Trip|distance (km)|time (h)|note (remark)|rate (%)",
    "A   |120          |1.5     |fine         |5",
    "Leg",
    "    length (m)",
    "    - One",
    "        length: 20",
    "        width: 3",
    "    - Two",
    "        length (ft): 5",
  ].join("\n");
  const { nodes, errors } = lint(text, "T");
  const named = (n, k) => nodes.find((x) => x.name === n && (k === undefined || x.kind === k));
  check("alias: the parser needs nothing new", !errors.length && named("distance", KIND.ATTRIBUTE).alias === "km");
  check("alias: a table's column is in its unit", unitOf(named("distance", KIND.DEFAULT)) === "km");
  check("alias: an alias naming no unit is only another name", unitOf(named("note", KIND.DEFAULT)) === null);
  check("alias: percent", unitOf(named("rate", KIND.DEFAULT)) === "%");
  const twenty = nodes.find((x) => x.name === "length" && x.value === "20");
  check("alias: a line-form value reads the declaration above", unitOf(twenty) === "m");
  check("alias: nothing above, no unit", unitOf(named("width", KIND.DEFAULT)) === null);
  const five = nodes.find((x) => x.name === "length" && x.value === "5");
  check("alias: its own alias wins", unitOf(five) === "ft");
}
{
  const own = lint(["Hour", "    - Morning", "Slot|start (hour)", "A|Morning"].join("\n"), "T");
  check("alias: the file's own Concept wins: this is no unit", unitOf(own.nodes.find((n) => n.name === "start" && n.kind === KIND.DEFAULT)) === null);
  const mine = lint(["Unit", "    FTE", "    Seat", "Team|size (fte)", "A|3"].join("\n"), "T");
  check("alias: a Concept filed under Unit is a unit of the file's own", unitOf(mine.nodes.find((n) => n.name === "size" && n.kind === KIND.DEFAULT)) === "fte");
  check("alias: unitNamed reads the same", unitNamed("km", mine.root) === "km" && unitNamed("nonsense", mine.root) === null);
}

// --- 3. reading and writing a number -----------------------------------------------
check("withUnit: a plain number takes the column's", table.withUnit("120", "km") === "120 km" && table.withUnit("100", "$") === "$100" && table.withUnit("30", "%") === "30%" && table.withUnit("-5", "$") === "-$5" && table.withUnit("10", "$/kg") === "$10/kg" && table.withUnit("(5)", "$") === "($5)");
check("withUnit: its own unit, or no number, stays", table.withUnit("75 mi", "km") === "75 mi" && table.withUnit("n/a", "km") === "n/a" && table.withUnit("", "km") === "" && table.withUnit("5", null) === "5");
check("write: in the unit sent", table.formatNumberText("70000", "$100", "$") === "$70,000" && table.formatNumberText("60", "", "km/h") === "60 km/h" && table.formatNumberText("70", "", "%") === "70%" && table.formatNumberText("10", "", "$/kg") === "$10/kg");
check("write: no unit sent is no unit", table.formatNumberText("5", "3 km", "") === "5");
check("write: nothing said, the cell's stands", table.formatNumberText("1500", "$9") === "$1,500" && table.formatNumberText("5", "3 km") === "5 km");
check("write: a negative, and a cell that brackets one", table.formatNumberText("-5", "", "$") === "-$5" && table.formatNumberText("-1000", "(500)", "") === "(1,000)" && table.formatNumberText("1000", "(500)", "") === "1,000");
check("write: glued stays glued, the cell's spelling stays", table.formatNumberText("7", "5km", "km") === "7km" && table.formatNumberText("7", "5 kilometres", "kilometres") === "7 kilometres");
check("short: a unit stays behind", table.shortNumber("3.3333333333333335 km/h") === "3.3̅ km/h" && table.shortNumber("0.30000000000000004 km") === "0.3 km" && table.shortNumber("33.33333333333333%") === "33.3̅%");
check("short: a currency stays in front, brackets around", table.shortNumber("€0.363466") === "€0.363..." && table.shortNumber("R1,234.56789") === "R1,234.567..." && table.shortNumber("(0.3333333333333333)") === "(0.3̅)");
check("short: nothing to shorten, nothing replaced", table.shortNumber("120 km") === null && table.shortNumber("3 Main Street") === null && table.shortNumber("0.5%") === null);
check("value: currencies, brackets and units have a number", table.numericValue("€1,200") === 1200 && table.numericValue("R1,204") === 1204 && table.numericValue("(1,000)") === -1000 && table.numericValue("120 km") === 120 && isNaN(table.numericValue("Rabbit")));
check("form: what a cell says", table.writtenForm("$10/kg").unit === "$/kg" && table.writtenForm("30%").unit === "%" && table.writtenForm("120 km").unit === "km" && table.writtenForm("5").number && !table.writtenForm("n/a").number && !table.writtenForm("2026-01-31").number && !table.writtenForm("12 Monkeys and").number);

// --- 4. literals in formulas ---------------------------------------------------------
{
  const lit = (s, refs) => python.quantityLiterals(s, refs).map((q) => s.slice(q.start, q.start + q.length));
  const same = (s, want, refs) => check(`literal: ${s}`, JSON.stringify(lit(s, refs)) === JSON.stringify(want), lit(s, refs));
  same("5 km", ["5 km"]);
  same("$5,000", ["$5,000"]);
  same("(1-30%)*2", ["30%"]);
  same("R500+1", ["R500"]);
  same("$5/kg*2", ["$5/kg"]);
  same("1,000 km", ["1,000 km"]);
  same("5 km/h", ["5 km/h"]);
  same("5 km / rate", ["5 km"]);
  same("[5 km, 6 km]", ["5 km", "6 km"]);
  same("3 m²", ["3 m²"]);
  same("7 % 3", []);
  same("7%3", []);
  same("5 if x else 6", []);
  same("f(1,000)", []);
  same("\"5 km\"", []);
  same("1e5", []);
  same("0x10", []);
  same("x.R5", []);
  same("2 # 5 km", []);
  check("literal: a reference is skipped", JSON.stringify(lit("@a + 5 km", [{ start: 0, length: 2 }])) === JSON.stringify(["5 km"]));
}
check("bound: a number with its unit reads as a bound", ["500 km", "$5,000", "30%", "40 km/h"].every(readsAsExpression) && !readsAsExpression("none noted") && !readsAsExpression("18 years old"));

// --- 5. the CSV mirror ----------------------------------------------------------------
{
  const text = ["Trip|distance (km)|price ($)|note", "A   |120          |5        |x", "B   |75 mi        |6        |y"].join("\n");
  const { root, nodes } = lint(text, "T");
  const grid = derive.mirrorGrids(root, nodes).find((g) => g.name === "Trip");
  check("csv: the heading says the unit, the cells stay plain numbers",
    JSON.stringify(grid.header) === JSON.stringify(["Trip", "distance (km)", "price ($)", "note"])
    && JSON.stringify(grid.rows[0]) === JSON.stringify(["A", "120", "5", "x"]) && grid.rows[1][1] === "75 mi", grid);
  const aot = [grid.header, ...grid.rows];
  check("csv: says the same to itself", csvsync.saysTheSame(aot.map((r) => r.slice()), aot));
  const edited = [["Trip", "distance", "price ($)", "note"], ["A", "130", "5", "x"], ["B", "75 mi", "6", "y"]];
  const plan = csvsync.csvOverrides(edited, aot);
  check("csv: a column is its name, whatever its heading kept", plan.fold && plan.fold[0].includes("distance (km)") && plan.fold.some((r) => r[0] === "A" && r.includes("130")), plan);
  const ops = derive.updateScope(text.split("\n"), root, nodes, grid.node, plan.fold[0], plan.fold.slice(1), "T", {});
  const block = ops.find((o) => o.type === "block");
  check("csv: folded back, the cell is the number and the header keeps the unit", block && block.block.join("\n").includes("|130") && block.block[0].includes("distance (km)"), ops);
  check("csv: a spreadsheet's 15 digits are the same number, percent or currency", csvsync.saysTheSame([["T", "a"], ["x", "€0.333333333333333"]], [["T", "a"], ["x", "€0.3333333333333333"]]));
}

// --- 6. the flip keeps it ---------------------------------------------------------------
{
  const text = ["Trip|distance (km)", "A   |120", "B   |7"].join("\n");
  const { root, nodes } = lint(text, "T");
  const trip = nodes.find((n) => n.name === "Trip");
  const flipped = derive.flipForm(text.split("\n"), trip, "T");
  const lines = flipped.block.join("\n");
  check("flip: to lines, the alias on the declaration and each value", /distance \(km\)/.test(lines), lines);
  const again = lint(lines, "T");
  const values = again.nodes.filter((n) => n.name === "distance" && n.kind === KIND.DEFAULT);
  check("flip: and each value still in km", values.length === 2 && values.every((v) => unitOf(v) === "km"), values.map((v) => v.alias));
}

// --- 7. a repository's own units ---------------------------------------------------------
// Rows of a kind under a Concept called Unit: each Example a unit, `factor` its
// worth in the kind's base, `format` where the number goes.
const OWN = [
  "Unit",
  "    Money|factor|format",
  "    CHF  |1     |CHF #",
  "    Rappen|0.01 |# Rp",
  "        measures: worth",
  "",
  "    Effort|factor",
  "    FTE   |1",
  "    PD    |1/220",
  "        measures: work",
  "",
  "    Length|factor",
  "    league|4828",
  "        measures: distance",
  "",
  "    Seating|format",
  "    seat   |# seats",
  "        measures: places",
];
{
  const { root, nodes, errors, warnings } = lint(OWN.join("\n"), "T");
  check("own: rows of a kind lint clean once each kind says what it measures", !errors.length && !warnings.length, [...errors, ...warnings].map((e) => e.message));
  const list = unitsFromTree(root, nodes);
  check("own: each row is a unit of the kind above it",
    JSON.stringify(list.map((u) => [u.name, u.kind, u.factor, u.format])) === JSON.stringify([
      ["CHF", "Money", "1", "CHF #"], ["Rappen", "Money", "0.01", "# Rp"], ["FTE", "Effort", "1", ""], ["PD", "Effort", "1/220", ""],
      ["league", "Length", "4828", ""], ["seat", "Seating", "", "# seats"]]), list);
  check("own: read once per parse", unitsFromTree(root, nodes) === list);

  const same = lint(["Unit", "    Money|factor|format", "    CHF|1|CHF #", "", "    Effort|factor|format", "    FTE|1|# FTE"].join("\n"), "T");
  check("own: two kinds saying nothing apart are told so, as any two kinds are",
    same.errors.some((e) => /^give one a differentia, or merge them — 'Effort' and 'Money' carry the same definition/.test(e.message)), same.errors.map((e) => e.message));
  const spaced = lint(["Unit", "    Effort|factor|format", "    FTE|1|# FTE", "    FTE day|1/220|# FTE days"].join("\n"), "T");
  check("own: a unit's name is one word, or no value could name it",
    spaced.errors.some((e) => e.line === 4 && /^name the unit in one word, as in 'FTEday' — a value's unit is the one word after its number, so '5 FTE day' would read as text$/.test(e.message)), spaced.errors.map((e) => e.message));
  check("own: and so is the mark its format writes behind the number",
    spaced.errors.some((e) => e.line === 4 && /^write the mark behind the number as one word, as in '# FTEdays' — /.test(e.message)) && spaced.errors.length === 2, spaced.errors.map((e) => e.message));
  const lone = lint(["Unit", "    Effort|factor", "    FTE|1", "", "Animal", "    Dog", "        - Rex"].join("\n"), "T");
  check("own: one kind of the repository's own is enough, the built-in kinds are its siblings",
    !lone.warnings.some((w) => w.loneSubtype && w.loneSubtype.concept === "Unit") && lone.warnings.some((w) => w.loneSubtype && w.loneSubtype.concept === "Animal"), lone.warnings.map((w) => w.message));
  const bad = lint(["Unit", "    Money|factor|format", "    CHF|ten|CHF"].join("\n"), "T");
  check("own: a factor that is no number is an error, and says so",
    bad.errors.some((e) => /^write the factor as a plain number, as in 'factor: 1000' — the factor of unit 'CHF' is 'ten'/.test(e.message)), bad.errors.map((e) => e.message));
  check("own: a format with no # is an error, and says so",
    bad.errors.some((e) => /^put a '#' where the number goes, as in 'CHF #' or '# km' — the format of unit 'CHF' is 'CHF'/.test(e.message)), bad.errors.map((e) => e.message));
  const fine = lint(["Unit", "    Money|factor", "    Rappen|1,000", "    Half|1/2", "    Tenth|0.1"].join("\n"), "T");
  check("own: a factor may be whole, grouped, a fraction or a decimal", !fine.errors.length, fine.errors.map((e) => e.message));

  check("format: # is the number, the text around it how it is written",
    JSON.stringify(units.parseFormat("CHF #", "CHF")) === JSON.stringify({ prefix: "CHF", prefixSpace: true, suffix: "", suffixSpace: false, decimals: null })
    && JSON.stringify(units.parseFormat("R#.00", "R")) === JSON.stringify({ prefix: "R", prefixSpace: false, suffix: "", suffixSpace: false, decimals: 2 })
    && JSON.stringify(units.parseFormat("#x", "x")) === JSON.stringify({ prefix: "", prefixSpace: false, suffix: "x", suffixSpace: false, decimals: null }));
  check("format: none is the number and the unit's name", JSON.stringify(units.parseFormat("", "FTE")) === JSON.stringify({ prefix: "", prefixSpace: false, suffix: "FTE", suffixSpace: true, decimals: null }));

  const before = units.unitsGeneration();
  units.defineUnits(list);
  const after = units.unitsGeneration();
  units.defineUnits(list.map((u) => ({ ...u })));
  check("define: the same units handed again rebuild nothing", after === before + 1 && units.unitsGeneration() === after);
  check("define: a unit of the repository's own is a unit", units.isUnit("FTE") && units.isUnit("Rappen") && units.isUnit("PD") && units.isUnit("seat") && units.isUnit("CHF/PD"));
  check("define: a format's mark names the unit too", units.builtIn("Rp").name === "Rappen" && units.builtIn("seats").name === "seat");
  check("define: at three letters case is aside, as for the built-in ones", units.builtIn("rappen").name === "Rappen" && units.builtIn("fte").name === "FTE" && units.builtIn("pd") === null && units.builtIn("rp") === null);
  {
    const lit = (s) => python.quantityLiterals(s, []).map((q) => s.slice(q.start, q.start + q.length));
    check("literal: a mark of the repository's own, a space from its number or glued",
      JSON.stringify(lit("@a + CHF 5")) === JSON.stringify(["CHF 5"]) && JSON.stringify(lit("CHF1,200.50*2")) === JSON.stringify(["CHF1,200.50"]) && JSON.stringify(lit("CHF 5/PD")) === JSON.stringify(["CHF 5/PD"]), [lit("@a + CHF 5"), lit("CHF1,200.50*2"), lit("CHF 5/PD")]);
    check("literal: never the end of a name, nor a name itself", JSON.stringify(lit("xCHF 5")) === "[]" && JSON.stringify(lit("x.CHF 5")) === "[]" && JSON.stringify(lit("CHF5x")) === "[]" && JSON.stringify(lit("CHF * 5")) === "[]", [lit("xCHF 5"), lit("x.CHF 5"), lit("CHF5x"), lit("CHF * 5")]);
    check("literal: a mark behind reads as any unit does", JSON.stringify(lit("@a + 50 Rp")) === JSON.stringify(["50 Rp"]));
    check("bound: a number behind the repository's mark reads as a bound, so 'price <=CHF 500' is a rule",
      readsAsExpression("CHF 500") && readsAsExpression("@cap - CHF 5") && !readsAsExpression("CHF francs") && !readsAsExpression("x CHF 5"));
  }
  check("define: a word the repository writes wins over the built-in one", units.builtIn("CHF").kind === "Money" && units.builtIn("CHF").own);
  check("define: the built-in ones stay", units.builtIn("km").kind === "Length" && units.isUnit("$"));
  check("define: the marks in front of a number, longest first", JSON.stringify(units.prefixes()) === JSON.stringify(["CHF"]));
  check("describe: worth in the kind's base", units.describe("Rappen") === "Unit ▸ Money ▸ Rappen, written in this repository. 1 Rappen = 0.01 CHF.", units.describe("Rappen"));
  check("describe: a kind Alpha knows has its base", units.describe("league") === "Unit ▸ Length ▸ league, written in this repository. 1 league = 4828 m.", units.describe("league"));
  check("describe: no factor converts to nothing", units.describe("seat") === "Unit ▸ Seating ▸ seat, written in this repository. It converts to no other unit.", units.describe("seat"));
  check("describe: the base itself", units.describe("CHF") === "Unit ▸ Money ▸ CHF, written in this repository.", units.describe("CHF"));

  check("value: a mark in front is read as the number's", table.numericValue("CHF 1,200") === 1200 && table.numericValue("CHF1,200") === 1200 && table.numericValue("-CHF 5") === -5);
  check("value: a mark behind", table.numericValue("120 Rp") === 120 && table.writtenForm("120 Rp").unit === "Rp");
  check("form: a mark in front is the unit", table.writtenForm("CHF 1,200").unit === "CHF" && table.writtenForm("CHF 1,200").number);
  check("write: as the format says", table.formatNumberText("1200.5", "", "CHF") === "CHF 1,200.5" && table.withUnit("5", "Rappen") === "5 Rp", [table.formatNumberText("1200.5", "", "CHF"), table.withUnit("5", "Rappen")]);
  check("write: a cell's mark stays in front", table.formatNumberText("1200", "CHF 5") === "CHF 1,200", table.formatNumberText("1200", "CHF 5"));
  check("short: a mark stays in front", table.shortNumber("CHF 0.3333333333") === "CHF 0.3̅" || /^CHF 0\.3/.test(table.shortNumber("CHF 0.3333333333")), table.shortNumber("CHF 0.3333333333"));
  units.defineUnits([{ name: "CHF", kind: "Money", factor: "1", format: "CHF #.00" }]);
  check("write: .00 fixes the decimals", table.formatNumberText("1200.5", "", "CHF") === "CHF 1,200.50" && table.formatNumberText("3", "", "CHF") === "CHF 3.00", [table.formatNumberText("1200.5", "", "CHF"), table.formatNumberText("3", "", "CHF")]);

  units.defineUnits([]);
  check("define: none handed back, none left", units.builtIn("Rappen") === null && units.builtIn("CHF").kind === "Currency" && isNaN(table.numericValue("CHF 1,200")) && !units.isUnit("FTE") && !readsAsExpression("CHF 500"));

  // the command line reads every file's before it judges any, as the editor does
  const defined = gates.defineUnitsFrom([{ text: "Notes\n    - A", rootName: "Notes" }, { text: OWN.join("\n"), rootName: "Units" }]);
  check("define: the command line reads them off every file", defined.length === 6 && units.builtIn("Rappen").kind === "Money"
    && JSON.stringify(defined.find((u) => u.name === "CHF")) === JSON.stringify({ name: "CHF", kind: "Money", factor: "1", prefix: "CHF", suffix: "", decimals: null }), defined);
  units.defineUnits([]);
}

// --- 8. the formula engine --------------------------------------------------------------
function pythonHere() {
  const interpreter = (process.platform === "win32" ? ["python"] : ["python3", "python"]).find((p) => {
    const r = spawnSync(p, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 15000 });
    return r.status === 0 && String(r.stdout).trim() === "3";
  });
  if (!interpreter) return null;
  const pandas = spawnSync(interpreter, ["-c", "import pandas"], { encoding: "utf8", timeout: 60000 }).status === 0;
  return { interpreter, pandas };
}

// A whole file, calculated as the editor and check.js do: every result by address,
// { text } as it would be written or { error } in plain words.
async function calc(session, rootName, text) {
  const lines = text.split("\n");
  const { root, nodes, errors } = lint(text, rootName);
  if (errors.length) return { lintErrors: errors.map((e) => e.message) };
  const hosts = python.calcHosts(nodes, lines, rootName);
  const registry = table.mergeRegistries(derive.conceptRegistry(root, nodes));
  const ctx = { lines, registry, rootName, index: python.hostIndex(hosts, undefined, nodes, lines) };
  const resolved = new Map(hosts.map((h) => {
    try { return [h.address, python.resolveHost(h, ctx)]; }
    catch (e) { return [h.address, { code: "", targets: [], deps: [], errors: [e.message] }]; }
  }));
  const { order } = python.orderDerivations(hosts, (a) => (resolved.get(a) || { deps: [] }).deps);
  await session.request({ op: "reset" });
  // the repository's own units go with every open, as the editor sends them
  await session.request({ op: "open", root: rootName, aotFiles: os.tmpdir(), tree: python.treeOf(root), sidecar: null, sidecarMtime: null, units: units.definedUnits() });
  const out = new Map();
  for (const a of order) {
    const h = hosts.find((x) => x.address === a);
    const r = resolved.get(a);
    if (r.errors.length) { out.set(a, { error: r.errors[0] }); continue; }
    const item = python.evalItem(h, r, r.targets.map((_, k) => k));
    try {
      const answer = await session.request(Object.assign({ op: "eval", targets: r.targets }, item));
      out.set(a, answer.many ? {} : python.resultOf(h, answer.result, 120));
    } catch (e) { out.set(a, { error: python.plainError(e.message) }); }
  }
  const items = python.checkItems(python.constraintChecks(nodes, lines), ctx);
  const asked = items.filter((p) => p.item);
  const answers = asked.length ? (await session.request({ op: "checks", items: asked.map((p) => p.item) })).results : [];
  return { out, rules: asked.map((p, k) => ({ value: p.check.value, ...answers[k] })) };
}

async function engine({ interpreter, pandas }) {
  const session = new python.Session(spawn, { python: interpreter, runtime: path.join(__dirname, "..", "src", "aot_runtime.py"), cwd: os.tmpdir(), timeoutMs: 60000 }).start();
  await session.request({ op: "hello" });
  // one value with a formula, the result as the cell would write it
  const run = async (formula, extra = [], cell = "") => {
    const text = ["Case", ...extra.map((l) => `    ${l}`), `    x: ${cell ? `${cell} ` : ""}=${formula}`].join("\n");
    const r = await calc(session, "T", text);
    if (r.lintErrors) return { error: r.lintErrors[0] };
    return r.out.get("@Case@x") || { error: "no result" };
  };
  const gives = async (name, formula, want, extra, cell) => {
    const r = await run(formula, extra, cell);
    check(name, r.text === want, r);
  };
  const fails = async (name, formula, re, extra, cell) => {
    const r = await run(formula, extra, cell);
    check(name, !!r.error && re.test(r.error), r);
  };
  const P = ["price: $100,000", "discount: 30%", "rate: 15%", "euro: €20,000"];
  // the table in the plan, row by row
  await gives("number: 30% reads as 0.3", "@discount", "0.3", P);
  await gives("number: a % cell shows a share as a percent", "@discount+0.05", "35%", P, "1%");
  await gives("number: $100,000 less 30%", "@price*(1-@discount)", "$70,000", P);
  await gives("number: €20,000 less 15%", "@euro*(1-@rate)", "€17,000", P);
  await gives("number: £5", "@a*2", "£10", ["a: £5"]);
  await gives("number: ¥5", "@a*2", "¥10", ["a: ¥5"]);
  await gives("number: R1,204", "@a*2", "R2,408", ["a: R1,204"]);
  await gives("number: (1,000) is negative", "@a+1", "-999", ["a: (1,000)"]);
  await gives("number: ($1,000) is negative", "@a*2", "-$2,000", ["a: ($1,000)"]);
  await gives("number: a cell bracketing a negative stays bracketed", "@a*2", "(2,000)", ["a: (1,000)"], "(5)");
  await fails("text: n/a × 2 is an error", "@a*2", /'n\/a' is text, so it can't be multiplied/, ["a: n/a"]);
  await fails("text: 2 × n/a is an error", "2*@a", /'n\/a' is text/, ["a: n/a"]);
  await fails("text: 1.2M stays text, and says so", "@a*2", /'1\.2M' is text/, ["a: 1.2M"]);
  await fails("text: 1.204,50 stays text", "@a*2", /is text/, ["a: 1.204,50"]);
  await fails("text: 15/01/2026 stays text", "@a*2", /is text/, ["a: 15/01/2026"]);
  await fails("text: 1.2M + 450k does not join into one", "@a+@b", /write them as plain numbers/, ["a: 1.2M", "b: 450k"]);
  await gives("text: words still join", "@a+\" \"+@b", "Ada Lovelace", ["a: Ada", "b: Lovelace"]);
  await gives("unit: 120 km / 2 h", "@d/@t", "60 km/h", ["d: 120 km", "t: 2 h"]);
  await gives("unit: glued, for a unit it knows", "@d/@t", "60 km/h", ["d: 120km", "t: 2h"]);
  await gives("unit: 46 clients needs no setup", "@a+@b", "47 clients", ["a: 46 clients", "b: 1 client"]);
  await gives("unit: $10/kg × 3 kg", "@p*@q", "$30", ["p: $10/kg", "q: 3 kg"]);
  await gives("unit: 3 m² is a square metre", "@a/1", "3 m²", ["a: 3 m²"]);
  await gives("unit: 5 km + 500 m", "@a+@b", "5.5 km", ["a: 5 km", "b: 500 m"]);
  await gives("unit: same kind divides to a plain number", "@a/@b", "10", ["a: 10 km", "b: 1000 m"]);
  await gives("unit: a price per client", "@a/@b", "$25/client", ["a: $100", "b: 4 clients"]);
  await fails("unit: $100 + 5 says write the unit", "@a+5", /write the unit on 5, as in \$5/, ["a: $100"]);
  await fails("unit: 5 km > 3 says write the unit", "@a>3", /write the unit on 3, as in 3 km/, ["a: 5 km"]);
  await fails("unit: $100,000 less 30% written wrong is caught", "@price-@discount", /write the unit/, P);
  await gives("unit: 0 is always allowed", "@a+0", "$100", ["a: $100"]);
  await gives("unit: 0 compares", "@a>0", "Yes", ["a: $100"]);
  await fails("unit: $5 + €5", "@a+@b", /don't convert into each other/, ["a: $5", "b: €5"]);
  await fails("unit: 3 kg + 2 km", "@a+@b", /don't convert into each other/, ["a: 3 kg", "b: 2 km"]);
  await fails("unit: months don't convert to days", "@a.to(\"days\")", /don't convert/, ["a: 6 months"]);
  await gives("unit: months convert to years", "@a.to(\"yr\")", "0.5 yr", ["a: 6 months"]);
  await gives("unit: a date moves by days", "@d + 30 days", "2026-03-02", ["d: 2026-01-31"]);
  await gives("unit: 12 Monkeys still reads as text", "@a.upper()", "12 MONKEYS", ["a: 12 Monkeys"]);
  await gives("unit: a code like R100 still compares as text", "@a == \"R100\"", "Yes", ["a: R100"]);
  await fails("unit: float() wants .value", "float(@a)", /use \.value/, ["a: 5 km"]);
  await fails("unit: math.sqrt wants .value", "math.sqrt(@a)", /use \.value/, ["a: 4 m"]);
  await gives("unit: .value is the plain number", "@a.value+1", "6", ["a: 5 km"]);
  await gives("unit: aot.quantity", "aot.quantity(5, \"km\")+aot.quantity(\"500 m\")", "5.5 km");
  // units inside formulas
  await gives("literal: =@price + $5,000", "@price + $5,000", "$105,000", P);
  await gives("literal: =@d + 5 km", "@d + 5 km", "125 km", ["d: 120 km"]);
  await gives("literal: =@price*30%", "@price*30%", "$30,000", P);
  await gives("literal: 7 % 3 stays remainder", "7 % 3", "1");
  // the cell's unit
  await gives("cell: a unit alone chooses it", "@d/@t", "74.56454306848008 mph", ["d: 120 km", "t: 1 h"], "mph");
  await fails("cell: a wrong kind is an error", "@d", /the formula gives km, and this cell says kg/, ["d: 120 km"], "5 kg");
  await gives("cell: a number's old unit converts the result", "@d", "120000 m".replace("120000", "120,000"), ["d: 120 km"], "5 m");
  await gives("cell: a plain number takes the cell's unit", "@a*2", "$10", ["a: 5"], "$1");
  await gives("cell: a word waiting for its value names nothing", "@a*2", "10", ["a: 5"], "pending");
  await gives("cell: spelled as the cell spells it", "@a*2", "4 kilometres", ["a: 2 km"], "1 kilometres");
  await gives("cell: glued stays glued", "@a*2", "4km", ["a: 2 km"], "1km");

  // a column in its unit
  {
    const text = [
      "Trip|distance (km)|time (h)|speed (km/h) =@distance/@time|total (km)",
      "A   |120          |1.5     |                             |=@distance+5 km",
      "B   |75 mi        |1       |                             |",
      "",
      "Summary",
      "    all: =@Trip@distance.sum()",
    ].join("\n");
    const r = await calc(session, "T", text);
    check("column: a plain number is in its alias's unit", r.out.get("@Trip@speed@A").text === "80", r.out.get("@Trip@speed@A"));
    check("column: a cell's own unit wins and is converted", r.out.get("@Trip@speed@B").text === "120.7008", r.out.get("@Trip@speed@B"));
    check("column: a result in the column's unit is the number alone", r.out.get("@Trip@total@A").text === "125", r.out.get("@Trip@total@A"));
    check("column: a whole column keeps its unit", /^240\.7008[0-9]* km$/.test(r.out.get("@Summary@all").text), r.out.get("@Summary@all"));
  }
  {
    const text = ["Trip", "    distance (km) <=500", "    discount (%) <=35", "    - A", "        distance: 120", "        discount: 30", "    - B", "        distance: 600", "        discount: 40"].join("\n");
    const r = await calc(session, "T", text);
    const verdict = (v) => r.rules.find((x) => x.value === v);
    check("rule: a number written straight is in the column's unit", verdict("120").ok && verdict("120").holds && verdict("600").ok && !verdict("600").holds, r.rules);
    check("rule: and a percent column's in percent", verdict("30").holds && !verdict("40").holds, r.rules);
  }
  {
    const r = await calc(session, "T", ["Trip", "    distance <=500", "    - A", "        distance: 120 km"].join("\n"));
    check("rule: a plain bound over a unit says write the unit", r.rules[0].ok === false && /write the unit on 500/.test(r.rules[0].error), r.rules);
    const with_unit = await calc(session, "T", ["Trip", "    distance <=500 km", "    - A", "        distance: 120 km", "    - B", "        distance: 600 km"].join("\n"));
    check("rule: a bound with its unit", with_unit.rules[0].holds === true && with_unit.rules[1].holds === false, with_unit.rules);
    const conv = await calc(session, "T", ["Trip", "    distance <=500 km", "    - A", "        distance: 400 mi"].join("\n"));
    check("rule: converted before it is held", conv.rules[0].holds === false, conv.rules);
  }

  // roll-ups and inheritance
  {
    const text = [
      "Deal",
      "    limit: 100",
      "    net",
      "    - Direct",
      "        net: 5",
      "    Enterprise Deal",
      "        - Acme",
      "            net: 70000",
      "        Big Deal",
      "            - Mega",
      "                net: 17000",
      "                price: 5",
      "                over: =@price>@limit",
      "Summary",
      "    total: =@Deal@net.sum()",
      "    rows: =len(@Deal)",
      "    own: =@Big Deal@net.sum()",
      "    kinds: =sorted(set(@Deal[\"kind\"]))[0]",
    ].join("\n");
    const r = await calc(session, "T", text);
    if (pandas) {
      check("rollup: @Deal@net counts every kind's rows, not 5", r.out.get("@Summary@total").text === "87,005", r.out.get("@Summary@total"));
      check("rollup: @Deal has them all", r.out.get("@Summary@rows").text === "3", r.out.get("@Summary@rows"));
      check("rollup: a kind's own stays its own", r.out.get("@Summary@own").text === "17,000", r.out.get("@Summary@own"));
      check("rollup: a kind column names each row's", r.out.get("@Summary@kinds").text === "Big Deal", r.out.get("@Summary@kinds"));
    } else console.log("SKIP rollup frames (no pandas)");
    check("inherit: a default two levels up is read", r.out.get("@Big Deal@over@Mega").text === "No", r.out.get("@Big Deal@over@Mega"));
    const longest = await calc(session, "T", ["Deal", "    discount cap: 0.2", "    Deal|discount|ok", "    Acme|0.1|=@discount cap>@discount"].join("\n"));
    check("inherit: the longest name wins across a column and a default", longest.out.get("@Deal@ok@Acme").text === "Yes", longest.out.get("@Deal@ok@Acme"));
    const nearest = await calc(session, "T", ["Deal", "    limit: 100", "    Kind", "        limit: 7", "        - A", "            x: =@limit"].join("\n"));
    check("inherit: the nearest default wins", nearest.out.get("@Kind@x@A").text === "7", nearest.out.get("@Kind@x@A"));
  }

  if (pandas) {
    const text = [
      "Trip|region|distance|price",
      "A   |x     |1 km    |$5",
      "B   |x     |2 km    |$7",
      "C   |y     |500 m   |",
      "",
      "Summary",
      "    sum: =@Trip@distance.sum()",
      "    mean: =@Trip@distance.mean()",
      "    median: =@Trip@distance.median()",
      "    min: =@Trip@distance.min()",
      "    max: =@Trip@distance.max()",
      "    std: =round(@Trip@price.std(), 3)",
      "    by region: =@Trip.groupby(\"region\")[\"distance\"].sum().iloc[0]",
      "    by mean: =@Trip.groupby(\"region\")[\"distance\"].mean().iloc[0]",
      "    double: =(@Trip@distance*2).sum()",
      "    over: =(@Trip@distance > 1 km).sum()",
      "    biggest: =@Trip@distance.idxmax()",
      "Sheet =@Trip[[\"distance\"]]",
    ].join("\n");
    const r = await calc(session, "T", text);
    const say = (a) => r.out.get(`@Summary@${a}`);
    check("pandas: .sum() keeps the unit, in the first row's", say("sum").text === "3.5 km", say("sum"));
    check("pandas: .mean() keeps the unit", say("mean").text.startsWith("1.1666") && say("mean").text.endsWith(" km"), say("mean"));
    check("pandas: .median()", say("median").text === "1 km", say("median"));
    check("pandas: .min() compares across units", say("min").text === "500 m", say("min"));
    check("pandas: .max()", say("max").text === "2 km", say("max"));
    check("pandas: .std() and round", say("std").text === "$1.414", say("std"));
    check("pandas: groupby sum", say("by region").text === "3 km", say("by region"));
    check("pandas: groupby mean", say("by mean").text === "1.5 km", say("by mean"));
    check("pandas: arithmetic on a column", say("double").text === "7 km", say("double"));
    check("pandas: a comparison with a unit", say("over").text === "1", say("over"));
    check("pandas: idxmax", say("biggest").text === "B", say("biggest"));
    const sheet = r.out.get("@Sheet");
    check("pandas: a table a formula writes carries its units", sheet.grid && sheet.grid.rows[0].includes("1 km") && sheet.grid.rows[2].includes("500 m"), sheet);
    const mixed = await calc(session, "T", ["Trip|distance", "A|1 km", "B|n/a", "Summary", "    sum: =@Trip@distance.sum()"].join("\n"));
    check("pandas: text in a column of units is an error, not a number", !!mixed.out.get("@Summary@sum").error, mixed.out.get("@Summary@sum"));
    const plain = await calc(session, "T", ["Trip|n", "A|2", "B|3", "Summary", "    cost: =(@Trip@n*$5).sum()"].join("\n"));
    check("pandas: a plain column times a unit", plain.out.get("@Summary@cost").text === "$25", plain.out.get("@Summary@cost"));
    const std = await calc(session, "T", ["Trip|r|d", "A|x|1 km", "B|x|2 km", "Summary", "    s: =@Trip.groupby(\"r\")[\"d\"].std().iloc[0]"].join("\n"));
    check("pandas: groupby std says it can't, rather than a wrong number", !!std.out.get("@Summary@s").error || /km$/.test(std.out.get("@Summary@s").text), std.out.get("@Summary@s"));
  } else console.log("SKIP pandas (not installed)");

  // a repository's own units: defined as the extension defines them, from the
  // file's lines, and sent with the open
  {
    const ownCalc = async (lines) => {
      const text = [...OWN, ...lines].join("\n");
      const parsed = lint(text, "T");
      units.defineUnits(unitsFromTree(parsed.root, parsed.nodes));
      return calc(session, "T", text);
    };
    const got = async (name, lines, address, want) => {
      const r = await ownCalc(lines);
      const at = r.out ? r.out.get(address) : r;
      check(name, !!at && (want instanceof RegExp ? want.test(at.text || at.error || "") : at.text === want), at);
    };
    await got("own: CHF 10 + 50 Rp, in the first one's unit", ["Bill", "    a: CHF 10", "    b: 50 Rp", "    t: =@a+@b"], "@Bill@t", "CHF 10.5");
    await got("own: and the other way round", ["Bill", "    a: CHF 10", "    b: 50 Rp", "    t: =@b+@a"], "@Bill@t", /^1,050 Rp$/);
    await got("own: a kind of the repository's own converts within itself", ["Team", "    a: 2 FTE", "    b: 220 PD", "    t: =@a+@b"], "@Team@t", "3 FTE");
    await got("own: a unit added to a kind Alpha knows converts with its units", ["Trip", "    a: 2 league", "    t: =@a.to(\"km\")"], "@Trip@t", "9.656 km");
    await got("own: with no factor it converts to nothing", ["Hall", "    a: 5 seats", "    b: 2 km", "    t: =@a+@b"], "@Hall@t", /don't convert into each other/);
    await got("own: it still adds to itself", ["Hall", "    a: 5 seats", "    b: 2 seats", "    t: =@a+@b"], "@Hall@t", "7 seats");
    await got("own: a kind of its own converts to no built-in currency", ["Bill", "    a: CHF 10", "    b: $5", "    t: =@a+@b"], "@Bill@t", /don't convert into each other/);
    await got("own: a literal in a formula reads by the format too", ["Bill", "    a: CHF 10", "    t: =@a + CHF 5"], "@Bill@t", "CHF 15");
    {
      const text = [...OWN, "Bill|price (CHF)|net (Rappen) =@price", "A|120|", "", "Cap", "    price <=CHF 500", "    - Low", "        price: CHF 400", "    - High", "        price: CHF 600"].join("\n");
      const parsed = lint(text, "T");
      units.defineUnits(unitsFromTree(parsed.root, parsed.nodes));
      const r = await calc(session, "T", text);
      check("own: a column's alias names the unit, and a result converts into the column's", (r.out.get("@Bill@net@A") || {}).text === "12,000", r.out.get("@Bill@net@A"));
      const held = (v) => r.rules.find((x) => x.value === v);
      check("own: a rule's bound in the repository's unit", held("CHF 400") && held("CHF 400").holds === true && held("CHF 600") && held("CHF 600").holds === false, r.rules);
    }
    units.defineUnits([]);
    const plain = await calc(session, "T", ["Bill", "    a: 50 Rp", "    t: =@a*2"].join("\n"));
    check("own: none sent back, the runtime forgets them", (plain.out.get("@Bill@t") || {}).text === "100 Rp", plain.out.get("@Bill@t"));
  }

  try { await session.request({ op: "bye" }, 2000); } catch { /* gone */ }
  session.kill("done");
}

(async () => {
  const here = pythonHere();
  if (here) await engine(here);
  else console.log("SKIP formula engine (no python on PATH)");
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.log(`FAIL threw ${e && e.stack}`);
  process.exit(1);
});
