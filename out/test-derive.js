// Unit tests for line-form formulas and constraints (src/derive.js): the
// reference semantics (@attr, aggregates over sibling Examples, @Example),
// the audit spans, the recompute fixpoint, and the copy-to-siblings edit.
//
// Plain Node script, no framework — run with: node out/test-derive.js
const { lint } = require("../src/linter");
const { auditValues, recomputeValues, copyToSiblings, conceptRegistry, addExample, updateExamples, formulaReferences, mirrorGrids, updateScope } = require("../src/derive");
const { mergeRegistries } = require("../src/table");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const aot = (...lines) => lines.join("\n");
const parsed = (text) => {
  const { root, nodes } = lint(text, "Sheet");
  return { root, nodes, lines: text.split(/\r?\n/) };
};

// ---------------------------------------------------------------------------
// references: @attr on the same Example, @Example across siblings, @N rejected
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    - A",
    "        price: 10",
    "        vat: 2 =@price*0.2",
    "        copy: =@price@B",
    "        bad: =@2*2",
    "    - B",
    "        price: 20",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  const vat = audit.find((f) => f.line === 4);
  const copy = audit.find((f) => f.line === 5);
  const bad = audit.find((f) => f.line === 6);
  check("audit: @attr reads the sibling attribute (2 = 10*0.2 is true)", vat && !vat.stale && !vat.error);
  check("audit: @attr@Example reads the named sibling Example",
    copy && copy.stale === true && /is not yet computed \(= 20\)/.test(copy.message));
  check("audit: positional @N is gone — a digits lead that names nothing errors",
    bad && bad.error === true && /positional column numbers were removed/.test(bad.message));
  check("audit: spans run from the operator to the value's end",
    vat.startCol === lines[3].indexOf("=") && vat.endCol === lines[3].length);

  // the instrumented walk: every '@' name in every line-form formula, its
  // exact span and the declaring nodes it resolves to — what a rename edits
  const refs = formulaReferences(root, nodes, lines);
  const attrRef = refs.find((r) => r.line === 4 && r.text === "price");
  check("formulaReferences: @attr answers its span and every declaring copy",
    attrRef && attrRef.kind === "column"
    && lines[3].slice(attrRef.startCol, attrRef.endCol) === "price"
    && attrRef.nodes.length === 2 && attrRef.nodes.every((n) => n.name === "price"));
  const exRef = refs.find((r) => r.line === 5 && r.text === "B");
  check("formulaReferences: @Example answers the sibling's node",
    exRef && exRef.kind === "row" && exRef.nodes.length === 1 && exRef.nodes[0].name === "B");
}

// ---------------------------------------------------------------------------
// a line-form value reaching a foreign table by its parent name, through
// the registry — @Table@col@Example and sum(@Table@col)
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Prices",
    "    |name |price|",
    "    |-----+-----|",
    "    |Acme |10   |",
    "    |Bolt |20   |",
    "Order",
    "    - A",
    "        cost: =@Prices@price@Acme",
    "        allcost: =sum(@Prices@price)",
  );
  const { root, nodes, lines } = parsed(text);
  const reg = mergeRegistries(conceptRegistry(root, nodes));
  const edits = recomputeValues(root, nodes, lines, reg);
  check("cross-table (line-form): @Table@col@Example reads the foreign cell",
    edits.some((e) => e.text.includes("cost: 10 =@Prices@price@Acme")));
  check("cross-table (line-form): sum(@Table@col) totals the foreign column",
    edits.some((e) => e.text.includes("allcost: 30 =sum(@Prices@price)")));
  check("cross-table (line-form): the audit is quiet once the foreign values are filled",
    (() => {
      const filled = lines.slice();
      for (const e of edits) filled[e.line - 1] = e.text;
      const re = lint(filled.join("\n"), "Sheet");
      return auditValues(re.root, re.nodes, filled, reg).every((f) => !f.error && !f.stale);
    })());
  check("cross-table (line-form): without a registry the foreign reference is #ERR",
    recomputeValues(root, nodes, lines).some((e) => e.text.includes("cost: #ERR")));
}

