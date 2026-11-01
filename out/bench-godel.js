// How long the Gödel numbering takes on a file shaped like real data: one
// wide table with a unique reference column (the column whose value codes,
// and so whose exponents, grow with every row), a few low-cardinality
// columns, and a second Concept declaring enough attributes to give the
// repository-sized prime universe the registry holds. It touches only the
// public API — lint, buildGodel, clashes, hoists, profile, pool/twins and
// armstrong.inferFDs — so the same script times any version of the modules.
//
// Not part of `npm test`: it measures, it does not check. Run with
//     node out/bench-godel.js [rows]          (default 1000)
// and compare the numbers before and after a change.

const { lint } = require("../src/linter");
const godel = require("../src/godel");
const armstrong = require("../src/armstrong");

const ROWS = Number(process.argv[2]) || 1000;

// a small deterministic generator, so every run builds the same file
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

function synthetic(rows) {
  const columns = ["ref", "kind", "region", "status", "amount", "owner"];
  for (let c = 6; c < 30; c++) columns.push(`trait ${String(c).padStart(2, "0")}`);
  const pools = {
    kind: ["alpha", "beta", "gamma", "delta", "epsilon"],
    region: ["north", "south", "east", "west"],
    status: ["open", "held", "closed"],
    amount: Array.from({ length: 100 }, (_, i) => String(100 + i * 7)),
    owner: Array.from({ length: 20 }, (_, i) => `owner ${i}`),
  };
  const lines = [["Ledger", ...columns].join("|")];
  for (let r = 1; r <= rows; r++) {
    const cells = [`Entry ${r}`];
    for (const c of columns) {
      if (c === "ref") cells.push(`ref ${r}`);
      else if (pools[c]) cells.push(pick(pools[c]));
      else cells.push(rand() < 0.4 ? `level ${Math.floor(rand() * 10)}` : "");
    }
    lines.push(cells.join("|"));
  }
  lines.push("");
  lines.push("Catalogue");
  for (let a = 1; a <= 280; a++) lines.push(`    facet ${String(a).padStart(3, "0")}`);
  for (let e = 1; e <= 3; e++) {
    lines.push(`    - Sample ${e}`);
    for (let a = 1; a <= 5; a++) lines.push(`        facet ${String(a * e).padStart(3, "0")}: grade ${e + a}`);
  }
  return lines.join("\n");
}

const time = (fn) => {
  const t = process.hrtime.bigint();
  const out = fn();
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, out };
};
const row = (label, ms) => console.log(`${label.padEnd(46)}${ms.toFixed(1).padStart(10)} ms`);

const text = synthetic(ROWS);
console.log(`synthetic file: ${ROWS} rows x 30 columns, a 280-attribute Concept beside it`);
const parsed = time(() => lint(text, "bench"));
row("lint (parse, chi primes, rules)", parsed.ms);
const { root, nodes } = parsed.out;

const build = time(() => godel.buildGodel(root, nodes));
row("buildGodel (number every node)", build.ms);
const tables = build.out;
const numbered = [root, ...nodes].filter((n) => n.godel !== undefined);
let widest = 0;
for (const n of numbered.slice(0, 200)) widest = Math.max(widest, String(n.godel).length);
console.log(`  ${numbered.length} numbered nodes, ${tables.attrPrime.size} attribute primes, widest G among the first 200: ${widest} digits`);

row("clashes (rule 20)", time(() => godel.clashes(root, nodes)).ms);
row("hoists (rules 15-16)", time(() => godel.hoists(root, nodes)).ms);
row("armstrong.inferFDs (rules 12-13)", time(() => armstrong.inferFDs(root, nodes)).ms);

const sample = nodes.filter((n) => n.godel !== undefined).slice(0, 50);
const hover = time(() => { for (const n of sample) godel.profile(root, nodes, n, tables); });
row(`profile (hover) x ${sample.length}`, hover.ms);
row("  ... per hover", hover.ms / sample.length);

const other = lint(synthetic(Math.max(10, Math.floor(ROWS / 10))), "bench twin");
const docs = [{ file: "bench.aot", root, nodes }, { file: "bench twin.aot", root: other.root, nodes: other.nodes }];
row("twins (rule 17, two files pooled)", time(() => godel.twins(docs, "bench.aot")).ms);
