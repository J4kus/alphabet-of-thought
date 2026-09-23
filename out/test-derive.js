// Unit tests for line-form formulas and constraints (src/derive.js): the
// reference semantics (@attr, aggregates over sibling Examples, @Example),
// the audit spans, the recompute fixpoint, and the copy-to-siblings edit.
//
// Plain Node script, no framework — run with: node out/test-derive.js
const { lint, KIND } = require("../src/linter");
const { auditValues, recomputeValues, copyToSiblings, conceptRegistry, addExample, updateExamples, formulaReferences, mirrorGrids, updateScope, renumberExamples, renumberConcepts, flipForm, gridOfConcept } = require("../src/derive");
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
    "    name |price",
    "    Acme |10",
    "    Bolt |20",
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
// the lookups range over EVERY Example, this one included — a conditional
// total is about the data, not about the other rows
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    paid: =sumifs(@price,@status,`paid`)",
    "    open: =countifs(@status,`<>paid`)",
    "    de rate: =xlookup(`DE`,@Rate@code,@Rate@pct)",
    "    - A",
    "        price: 10",
    "        status: paid",
    "        group: =sumifs(@price,@status,@status)",
    "    - B",
    "        price: 20",
    "        status: draft",
    "    - C",
    "        price: 30",
    "        status: paid",
    "Rate",
    "    - eu",
    "        code: DE",
    "        pct: 19",
  );
  const { root, nodes, lines } = parsed(text);
  const reg = mergeRegistries(conceptRegistry(root, nodes));
  const edits = recomputeValues(root, nodes, lines, reg);
  const at = (line) => (edits.find((e) => e.line === line) || {}).text || "";
  check("recompute: sumifs/countifs over a Concept's Examples",
    at(2).includes("paid: 40 =") && at(3).includes("open: 1 ="));
  check("recompute: xlookup reaches another Concept written in line form",
    at(4).includes("de rate: 19 ="));
  check("recompute: an Example's own conditional total counts itself",
    at(8).includes("group: 40 ="));
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
    "    name|qty >=1 <=5",
    "    A   |0",
    "    B   |9",
    "    C   |3",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  check("chain: a header cell's bounds hold its column both ways",
    audit.some((f) => f.line === 3 && f.warning && /violates 'qty >= 1'/.test(f.message))
    && audit.some((f) => f.line === 4 && f.warning && /violates 'qty <= 5'/.test(f.message))
    && !audit.some((f) => f.line === 5 && (f.error || f.warning)));
  check("chain: an uncomputable second bound errors on its own span, once",
    (() => {
      const t2 = aot(
        "Ledger",
        "    name|qty >=1 <=@nope",
        "    A   |3",
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
    "Order|price|margin >=@price*0.1",
    "A    |100  |20",
    "B    |100  |5",
    "",
    "Loose Order",
    "    - C",
    "        margin: 1",
  );
  const { root, nodes, lines } = parsed(text);
  const { errors } = require("../src/linter").lint(text, "Sheet");
  check("scope fixture parses clean", errors.length === 0);
  const audit = auditValues(root, nodes, lines);
  const rowB = audit.find((f) => f.line === 3 && f.warning);
  check("audit: a column's bound is checked per row, against that row's own cells",
    rowB && /value '5' violates 'margin >= 10'/.test(rowB.message)
    && rowB.startCol === lines[2].lastIndexOf("5"));
  check("audit: a row that satisfies its own bound stays quiet",
    !audit.some((f) => f.line === 2 && (f.error || f.warning)));
  check("audit: a value outside the declaring subtree is not governed",
    !audit.some((f) => f.line === 7 && (f.error || f.warning)));
}

// ---------------------------------------------------------------------------
// a header cell's own constraint, and an uncomputable bound reported once
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Ledger",
    "    name|qty >=1|cap <=@nope",
    "    A   |0      |1",
    "    B   |2      |2",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  const qty = audit.find((f) => f.line === 3 && f.warning && /qty/.test(f.message));
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
// '==' defines rather than bounds: a determinate bound on an attribute
// declaration is the derivation for every value of that attribute, so a
// line-form value follows it without a formula of its own
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    vat ==@price*0.2",
    "    - A",
    "        price: 100",
    "        vat: 5",
    "    - B",
    "        price: 50",
    "        vat: 10",
  );
  const { root, nodes, lines } = parsed(text);
  const edits = recomputeValues(root, nodes, lines);
  check("recomputeValues: a '==' declaration defines every value beneath it",
    edits.length === 1
    && edits[0].line === 5 && edits[0].text === "        vat: 20");
  const audit = auditValues(root, nodes, lines);
  const stale = audit.find((f) => f.line === 5 && f.warning);
  check("audit: a value that differs from its definition is stale, not in violation",
    stale && /does not match its definition 'vat ==@price\*0\.2'/.test(stale.message)
    && /recomputes/.test(stale.message) && !/violates/.test(stale.message));
  check("audit: a value that already matches its definition stays quiet",
    !audit.some((f) => f.line === 8 && f.warning));

  // '==or(…)' names no single value, so it stays a bound the audit checks
  const listed = aot(
    "Task",
    "    status ==or(`draft`,`sent`)",
    "    - A",
    "        status: bogus",
  );
  const p2 = parsed(listed);
  check("recomputeValues: '==or(…)' lists allowed values, so it derives nothing",
    recomputeValues(p2.root, p2.nodes, p2.lines).length === 0);
  check("audit: '==or(…)' still reports a value outside the list as a violation",
    auditValues(p2.root, p2.nodes, p2.lines)
      .some((f) => f.warning && /violates 'status == `draft` or `sent`'/.test(f.message)));

  // an explicit '=' on the value is the nearer word and wins
  const own = aot(
    "Order",
    "    vat ==@price*0.2",
    "    - A",
    "        price: 100",
    "        vat: 30 =@price*0.3",
  );
  const p3 = parsed(own);
  check("recomputeValues: an explicit '=' formula wins over the '==' definition",
    recomputeValues(p3.root, p3.nodes, p3.lines).length === 0);
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
    "    name    |nationality|alias",
    "    Socrates|RSA        |Paul",
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
    "    name |price",
    "    Acme |10",
    "    Bolt |20",
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
    "    name    |alias",
    "    Socrates|Paul",
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
    "    name    |alias",
    "    Socrates|Paul",
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
    "        test 1              |alias",
    "        aot.files/Person.csv|Mike",
    "Other",
    "    - x",
  );
  const { root, nodes } = parsed(text);
  const grids = mirrorGrids(root, nodes);
  const ft = grids.find((g) => g.name === "File Tester");
  // 'aot.files/Person.csv' is a row of a table filed under the Example
  // 'test 1', so this scope nests — and a nesting scope carries its shape
  // in a 'parent' column, which no spreadsheet can trim away
  check("mirror: one union grid per Concept, a table under an Example included",
    ft && ft.header.join(",") === "File Tester,parent,origin,weight,alias"
    && ft.rows.length === 3);
  check("mirror: a row silent on a column answers the nearest default, else blank",
    ft.rows[0].join("|") === "loose one||EU|7|"
    && ft.rows[1].join("|") === "test 1||EU||"
    && ft.rows[2].join("|") === "aot.files/Person.csv|test 1|EU||Mike");
  check("mirror: the parent column names the row a nested row sits under",
    ft.rows[2][1] === "test 1" && ft.rows[0][1] === "" && ft.rows[1][1] === "");
  // and the shape comes back: the parent column is read as depth, so a round
  // trip through a spreadsheet no longer flattens the tree
  {
    const nested = aot(
      "Thing       |age",
      "Parent      |",
      "    Child 1 |10",
      "    Child 2 |12",
    );
    const { root: r2, nodes: n2, lines: l2 } = parsed(nested);
    const thing = [r2, ...n2].find((n) => n && n.kind === KIND.CONCEPT && n.name === "Thing");
    const grid = mirrorGrids(r2, n2).find((g) => g.name === "Thing");
    check("mirror: a nested table writes its shape as a parent column",
      grid.header.join(",") === "Thing,parent,age"
      && grid.rows.map((x) => x.join("|")).join(";") === "Parent||;Child 1|Parent|10;Child 2|Parent|12");
    // Excel hands back an edited value and a re-parented row
    const edited = [
      ["Thing", "parent", "age"],
      ["Parent", "", ""],
      ["Child 1", "Parent", "11"],
      ["Child 2", "Child 1", "12"],
    ];
    const ops = updateScope(l2, r2, n2, thing, edited[0], edited.slice(1), "Sheet");
    const block = ops.find((o) => o.type === "block");
    check("mirror: folding back keeps the tree and applies the edit",
      block && block.block.join("\n") === aot(
        "Thing          |age",
        "Parent         |",
        "    Child 1    |11",
        "        Child 2|12",
      ));
  }

  const other = grids.find((g) => g.name === "Other");
  check("mirror: a pure line-form Concept grids exactly the same way",
    other && other.rows.length === 1 && other.header.join(",") === "Other");
}