// ---------------------------------------------------------------------------
// aggregates range over the other sibling Examples under the same parent
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    total: =sum(@price)",
    "    - A",
    "        price: 10",
    "    - B",
    "        price: 20",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  const total = audit.find((f) => f.line === 2);
  check("audit: a Concept's own default aggregates over its Examples",
    total && total.stale === true && /\(= 30\)/.test(total.message));

  const edits = recomputeValues(root, nodes, lines);
  check("recompute: fills the value and keeps the formula",
    edits.length === 1 && edits[0].line === 2 && edits[0].text === "    total: 30 =sum(@price)");
}

// ---------------------------------------------------------------------------
// the fixpoint: a formula referencing another formula's value converges
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    - A",
    "        price: 10",
    "        vat: =@price*0.2",
    "        gross: =@price+@vat",
  );
  const { root, nodes, lines } = parsed(text);
  const edits = recomputeValues(root, nodes, lines);
  const gross = edits.find((e) => e.line === 5);
  check("recompute: a formula may build on another formula's fresh value",
    gross && gross.text.includes("gross: 12 =@price+@vat"));
}

// ---------------------------------------------------------------------------
// constraints live on the attribute; every value of it is validated
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Person",
    "    age >=18",
    "    label ==`ada`",
    "    - Ada",
    "        age: 15",
    "        label: ada",
    "    - Bea",
    "        age: 21",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  const declared = audit.find((f) => f.line === 2 && f.op === ">=");
  const violated = audit.find((f) => f.line === 5);
  const fine = audit.find((f) => f.line === 8 && (f.error || f.warning));
  const label = audit.find((f) => f.line === 6 && (f.error || f.warning));
  check("audit: the declaration's span is returned for the colouring",
    declared && !declared.error && declared.startCol === lines[1].indexOf(">=") && declared.formula === "18");
  check("audit: a value under the bound is a warning pinned to the value",
    violated && violated.warning === true && !violated.error && violated.paint === false
    && /value '15' violates 'age >= 18' \(line 2\)/.test(violated.message)
    && violated.startCol === lines[4].indexOf("15"));
  check("audit: a satisfying value raises nothing", fine === undefined);
  check("audit: string equality bounds compare exactly", label === undefined);
  check("recompute: constrained plain values are never rewritten",
    recomputeValues(root, nodes, lines).length === 0);
}

