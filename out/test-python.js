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
  ];
  const prose = [
    "none noted", "18 years", "20 knots", "", "   ", "(2", "\"open", "@price*", "a b c", "@ ",
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
    "    Run Command: code =x",
    "    Plain",
    "    rows =f()",
    "    Empty =",
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
  check("Concept line: an inline Example's text keeps its '=' (a colon stands first)",
    run && run.formula === undefined && run.children.some((c) => c.name === "code =x"));
  check("Concept line: a plain Concept is untouched", r.nodes.some((n) => n.name === "Plain" && n.formula === undefined));
  const onAttr = r.errors.find((e) => e.line === 7);
  check("a derivation on a bare attribute is an error that says to add a colon",
    onAttr && /add a colon/.test(onAttr.message) && /rows: =f\(\)/.test(onAttr.message));
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
  check("format: a Python number takes the file's format", python.cellText(3628800) === "3,628,800" && python.cellText(0.1 + 0.2) === "0.3");
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
    '    status ==("draft", "sent")',
    "    grade ==@level*2",
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
    "    Team|lead|size ==4",
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
  const reg = table.mergeRegistries(derive.conceptRegistry(r.root, r.nodes));
  const hosts = python.hostsOf(r.nodes, lines, "t");
  const plan = python.checkItems(checks, { lines, registry: reg, rootName: "t", index: python.hostIndex(hosts) });
  const itemOn = (line, op) => plan.find((p) => p.check.host.line === line && p.clause.op === op);
  check("checks: each clause is one request, its value sent as written",
    itemOn(6, ">=").item.rel === ">=" && itemOn(6, ">=").item.code === "18" && itemOn(6, ">=").item.value === "30"
    && itemOn(6, "<=").item.code === "65");
  check("checks: a bound's reference resolves where its value stands",
    itemOn(9, "==").item.code === "_aot_ref(0)*2" && itemOn(9, "==").item.targets[0].text === "3");
  check("checks: an empty value is sent to a '==' that may define it",
    itemOn(12, "==") && itemOn(12, "==").item.value === "" && itemOn(17, "=="));
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
  check("security: spawned with -B -E, no bytecode, the Agg backend",
    seen.cmd === "py3" && seen.args.slice(0, 2).join() === "-B,-E" && seen.opts.env.PYTHONDONTWRITEBYTECODE === "1"
    && seen.opts.env.MPLBACKEND === "Agg" && seen.opts.cwd === "/w");

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
  const probe = spawnSync("python", ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 15000 });
  if (probe.status !== 0 || String(probe.stdout).trim() !== "3") {
    console.log("SKIP real runtime (no python on PATH)");
    return done();
  }
  const s = new python.Session(spawn, {
    python: "python", runtime: path.join(__dirname, "..", "src", "aot_runtime.py"), cwd: os.tmpdir(), timeoutMs: 30000,
  }).start();
  const ev = (code, targets, host) => s.request({ op: "eval", address: "@t@x", code, targets: targets || [], host: host || "value" })
    .then((r) => r.result, (e) => ({ error: e.message }));
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
    const sidecarSha = require("crypto").createHash("sha1").update(fs.readFileSync(sidecarFile)).digest("hex");
    const opened = await openWith({ [sidecarFile]: sidecarSha });
    check("runtime: the sidecar loads, and an os.py beside it shadows nothing", opened.sidecar && opened.functions.includes("twice"));
    check("runtime: arithmetic", (await ev("math.factorial(10)")).value === 3628800);
    check("runtime: a sidecar function", (await ev("twice(21)")).value === 42);
    check("runtime: values arrive typed — $1,204 is 1204", (await ev("_aot_ref(0) + 1", [{ kind: "value", text: "$1,204" }])).value === 1205);
    check("runtime: 2026-01 stays text (strict numbers)", (await ev("_aot_ref(0)", [{ kind: "value", text: "2026-01" }])).text === "2026-01");
    check("runtime: a date arrives as a date and leaves as yyyy-mm-dd", (await ev("_aot_ref(0) + timedelta(days=1)", [{ kind: "value", text: "2026-09-22" }])).text === "2026-09-23");
    check("runtime: a datetime with a time keeps it", (await ev("datetime(2026, 9, 22, 14, 30)")).text === "2026-09-22 14:30");
    check("runtime: Yes/No arrive as booleans and leave as Yes/No", (await ev("not _aot_ref(0)", [{ kind: "value", text: "No" }])).text === "Yes");
    check("runtime: NaN is an empty value", (await ev("float('nan')")).text === "");
    const printed = await s.request({ op: "eval", address: "@t@p", code: "print('hi') or 7", targets: [], host: "value" });
    check("runtime: a print is captured, never written into the protocol", printed.stdout === "hi\n" && printed.result.value === 7);
    check("runtime: exit() ends the expression, not the session", /asked Python to exit/.test((await ev("exit()")).error) && (await ev("1+1")).value === 2);
    const records = await ev("[{'name': 'Q1', 'total_units': 1204}, {'name': 'Q2', 'total_units': 5}]", [], "concept");
    check("runtime: records become a table — rows numbered 1, 2, 3, every key a column, written the language's way",
      records.kind === "frame" && records.columns.join() === "name,total units" && records.rows[0].join() === "1,Q1,1204" && records.rows[1][0] === "2");
    check("runtime: a live result is read back by the next derivation",
      (await ev("len(_aot_ref(0))", [{ kind: "object", address: "@t@x" }])).value === 2);
    const named = await ev("aot.grid(['Q', 'n'], [['A', 1], ['B', 2]])", [], "concept");
    check("runtime: a grid Python names row by row says so, and keeps its names", named.named === true && named.rows[1][0] === "B");

    // the constraints: every bound in one round trip
    const chk = (items) => s.request({ op: "checks", items }).then((r) => r.results);
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
    const sha = (p) => require("crypto").createHash("sha1").update(fs.readFileSync(p)).digest("hex");
    const allow = (...ps) => s.request({ op: "approve", files: Object.fromEntries(ps.map((p) => [p, sha(p)])) });
    await s.request({ op: "open", root: "t", repo, aotFiles: path.join(repo, "aot.files"), pyFiles, approved: {}, tree: { kind: "Concept", name: "t", children: [] } });
    const evr = (code) => s.request({ op: "eval", address: "@t@r", code, targets: [], host: "value" })
      .then((r) => ({ ok: r.result }), (e) => ({ error: e.message, consent: e.consent, file: e.file }));
    let got = await evr("finance.revenue(3)");
    check("repository: a file not yet allowed does not run, and the question names it by path and hash",
      got.consent && got.consent.path.endsWith(path.join("tools", "finance.py")) && got.consent.sha1 === sha(financePy));
    await allow(financePy);
    got = await evr("finance.revenue(3)");
    check("repository: a module it imports is asked about in its turn", got.consent && got.consent.path.endsWith("helpers.py"));
    await allow(helpers, pkgInit, pkgSub, nsMod, spaced);
    check("repository: found anywhere by its name, its own import found in aot.files", (await evr("finance.revenue(3)")).ok.value === 60);
    check("repository: a dotted path from the root", (await evr("tools.finance.revenue(1)")).ok.value === 20);
    check("repository: a package, its submodule imported as it is reached", (await evr("pkg.LABEL + pkg.sub.f()")).ok.text === "pkgsub");
    check("repository: a folder without __init__ is a package too", (await evr("ns.deep.mod.g()")).ok.text === "ns");
    check("repository: two files of one name — an error naming both, and the dotted path to write",
      /names 2 files.*dup\.a\.same/.test((await evr("same.X")).error));
    check("repository: the standard library wins — the repository's os.py never runs", (await evr("os.sep in '/\\\\'")).ok.text === "Yes");
    check("repository: any installed module is there by its name", (await evr("csv.QUOTE_ALL")).ok.value === 1);
    check("repository: aot.use loads a file by its path, a space and all", (await evr('aot.use("tools/my helpers.py").hi()')).ok.text === "hi");
    check("repository: aot.use refuses a file outside the repository", !!(await evr('aot.use("../outside.py")')).error);
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(helpers, "def twice(x):\n    return 3 * x\n");
    await s.request({ op: "open", root: "t", repo, aotFiles: path.join(repo, "aot.files"), pyFiles, approved: {}, tree: { kind: "Concept", name: "t", children: [] } });
    got = await evr("finance.revenue(3)");
    check("repository: a file changed on disk is asked about again", got.consent && got.consent.path.endsWith("helpers.py"));
    await allow(helpers);
    check("repository: ...and once allowed, runs as it is now", (await evr("finance.revenue(3)")).ok.value === 90);

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
