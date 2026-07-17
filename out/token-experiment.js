// The token experiment behind the README's "What it costs to think in Alpha"
// section. Measures, exactly rather than by rule of thumb, what the same
// knowledge costs an LLM written as Alpha and written as plain English:
//
//   input       the facts, put in front of the model
//   processing  the facts, re-read to answer questions about them
//   output      one change to the facts, written back
//
// The comparison is only worth anything if the prose is *fair*, so the prose
// here is what a careful person would actually type: complete sentences, no
// padding, no repetition beyond the repetition prose itself forces (every
// fact must re-name its subject and its attribute — that is the whole of the
// difference, and it is not a trick).
//
// Needs a tokenizer, which the extension itself does not:
//
//     npm install --no-save gpt-tokenizer
//     node out/token-experiment.js
//
// gpt-tokenizer is byte-pair encoding over o200k_base (GPT-4o/4.1). Claude's
// tokenizer is not public and differs in detail; the *ratio* between two
// English texts is stable across BPE tokenizers, which is what is claimed.

const fs = require("fs");
const path = require("path");

let encode;
try {
  ({ encode } = require("gpt-tokenizer/encoding/o200k_base"));
} catch {
  console.error("This experiment needs a tokenizer:\n\n    npm install --no-save gpt-tokenizer\n");
  process.exit(2);
}
const tokens = (text) => encode(text).length;

// --------------------------------------------------------------------------
// the dataset: people, each with the same five attributes
// --------------------------------------------------------------------------
const FIRST = ["Ada", "Alan", "Grace", "Edsger", "Barbara", "Donald", "Ken", "Dennis", "John", "Alonzo"];
const LAST = ["Lovelace", "Turing", "Hopper", "Dijkstra", "Liskov", "Knuth", "Thompson", "Ritchie", "McCarthy", "Church"];
const NATION = ["British", "American", "Dutch", "Canadian", "Australian"];
const WORK = ["mathematician", "engineer", "physicist", "logician", "chemist"];

function people(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}${i >= 100 ? " " + i : ""}`,
      "birth date": `${1815 + (i * 7) % 150}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
      nationality: NATION[i % NATION.length],
      occupation: WORK[i % WORK.length],
      age: String(30 + (i % 50)),
    });
  }
  return out;
}
const COLUMNS = ["birth date", "nationality", "occupation", "age"];

// Alpha: a table under its Concept, aligned exactly as the editor writes it
// (the padding is real, and it is counted).
function asAlpha(rows) {
  const header = ["name", ...COLUMNS];
  const grid = [header, ...rows.map((r) => [r.name, ...COLUMNS.map((c) => r[c])])];
  const width = header.map((_, k) => Math.max(...grid.map((g) => g[k].length)));
  const line = (cells) => "    |" + cells.map((c, k) => c.padEnd(width[k])).join("|") + "|";
  const sep = "    |" + width.map((w) => "-".repeat(w)).join("+") + "|";
  return ["Person Record", line(header), sep, ...grid.slice(1).map(line)].join("\n");
}

// Plain English: the same facts, written the way a person writes them.
function asProse(rows) {
  return "Here are the people on record. "
    + rows.map((r) => `${r.name} was born on ${r["birth date"]}, is ${r.nationality}, `
      + `works as a ${r.occupation}, and is ${r.age} years old.`).join(" ");
}

// --------------------------------------------------------------------------
// 1) input — the facts, put in front of the model
// --------------------------------------------------------------------------
// The same grid as the CSV the mirror already writes — no alignment padding.
// Worth measuring because it is not hypothetical: aot.files holds exactly
// this, so it is a form you can hand a model today.
const { toCsv } = require("../src/table");
const asCsv = (rows) => toCsv([["name", ...COLUMNS], ...rows.map((r) => [r.name, ...COLUMNS.map((c) => r[c])])]);

console.log("INPUT — the same facts, as Alpha and as prose\n");
console.log("  people   facts   Alpha   prose   saved     CSV   Alpha/fact   prose/fact");
const sizes = [1, 5, 20, 100];
const inputRows = [];
for (const n of sizes) {
  const rows = people(n);
  const facts = n * COLUMNS.length; // every person x every attribute
  const a = tokens(asAlpha(rows));
  const p = tokens(asProse(rows));
  const c = tokens(asCsv(rows));
  inputRows.push({ n, facts, a, p, c });
  console.log(`  ${String(n).padStart(6)} ${String(facts).padStart(7)} ${String(a).padStart(7)} ${String(p).padStart(7)}`
    + `   ${String(Math.round((1 - a / p) * 100) + "%").padStart(5)} ${String(c).padStart(7)}`
    + `   ${(a / facts).toFixed(2).padStart(10)}   ${(p / facts).toFixed(2).padStart(10)}`);
}

// --------------------------------------------------------------------------
// 2) processing — the facts, re-read to answer questions
// --------------------------------------------------------------------------
// A question about a model is answered one of two ways. In prose the model
// must read the text: every question pays the input cost again. In Alpha the
// same question is arithmetic over the tree — `verify.js --ask X Y` is a
// divisibility test — so the tool answers and the LLM reads nothing at all.
console.log("\nPROCESSING — 10 questions over the 100-person record\n");
{
  const rows = people(100);
  const a = tokens(asAlpha(rows));
  const p = tokens(asProse(rows));
  const asked = 10;
  console.log(`  prose, re-read per question : ${p} x ${asked} = ${p * asked} tokens`);
  console.log(`  Alpha, re-read per question : ${a} x ${asked} = ${a * asked} tokens`);
  console.log(`  Alpha, answered by verify.js: 0 tokens (an is-a test is a division, not a prompt)`);
}