// An Example under an attribute is an Example *of that attribute* — the
// values it is allowed to take — not another Example of the Concept, so it
// is no row of the Concept's CSV. Nor are the refinements listed under it.
{
  const text = aot(
    "Invoice",
    "    - INV-1",
    "        amount: 10",
    "    status",
    "        - draft",
    "            - part paid",
    "        - sent",
  );
  const { root, nodes } = parsed(text);
  const inv = mirrorGrids(root, nodes).find((g) => g.name === "Invoice");
  check("mirror: an attribute's Examples are the attribute's allowed values, not rows",
    inv && inv.rows.length === 1 && inv.rows[0][0] === "INV-1");
  check("mirror: the attribute still heads a column of its own",
    inv && inv.header.join(",") === "Invoice,status,amount");
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
    "    name|price",
    "    Acme|10",
    "    Bolt|=@price@Acme",
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
    out.includes("Acme |12"));
  check("fold: a formula cell keeps its formula",
    out.includes("Bolt |=@price@Acme"));
  check("fold: a fresh name lands as a row of the Concept's own table",
    out.includes("Fresh|3"));
  check("fold: a line-form Example updates attribute by attribute",
    out.includes("weight: 8"));
  check("fold: a valued cell whose table lacks the column is left to the tree",
    !out.includes("weight: 5") && !out.includes("5"));
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
    "    name    |alias",
    "    Socrates|Paul",
  );
  const { root, nodes, lines } = parsed(text);
  const integer = nodes.find((n) => n.name === "Integer");
  const person = nodes.find((n) => n.name === "Person");

  const line = addExample(root, nodes, lines, integer, "5", "Sheet");
  check("addExample: a line-form Concept gains a '- value' after its last Example",
    line && line.to < line.from && line.from === 5 && line.block[0] === "    - 5");

  const row = addExample(root, nodes, lines, person, "James", "Sheet");
  check("addExample: a Concept written as a table gains a row instead",
    row && row.changed && row.block.some((l) => /^\s*James\s*\|\s*$/.test(l)));
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
    "    name |grade ==or(1,2,3)",
    "    Alpha|2",
    "    Beta |9",
  );
  const { root, nodes, lines } = parsed(text);
  const findings = auditValues(root, nodes, lines).filter((f) => f.error || f.warning);
  check("enumeration: a header cell lists its column's allowed values",
    findings.length === 1 && findings[0].line === 4 && findings[0].warning === true && /value '9' violates/.test(findings[0].message));
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

