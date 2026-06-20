// Unit tests for the arithmetic linter (src/linter.js) and the advisory
// "hint" channel it feeds. Every exported function gets a direct test;
// the internal helpers (classify, realChildren, looksPlural, slotSignature,
// makeReport) are exercised through the public parse / verify they back.
//
// The hint sources are the three advisory streams extension.js surfaces as
// DiagnosticSeverity.Hint and verify.js prints as "hint:" / "suggestions":
//   godel.clashes (content)   identical-content nodes
//   armstrong.findings        derivable / equivalent attributes (FDs)
//   fca.suggest               the FCA audit (confirmed / drift / exhaustion)
//
// Plain Node script, no framework — run with: node out/test-linter.js
const {
  lint, parse, number, verify, gcd, primes, INDENT, KIND,
} = require("../src/linter");
const godel = require("../src/godel");
const armstrong = require("../src/armstrong");
const { suggest } = require("../src/fca");

const { INDIVIDUAL, DEFAULT, CONCEPT, ATTRIBUTE, MAP } = KIND;

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const aot = (...lines) => lines.join("\n");
const node = (root, nodes, name) => [root, ...nodes].find((n) => n.name === name);

// A standalone report, identical in shape to the linter's internal
// makeReport(), so parse / verify can be driven in isolation from lint()
// (and its subsumption pass). This also covers makeReport's contract.
function makeReport() {
  const errors = [], warnings = [];
  return {
    errors, warnings,
    error: (line, message) => errors.push({ line, message }),
    warn: (line, message) => warnings.push({ line, message }),
  };
}

// parse + number + verify, without lint()'s subsumption pass, so a check's
// own error/warning is the only thing under test.
function lintTree(text, rootName = "Root") {
  const report = makeReport();
  const { root, nodes } = parse(text, rootName, report);
  number(root, nodes);
  verify(root, nodes, report);
  return { root, nodes, report };
}

const hasError = (report, re) => report.errors.some((e) => re.test(e.message));

// ---------------------------------------------------------------------------
// gcd, primes, INDENT, KIND  (the pure exports)
// ---------------------------------------------------------------------------
{
  check("gcd(12, 18) = 6", gcd(12n, 18n) === 6n);
  check("gcd(17, 5) = 1 (coprime)", gcd(17n, 5n) === 1n);
  check("gcd(a, 0) = a (identity)", gcd(42n, 0n) === 42n);

  const gen = primes();
  const first = [gen.next().value, gen.next().value, gen.next().value, gen.next().value, gen.next().value];
  check("primes() yields 2, 3, 5, 7, 11 as BigInts", first.join(",") === "2,3,5,7,11" && typeof first[0] === "bigint");

  check("INDENT is 4", INDENT === 4);
  check("KIND tags are distinct 0..4", new Set(Object.values(KIND)).size === 5 && KIND.INDIVIDUAL === 0 && KIND.MAP === 4);
}

// ---------------------------------------------------------------------------
// classify (via parse): one node kind per line shape, alias stripping
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Animal",
    "    weight: 5",
    "    height",
    "    - Apple",
    "    ... rest",
    "    Run Command (cmd)",
  );
  const report = makeReport();
  const { root, nodes } = parse(text, "World", report);
  const animal = node(root, nodes, "Animal");
  const kid = (name) => animal.children.find((c) => c.name === name);

  check("classify: capitalised term -> CONCEPT", kid("Animal") === undefined && node(root, nodes, "Animal").kind === CONCEPT);
  check("classify: 'weight: 5' -> DEFAULT with value", kid("weight").kind === DEFAULT && kid("weight").value === "5");
  check("classify: bare 'height' -> ATTRIBUTE, value null", kid("height").kind === ATTRIBUTE && kid("height").value === null);
  check("classify: '- Apple' -> INDIVIDUAL", kid("Apple").kind === INDIVIDUAL);
  check("classify: '... rest' -> MAP named 'rest'", kid("rest").kind === MAP);
  check("classify: trailing (alias) dropped from the name", kid("Run Command") && kid("Run Command").kind === CONCEPT);
}