// ---------------------------------------------------------------------------
// chained constraints: one declaration may carry several bounds
// ('age >=18 <=65'), each checked on its own — bare lines and header
// cells alike
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Person",
    "    age >=18 <=65",
    "    - Ada",
    "        age: 15",
    "    - Bea",
    "        age: 70",
    "    - Cal",
    "        age: 30",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  const spans = audit.filter((f) => f.line === 2 && f.op);
  check("chain: each bound answers its own coloured span",
    spans.length === 2 && spans[0].op === ">=" && spans[1].op === "<="
    && spans[0].startCol === lines[1].indexOf(">=18")
    && spans[1].startCol === lines[1].indexOf("<=65")
    && spans[0].endCol === lines[1].indexOf(" <=65"));
  check("chain: a value under the floor violates the '>=' bound alone",
    (() => {
      const f = audit.filter((x) => x.line === 4 && x.warning);
      return f.length === 1 && /value '15' violates 'age >= 18'/.test(f[0].message);
    })());
  check("chain: a value over the ceiling violates the '<=' bound alone",
    (() => {
      const f = audit.filter((x) => x.line === 6 && x.warning);
      return f.length === 1 && /value '70' violates 'age <= 65'/.test(f[0].message);
    })());
  check("chain: a value inside both bounds raises nothing",
    !audit.some((x) => x.line === 8 && (x.error || x.warning)));
}
{
  const text = aot(
    "Ledger",
    "    |name|qty >=1 <=5|",
    "    |----+-----------|",
    "    |A   |0          |",
    "    |B   |9          |",
    "    |C   |3          |",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  check("chain: a header cell's bounds hold its column both ways",
    audit.some((f) => f.line === 4 && f.warning && /violates 'qty >= 1'/.test(f.message))
    && audit.some((f) => f.line === 5 && f.warning && /violates 'qty <= 5'/.test(f.message))
    && !audit.some((f) => f.line === 6 && (f.error || f.warning)));
  check("chain: an uncomputable second bound errors on its own span, once",
    (() => {
      const t2 = aot(
        "Ledger",
        "    |name|qty >=1 <=@nope|",
        "    |----+---------------|",
        "    |A   |3              |",
      );
      const p2 = parsed(t2);
      const a2 = auditValues(p2.root, p2.nodes, p2.lines);
      const errs2 = a2.filter((f) => f.error);
      return errs2.length === 1 && /'<=@nope' on 'qty' does not compute/.test(errs2[0].message)
        && errs2[0].startCol === p2.lines[1].indexOf("<=@nope");
    })());
}

// ---------------------------------------------------------------------------
// constraint references resolve per value: each row is held to a bound
// computed from its own cells; a value outside the declaring subtree is
// not governed
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    |name|price|margin >=@price*0.1|",
    "    |----+-----+-------------------|",
    "    |A   |100  |20                 |",
    "    |B   |100  |5                  |",
    "Loose Order",
    "    - C",
    "        margin: 1",
  );
  const { root, nodes, lines } = parsed(text);
  const { errors } = require("../src/linter").lint(text, "Sheet");
  check("scope fixture parses clean", errors.length === 0);
  const audit = auditValues(root, nodes, lines);
  const rowB = audit.find((f) => f.line === 5 && f.warning);
  check("audit: a column's bound is checked per row, against that row's own cells",
    rowB && /value '5' violates 'margin >= 10'/.test(rowB.message)
    && rowB.startCol === lines[4].indexOf("5 "));
  check("audit: a row that satisfies its own bound stays quiet",
    !audit.some((f) => f.line === 4 && (f.error || f.warning)));
  check("audit: a value outside the declaring subtree is not governed",
    !audit.some((f) => f.line === 8 && (f.error || f.warning)));
}

// ---------------------------------------------------------------------------
// a header cell's own constraint, and an uncomputable bound reported once
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Ledger",
    "    |name|qty >=1|cap <=@nope|",
    "    |----+-------+-----------|",
    "    |A   |0      |1       |",
    "    |B   |2      |2       |",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  const qty = audit.find((f) => f.line === 4 && f.warning && /qty/.test(f.message));
  const decl = audit.find((f) => f.line === 2 && f.op === ">=");
  const broken = audit.filter((f) => f.error && /does not compute/.test(f.message));
  check("audit: a header constraint holds its column's cells",
    qty && /value '0' violates 'qty >= 1'/.test(qty.message));
  check("audit: the header declaration's span sits inside its cell",
    decl && decl.startCol === lines[1].indexOf(">=1"));
  check("audit: an uncomputable bound is the declaration's error, reported once",
    broken.length === 1 && broken[0].line === 2 && /cap/.test(broken[0].message));
}

// ---------------------------------------------------------------------------
// date-aware bounds: two ISO dates compare chronologically
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Record",
    "    due >=`2025-01-01`",
    "    - Good",
    "        due: 2026-01-01",
    "    - Bad",
    "        due: 2024-06-01",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  const warn = (re) => audit.find((f) => f.warning && re.test(f.message));
  check("audit: a date bound compares chronologically (2024-06-01 < 2025-01-01)",
    !!warn(/value '2024-06-01' violates 'due >= `2025-01-01`'/));
  check("audit: a date within the bound raises nothing",
    !audit.some((f) => (f.error || f.warning) && f.line === 4));
}

