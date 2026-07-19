// Smoke test for the Armstrong / functional-dependency reasoning
// (src/armstrong.js): infer FDs from Example data via Gödel projections, and
// walk the declared Concept-dependency closure.
const { lint } = require("../src/linter");
const { inferFDs, findings, dependsOf, chains, dependencyGraph, axioms } = require("../src/armstrong");

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

// 4) dependency chains: every maximal path out of a Concept, one per
// crosslinked *attribute* (the hop labelled with the attribute), growing by
// one Concept per dependency the previous link declares. An attribute's
// alias types it (`vehicle (car)` → Car), but a Concept that merely contains
// or is aliased to another is a kind of it, not a dependency, so it is no
// chain edge. A revisited Concept marks a cycle.
const chained = [
  "Trip",
  "    driver person",
  "    vehicle (car)",
  "Person",
  "    home address",
  "Address",
  "    street",
  "Car",
  "    owner person",
  "Loop A",
  "    partner loop b",
  "Loop B",
  "    partner loop a",
].join("\n");
{
  const { root, nodes } = lint(chained, "World");
  const show = (c) => c.path.map((n) => n.name).join(">") + (c.cycle ? " cycle" : "");
  const fromTrip = chains(root, nodes, node(root, nodes, "Trip")).map(show);
  check("Trip has two chains, one per crosslinked attribute", fromTrip.length === 2);
  check("chain via 'driver person': Trip > Person > Address (3 Concepts)", fromTrip.includes("Trip>Person>Address"));
  check("chain via the 'vehicle (car)' attribute alias: Trip > Car > Person > Address", fromTrip.includes("Trip>Car>Person>Address"));
  const viaLabels = chains(root, nodes, node(root, nodes, "Trip")).map((c) => c.via.join(">"));
  check("hops carry the attribute that declares them", viaLabels.includes("driver person>home address"));
  const fromLoop = chains(root, nodes, node(root, nodes, "Loop A"));
  check("mutual dependency reports one chain, marked a cycle",
    fromLoop.length === 1 && fromLoop[0].cycle && show(fromLoop[0]) === "Loop A>Loop B>Loop A cycle");
  check("a Concept with no dependencies has no chains", chains(root, nodes, node(root, nodes, "Address")).length === 0);
}

// 4b) a Concept that contains or is aliased to another is a *kind* of it,
// not a dependency: those crosslinks navigate but are not chain edges.
{
  const kinds = lint([
    "Tree",
    "Recurring Tree",   // name contains 'Tree' — a kind of Tree, not a dependency
    "Auto (Vehicle)",   // aliased to a general context — still not a dependency
    "Vehicle",
  ].join("\n"), "World");
  check("a name-contained Concept declares no dependency",
    chains(kinds.root, kinds.nodes, node(kinds.root, kinds.nodes, "Recurring Tree")).length === 0);
  check("a Concept alias declares no dependency",
    chains(kinds.root, kinds.nodes, node(kinds.root, kinds.nodes, "Auto")).length === 0);
}

// 5) value links declare dependencies too: a value naming an Example of
// another Concept is an edge to that Concept — no Concept name appears in
// the text, yet the dependency is real (linking must not hide it).
const valued = [
  "Human",
  "    - Socrates",
  "        home address: Athens",
  "Address",
  "    - Athens",
  "Census",
  "    human: Socrates",
].join("\n");
{
  const { root, nodes } = lint(valued, "World");
  const { edges } = dependencyGraph(root, nodes);
  const census = node(root, nodes, "Census");
  const out = edges.get(census) || [];
  check("a value naming an Example is an edge to its owning Concept, via the attribute",
    out.some((e) => e.to.name === "Human" && e.via === "human"));
  const fromCensus = chains(root, nodes, census).map((c) => c.path.map((n) => n.name).join(">"));
  check("chains run on through value links: Census > Human > Address",
    fromCensus.includes("Census>Human>Address"));
}