// ---------------------------------------------------------------------------
// renumberExamples: the first `N. ` opts a Concept's list into numbering
// ---------------------------------------------------------------------------
{
  const p = parsed(aot(
    "Recipe",
    "    - 1. Mix",
    "    - Bake",
    "    - 4. Serve",
  ));
  const changes = renumberExamples(p.nodes.find((n) => n.name === "Recipe"));
  check("renumberExamples: stale and missing numbers correct in listed order",
    changes.length === 2
    && changes[0].node.name === "Bake" && changes[0].newName === "2. Bake"
    && changes[1].node.name === "4. Serve" && changes[1].newName === "3. Serve");

  const sequential = parsed(aot("Recipe", "    - 1. Mix", "    - 2. Bake"));
  check("renumberExamples: an already true numbering changes nothing",
    renumberExamples(sequential.nodes.find((n) => n.name === "Recipe")).length === 0);

  const unnumbered = parsed(aot("Recipe", "    - Mix", "    - Bake"));
  check("renumberExamples: an unnumbered list is not opted in (null)",
    renumberExamples(unnumbered.nodes.find((n) => n.name === "Recipe")) === null);

  const eleven = parsed(aot("Steps",
    ...Array.from({ length: 11 }, (_, i) => `    - ${i === 0 ? "1. " : ""}Step ${String.fromCharCode(65 + i)}`)));
  const c11 = renumberExamples(eleven.nodes.find((n) => n.name === "Steps"));
  check("renumberExamples: double digits number cleanly ('11. Step K')",
    c11.length === 10 && c11[9].newName === "11. Step K");
}