// ---------------------------------------------------------------------------
// copyToSiblings: replace an existing derivation, insert a missing attribute
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    - A",
    "        price: 10",
    "        vat: 2 =@price*0.2",
    "    - B",
    "        price: 20",
    "        vat: 9",
    "    - C",
    "        price: 30",
  );
  const { root, nodes, lines } = parsed(text);
  const ops = copyToSiblings(root, nodes, lines, 3); // the 'vat: 2 =@price*0.2' line
  const replaced = ops && ops.find((o) => o.type === "replace");
  const inserted = ops && ops.find((o) => o.type === "insert");
  check("copy: a peer's existing attribute keeps its value, gains the formula",
    replaced && replaced.line === 7 && replaced.text === "        vat: 9 =@price*0.2");
  check("copy: a peer without the attribute gains a fresh line after its block",
    inserted && inserted.afterLine === 9 && inserted.text === "        vat: =@price*0.2");
  check("copy: a non-formula line copies nothing", copyToSiblings(root, nodes, lines, 2) === null);
}

// ---------------------------------------------------------------------------
// a local attribute named after the table it points at no longer shadows it:
// the local reading is tried first and, when it cannot be completed, the
// foreign table gets its turn
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Person",
    "    |name    |nationality|alias|",
    "    |--------+-----------+-----|",
    "    |Socrates|RSA        |Paul |",
    "Measurement",
    "    person: Socrates",              // a sibling attribute named 'person'
    "    alias: =@Person@alias@Socrates", // ... must not swallow this lead
    "    where: =@Person@nationality@Socrates",
    "    mine: =@person",                 // the local attribute still wins outright
  );
  const { root, nodes, lines } = parsed(text);
  const reg = mergeRegistries(conceptRegistry(root, nodes));
  const edits = recomputeValues(root, nodes, lines, reg);
  check("shadowing: @Person@alias@Socrates reaches the table past the local 'person'",
    edits.some((e) => e.text.includes("alias: Paul =@Person@alias@Socrates")));
  check("shadowing: the same holds for any of the table's columns",
    edits.some((e) => e.text.includes("where: RSA =@Person@nationality@Socrates")));
  check("shadowing: a lone @person still reads the local attribute, not the table",
    edits.some((e) => e.text.includes("mine: Socrates =@person")));
}

// an aggregate's column reference is read the same way: the local attribute
// gives way to the table when it cannot name a whole column
{
  const text = aot(
    "Prices",
    "    |name |price|",
    "    |-----+-----|",
    "    |Acme |10   |",
    "    |Bolt |20   |",
    "Order",
    "    prices: some",                  // a sibling attribute named 'prices'
    "    total: =sum(@Prices@price)",    // ... must not swallow this lead
  );
  const { root, nodes, lines } = parsed(text);
  const edits = recomputeValues(root, nodes, lines, mergeRegistries(conceptRegistry(root, nodes)));
  check("shadowing: sum(@Prices@price) reaches the table past the local 'prices'",
    edits.some((e) => e.text.includes("total: 30 =sum(@Prices@price)")));
}

// ---------------------------------------------------------------------------
// a line-form Concept is referenced exactly as a table is: its Examples are
// the rows, its attributes the columns, and a numeric Example name is an
// Example (line form has no columns to number)
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Integer",
    "    is prime: No",
    "    - 1",
    "        is prime: Yes",
    "        weight: 4",
    "    - 35",
    "        is prime: No",
    "        weight: 6",
    "    - 7",
    "        weight: 2",                 // silent on 'is prime': inherits 'No'
    "Measurement",
    "    age: =@Integer@35@is prime",
    "    first: =@Integer@is prime@1",   // column and Example in either order
    "    heavy: =sum(@Integer@weight)",
    "    quiet: =@Integer@is prime@7",   // the Concept's own default stands in
  );
  const { root, nodes, lines } = parsed(text);
  const reg = mergeRegistries(conceptRegistry(root, nodes));
  const edits = recomputeValues(root, nodes, lines, reg);
  check("line-form scope: @Concept@Example@attribute reads a numeric Example",
    edits.some((e) => e.text.includes("age: No =@Integer@35@is prime")));
  check("line-form scope: the column and the Example may come in either order",
    edits.some((e) => e.text.includes("first: Yes =@Integer@is prime@1")));
  check("line-form scope: an aggregate ranges over the Concept's column",
    edits.some((e) => e.text.includes("heavy: 12 =sum(@Integer@weight)")));
  check("line-form scope: an Example silent on an attribute inherits the default",
    edits.some((e) => e.text.includes("quiet: No =@Integer@is prime@7")));
  check("line-form scope: without a registry the reference is #ERR",
    recomputeValues(root, nodes, lines).some((e) => e.text.includes("age: #ERR")));

  const scope = conceptRegistry(root, nodes).get("integer");
  check("line-form scope: the Concept offers its attributes as columns and Examples as rows",
    scope && scope.columns.join(",") === "is prime,weight" && scope.rows.join(",") === "1,35,7");
  check("line-form scope: a Concept listing no Examples has nothing to answer with",
    !conceptRegistry(root, nodes).has("measurement"));
}

