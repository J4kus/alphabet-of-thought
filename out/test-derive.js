// Unit tests for line-form formulas and constraints (src/derive.js): the
// reference semantics (@attr, aggregates over sibling Examples, @Example),
// the audit spans, the recompute fixpoint, and the copy-to-siblings edit.
//
// Plain Node script, no framework — run with: node out/test-derive.js
const { lint } = require("../src/linter");
const { auditValues, recomputeValues, copyToSiblings } = require("../src/derive");
const { tableRegistry, mergeRegistries } = require("../src/table");

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
  check("audit: numeric @N references are table-only",
    bad && bad.error === true && /table-only/.test(bad.message));
  check("audit: spans run from the operator to the value's end",
    vat.startCol === lines[3].indexOf("=") && vat.endCol === lines[3].length);
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
  const reg = mergeRegistries(tableRegistry(lines, "Sheet"));
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
  const fine = audit.find((f) => f.line === 8 && f.error);
  const label = audit.find((f) => f.line === 6 && f.error);
  check("audit: the declaration's span is returned for the colouring",
    declared && !declared.error && declared.startCol === lines[1].indexOf(">=") && declared.formula === "18");
  check("audit: a value under the bound is an error pinned to the value",
    violated && violated.error === true && violated.paint === false
    && /value '15' violates 'age >= 18' \(line 2\)/.test(violated.message)
    && violated.startCol === lines[4].indexOf("15"));
  check("audit: a satisfying value raises nothing", fine === undefined);
  check("audit: string equality bounds compare exactly", label === undefined);
  check("recompute: constrained plain values are never rewritten",
    recomputeValues(root, nodes, lines).length === 0);
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
  const rowB = audit.find((f) => f.line === 5 && f.error);
  check("audit: a column's bound is checked per row, against that row's own cells",
    rowB && /value '5' violates 'margin >= 10'/.test(rowB.message)
    && rowB.startCol === lines[4].indexOf("5 "));
  check("audit: a row that satisfies its own bound stays quiet",
    !audit.some((f) => f.line === 4 && f.error));
  check("audit: a value outside the declaring subtree is not governed",
    !audit.some((f) => f.line === 8 && f.error));
}

// ---------------------------------------------------------------------------
// a header cell's own constraint, and an uncomputable bound reported once
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Ledger",
    "    |name|qty >=1|cap <=@9|",
    "    |----+-------+--------|",
    "    |A   |0      |1       |",
    "    |B   |2      |2       |",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  const qty = audit.find((f) => f.line === 4 && f.error && /qty/.test(f.message));
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
// type constraints: `is date / number / text`, alone and with a bound
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Record",
    "    birth date is date",
    "    amount is number",
    "    tag is text",
    "    due is date >=`2025-01-01`",
    "    - Good",
    "        birth date: 1990-05-01",
    "        amount: 42",
    "        tag: hello",
    "        due: 2026-01-01",
    "    - Bad",
    "        birth date: yesterday",
    "        amount: lots",
    "        tag: 99",
    "        due: 2024-06-01",
  );
  const { root, nodes, lines } = parsed(text);
  const audit = auditValues(root, nodes, lines);
  const err = (re) => audit.find((f) => f.error && re.test(f.message));
  check("audit: a non-date value fails 'is date'",
    err(/value 'yesterday' must be date/) && err(/value 'yesterday' must be date/).paint === false);
  check("audit: a non-number value fails 'is number'", !!err(/value 'lots' must be number/));
  check("audit: a numeric value fails 'is text'", !!err(/value '99' must be text .*reads as number/));
  check("audit: a date bound compares chronologically (2024-06-01 < 2025-01-01)",
    !!err(/value '2024-06-01' violates 'due >= `2025-01-01`'/));
  check("audit: values of the right type and within the bound raise nothing",
    !audit.some((f) => f.error && f.line >= 7 && f.line <= 10));
  check("audit: a type clause without a bound still colours its declaration",
    audit.some((f) => f.line === 2 && !f.error && f.startCol === lines[1].indexOf("is date")));
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

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
