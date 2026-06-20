// Smoke test for the Armstrong / functional-dependency reasoning
// (src/armstrong.js): infer FDs from Example data via Gödel projections, and
// walk the declared Concept-dependency closure.
const { lint } = require("../src/linter");
const { inferFDs, findings, dependsOf } = require("../src/armstrong");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const node = (root, nodes, name) => [root, ...nodes].find((n) => n.name === name);

// 1) X -> Y inferred: 'country' determines 'currency' across the Examples,
// but not the reverse (two countries can share a currency).
const sales = [
  "Ledger",
  "    - Order A",
  "        country: France",
  "        currency: EUR",
  "        amount: 10",
  "    - Order B",
  "        country: France",
  "        currency: EUR",
  "        amount: 20",
  "    - Order C",
  "        country: Germany",
  "        currency: EUR",
  "        amount: 30",
  "    - Order D",
  "        country: Japan",
  "        currency: JPY",
  "        amount: 40",
].join("\n");
{
  const { root, nodes, errors } = lint(sales, "Sales");
  check("sales fixture parses clean", errors.length === 0);
  const { holds } = inferFDs(root, nodes);
  const has = (x, y) => holds.some((h) => h.x === x && h.y === y);
  check("country -> currency inferred", has("country", "currency"));
  check("currency -> country NOT inferred (France/Germany share EUR)", !has("currency", "country"));
  check("amount determines nothing constant (varies freely)", !has("amount", "currency"));
  const fd = findings(root, nodes);
  check(
    "finding: 'currency' is derivable from 'country'",
    fd.some((f) => /determines 'currency'/.test(f.message) && f.message.includes("country")),
  );
}

// 2) X <-> Y equivalence: 'code' and 'label' vary one-to-one. 'qty' repeats
// (1,1,2,2) so it is neither a key nor bijective with code/label — it must not
// become a third equivalence partner.
const twins = [
  "Catalogue",
  "    - Row 1",
  "        code: A",
  "        label: Alpha",
  "        qty: 1",
  "    - Row 2",
  "        code: B",
  "        label: Beta",
  "        qty: 1",
  "    - Row 3",
  "        code: C",
  "        label: Gamma",
  "        qty: 2",
  "    - Row 4",
  "        code: D",
  "        label: Delta",
  "        qty: 2",
].join("\n");
{
  const { root, nodes, errors } = lint(twins, "Cat");
  check("twins fixture parses clean", errors.length === 0);
  const fd = findings(root, nodes);
  check(
    "finding: 'code' and 'label' vary one-to-one",
    fd.some((f) => /vary one-to-one/.test(f.message) && f.message.includes("code") && f.message.includes("label")),
  );
  // reported once, not twice (code<->label and label<->code collapse)
  const oneToOne = fd.filter((f) => /vary one-to-one/.test(f.message) && f.message.includes("code"));
  check("equivalence reported once, not twice", oneToOne.length === 1);
}

// 3) declared dependency closure: Z depends on X through Y, via the
// attribute-is-a-Concept references.
const deps = [
  "X",
  "    foo",
  "Y",
  "    a x",
  "Z",
  "    a y",
].join("\n");
{
  const { root, nodes, errors } = lint(deps, "Graph");
  check("deps fixture parses clean", errors.length === 0);
  const Z = node(root, nodes, "Z");
  const { direct, transitive } = dependsOf(root, nodes, Z);
  check("Z depends directly on Y", direct.some((d) => d.name === "Y"));
  check("Z depends transitively on X (through Y)", transitive.some((t) => t.node.name === "X" && t.through.some((n) => n.name === "Y")));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