// ---------------------------------------------------------------------------
// a Concept's own value: @Concept@attribute, with no Example named, reads
// the value the Concept states on its own line
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Person",
    "    |name    |alias|",
    "    |--------+-----|",
    "    |Socrates|Paul |",
    "Integer",
    "    is prime: No",              // a value the Concept states itself
    "    - 1",
    "        is prime: Yes",
    "        weight: 4",             // an attribute only an Example carries
    "Measurement",
    "    age (integer): 5",
    "    alias: Paul",
    "File",
    "    borrowed: =@Measurement@alias",
    "    typed: =@Measurement@integer",   // the attribute's alias reaches it
    "    default: =@Integer@is prime",    // the Concept's own, not an Example's
    "    listed: =@Integer@is prime@1",   // the Example's still overrides
  );
  const { root, nodes, lines } = parsed(text);
  const reg = mergeRegistries(conceptRegistry(root, nodes));
  const edits = recomputeValues(root, nodes, lines, reg);
  check("own value: @Concept@attribute reads the value the Concept states itself",
    edits.some((e) => e.text.includes("borrowed: Paul =@Measurement@alias")));
  check("own value: an attribute's alias reaches the same value",
    edits.some((e) => e.text.includes("typed: 5 =@Measurement@integer")));
  check("own value: a Concept's default is read without naming an Example",
    edits.some((e) => e.text.includes("default: No =@Integer@is prime")));
  check("own value: naming an Example still reads the Example's own value",
    edits.some((e) => e.text.includes("listed: Yes =@Integer@is prime@1")));

  // a Concept in the registry only for its own values is registered too —
  // it has something to answer with, even with no Examples at all
  const scope = conceptRegistry(root, nodes).get("measurement");
  check("own value: a Concept with no Examples is registered for its values",
    scope && scope.rows.length === 0 && scope.self("alias") === "Paul");

  const errs = (formula) => {
    const t2 = aot(...text.split("\n").slice(0, -4), `    x: =${formula}`);
    const p2 = parsed(t2);
    const r2 = mergeRegistries(conceptRegistry(p2.root, p2.nodes));
    return auditValues(p2.root, p2.nodes, p2.lines, r2).filter((f) => f.error);
  };
  check("own value: a Concept with no stated default says so, table-formed or not",
    errs("@Person@alias").some((f) => /states no value of its own here/.test(f.message)));
  check("own value: a Concept stating no value there says so, and points at its Examples",
    errs("@Integer@weight").some((f) => /states no value of its own here/.test(f.message)));
}

// one scope for both notations: a Concept written as a table answers its
// stated free-text defaults too — grid and line form are one dataset (1.6)
{
  const text = aot(
    "Person",
    "    alias: Someone",
    "    |name    |alias|",
    "    |--------+-----|",
    "    |Socrates|Paul |",
    "Check",
    "    who: =@Person@alias",
    "    his: =@Person@alias@Socrates",
  );
  const { root, nodes, lines } = parsed(text);
  const reg = mergeRegistries(conceptRegistry(root, nodes));
  const edits = recomputeValues(root, nodes, lines, reg);
  check("unified scope: a table-formed Concept answers its stated default",
    edits.some((e) => e.text.includes("who: Someone =@Person@alias")));
  check("unified scope: a row's own cell still overrides the stated default",
    edits.some((e) => e.text.includes("his: Paul =@Person@alias@Socrates")));
}

