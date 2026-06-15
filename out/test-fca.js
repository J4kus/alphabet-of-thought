// Smoke test for the FCA mode (src/fca.js): build small in-memory .aot
// fixtures, run suggest(), and check the proposed / drift / exhaustion
// findings and the override semantics of the formal context.
const fs = require("fs");
const { lint } = require("../src/linter");
const { suggest, buildContext } = require("../src/fca");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

// 1) proposed: Whale and Bat share an attribute no Concept names
const zoo = [
  "Fish",
  "    lives in water",
  "    - Trout",
  "    - Whale",
  "        bears live young",
  "Bird",
  "    has wings",
  "    - Sparrow",
  "    - Bat",
  "        bears live young",
].join("\n");
{
  const { root, nodes, errors } = lint(zoo, "Animal");
  check("zoo fixture parses clean", errors.length === 0);
  const report = suggest(root, nodes);
  const proposed = report.findings.filter((f) => /^proposed:/.test(f.message));
  check(
    "proposed grouping { - Whale, - Bat } by 'bears live young'",
    proposed.some((f) => f.message.includes("- Whale") && f.message.includes("- Bat") && f.message.includes("bears live young")),
  );
  check(
    "a bare shared attribute also offers promotion to the nearest Concept",
    proposed.some((f) => f.message.includes("declare { bears live young } under")),
  );
  check("Fish and Bird confirmed by the lattice", report.confirmed.includes("Fish") && report.confirmed.includes("Bird"));
}

// 2) drift + exhaustion: Goldfish has everything Fish's members share
// but is filed under Bird; Sponge matches no sub-Concept's intent
const misfiled = [
  "Fish",
  "    lives in water",
  "    - Trout",
  "    - Salmon",
  "Bird",
  "    has wings",
  "    - Sparrow",
  "    - Goldfish",
  "        lives in water",
  "- Sponge",
].join("\n");
{
  const { root, nodes, errors } = lint(misfiled, "Animal");
  check("misfiled fixture parses clean", errors.length === 0);
  const report = suggest(root, nodes);
  check(
    "drift: '- Goldfish' shares Fish's intent but is filed under Bird",
    report.findings.some((f) => /^drift: '- Goldfish' /.test(f.message) && f.message.includes("'Fish'") && f.message.includes("filed under 'Bird'")),
  );
  check(
    "exhaustion: '- Sponge' matches no sub-Concept of Animal",
    report.findings.some((f) => /^exhaustion: 'Animal'/.test(f.message) && f.message.includes("- Sponge")),
  );
}

// 3) override: an Example re-declaring an inherited default keeps
// only its own value column; the inherited one is shadowed
const overrides = [
  "Pen",
  "    colour: blue",
  "    - Standard Pen",
  "    - Red Pen",
  "        colour: red",
].join("\n");
{
  const { root, nodes, errors } = lint(overrides, "Stationery");
  check("override fixture parses clean", errors.length === 0);
  const { objects, intents } = buildContext(root, nodes);
  const redPen = objects.find((g) => g.name === "Red Pen");
  const standard = objects.find((g) => g.name === "Standard Pen");
  check(
    "Red Pen's intent has 'colour: red' and not 'colour: blue'",
    intents.get(redPen).has("colour: red") && !intents.get(redPen).has("colour: blue"),
  );
  check("Standard Pen inherits 'colour: blue'", intents.get(standard).has("colour: blue"));
}

// 4) default-is-a-Example: a value naming an Example elsewhere
// contributes that Example's ancestry as columns, so growth (Ratio,
// filed under Formula > Arithmetic) groups with size (Formula directly)
const schema = [
  "Measurement",
  "    operation",
  "        - Formula",
  "            - Arithmetic",
  "                - Ratio",
  "        - Observation",
  "Metric",
  "    - growth",
  "        operation: Ratio",
  "    - size",
  "        operation: Formula",
  "    - count",
  "        operation: Observation",
].join("\n");
{
  const { root, nodes, errors } = lint(schema, "Model");
  check("schema fixture parses clean", errors.length === 0);
  const { objects, intents } = buildContext(root, nodes);
  const growth = objects.find((g) => g.name === "growth");
  check(
    "growth's 'operation: Ratio' expands to 'operation: Formula' via the Example's ancestry",
    intents.get(growth).has("operation: formula") && intents.get(growth).has("operation: arithmetic"),
  );
  const report = suggest(root, nodes);
  check(
    "proposed grouping { - growth, - size } by the shared Formula ancestry",
    report.findings.some((f) => /^proposed:/.test(f.message) && f.message.includes("- growth") && f.message.includes("- size") && !f.message.includes("- count")),
  );
}

// 5) attribute-is-a-Concept: an attribute whose trailing words name a
// Concept contributes that Concept as a column
const typed = [
  "Integer",
  "Person",
  "    - Socrates",
  "        age integer: 70",
  "    - Plato",
  "        height integer: 175",
].join("\n");
{
  const { root, nodes, errors } = lint(typed, "World");
  check("typed fixture parses clean", errors.length === 0);
  const { objects, intents } = buildContext(root, nodes);
  check(
    "both Examples carry the 'integer' Concept column from their typed attributes",
    objects.every((g) => intents.get(g).has("integer")),
  );
}

// 6) differentia: a Concept adding nothing beyond its ancestor is
// flagged — unless a Map child declares it intentionally incomplete
const undivided = [
  "Fish",
  "    lives in water",
  "    Pond Fish",
  "        - Trout",
  "        - Carp",
  "    Sea Fish",
  "        ...",
  "        - Salmon",
  "        - Cod",
].join("\n");
{
  const { root, nodes, errors } = lint(undivided, "Zoo");
  check("undivided fixture parses clean", errors.length === 0);
  const report = suggest(root, nodes);
  check(
    "differentia: 'Pond Fish' flagged for adding nothing beyond 'Fish'",
    report.findings.some((f) => /^differentia: 'Pond Fish'/.test(f.message)),
  );
  check(
    "'Sea Fish' not flagged: its Map child declares it incomplete",
    !report.findings.some((f) => f.message.includes("'Sea Fish'")),
  );
}

// 7) the reference file runs without throwing and reports a context
{
  const text = fs.readFileSync("alphabet of thought.aot", "utf-8");
  const { root, nodes } = lint(text, "alphabet of thought");
  const report = suggest(root, nodes);
  console.log(`reference file: ${report.objects} objects x ${report.columns} attributes, ${report.concepts} formal concepts, S = ${report.findings.length}`);
  check("reference file analysed", report.objects > 1 && report.concepts > 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