// --------------------------------------------------------------------------
// 3) output — one change, written back
// --------------------------------------------------------------------------
// What the model must *emit* to make a change. Alpha's unit is a line; prose
// has no unit smaller than the sentence, and a fact changed mid-sentence
// takes the whole sentence with it.
console.log("\nOUTPUT — one change to the 100-person record\n");
{
  const rows = people(100);
  const alphaLines = asAlpha(rows).split("\n");
  const oneRow = alphaLines[alphaLines.length - 1];
  const oneSentence = asProse(rows.slice(-1)).replace("Here are the people on record. ", "");

  console.log(`  add one person   — Alpha: ${String(tokens(oneRow)).padStart(3)} tokens (one row)`);
  console.log(`                     prose: ${String(tokens(oneSentence)).padStart(3)} tokens (one sentence)`);
  // change one fact: Alpha re-emits the row it sits in, prose the sentence
  console.log(`  change one fact  — Alpha: ${String(tokens(oneRow)).padStart(3)} tokens (the row it sits in)`);
  console.log(`                     prose: ${String(tokens(oneSentence)).padStart(3)} tokens (the sentence it sits in)`);
}

// --------------------------------------------------------------------------
// 4) the other shape: a taxonomy, where the fact IS the placement
// --------------------------------------------------------------------------
// A grid is only half of what a model holds. The other half is the tree: a
// Concept filed under its kind. Alpha writes that edge as four spaces of
// indentation; prose has no way to write it but a sentence. This is where
// the two diverge hardest, so it is measured separately rather than averaged
// into the grid's numbers.
const KINDS = ["Vehicle", "Instrument", "Structure", "Vessel", "Machine"];
const MIDS = ["Land", "Water", "Air", "Rail", "Hand"];
const LEAFS = ["Bicycle", "Cart", "Sled", "Ferry", "Canoe", "Glider", "Kite", "Tram", "Wagon", "Loom"];

// A balanced three-level taxonomy: kind > sub-kind > particular.
function taxonomy(perLevel) {
  const tree = [];
  for (const k of KINDS.slice(0, perLevel)) {
    const subs = [];
    for (const m of MIDS.slice(0, perLevel)) {
      subs.push({ name: `${m} ${k}`, children: LEAFS.slice(0, perLevel).map((l) => ({ name: `${l} ${m}`, children: [] })) });
    }
    tree.push({ name: k, children: subs });
  }
  return tree;
}
const edgesOf = (tree) => tree.reduce((n, t) => n + t.children.length
  + t.children.reduce((m, c) => m + c.children.length, 0), 0);

function taxonomyAlpha(tree) {
  const out = ["Thing"];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push(" ".repeat(4 * depth) + n.name);
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 1);
  return out.join("\n");
}

function taxonomyProse(tree) {
  const out = [];
  const walk = (nodes, parent) => {
    for (const n of nodes) {
      out.push(`A ${n.name} is a kind of ${parent}.`);
      walk(n.children, n.name);
    }
  };
  walk(tree, "Thing");
  return out.join(" ");
}

console.log("\nINPUT — a taxonomy, as Alpha and as prose\n");
console.log("  ideas   edges   Alpha   prose   saved   Alpha/edge   prose/edge");
for (const per of [2, 3, 5]) {
  const tree = taxonomy(per);
  const edges = edgesOf(tree) + tree.length;
  const ideas = edges;
  const a = tokens(taxonomyAlpha(tree));
  const p = tokens(taxonomyProse(tree));
  console.log(`  ${String(ideas).padStart(5)} ${String(edges).padStart(7)} ${String(a).padStart(7)} ${String(p).padStart(7)}`
    + `   ${String(Math.round((1 - a / p) * 100) + "%").padStart(5)}`
    + `   ${(a / edges).toFixed(2).padStart(10)}   ${(p / edges).toFixed(2).padStart(10)}`);
}

// --------------------------------------------------------------------------
// the real file, for scale
// --------------------------------------------------------------------------
// Reported as it is, not extrapolated: the reference model is mostly tree
// (555 ideas, 106 of them carrying a value), so its cost per *idea* is the
// honest figure. Pricing it per valued fact would flatter prose by pretending
// the other 449 ideas were free to say.
console.log("\nTHE REFERENCE MODEL — examples/alphabet of thought.aot\n");
{
  const { lint, KIND } = require("../src/linter");
  const file = path.join(__dirname, "..", "examples", "alphabet of thought.aot");
  const text = fs.readFileSync(file, "utf8");
  const { nodes } = lint(text, "alphabet of thought");
  const valued = nodes.filter((n) => n.kind === KIND.DEFAULT && n.value).length;
  const t = tokens(text);
  console.log(`  ${text.split(/\r?\n/).length} lines, ${nodes.length} ideas (${valued} carrying a value)`);
  console.log(`  ${t} tokens — ${(t / nodes.length).toFixed(2)} per idea`);
  console.log(`  every idea also states its parent, at no cost: ${nodes.length} is-a edges for free`);
}