// ---------------------------------------------------------------------------
// renumberConcepts: one `1. ` numbers a whole scope (dotted beneath), one
// deleted number strips it all
// ---------------------------------------------------------------------------
{
  const say = (changes) => changes.map((c) => `${c.node.name}->${c.newName}`).join(", ");

  const p = parsed(aot(
    "1. Vehicle",
    "    Car",
    "        Sports Car",
    "    Boat",
    "Person",
  ));
  check("renumberConcepts: one '1. ' numbers every Concept, dotted down the is-a chain",
    say(renumberConcepts(p.root, p.nodes))
    === "Car->1.1 Car, Sports Car->1.1.1 Sports Car, Boat->1.2 Boat, Person->2. Person");

  const moved = parsed(aot(
    "2. Person",
    "1. Vehicle",
    "    1.1 Car",
  ));
  check("renumberConcepts: a fully numbered scope keeps its numbers true to position",
    say(renumberConcepts(moved.root, moved.nodes))
    === "2. Person->1. Person, 1. Vehicle->2. Vehicle, 1.1 Car->2.1 Car");

  const stripped = parsed(aot(
    "1. Vehicle",
    "    1.1 Car",
    "    Boat",
    "2. Person",
  ));
  check("renumberConcepts: one deleted number strips the whole scope (parents too)",
    say(renumberConcepts(stripped.root, stripped.nodes))
    === "1. Vehicle->Vehicle, 1.1 Car->Car, 2. Person->Person");

  const half = parsed(aot("Alpha", "2. Beta"));
  check("renumberConcepts: a lone number that is not '1. ' reads as a deletion's leftover",
    say(renumberConcepts(half.root, half.nodes)) === "2. Beta->Beta");

  const scoped = parsed(aot(
    "Process",
    "    - run",
    "        1. Prepare",
    "        Execute",
    "Outside",
  ));
  check("renumberConcepts: under an Example only that Example's Concepts number",
    say(renumberConcepts(scoped.root, scoped.nodes)) === "Execute->2. Execute");

  const off = parsed(aot("Vehicle", "    Car", "Person"));
  check("renumberConcepts: an unnumbered file is left exactly as written",
    renumberConcepts(off.root, off.nodes).length === 0);
}

