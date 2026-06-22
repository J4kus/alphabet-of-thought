// Smoke test for the Gödel numbering (src/godel.js): build small in-memory
// .aot fixtures, number them, and check the radical/clash/valuation semantics
// the linter rests on.
const { lint } = require("../src/linter");
const { buildGodel, clashes, valuation, radical } = require("../src/godel");

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
}

// 2) clash: two unrelated nodes with identical content -> G equal + clash
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
  check(
    "clash: identical-content finding for the twins",
    report.findings.some((f) => /^clash:/.test(f.message) && f.message.includes("identical attributes and values")),
  );
}

// 3) valuation: an absent attribute has exponent 0, a present one >= 1
{
  const { root, nodes } = lint(colours, "World");
  const { attrPrime } = buildGodel(root, nodes);
  const cherry = node(root, nodes, "Cherry");
  check("valuation of a carried attribute is >= 1", valuation(cherry.godel, attrPrime.get("colour")) >= 1n);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