// ---------------------------------------------------------------------------
// parse: tree shape, inline-Example materialisation, indentation reporting
// ---------------------------------------------------------------------------
{
  // structure: parent / child wiring and depths
  const { root, nodes } = (() => {
    const report = makeReport();
    return parse(aot("Thing", "    - Apple", "        colour: red"), "Root", report);
  })();
  const thing = node(root, nodes, "Thing"), apple = node(root, nodes, "Apple");
  check("parse: root is the file name at depth -1", root.name === "Root" && root.depth === -1);
  check("parse: Thing is a child of root at depth 0", thing.parent === root && thing.depth === 0);
  check("parse: Apple nests under Thing at depth 1", apple.parent === thing && apple.depth === 1);
  check("parse: colour nests under Apple at depth 2", node(root, nodes, "colour").parent === apple);

  // inline Example: a capitalised line with a colon materialises one Example
  {
    const report = makeReport();
    const p = parse(aot("Run Command: code ."), "Root", report);
    const rc = node(p.root, p.nodes, "Run Command");
    const ex = rc.children.find((c) => c.kind === INDIVIDUAL);
    check("parse: 'Concept: value' materialises an inline Example child", ex && ex.name === "code ." && ex.kind === INDIVIDUAL);
  }

  // tab character
  {
    const report = makeReport();
    parse("Thing\n\tfoo", "Root", report);
    check("parse: tab character is an error", hasError(report, /tab character/));
  }
  // indent not a multiple of 4
  {
    const report = makeReport();
    parse(aot("Thing", "  foo"), "Root", report);
    check("parse: 2-space indent is an error (2 mod 4)", hasError(report, /indent of 2 spaces/));
  }
  // depth jump with no intermediate parent
  {
    const report = makeReport();
    parse(aot("Thing", "            Deep"), "Root", report);
    check("parse: depth jump 0 -> 3 is an error", hasError(report, /depth jump 0 -> 3/));
  }
  // colon with nothing after it
  {
    const report = makeReport();
    parse(aot("Thing", "    weight:"), "Root", report);
    check("parse: empty value after ':' is an error", hasError(report, /0 characters after ':'/));
  }
  // dash with no following space
  {
    const report = makeReport();
    parse(aot("Thing", "    -Apple"), "Root", report);
    check("parse: '-Apple' (no space after dash) is an error", hasError(report, /0 spaces after '-'/));
  }
  // blank lines are skipped, not numbered
  {
    const report = makeReport();
    const p = parse(aot("Thing", "", "    - Apple"), "Root", report);
    check("parse: blank lines produce no nodes", p.nodes.length === 2);
  }
}

// ---------------------------------------------------------------------------
// number: chi = prime * chi(parent), so ancestry is divisibility
// ---------------------------------------------------------------------------
{
  const report = makeReport();
  const { root, nodes } = parse(aot("Thing", "    - Apple"), "Root", report);
  number(root, nodes);
  const thing = node(root, nodes, "Thing"), apple = node(root, nodes, "Apple");
  check("number: root.chi = root.prime", root.chi === root.prime);
  check("number: chi(child) = prime(child) * chi(parent)", apple.chi === apple.prime * thing.chi);
  check("number: 'is-a' is divisibility — chi(Thing) | chi(Apple)", apple.chi % thing.chi === 0n);
  check("number: every node under root — chi(root) | chi(Apple)", apple.chi % root.chi === 0n);
  check("number: genus by gcd — gcd(chi(Apple), chi(Thing)) = chi(Thing)", gcd(apple.chi, thing.chi) === thing.chi);
}

// ---------------------------------------------------------------------------
// verify: one fixture per arithmetic check (errors, then warnings)
// ---------------------------------------------------------------------------
// repeats the file name
check("verify: a top-level line repeating the file name is an error",
  hasError(lintTree(aot("Root"), "Root").report, /repeats the file name/));