// ---------------------------------------------------------------------------
// the union CSV mirror: one grid per Concept, both notations together
// ---------------------------------------------------------------------------
{
  const text = aot(
    "File Tester",
    "    origin: EU",
    "    - loose one",
    "        weight: 7",
    "    - test 1",
    "        |name                |alias|",
    "        |--------------------+-----|",
    "        |aot.files/Person.csv|Mike |",
    "Other",
    "    - x",
  );
  const { root, nodes } = parsed(text);
  const grids = mirrorGrids(root, nodes);
  const ft = grids.find((g) => g.name === "File Tester");
  check("mirror: one union grid per Concept, a table under an Example included",
    ft && ft.hasTable === true
    && ft.header.join(",") === "name,origin,weight,alias"
    && ft.rows.length === 3);
  check("mirror: a row silent on a column answers the nearest default, else blank",
    ft.rows[0].join("|") === "loose one|EU|7|"
    && ft.rows[1].join("|") === "test 1|EU||"
    && ft.rows[2].join("|") === "aot.files/Person.csv|EU||Mike");
  const other = grids.find((g) => g.name === "Other");
  check("mirror: a pure line-form Concept grids too, marked table-less",
    other && other.hasTable === false && other.rows.length === 1 && other.header.join(",") === "name");
}

// ---------------------------------------------------------------------------
// updateScope: the union CSV folds back by Example name, wherever it lives
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    origin: EU",
    "    - Loose",
    "        weight: 7",
    "    |name|price       |",
    "    |----+------------|",
    "    |Acme|10          |",
    "    |Bolt|=@price@Acme|",
  );
  const { root, nodes, lines } = parsed(text);
  const concept = nodes.find((n) => n.name === "Order");
  const header = ["name", "price", "weight", "origin"];
  const rows = [
    ["Acme", "12", "5", ""],   // the price cell updates; weight has no column
    ["Bolt", "99", "", ""],    // a formula cell keeps its formula
    ["Loose", "", "8", ""],    // a line-form Example updates in place
    ["Fresh", "3", "", ""],    // a new name lands as a row of the direct table
  ];
  const ops = updateScope(lines, root, nodes, concept, header, rows, "Sheet");
  const applied = lines.slice();
  const lineOf = (op) => (op.type === "replace" ? op.line : op.type === "block" ? op.from + 1 : op.afterLine);
  for (const op of [...ops].sort((a, b) => lineOf(b) - lineOf(a))) {
    if (op.type === "block") applied.splice(op.from, op.to - op.from + 1, ...op.block);
    else if (op.type === "replace") applied[op.line - 1] = op.text;
    else applied.splice(op.afterLine, 0, ...op.text.split("\n"));
  }
  const out = applied.join("\n");
  check("fold: a table row updates within its own columns, redrawn aligned",
    out.includes("|Acme |12          |"));
  check("fold: a formula cell keeps its formula",
    out.includes("|Bolt |=@price@Acme|"));
  check("fold: a fresh name lands as a row of the Concept's own table",
    out.includes("|Fresh|3           |"));
  check("fold: a line-form Example updates attribute by attribute",
    out.includes("weight: 8"));
  check("fold: a valued cell whose table lacks the column is left to the tree",
    !out.includes("weight: 5") && !out.includes("|5"));
  check("fold: a blank cell erases nothing", out.includes("origin: EU"));
}

// ---------------------------------------------------------------------------
// addExample: the edit that lists a value as an Example, in whichever form
// the Concept is already written
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Integer",
    "    - 1",
    "        is prime: Yes",
    "    - 35",
    "        is prime: No",
    "Person",
    "    |name    |alias|",
    "    |--------+-----|",
    "    |Socrates|Paul |",
  );
  const { root, nodes, lines } = parsed(text);
  const integer = nodes.find((n) => n.name === "Integer");
  const person = nodes.find((n) => n.name === "Person");

  const line = addExample(root, nodes, lines, integer, "5", "Sheet");
  check("addExample: a line-form Concept gains a '- value' after its last Example",
    line && line.to < line.from && line.from === 5 && line.block[0] === "    - 5");

  const row = addExample(root, nodes, lines, person, "James", "Sheet");
  check("addExample: a Concept written as a table gains a row instead",
    row && row.changed && row.block.some((l) => /\|James\s*\|\s*\|/.test(l)));
  check("addExample: the new row keeps the table's own columns",
    row && row.block[0].includes("name") && row.block[0].includes("alias"));
}

