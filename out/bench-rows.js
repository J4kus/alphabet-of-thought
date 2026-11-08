// How long the editor's reading of a file takes as its table grows: the parse,
// the row checks (fca.audit), the identical-content check, the hoists, the
// crosslinks, the formulas and their spans, and spelling — the passes the
// extension's analyse() runs on a keystroke's pause — and, apart, what a
// calculation lists before it runs anything (python.calcHosts, every formula
// and every value a rule holds, which check.js and verify.js list too), and
// the inferred dependencies (armstrong), which only run when asked for and
// stop past gates.MAX_FD_OBJECTS rows. Every pass's cost should grow with the
// rows, not with their square: twice the rows, about twice the time.
//
// Not part of `npm test`: it measures, it does not check. Run with
//     node out/bench-rows.js [rows ...]       (default 1000 5000 20000 50000)
// and compare the numbers before and after a change. The targets (1.15): a
// 5,000-row table read in about 150 ms, a 50,000-row one in about 1.5 s.

const { lint } = require("../src/linter");
const { audit } = require("../src/fca");
const godel = require("../src/godel");
const armstrong = require("../src/armstrong");
const crosslinks = require("../src/crosslinks");
const python = require("../src/python");
const derive = require("../src/derive");
const spelling = require("../src/spelling");
const { MAX_FD_OBJECTS } = require("../src/gates");

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
const SIZES = sizes.length ? sizes : [1000, 5000, 20000, 50000];

const REGION = ["North", "South", "East", "West"];
function table(rows) {
  const out = ["Order|region|price|qty|net =@price*@qty"];
  for (let i = 0; i < rows; i++) out.push(`Row ${i}|${REGION[i % 4]}|${(i * 37) % 900}|${(i * 13) % 50}|`);
  return out.join("\n");
}

const time = (fn) => {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
};
const ms = (n) => `${n.toFixed(0).padStart(6)}`;

spelling.check("warm the dictionaries", new Set()); // loaded once per process, not per reading
console.log("   rows |  parse  audit  clash hoists  links  forms  spell |  total |   calc | dependencies");
for (const rows of SIZES) {
  const text = table(rows);
  const lines = text.split("\n");
  let parsed;
  const t = {
    parse: time(() => { parsed = lint(text, "Bench"); }),
  };
  t.audit = time(() => audit(parsed.root, parsed.nodes));
  t.clash = time(() => godel.clashes(parsed.root, parsed.nodes));
  t.hoists = time(() => godel.hoists(parsed.root, parsed.nodes));
  t.links = time(() => crosslinks.resolve(text, parsed.root, parsed.nodes));
  t.forms = time(() => { python.hostsOf(parsed.nodes, lines, "Bench"); derive.derivationSpans(parsed.root, parsed.nodes, lines); });
  t.spell = time(() => spelling.check(text, new Set()));
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  const calc = time(() => python.calcHosts(parsed.nodes, lines, "Bench"));
  const fd = rows <= MAX_FD_OBJECTS ? `${time(() => armstrong.findings(parsed.root, parsed.nodes)).toFixed(0)} ms` : `not run past ${MAX_FD_OBJECTS}`;
  console.log(`${String(rows).padStart(7)} | ${ms(t.parse)} ${ms(t.audit)} ${ms(t.clash)} ${ms(t.hoists)} ${ms(t.links)} ${ms(t.forms)} ${ms(t.spell)} | ${ms(total)} | ${ms(calc)} | ${fd}`);
}
