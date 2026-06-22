// Smoke test for the Armstrong / functional-dependency reasoning
// (src/armstrong.js): infer FDs from Example data via Gödel projections, and
// walk the declared Concept-dependency closure.
const { lint } = require("../src/linter");
const { inferFDs, findings } = require("../src/armstrong");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

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
  // code/label is a pure bijection (A/B/C/D, no value repeats): covariation,
  // confidence 0, kept off the editor.
  const cl = oneToOne[0];
  check("code/label tagged 'covaries' (no value repeats)", cl.kind === "covaries" && cl.confidence === 0);
}

// 2b) A confirmed equivalence: 'sku' and 'name' line up one-to-one AND two
// values repeat (P/P/Q/Q), so the collapse is witnessed twice — 'derivable',
// confidence 2, clears the editor threshold.
const confirmed = [
  "Stock",
  "    - Bin 1",
  "        sku: P",
  "        name: Widget",
  "    - Bin 2",
  "        sku: P",
  "        name: Widget",
  "    - Bin 3",
  "        sku: Q",
  "        name: Gadget",
  "    - Bin 4",
  "        sku: Q",
  "        name: Gadget",
].join("\n");
{
  const { root, nodes, errors } = lint(confirmed, "Inv");
  check("confirmed fixture parses clean", errors.length === 0);
  const { findings: f2, MIN_CONFIDENCE } = require("../src/armstrong");
  const fd = f2(root, nodes);
  const eq = fd.find((f) => f.message.includes("sku") && f.message.includes("name"));
  check("sku/name tagged 'derivable' with confidence 2", !!eq && eq.kind === "derivable" && eq.confidence === 2);
  check("confirmed equivalence clears the editor threshold", !!eq && eq.confidence >= MIN_CONFIDENCE);
  check("complete sample is not flagged incomplete", !!eq && !eq.incomplete);
}

// 2c) The same confirmed equivalence, but the Example set carries a '- ...'
// marker: the sample is admittedly partial, so the high-confidence finding is
// flagged 'incomplete' and stays off the editor squiggle.
const partial = confirmed + "\n    - ...";
{
  const { root, nodes, errors } = lint(partial, "Inv");
  check("partial fixture parses clean", errors.length === 0);
  const fd = findings(root, nodes);
  const eq = fd.find((f) => f.message.includes("sku") && f.message.includes("name"));
  check("'...' marker keeps confidence 2", !!eq && eq.confidence === 2);
  check("'...' marker flags the finding incomplete", !!eq && eq.incomplete === true);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