// ---------------------------------------------------------------------------
// a constraint may list the allowed values with or(): `==or(...)` asks that
// the value be one of them
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    status ==or(`draft`,`sent`,`paid`)",
    "    - A",
    "        status: sent",
    "    - B",
    "        status: void",
    "    - C",
    "        status: paid",
  );
  const { root, nodes, lines } = parsed(text);
  const findings = auditValues(root, nodes, lines).filter((f) => f.error || f.warning);
  check("enumeration: a value outside the list is a warning naming the alternatives",
    findings.length === 1 && findings[0].line === 6 && findings[0].warning === true
    && /value 'void' violates 'status == `draft` or `sent` or `paid`'/.test(findings[0].message));
  check("enumeration: a value on the list raises nothing",
    !findings.some((f) => f.line === 4 || f.line === 8));
}

// the same over a table's header cell, and with numbers
{
  const text = aot(
    "Order",
    "    |name |grade ==or(1,2,3)|",
    "    |-----+------------------|",
    "    |Alpha|2                 |",
    "    |Beta |9                 |",
  );
  const { root, nodes, lines } = parsed(text);
  const findings = auditValues(root, nodes, lines).filter((f) => f.error || f.warning);
  check("enumeration: a header cell lists its column's allowed values",
    findings.length === 1 && findings[0].line === 5 && findings[0].warning === true && /value '9' violates/.test(findings[0].message));
}

// and the logic reads as logic in a value's own formula
{
  const text = aot(
    "Order",
    "    - A",
    "        qty: 3",
    "        price: 10",
    "        ok: =if(and(@qty>0,@price>0),`yes`,`no`)",
    "        any: =if(or(@qty>5,@price>5),`yes`,`no`)",
    "        none: =if(or(@qty>5,@price>50),`yes`,`no`)",
  );
  const { root, nodes, lines } = parsed(text);
  const edits = recomputeValues(root, nodes, lines);
  check("logic: and() over two true tests",
    edits.some((e) => e.text.includes("ok: yes =")));
  check("logic: or() is true when either test is",
    edits.some((e) => e.text.includes("any: yes =")));
  check("logic: or() is false when neither is",
    edits.some((e) => e.text.includes("none: no =")));
}

// ---------------------------------------------------------------------------
// an escaped '=' keeps its value plain, and survives a recompute of the
// lines around it
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Note",
    "    - A",
    "        formula text: a \\= b",
    "        computed: =2*2",
  );
  const { root, nodes, lines } = parsed(text);
  const escaped = nodes.find((n) => n.name === "formula text");
  check("escape: the model reads the value with its '=', and no formula",
    escaped && escaped.value === "a = b" && escaped.formula === undefined);
  const edits = recomputeValues(root, nodes, lines);
  check("escape: an escaped value is not a host, so a recompute leaves its line alone",
    edits.length === 1 && edits[0].line === 4);
  check("escape: the neighbouring formula still computes",
    edits[0].text.includes("computed: 4 =2*2"));
}

