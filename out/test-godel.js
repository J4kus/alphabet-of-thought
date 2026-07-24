// Smoke test for the Gödel numbering (src/godel.js): build small in-memory
// .aot fixtures, number them, and check the radical/override/clash/decode
// semantics the CLI queries rest on.
const { lint } = require("../src/linter");
const {
  buildGodel, clashes, overrides, diff, decode, valuation, radical,
  find, common, near,
} = require("../src/godel");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const node = (root, nodes, name) => [root, ...nodes].find((n) => n.name === name);

// 1) same attribute names, different values: equal radical, different G
const colours = [
  "Thing",
  "    - Cherry",
  "        colour: red",
  "        weight: light",
  "    - Apple",
  "        colour: green",
  "        weight: light",
].join("\n");
{
  const { root, nodes, errors } = lint(colours, "World");
  check("colours fixture parses clean", errors.length === 0);
  const { attrPrime } = buildGodel(root, nodes);
  const cherry = node(root, nodes, "Cherry"), apple = node(root, nodes, "Apple");
  const primeList = [...attrPrime.values()];
  check("same attribute names -> equal radical", radical(cherry.godel, primeList) === radical(apple.godel, primeList));
  check("different values -> different G", cherry.godel !== apple.godel);
  // decode round-trips the written value
  const slots = decode(cherry, attrPrime, buildGodel(root, nodes).valueCode, null);
  const colour = slots.find((s) => s.attr === "colour");
  check("decode round-trips colour: red", colour && colour.value === "red");
}

// 2) override: a child Example redeclares an inherited default with a new value
const override = [
  "Drink",
  "    temperature: cold",
  "    - Coffee",
  "        temperature: hot",
  "    - Water",
].join("\n");
{
  const { root, nodes, errors } = lint(override, "Menu");
  check("override fixture parses clean", errors.length === 0);
  const report = overrides(root, nodes);
  check(
    "override: '- Coffee' overrides inherited temperature cold -> hot",
    report.findings.some((f) => /override: '- Coffee'/.test(f.message) && f.message.includes("hot") && f.message.includes("cold")),
  );
  check("'- Water' inherits, no override reported", !report.findings.some((f) => f.message.includes("Water")));
}

// 3) clash: two unrelated nodes with identical content -> G equal + clash
const clash = [
  "Left",
  "    - Twin A",
  "        height: tall",
  "        mood: calm",
  "Right",
  "    - Twin B",
  "        height: tall",
  "        mood: calm",
].join("\n");
{
  const { root, nodes, errors } = lint(clash, "Pair");
  check("clash fixture parses clean", errors.length === 0);
  const a = node(root, nodes, "Twin A"), b = node(root, nodes, "Twin B");
  buildGodel(root, nodes);
  check("identical content -> equal G", a.godel === b.godel && a.godel > 1n);
  const report = clashes(root, nodes);
  const pair = report.findings.filter((f) => f.kind === "content");
  check("clash: both twins report, each related to the other",
    pair.length === 2
    && pair[0].line === a.line && pair[1].line === b.line
    && pair[0].related[0].line === b.line && pair[1].related[0].line === a.line);
  check(
    "clash: identical-content finding for the twins",
    report.findings.some((f) => /^clash:/.test(f.message) && f.message.includes("identical attributes and values")),
  );
}

// 4) valuation: an absent attribute has exponent 0, a present one >= 1
{
  const { root, nodes } = lint(colours, "World");
  const { attrPrime } = buildGodel(root, nodes);
  const cherry = node(root, nodes, "Cherry");
  check("valuation of a carried attribute is >= 1", valuation(cherry.godel, attrPrime.get("colour")) >= 1n);
}

// 5) diff: a file against itself reports no changes; a changed value shows up
{
  const a = lint(override, "Menu"), b = lint(override, "Menu");
  const same = diff(a.root, a.nodes, b.root, b.nodes);
  check("diff of identical trees -> no changes", same.findings.length === 0);
  const changed = lint(override.replace("temperature: hot", "temperature: warm"), "Menu");
  const report = diff(a.root, a.nodes, changed.root, changed.nodes);
  check("diff reports the changed Coffee temperature", report.findings.some((f) => /changed:/.test(f.message) && f.message.includes("temperature")));
}

// 6) find: query-by-example via divisibility
{
  const { root, nodes } = lint(colours, "World");
  buildGodel(root, nodes);
  const red = find(root, nodes, ["colour: red"]);
  check("find colour: red -> only Cherry", red.matches.length === 1 && red.matches[0].name === "Cherry");
  const light = find(root, nodes, ["weight: light"]);
  check("find weight: light -> both Cherry and Apple", light.matches.length === 2);
  const both = find(root, nodes, ["colour: green", "weight: light"]);
  check("find colour: green AND weight: light -> only Apple", both.matches.length === 1 && both.matches[0].name === "Apple");
  const miss = find(root, nodes, ["colour: purple"]);
  check("find an undeclared value -> unknown, no match", miss.matches.length === 0 && miss.unknown.length === 1);
}

// 7) common: gcd of two contents is what they agree on
{
  const { root, nodes } = lint(colours, "World");
  buildGodel(root, nodes);
  const cherry = node(root, nodes, "Cherry"), apple = node(root, nodes, "Apple");
  const c = common(root, nodes, cherry, apple);
  const attrs = c.slots.map((s) => `${s.attr}: ${s.value}`);
  check("common(Cherry, Apple) keeps weight: light", attrs.includes("weight: light"));
  check("common(Cherry, Apple) drops the differing colour", !attrs.some((a) => a.startsWith("colour")));
}

// 8) near: nearest neighbour by content distance
{
  const fruit = [
    "Bowl",
    "    - Lemon",
    "        colour: yellow",
    "        taste: sour",
    "    - Lime",
    "        colour: green",
    "        taste: sour",
    "    - Brick",
    "        colour: red",
    "        weight: heavy",
  ].join("\n");
  const { root, nodes } = lint(fruit, "Kitchen");
  buildGodel(root, nodes);
  const lemon = node(root, nodes, "Lemon");
  const ranked = near(root, nodes, lemon, 1);
  check("nearest to Lemon is Lime (shares taste: sour)", ranked[0].node.name === "Lime");
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