// ---------------------------------------------------------------------------
// flipForm: one Concept, two spellings — the table and the '- ' lines it is
// shorthand for, each written out as the other
// ---------------------------------------------------------------------------
{
  // the edit applied, so a test reads the file the writer would see
  const flip = (text, name) => {
    const { root, nodes, lines } = parsed(text);
    const concept = [root, ...nodes].find((n) => n && n.kind === KIND.CONCEPT && n.name === name);
    const edit = flipForm(lines, concept, "Sheet");
    if (!edit) return null;
    const out = lines.slice();
    out.splice(edit.from, edit.to - edit.from + 1, ...edit.block);
    return { form: edit.form, text: out.join("\n") };
  };

  const lineForm = aot(
    "Person",
    "    first name",
    "    age",
    "    - Aristotle",
    "        first name: A",
    "        age: 10",
    "    - Socrates",
    "        first name: Sokrates",
    "        age: 20 =10+10",
  );
  const asTable = flip(lineForm, "Person");
  check("flipForm: a line-form Concept becomes a standalone table naming itself",
    asTable.form === "table" && asTable.text === aot(
      "Person   |first name|age",
      "Aristotle|A         |10",
      "Socrates |Sokrates  |20 =10+10",
    ));
  check("flipForm: a derivation moves into its cell exactly as it was typed",
    asTable.text.includes("20 =10+10"));
  const backAgain = flip(asTable.text, "Person");
  check("flipForm: flipping the table back gives the lines it was written from",
    backAgain.form === "lines" && backAgain.text === lineForm);

  // an attribute's (alias) and its constraint belong to the declaration, so
  // the header cell carries both and only the alias reaches a value line
  const suffixed = aot(
    "Life Event",
    "    beneficiary (person)",
    "    age >=18",
    "    - Socrates Birth",
    "        beneficiary (person): Socrates",
    "        age: 20",
  );
  const suffixedTable = flip(suffixed, "Life Event");
  check("flipForm: a column header keeps the attribute's (alias) and its constraint",
    suffixedTable.text.includes("beneficiary (person)|age >=18"));
  check("flipForm: a constraint never lands on a value line, an alias does",
    flip(suffixedTable.text, "Life Event").text === suffixed);

  // the merge form is what carries everything a row cannot hold
  const mixed = aot(
    "Order",
    "    tax rate: 0.2",
    "    price",
    "    ... more to come",
    "    - Acme",
    "        price: 100",
    "        vat: 20 =@price*@tax rate",
  );
  const mixedTable = flip(mixed, "Order");
  const mixedLines = mixedTable.text.split("\n");
  check("flipForm: a Concept with a default or a Map keeps its own line and files the grid under it",
    mixedLines[0] === "Order" && mixedLines[1] === "    tax rate: 0.2"
    && mixedLines[2] === "    ... more to come" && mixedLines[3].startsWith("    Order|price|vat"));
  check("flipForm: the flip never recomputes — a cell reading a line-form default keeps its value",
    mixedTable.text.includes("Acme |100  |20 =@price*@tax rate"));
  check("flipForm: an attribute the Concept declares beside the grid is not declared twice on the way back",
    flip(mixedTable.text, "Order").text.split("\n").filter((l) => /^ *tax rate/.test(l)).length === 1);

  // an Example carrying structure of its own is no row, so it stays a line
  const nested = flip(aot(
    "City",
    "    residents known as",
    "    - Athens",
    "        residents known as: Athenians",
    "    - Pella",
    "        residents known as: Pellans",
    "        Landmark",
    "            - Palace",
  ), "City");
  check("flipForm: an Example with children of its own is left as a line beside the grid",
    nested.text.includes("        Landmark") && nested.text.includes("            - Palace")
    && nested.text.includes("Athens|Athenians"));

  // A sub-Example IS a row — one indented inside its name cell — so a nested
  // list and a nested grid are the same idea in two spellings, and the flip
  // between them loses nothing in either direction.
  const nestedLines = aot(
    "Thing",
    "    age",
    "    - Parent",
    "        - Child 1",
    "            age: 10",
    "        - Child 2",
    "            age: 12",
    "    - Other Parent",
    "        - Child 3",
    "            age: 7",
  );
  const nestedGrid = flip(nestedLines, "Thing");
  check("flipForm: a nested list flips to a grid whose rows keep their depth",
    nestedGrid.form === "table"
    && nestedGrid.text.split("\n").map((l) => l.trimEnd()).join("\n") === aot(
      "Thing       |age",
      "Parent      |",
      "    Child 1 |10",
      "    Child 2 |12",
      "Other Parent|",
      "    Child 3 |7",
    ));
  check("flipForm: and back again, exactly as it was written",
    flip(nestedGrid.text, "Thing").text === nestedLines);
  check("flipForm: a sub-Example's own attribute still becomes a column",
    flip(aot(
      "Thing",
      "    - Parent",
      "        - Child",
      "            nickname: Kid",
    ), "Thing").text.includes("nickname"));

  check("flipForm: a Concept with no Examples has nothing to flip",
    flip(aot("Colour", "    hue"), "Colour") === null);

  // an (alias) crosslinks to a Concept; it is not a second name for the
  // attribute, so attributes sharing one must stay separate columns
  check("flipForm: attributes sharing an (alias) stay separate columns, each keeping its values",
    flip(aot(
      "Birth",
      "    father (person)",
      "    mother (person)",
      "    - Socrates Birth",
      "        father (person): Sophroniscus",
      "        mother (person): Phaenarete",
    ), "Birth").text === aot(
      "Birth         |father (person)|mother (person)",
      "Socrates Birth|Sophroniscus   |Phaenarete",
    ));

  // the one reading a grid cannot hold: an attribute an Example only
  // declares becomes a column, its cell left empty
  const declared = flip(aot(
    "Belief",
    "    - Introduced",
    "        timing: Async",
    "        use intuition",
  ), "Belief");
  check("flipForm: an attribute an Example only declares becomes a column with an empty cell",
    declared.text === aot(
      "Belief    |timing|use intuition",
      "Introduced|Async |",
    ));

  // a cursor anywhere in the Concept's subtree names the same Concept, so
  // the grid is found from the Concept whatever form it is written in
  const { root: gRoot, nodes: gNodes, lines: gLines } = parsed(aot(
    "Known For      |beneficiary",
    "Socratic Method|Socrates",
  ));
  const known = [gRoot, ...gNodes].find((n) => n.name === "Known For");
  check("gridOfConcept: a standalone table is found from the Concept its header names",
    (gridOfConcept(gLines, known, "Sheet") || {}).start === 0);
}