// ---------------------------------------------------------------------------
// updateExamples: a CSV's rows merge into a line-form Concept by name,
// leaving the Concept in the form its author wrote it in
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Integer",
    "    - 1",
    "        is prime: Yes",
    "        weight: 4",
    "    - 35",
    "        is prime: Maybe",       // the grid corrects this
    "    - 9",
    "        is prime: No",
    "        weight: =1+1",          // derived: the formula owns it
  );
  const { root, nodes, lines } = parsed(text);
  const integer = nodes.find((n) => n.name === "Integer");
  const header = ["name", "is prime", "weight"];
  const rows = [
    ["1", "Yes", "4"],      // unchanged throughout
    ["35", "No", "6"],      // one value corrected, one attribute missing
    ["9", "No", "99"],      // the weight is derived: left alone
    ["7", "Yes", "2"],      // a whole new Example
  ];
  const ops = updateExamples(lines, integer, header, rows);

  check("updateExamples: a changed value replaces its own line, nothing else",
    ops.filter((o) => o.type === "replace").length === 1
    && ops.find((o) => o.type === "replace").line === 6
    && ops.find((o) => o.type === "replace").text === "        is prime: No");
  check("updateExamples: an attribute the Example lacks is added beneath it",
    ops.some((o) => o.type === "insert" && o.afterLine === 6 && o.text === "        weight: 6"));
  check("updateExamples: a derived value is left to its formula",
    !ops.some((o) => /weight: 99/.test(o.text)));
  check("updateExamples: a row with no Example is appended whole, as line form",
    ops.some((o) => o.type === "insert" && o.afterLine === 9
      && o.text === "    - 7\n        is prime: Yes\n        weight: 2"));
  check("updateExamples: a grid that changes nothing edits nothing",
    updateExamples(lines, integer, header, [["1", "Yes", "4"]]).length === 0);
  check("updateExamples: a blank cell says nothing rather than erasing",
    updateExamples(lines, integer, header, [["1", "", ""]]).length === 0);

  // applied bottom-up, the ops land where they were measured
  const applied = lines.slice();
  const lineOf = (o) => (o.type === "replace" ? o.line : o.afterLine);
  for (const op of [...ops].sort((a, b) => lineOf(b) - lineOf(a))) {
    if (op.type === "replace") applied[op.line - 1] = op.text;
    else applied.splice(op.afterLine, 0, ...op.text.split("\n"));
  }
  const re = lint(applied.join("\n"), "Sheet");
  const scope = conceptRegistry(re.root, re.nodes).get("integer");
  check("updateExamples: the folded file reads back as the grid that made it",
    scope.rows.join(",") === "1,35,9,7"
    && scope.cellAt("is prime", 1) === "No" && scope.cellAt("weight", 1) === "6"
    && scope.cellAt("weight", 3) === "2");
  check("updateExamples: the Concept is still line form, not a table",
    !applied.some((l) => l.trim().startsWith("|")));
}

// the collision: when the *last* Example gains an attribute and a fresh
// Example is appended too, both land after that Example's last line. Applied
// bottom-up they would arrive reversed, putting the attribute meant for the
// last Example under the fresh one — so they must merge into one op.
{
  const text = aot(
    "Integer",
    "    - 1",
    "        is prime: Yes",
    "    - 35",                // the last Example ...
    "        is prime: No",    // ... and its last line
  );
  const { root, nodes, lines } = parsed(text);
  const integer = nodes.find((n) => n.name === "Integer");
  const ops = updateExamples(lines, integer, ["name", "is prime", "weight"], [
    ["35", "No", "6"],   // an attribute for the last Example
    ["7", "Yes", "2"],   // and a fresh Example after it
  ]);
  check("updateExamples: two inserts after one line merge into a single op",
    ops.length === 1 && ops[0].type === "insert" && ops[0].afterLine === 5);

  const applied = lines.slice();
  const lineOf = (o) => (o.type === "replace" ? o.line : o.afterLine);
  for (const op of [...ops].sort((a, b) => lineOf(b) - lineOf(a))) {
    if (op.type === "replace") applied[op.line - 1] = op.text;
    else applied.splice(op.afterLine, 0, ...op.text.split("\n"));
  }
  const re = lint(applied.join("\n"), "Sheet");
  const ex35 = re.nodes.find((n) => n.name === "35");
  const ex7 = re.nodes.find((n) => n.name === "7");
  check("updateExamples: the last Example's own attribute stays under it",
    ex35 && ex35.children.some((c) => c.name === "weight" && c.value === "6"));
  check("updateExamples: the fresh Example keeps its own attributes, and only those",
    ex7 && ex7.children.filter((c) => c.name === "weight").length === 1
    && ex7.children.find((c) => c.name === "weight").value === "2");
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