// Map with non-Map content
check("verify: a Map with non-Map children is an error",
  hasError(lintTree(aot("Thing", "    ... omitted", "        leftover")).report, /non-Map children/));

// 'and' joins two kinds
check("verify: a Concept containing 'and' is an error",
  hasError(lintTree(aot("Salt and Pepper")).report, /contains 'and'/));

// univocity: one Concept name, one prime
check("verify: the same Concept name defined twice is an error",
  hasError(lintTree(aot("Dog", "    Animal", "Cat", "    Animal"), "Zoo").report, /Concept 'Animal' defined 2 times/));

// ambiguity: identical siblings (same name AND value)
check("verify: identical sibling defaults are an error",
  hasError(lintTree(aot("Box", "    colour: red", "    colour: red")).report, /repeated under 'Box' with the same value/));

// plural Concept (warning)
check("verify: a plural Concept name warns",
  lintTree(aot("Animals"), "Zoo").report.warnings.some((w) => /appears plural/.test(w.message)));

// actual without target / target without actual (warnings)
check("verify: 'actual' without 'target' warns",
  lintTree(aot("Metric", "    actual: 5")).report.warnings.some((w) => /'actual' without 'target'/.test(w.message)));
check("verify: 'target' without 'actual' warns",
  lintTree(aot("Metric", "    target: 5")).report.warnings.some((w) => /'target' without 'actual'/.test(w.message)));

// more than eight sub-Concepts (warning)
check("verify: more than eight sub-Concepts warns",
  lintTree(aot("Genus", "    Aa", "    Bb", "    Cc", "    Dd", "    Ee", "    Ff", "    Gg", "    Hh", "    Ii"))
    .report.warnings.some((w) => /9 sub-Concepts/.test(w.message)));

// exactly one sub-Concept (warning)
check("verify: a lone sub-Concept warns (the kind is its subtype)",
  lintTree(aot("Genus", "    Species")).report.warnings.some((w) => /1 sub-Concept/.test(w.message)));

// exactly one sub-Example (warning)
check("verify: a lone sub-Example warns",
  lintTree(aot("Group", "    - Parent", "        - Child")).report.warnings.some((w) => /1 sub-Example/.test(w.message)));

// differentia: two sub-Concepts told apart by position only (warning)
check("verify: sibling sub-Concepts with identical slots warn",
  lintTree(aot("Drink", "    Coffee", "        temperature: hot", "    Tea", "        temperature: hot"))
    .report.warnings.some((w) => /shares its slots with a sibling/.test(w.message)));

// a clean tree raises nothing in verify
check("verify: a well-formed tree yields no errors",
  lintTree(aot("Fruit", "    - Apple", "        colour: red", "    - Pear", "        colour: green")).report.errors.length === 0);

// ---------------------------------------------------------------------------
// lint: the full pipeline — numbered tree, sorted findings, subsumption
// ---------------------------------------------------------------------------
{
  const clean = aot(
    "Thing",
    "    - Cherry",
    "        colour: red",
    "    - Apple",
    "        colour: green",
  );
  const r = lint(clean, "World");
  check("lint: a clean file verifies (V = 0)", r.errors.length === 0);
  check("lint: the tree is numbered (root.chi present)", typeof r.root.chi === "bigint");
  check("lint: subsumption report is attached and consistent", r.subsumption && r.subsumption.consistent === true);

  // findings come back sorted by line
  const bad = lint(aot("World", "  x", "        deep"), "World");
  const lines = bad.errors.map((e) => e.line);
  check("lint: errors are sorted by line", lines.every((l, i) => i === 0 || lines[i - 1] <= l));
  check("lint: errors and warnings are reported separately", Array.isArray(bad.errors) && Array.isArray(bad.warnings));
}