// 6) the axioms as lint rules: a dependency cycle is an error (one per edge
// on the loop, pinned to the attribute declaring it), a direct edge a chain
// through another Concept already implies is a warning. Self-edges
// (recursion) and parallel edges (two slots of one type) never flag.
{
  const looped = [
    "Loop A",
    "    partner loop b", // line 2 — on the cycle
    "Loop B",
    "    partner loop a", // line 4 — on the cycle
  ].join("\n");
  const { root, nodes } = lint(looped, "World");
  const ax = axioms(root, nodes);
  check("mutual dependency: one error per edge on the loop (2, not 4)", ax.errors.length === 2);
  check("cycle errors sit on the declaring attribute lines",
    ax.errors.some((e) => e.line === 2) && ax.errors.some((e) => e.line === 4));
  check("cycle error names the witnessing chain hover-style",
    ax.errors.some((e) => /^dependency cycle:/.test(e.message)
      && e.message.includes("Loop A ─partner loop b→ Loop B ─partner loop a→ Loop A")));
  check("a cycle edge is never also warned redundant", ax.warnings.length === 0);
}
{
  const threeCycle = [
    "Alpha",
    "    next beta",
    "Beta",
    "    next gamma",
    "Gamma",
    "    next alpha",
  ].join("\n");
  const { root, nodes } = lint(threeCycle, "World");
  const ax = axioms(root, nodes);
  check("a longer loop (A > B > C > A) is caught too, one error per edge", ax.errors.length === 3);
}
{
  const recursive = [
    "Node",
    "    parent node", // an attribute of one's own kind: recursion, not a loop
    "    label",
  ].join("\n");
  const { root, nodes } = lint(recursive, "World");
  const ax = axioms(root, nodes);
  check("direct self-reference stays legitimate recursion (Reflexivity: X -> X asserts nothing)",
    ax.errors.length === 0 && ax.warnings.length === 0);
}
{
  const parallel = [
    "Directional Edge",
    "    from node",
    "    to node",
    "Node",
    "    label",
  ].join("\n");
  const { root, nodes } = lint(parallel, "World");
  const ax = axioms(root, nodes);
  check("two slots of one type (parallel edges) never imply each other",
    ax.errors.length === 0 && ax.warnings.length === 0);
}
{
  const redundant = [
    "Alpha",
    "    beta",
    "    gamma", // line 3 — implied via Alpha > Beta > Gamma
    "Beta",
    "    gamma", // line 5 — not redundant: Beta's only path
    "Gamma",
    "    size",
  ].join("\n");
  const { root, nodes } = lint(redundant, "World");
  const ax = axioms(root, nodes);
  check("a transitively implied direct edge warns once, on its declaring line",
    ax.warnings.length === 1 && ax.warnings[0].line === 3);
  check("the warning names the implying chain",
    /^redundant dependency:/.test(ax.warnings[0].message)
      && ax.warnings[0].message.includes("Alpha ─beta→ Beta ─gamma→ Gamma"));
  check("redundancy is a warning, not an error", ax.errors.length === 0);
  // the negative: remove the intermediate hop and the redundancy is gone
  const direct = lint(redundant.replace("Beta\n    gamma", "Beta\n    size"), "World");
  const ax2 = axioms(direct.root, direct.nodes);
  check("without the implying chain the direct edge is not redundant", ax2.warnings.length === 0);
}
{
  // the spreadsheet shape: a mutual dependency between two Concepts, each
  // also declaring the edge the other's chain implies
  const sheet = [
    "Share",
    "Shares Outstanding",
    "    share",  // line 3 — redundant: implied via tensor
    "    tensor", // line 4 — on the cycle
    "Tensor",
    "    share",  // line 6 — redundant: implied via shares outstanding
    "    shares outstanding", // line 7 — on the cycle
  ].join("\n");
  const { root, nodes } = lint(sheet, "Market");
  const ax = axioms(root, nodes);
  check("spreadsheet shape: the mutual dependency errors on lines 4 and 7",
    ax.errors.length === 2 && ax.errors.some((e) => e.line === 4) && ax.errors.some((e) => e.line === 7));
  check("spreadsheet shape: both direct 'share' edges warn redundant (lines 3 and 6)",
    ax.warnings.length === 2 && ax.warnings.some((w) => w.line === 3) && ax.warnings.some((w) => w.line === 6));
  // the edges now carry their declaring line, for the pinning above
  const { edges } = dependencyGraph(root, nodes);
  const so = node(root, nodes, "Shares Outstanding");
  check("dependencyGraph edges carry the declaring line",
    (edges.get(so) || []).some((e) => e.to.name === "Share" && e.via === "share" && e.line === 3));
}

// 7) Transitivity's minimal cover over the inferred FDs: an X -> Z that
// X -> Y and Y -> Z already give is tagged 'implied' (held off the squiggle
// channel; --fd still prints it). Equivalence members are immune.
const covered = [
  "Ledger",
  "    - Order A",
  "        country: France",
  "        currency: EUR",
  "        symbol: E",
  "    - Order B",
  "        country: France",
  "        currency: EUR",
  "        symbol: E",
  "    - Order C",
  "        country: Germany",
  "        currency: EUR",
  "        symbol: E",
  "    - Order D",
  "        country: Japan",
  "        currency: JPY",
  "        symbol: Y",
].join("\n");
{
  const { root, nodes, errors } = lint(covered, "Sales");
  check("cover fixture parses clean", errors.length === 0);
  const fd = findings(root, nodes);
  const eq = fd.find((f) => f.message.includes("currency") && f.message.includes("symbol") && /equivalent|one-to-one/.test(f.message));
  check("currency <-> symbol equivalence found and immune to the cover", !!eq && !eq.implied);
  const toCurrency = fd.find((f) => /determines 'currency'/.test(f.message));
  const toSymbol = fd.find((f) => /determines 'symbol'/.test(f.message));
  check("exactly one of country's two consequences is tagged implied",
    !!toCurrency && !!toSymbol && !!toCurrency.implied !== !!toSymbol.implied);
  const implied = toCurrency.implied ? toCurrency : toSymbol;
  check("the implied finding carries its witnessing chain",
    Array.isArray(implied.implied) && implied.implied.length === 3 && implied.implied[0] === "country");
  // the negative: without the equivalence there is no chain, nothing implied
  const flat = lint(covered.split("\n").filter((l) => !l.includes("symbol")).join("\n"), "Sales");
  const flatFd = findings(flat.root, flat.nodes);
  check("without a covering chain no finding is implied", flatFd.every((f) => !f.implied));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