// ---------------------------------------------------------------------------
// parked constraints still bound the values (park.parkedConstraints)
// ---------------------------------------------------------------------------
{
  const park = require("../src/park");
  const lines = [
    "Person",
    "    age >=18",
    "    - Ann",
    "        age: 12",
    "",
    "Invoice|price|vat ==@price*0.2|qty >=@nope",
    "INV-1|100|25|2",
  ];
  const before = lint(lines.join("\n"), "Sheet");
  const written = auditValues(before.root, before.nodes, lines).filter((f) => f.message);
  const out = park.park(lines, before.nodes, "Sheet");
  const after = lint(out.lines.join("\n"), "Sheet");
  const held = park.parkedConstraints(after.nodes, "Sheet", out.parked);
  const parked = auditValues(after.root, after.nodes, out.lines, undefined, held).filter((f) => f.message);
  check("parked: without the store, a parked file's bounds hold nothing",
    auditValues(after.root, after.nodes, out.lines).filter((f) => f.message).length === 0);
  check("parked: a bound still flags the value that breaks it",
    parked.some((f) => f.warning && f.line === 4 && /violates parked 'age >= 18'/.test(f.message)));
  check("parked: a stale value under a parked definition says how to recompute it",
    parked.some((f) => f.warning && f.line === 7 && /parked definition 'vat ==@price\*0\.2'/.test(f.message)
      && /put the formulas back/.test(f.message)));
  const broken = parked.find((f) => f.error);
  check("parked: a bound that cannot compute is an error on the declaration's name",
    broken && broken.line === 6 && out.lines[5].slice(broken.startCol, broken.endCol) === "qty"
    && /parked constraint '>=@nope' on 'qty'/.test(broken.message));
  check("parked: the same findings as when the constraints were written",
    written.length === parked.length && written.filter((f) => f.error).length === parked.filter((f) => f.error).length);
  check("parked: a parked '==' leaves its values frozen, never recomputed",
    recomputeValues(after.root, after.nodes, out.lines).length === 0);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