// ---------------------------------------------------------------------------
// HINTS — godel.clashes (content): identical-content nodes
// ---------------------------------------------------------------------------
{
  const twins = aot(
    "Left",
    "    - Twin A",
    "        height: tall",
    "        mood: calm",
    "Right",
    "    - Twin B",
    "        height: tall",
    "        mood: calm",
  );
  const { root, nodes, errors } = lint(twins, "Pair");
  check("hint/clash: twins fixture verifies", errors.length === 0);
  const content = godel.clashes(root, nodes).findings.filter((f) => f.kind === "content");
  check("hint/clash: identical-content twins raise a content clash", content.length >= 1);
  check("hint/clash: message names the identical attributes and values",
    content.some((f) => f.message.includes("identical attributes and values")));

  // distinct content -> no content clash
  const distinct = lint(aot("Left", "    - A", "        h: tall", "Right", "    - B", "        h: short"), "Pair");
  check("hint/clash: differing content raises no content clash",
    godel.clashes(distinct.root, distinct.nodes).findings.filter((f) => f.kind === "content").length === 0);
}

// ---------------------------------------------------------------------------
// HINTS — armstrong.findings: derivable / equivalent attributes
// ---------------------------------------------------------------------------
{
  const sales = aot(
    "Ledger",
    "    - Order A",
    "        country: France",
    "        currency: EUR",
    "    - Order B",
    "        country: France",
    "        currency: EUR",
    "    - Order C",
    "        country: Germany",
    "        currency: EUR",
    "    - Order D",
    "        country: Japan",
    "        currency: JPY",
  );
  const { root, nodes, errors } = lint(sales, "Sales");
  check("hint/FD: sales fixture verifies", errors.length === 0);
  const fd = armstrong.findings(root, nodes);
  check("hint/FD: 'currency' is flagged derivable from 'country'",
    fd.some((f) => /determines 'currency'/.test(f.message) && f.message.includes("country")));

  // one-to-one attributes collapse to a single equivalence hint
  const twins = aot(
    "Catalogue",
    "    - Row 1",
    "        code: A",
    "        label: Alpha",
    "    - Row 2",
    "        code: B",
    "        label: Beta",
    "    - Row 3",
    "        code: C",
    "        label: Gamma",
  );
  const t = lint(twins, "Cat");
  const eq = armstrong.findings(t.root, t.nodes).filter((f) => /vary one-to-one/.test(f.message) && f.message.includes("code"));
  check("hint/FD: equivalent attributes reported once", eq.length === 1);
}

// ---------------------------------------------------------------------------
// HINTS — fca.suggest: the FCA audit (confirmed / drift / exhaustion)
// ---------------------------------------------------------------------------
{
  // confirmed: Fish and Bird are exactly formal concepts in the lattice
  const zoo = aot(
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
  );
  const z = lint(zoo, "Animal");
  check("hint/FCA: zoo fixture verifies", z.errors.length === 0);
  const report = suggest(z.root, z.nodes);
  check("hint/FCA: Fish and Bird confirmed by the lattice",
    report.confirmed.includes("Fish") && report.confirmed.includes("Bird"));

  // drift + exhaustion: a misfiled Example and an unmatched one
  const misfiled = aot(
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
  );
  const m = lint(misfiled, "Animal");
  const mr = suggest(m.root, m.nodes);
  check("hint/FCA: drift flags Goldfish filed under Bird",
    mr.findings.some((f) => /^drift: '- Goldfish' /.test(f.message) && f.message.includes("filed under 'Bird'")));
  check("hint/FCA: exhaustion flags Sponge matching no sub-Concept",
    mr.findings.some((f) => /^exhaustion: 'Animal'/.test(f.message) && f.message.includes("- Sponge")));

  // fewer than two Examples: nothing to analyse
  const tiny = lint(aot("Solo", "    - Only"), "World");
  check("hint/FCA: fewer than two Examples -> tooFew", suggest(tiny.root, tiny.nodes).tooFew === true);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
