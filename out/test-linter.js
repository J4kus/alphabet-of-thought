// Unit tests for the arithmetic linter (src/linter.js) and the advisory
// "hint" channel it feeds. Every exported function gets a direct test;
// the internal helpers (classify, realChildren, looksPlural, slotSignature,
// makeReport) are exercised through the public parse / verify they back.
//
// The hint sources are the three advisory streams extension.js processes:
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
    error: (line, message, extra) => errors.push({ line, message, ...extra }),
    warn: (line, message, extra) => warnings.push({ line, message, ...extra }),
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

  // a Concept's default: a capitalised line with a colon states it, and it
  // is no Example — no child, no row, no member of the Concept's extension
  {
    const report = makeReport();
    const p = parse(aot("Run Command: code ."), "Root", report);
    const rc = node(p.root, p.nodes, "Run Command");
    check("parse: 'Concept: value' states the Concept's default, and materialises no Example",
      rc && rc.value === "code ." && !rc.children.some((c) => c.kind === INDIVIDUAL) && !p.nodes.some((n) => n.kind === INDIVIDUAL));
    const derived = makeReport();
    parse(aot("Run Command: code =x"), "Root", derived);
    const escaped = makeReport();
    const pe = parse(aot("Run Command: code ==x"), "Root", escaped);
    check("parse: a Concept's default is stated, not derived — an '=' opening one is an error; a doubled one is the text",
      derived.errors.some((e) => /derives the Concept's default/.test(e.message))
      && !escaped.errors.length && node(pe.root, pe.nodes, "Run Command").value === "code =x");
  }

  // tab character
  {
    const report = makeReport();
    parse("Thing\n\tfoo", "Root", report);
    check("parse: tab character is an error", hasError(report, /^replace the tab in the indentation/));
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
  // dash or pipe with no following space
  {
    const report = makeReport();
    parse(aot("Thing", "    -Apple"), "Root", report);
    check("parse: '-Apple' (no space after dash) is an error", hasError(report, /0 spaces after '-'/));
  }
  {
    const report = makeReport();
    parse(aot("Otter|size", "Ollie|5"), "Root", report);
    check("parse: a row needs no gutter after its divider", !hasError(report, /0 spaces after/));
  }
  // blank lines are skipped, not numbered
  {
    const report = makeReport();
    const p = parse(aot("Thing", "", "    - Apple"), "Root", report);
    check("parse: blank lines produce no nodes", p.nodes.length === 2);
  }
}

// ---------------------------------------------------------------------------
// A row's indent means nothing: it stands at its table's depth, and only a
// parent cell files it under another row.
// ---------------------------------------------------------------------------
{
  const report = makeReport();
  const { root, nodes } = parse(aot(
    "Thing       |age",
    "Parent      |",
    "    Child 1 |10",
    "  Child 2   |12",
  ), "World", report);
  const at = (n) => node(root, nodes, n);
  check("indent: an indented row raises nothing, however far it is indented", report.errors.length === 0 && report.warnings.length === 0);
  check("indent: an indented row is an Example of the Concept, like any other",
    at("Child 1").kind === INDIVIDUAL && at("Child 1").parent === at("Thing") && at("Child 2").parent === at("Thing"));
  check("indent: its cells are its own", at("Child 1").children.length === 1 && at("Child 1").children[0].value === "10");
  check("indent: a parent row with an empty cell asserts nothing",
    at("Parent").children.filter((c) => c.kind === DEFAULT).length === 0);

  // a tree written as a table parses to the very tree it is as lines
  const shape = (n) => n.children
    .map((c) => `${c.kind}:${c.name}:${c.value || ""}:${c.depth}[${shape(c)}]`).join(",");
  const names = (n) => n.children.filter((c) => c.kind === INDIVIDUAL)
    .map((c) => `${c.name}(${names(c)})`).join(" ");
  const asLines = parse(aot(
    "Thing",
    "    age",
    "    - Parent",
    "        - Child 1",
    "            age: 10",
    "    - Other Parent",
    "        - Child 3",
    "            age: 7",
  ), "World", makeReport());
  const asTable = parse(aot(
    "Thing",
    "    Thing       |parent (thing)|age",
    "    Parent      |              |",
    "    Child 1     |Parent        |10",
    "    Other Parent|              |",
    "    Child 3     |Other Parent  |7",
  ), "World", makeReport());
  check("indent: a table's parent column gives the tree the nested lines give",
    names(asLines.root.children[0]) === names(asTable.root.children[0]));

  const errs = (...ls) => {
    const r = makeReport();
    parse(aot(...ls), "World", r);
    return r.errors;
  };
  check("indent: gutter spaces are padding", errs("Otter | size", "Ollie | 5").length === 0);
  check("indent: a row shallower than the header still opens a table of its own",
    errs("Thing", "    Sub|age", "    A  |1", "Other|n", "B    |2").length === 0);
}

// tables: org-style plain-text spreadsheets — header + separator + data rows.
// A table is a grid of Examples: header cells declare the columns as
// attributes of the parent, each data row is an Example named by its first
// cell, and each further cell is that Example's Attribute Value.
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Otter  | size | colour",
    "Ollie  | 5    | brown",
    "Pebble | 3    |",
  );
  const report = makeReport();
  const { root, nodes } = parse(text, "Zoo", report);
  const otter = node(root, nodes, "Otter");
  check("table: a well-formed table parses without errors", report.errors.length === 0);
  check("table: the first header cell declares the Concept the table describes",
    otter && otter.kind === CONCEPT && otter.parent === root && otter.cell === true);
  check("table: header cells after the first declare attributes on that Concept",
    otter.children.some((c) => c.kind === ATTRIBUTE && c.name === "size")
    && otter.children.some((c) => c.kind === ATTRIBUTE && c.name === "colour"));
  const ollie = node(root, nodes, "Ollie");
  check("table: a data row is an Example named by its first cell",
    ollie && ollie.kind === INDIVIDUAL && ollie.parent === otter);
  check("table: cells become Attribute Values under the row's Example",
    ollie.children.some((c) => c.kind === DEFAULT && c.name === "size" && c.value === "5")
    && ollie.children.some((c) => c.kind === DEFAULT && c.name === "colour" && c.value === "brown"));
  const pebble = node(root, nodes, "Pebble");
  check("table: an empty cell asserts nothing",
    pebble.children.length === 1 && pebble.children[0].name === "size" && pebble.children[0].value === "3");
  check("table: the separator row is layout, not a node",
    nodes.every((n) => !n.name.includes()));

  // the full pipeline accepts a table (subsumption included)
  check("table: a table verifies (V = 0)", lint(text, "Zoo").errors.length === 0);

  // the row that opens a run is the header: no rule declares it
  {
    const r = makeReport();
    const p = parse(aot("Thing", "    Otter | size", "    Ollie | 5"), "Zoo", r);
    check("table: the row standing first is the header, no rule needed",
      r.errors.length === 0
      && node(p.root, p.nodes, "Otter").kind === CONCEPT
      && node(p.root, p.nodes, "Ollie").kind === INDIVIDUAL);
  }
  // a lone multi-cell row is a header being typed: assumed, not demanded
  {
    const r = makeReport();
    const p = parse(aot("Organisation | full name | sort name"), "Zoo", r);
    const org = node(p.root, p.nodes, "Organisation");
    check("table: a lone multi-cell row is assumed to be the header",
      r.errors.length === 0
      && org.children.some((c) => c.kind === ATTRIBUTE && c.name === "full name")
      && org.children.some((c) => c.kind === ATTRIBUTE && c.name === "sort name"));
  }
  // a table needs a divider: a rule under a line that carries none heads no
  // table, and the lines around it read exactly as they are written
  {
    const r = makeReport();
    const p = parse(aot("Person", "John Doe"), "Zoo", r);
    const person = node(p.root, p.nodes, "Person");
    check("table: a line with no divider is no header, rule or no rule",
      r.errors.length === 0 && person && person.kind === CONCEPT && !person.cell
      && node(p.root, p.nodes, "John Doe").kind === CONCEPT);
  }
  // more cells than the header names
  {
    const r = makeReport();
    parse(aot("Otter | size", "Ollie | 5 | extra"), "Zoo", r);
    check("table: more cells than header columns is an error", hasError(r, /but the header names 2 columns/));
  }
  // a column names an attribute, and attributes are lowercase
  {
    const r = makeReport();
    parse(aot("Otter | Size", "Ollie | 5"), "Zoo", r);
    check("table: a capitalised column is an error", hasError(r, /^lowercase column 'Size' — it is capitalised/));
  }
  // a header cell is an attribute term, so it carries a (alias) like one
  {
    const r = makeReport();
    const p = parse(aot("Otter | size (length)", "Ollie | 5"), "Zoo", r);
    const attr = p.nodes.find((n) => n.name === "size");
    check("table: a header cell's (alias) is parsed off the name",
      attr && attr.kind === ATTRIBUTE && attr.alias === "length" && attr.aliasCol === 14);
    check("table: the row's cells still value the stripped name",
      node(p.root, p.nodes, "Ollie").children.some((c) => c.name === "size" && c.value === "5"));
    check("table: a header alias parses without errors", r.errors.length === 0);
  }
  // a formula rides after the value ('20 =@price*2'); the model sees only the value
  {
    const r = makeReport();
    const p = parse(aot(
      "Order | price | total",
      "A     | 10    | 20 =@price*2",
      "B     | 10    | =@price*2",
    ), "Zoo", r);
    const a = node(p.root, p.nodes, "A"), b = node(p.root, p.nodes, "B");
    check("table: a cell's formula is stripped from its Attribute Value",
      a.children.some((c) => c.name === "total" && c.value === "20"));
    check("table: a not-yet-computed formula cell asserts nothing",
      !b.children.some((c) => c.name === "total") && r.errors.length === 0);
  }
  // line-form values carry '=' formulas the same way; only the value part
  // enters the model, the formula rides on the node. Constraints belong to
  // the attribute declaration, never to a value.
  {
    const r = makeReport();
    const p = parse(aot(
      "Order",
      "    - A",
      "        total: 30 =sum(@price)",
      "        speed: 5 >=3",
      "        note: 10 < 20 knots",
    ), "Zoo", r);
    const a = node(p.root, p.nodes, "A");
    const total = a.children.find((c) => c.name === "total");
    const speed = a.children.find((c) => c.name === "speed");
    const note = a.children.find((c) => c.name === "note");
    check("line form: a value's '=' formula is stripped onto the node",
      total && total.value === "30" && total.op === "=" && total.formula === "sum(@price)");
    check("line form: a comparison in a value stays a plain value (constraints live on attributes)",
      speed && speed.value === "5 >=3" && speed.op === undefined);
    check("line form: prose comparisons stay whole values",
      note && note.value === "10 < 20 knots" && note.op === undefined && r.errors.length === 0);
  }
  // an attribute declaration may carry a constraint, bare line and table
  // header cell alike; the term (and its alias) parse off cleanly
  {
    const r = makeReport();
    const p = parse(aot(
      "Person",
      "    age (years) >=18",
      "    Metric|qty >=1",
      "    A     |2",
    ), "Zoo", r);
    const age = node(p.root, p.nodes, "age");
    const qty = node(p.root, p.nodes, "qty");
    check("attribute: a bare line's trailing constraint rides on the node",
      age && age.kind === ATTRIBUTE && age.constraints.length === 1
      && age.constraints[0].op === ">=" && age.constraints[0].formula === "18"
      && age.alias === "years" && age.constraints[0].opCol === 4 + "age (years) ".length);
    check("attribute: a header cell's constraint bounds the column",
      qty && qty.kind === ATTRIBUTE && qty.constraints.length === 1
      && qty.constraints[0].op === ">=" && qty.constraints[0].formula === "1" && qty.cell === true);
    check("attribute: constrained declarations parse without errors", r.errors.length === 0);
  }
  // table findings pin the offending cell, not the whole line
  {
    const r = makeReport();
    parse(aot("Otter | Size", "Ollie | 5"), "Zoo", r);
    const e = r.errors.find((x) => /capitalised/.test(x.message));
    check("table: the capitalised-column error carries its cell's columns",
      e && e.startCol === 8 && e.endCol === 12);
  }
  // a blank line ends the table, as in org: what follows it is a table of
  // its own, its first row the header again
  {
    const r = makeReport();
    const p = parse(aot("Otter | size", "", "Ollie | 5", "Pebble | 3"), "Zoo", r);
    check("table: a blank line ends the table",
      node(p.root, p.nodes, "Ollie").kind === CONCEPT
      && node(p.root, p.nodes, "Pebble").kind === INDIVIDUAL
      && node(p.root, p.nodes, "Pebble").parent.name === "Ollie");
  }
}

// the spreadsheet payoff: the whole engine reads table rows as Examples,
// so dependency inference works straight off the grid
{
  const ledger = aot(
    "Order   | country | currency",
    "A       | France  | EUR",
    "B       | France  | EUR",
    "C       | Germany | EUR",
    "D       | Japan   | JPY",
  );
  const { root, nodes, errors } = lint(ledger, "Sales");
  check("table/FD: the ledger table verifies", errors.length === 0);
  check("table/FD: dependencies are inferred across table rows",
    armstrong.findings(root, nodes).some((f) => /determines 'currency'/.test(f.message) && f.message.includes("country")));
}

// ---------------------------------------------------------------------------
// table.align: org's TAB — every column padded to its widest cell
// ---------------------------------------------------------------------------
{
  const { align, cells, isSeparator } = require("../src/table");
  check("cells: '| a | b |' -> two cells", cells("a | b").map((c) => c.text).join(",") === "a,b");
  check("cells: offsets point at the cell text", cells("a | b")[1].col === 4);
  check("cells: a leading divider opens an empty name cell", cells("|gegeg").length === 2
    && cells("|gegeg")[0].text === "" && cells("|gegeg")[1].text === "gegeg");
  check("isSeparator: dashes and a pipe yes; a '+' rule, a name and a lone dash no",
    isSeparator("---|---") && !isSeparator("---+---") && !isSeparator("a") && !isSeparator("-"));

  const messy = aot(
    "Otter",
    "    name | size",
    "    Ollie | 5",
  );
  const edits = align(messy);
  check("align: rows are padded to the widest cell",
    edits.some((e) => e.text === "    name |size")
    && edits.some((e) => e.text === "    Ollie|5"));
  check("align: a divider is redrawn to its columns",
    align(aot("Otter", "    name|size", "    ----|----", "    Ollie|5"))
      .some((e) => e.line === 3 && e.text === "    -----|----"));
  check("align: an already aligned table needs no edits",
    align(aot("Otter", "    name |size", "    Ollie|5")).length === 0);
  // no attributes, no pair of cells to divide: there the pipe closes the row,
  // which is the only thing keeping the lines a table rather than an outline
  check("align: a table with no attributes is drawn closed",
    align(aot("Otter", "    Otter|", "    Ollie|")).length === 0
    && align(aot("Otter", "    Otter |", "    Ollie|")).some((e) => e.text === "    Otter|"));
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

// a sub-Example cannot carry the name of an Example it sits under — whole
// and part would be one name — in '- ' lines and nested table rows alike
{
  const SAME = /has the same name as the Example it sits under/;
  const errs = (...lines) => lint(aot(...lines), "Book").errors;
  const child = errs("Thing", "    - Parent", "        - Parent", "        - Other");
  check("verify: a sub-Example named like its parent is an error, on the child",
    child.some((e) => SAME.test(e.message) && e.line === 3 && e.related && e.related[0].line === 2));
  check("verify: ... under a grandparent too, whatever the case or numbering",
    errs("Thing", "    - Root", "        - Mid", "            - 1. root", "            - Leaf", "        - Side").some((e) => SAME.test(e.message) && e.line === 4));
  const rows = lint(aot("Thing |parent (thing)|age", "Parent|              |", "Parent|Parent        |10", "Child |Parent        |12"), "Book").errors;
  check("verify: ... in a table row naming its parent, pinned on its name cell",
    rows.some((e) => SAME.test(e.message) && e.line === 3 && e.startCol === 0));
  check("verify: same-named Examples under different parents are not this error",
    !errs("Thing", "    - A", "        - X", "        - Y", "    - B", "        - X", "        - Z").some((e) => SAME.test(e.message)));
}

// a bare `=` line — Python that writes Concepts — is no node of the model:
// it rides beside the tree, filed under the line it stands beneath
{
  const r = lint(aot("=load_all()", "Person", "    =per_person()", "    - Ann"), "Book");
  check("bare =: no node of the model, and no error",
    r.errors.length === 0 && !r.nodes.some((n) => /load_all|per_person/.test(n.name)));
  check("bare =: recorded with its Python and the node it is filed under",
    r.generators.length === 2 && r.generators[0].formula === "load_all()" && r.generators[0].parent === r.root
    && r.generators[1].parent.name === "Person" && r.nodes.generators === r.generators);
  check("bare =: a lone '=' is an error",
    lint(aot("Person", "    ="), "Book").errors.some((e) => /'=' stands alone/.test(e.message)));
  check("bare =: a bound with no attribute is an error, not a Concept",
    lint(aot('==("a", "b")'), "Book").errors.some((e) => /a bound with no attribute/.test(e.message))
    && !lint(aot('==("a", "b")'), "Book").nodes.length);
  check("bare =: a pipe on it is its Python's, never a table's",
    lint(aot("=a() | b()", "Other"), "Book").errors.length === 0);
}

// names fold case everywhere references do: 'Animal' and 'ANIMAL' are one
// Concept name, 'red' and 'RED' one value, the file name one name in any case
check("verify: Concept names differing only in case are one name (univocity)",
  hasError(lintTree(aot("Dog", "    Animal", "Cat", "    ANIMAL"), "Zoo").report,
    /defined 2 times.*names differ only in case/));
check("verify: sibling defaults differing only in value case are identical",
  hasError(lintTree(aot("Box", "    colour: red", "    colour: RED")).report,
    /repeated under 'Box' with the same value/));
check("verify: repeating the file name in another case is still the repeat error",
  hasError(lintTree(aot("ROOT"), "Root").report, /repeats the file name/));
check("verify: a numbering prefix never makes a second name ('2. Animal' duplicates 'Animal')",
  hasError(lintTree(aot("Dog", "    Animal", "Cat", "    2. Animal"), "Zoo").report, /defined 2 times/));
check("verify: sibling slots differing only in case still share a signature",
  lintTree(aot("Shape", "    Circle", "        colour: red", "    Disc", "        colour: RED"), "Art")
    .report.warnings.some((w) => /shares its slots with a sibling under 'Shape'/.test(w.message)));

// a duplicate names two places, so it reports at both — each finding
// carrying the other's location as related information
{
  const both = lintTree(aot("Dog", "    Animal", "Cat", "    Animal"), "Zoo")
    .report.errors.filter((e) => /Concept 'Animal' defined 2 times/.test(e.message));
  check("verify: both duplicate definitions error, each related to the other",
    both.length === 2
    && both[0].related && both[0].related.length === 1 && both[0].related[0].line === both[1].line
    && both[1].related && both[1].related.length === 1 && both[1].related[0].line === both[0].line);
  const twins = lintTree(aot("Person", "    - Socrates", "Note", "    person: value", "        - socrates"), "World")
    .report.warnings.filter((w) => /differs only in case/.test(w.message));
  check("verify: the case-only Example warning reports at both spellings",
    twins.length === 2 && twins.every((w) => w.related && w.related.length === 1));
}

// an identifier resolves to exactly one target: shared aliases, self-aliases
// and an alias that names another Concept (a duplicate identity) are all errors
check("verify: two Concepts sharing an alias is an error",
  hasError(lintTree(aot("Automobile (Auto)", "Vehicle (Auto)"), "Fleet").report, /also the alias of 'Automobile'/));
check("verify: an alias repeating its own Concept's name is an error",
  hasError(lintTree(aot("Car (car)"), "Fleet").report, /repeats the Concept's own name/));
check("verify: an alias naming another Concept is a duplicate-identity error",
  hasError(lintTree(aot("Car", "Auto (Car)"), "Fleet").report, /is the name of another Concept.*one duplicated identity/));

// Example references resolve case-insensitively, so case-only twins warn
{
  const twins = lintTree(aot("Person", "    - Socrates", "Note", "    person: value", "        - socrates"), "World").report;
  check("verify: Examples differing only in case warn",
    twins.warnings.some((w) => /differs only in case from '- Socrates'/.test(w.message)));
  const same = lintTree(aot("Person", "    - Socrates", "Crowd", "    - Socrates"), "World").report;
  check("verify: same-spelling Examples in different scopes stay quiet",
    !same.warnings.some((w) => /differs only in case/.test(w.message)));
}

// a data row's first cell names its Example, so an empty one is an error —
// whatever the header says. The width cookie that used to make an exception
// of it (a continuation row carrying the next fragment of a wrapped value)
// went in 1.12, and `<10>` is now part of a column's name like any other
// characters.
{
  const plain = lintTree(aot(
    "Note|d",
    "A   |x",
    "    |y",
  ), "Sheet");
  check("table: a row with an empty first cell is an error",
    hasError(plain.report, /empty first cell/));
  const cookie = lintTree(aot(
    "Note|d <10>",
    "A   |a rather",
    "    |long note",
  ), "Sheet");
  check("table: '<10>' declares no width, so the empty first cell is still the error",
    hasError(cookie.report, /empty first cell/));
  const a = cookie.nodes.find((n) => n.name === "A");
  const d = a && a.children.find((c) => c.name === "d <10>");
  check("table: the cell keeps its own value — nothing joins across two rows",
    !!d && d.value === "a rather");
}

// plural Concept (warning)
check("verify: a plural Concept name warns",
  lintTree(aot("Animals"), "Zoo").report.warnings.some((w) => /appears plural/.test(w.message)));

// an accepted word (lint's third argument, fed by the editor's Quick Fix via
// aot.acceptedWords) is not read as plural
check("verify: an accepted word is not flagged plural",
  !lint(aot("Animals"), "Zoo", new Set(["animals"])).warnings.some((w) => /appears plural/.test(w.message)));

// a possessive is not a plural: the 's says whose the idea is, not how many
// there are, so it comes off before the number is judged
check("verify: a possessive Concept name is not read as plural",
  !lintTree(aot("Aristotle's"), "Zoo").report.warnings.some((w) => /appears plural/.test(w.message)));

// and taking it off catches the plural possessive pluralize misses whole
// ("Farmers'" is not a word it knows; "Farmers" is)
check("verify: a plural possessive still warns",
  lintTree(aot("Farmers'"), "Zoo").report.warnings.some((w) => /appears plural/.test(w.message)));

// the Quick Fix accepts the word as written, apostrophe and all
check("verify: an accepted possessive is not flagged plural",
  !lint(aot("Farmers'"), "Zoo", new Set(["farmers'"])).warnings.some((w) => /appears plural/.test(w.message)));

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
  // one name, one content, two places: an Example's name is part of what it
  // is, so only same-named Examples can be one idea written twice
  const twins = aot(
    "Left",
    "    - Twin",
    "        height: tall",
    "        mood: calm",
    "Right",
    "    - Twin",
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
// HINTS — an Example's name is part of what it is: a ledger's twins are two
// ---------------------------------------------------------------------------
{
  const ledger = aot(
    "Payment|amount|payee",
    "P1     |100   |Shop",
    "P2     |100   |Shop",
  );
  const { root, nodes, errors } = lint(ledger, "Books");
  check("name identity: two payments of one amount to one payee verify",
    errors.length === 0
    && godel.clashes(root, nodes).findings.filter((f) => f.kind === "content").length === 0);
  const again = lint(aot(
    "Payment|amount|payee",
    "P1     |100   |Shop",
    "",
    "Refund",
    "    Payment|amount|payee",
    "    P1     |100   |Shop",
  ), "Books");
  check("name identity: the same Example written twice, name and all, still clashes",
    godel.clashes(again.root, again.nodes).findings.some((f) => f.kind === "content" && /'- P1' and '- P1'/.test(f.message)));
}

// ---------------------------------------------------------------------------
// a pipe inside a value is part of the value, not a table
// ---------------------------------------------------------------------------
{
  const piped = lint(aot(
    "Person",
    "    rule: a | b",
    "    - Ann",
    "        motto: keep | going",
    "    - Bob",
    "        motto: onward",
  ), "People");
  const values = piped.nodes.filter((n) => n.kind === KIND.DEFAULT).map((n) => `${n.name}=${n.value}`);
  check("pipe in value: a 'name: value' line with a pipe lints clean",
    piped.errors.length === 0);
  check("pipe in value: the pipe stays in the value, whole",
    values.includes("rule=a | b") && values.includes("motto=keep | going"));
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
    mr.findings.some((f) => /^drift: move it under .* — '- Goldfish' carries/.test(f.message) && f.message.includes("filed under 'Bird'")));
  check("hint/FCA: exhaustion flags Sponge matching no sub-Concept",
    mr.findings.some((f) => /^exhaustion: add the kind .* — 'Animal' divides/.test(f.message) && f.message.includes("- Sponge")));

  // fewer than two Examples: nothing to analyse
  const tiny = lint(aot("Solo", "    - Only"), "World");
  check("hint/FCA: fewer than two Examples -> tooFew", suggest(tiny.root, tiny.nodes).tooFew === true);
}

// lint() folds the Armstrong axiom checks over the declared dependency
// graph: a dependency cycle is an error counted in V, a transitively
// implied direct edge a warning (never in V). Recursion stays legal.
{
  const looped = lint(aot(
    "Loop A",
    "    partner loop b",
    "Loop B",
    "    partner loop a",
  ), "World");
  const cycles = looped.errors.filter((e) => /^dependency cycle:/.test(e.message));
  check("lint: a mutual dependency is two errors, counted in V", cycles.length === 2 && looped.errors.length === 2);
  const redundant = lint(aot(
    "Alpha",
    "    beta",
    "    gamma",
    "Beta",
    "    gamma",
    "Gamma",
    "    size",
  ), "World");
  check("lint: a transitively implied direct edge is a warning, not in V",
    redundant.errors.length === 0
      && redundant.warnings.some((w) => /^redundant dependency:/.test(w.message) && w.line === 3));
  const recursive = lint(aot("Node", "    parent node", "    label"), "World");
  check("lint: recursion (an attribute of one's own kind) raises nothing",
    !recursive.errors.some((e) => /dependency/.test(e.message))
      && !recursive.warnings.some((w) => /dependency/.test(w.message)));
}

// '=' defines on a declaration, a header cell or a bare line; a literal '=' in
// a value is doubled
{
  const header = lint(aot("Invoice|price|vat =@price*0.2", "A      |100  |20"), "Book");
  const vat = header.nodes.find((n) => n.name === "vat" && n.cell && n.kind === 3);
  check("lint: '=' on a header cell is the column's definition, not part of its name",
    header.errors.length === 0 && vat && vat.constraints && vat.constraints[0].op === "==" && vat.constraints[0].formula === "@price*0.2");
  const doubled = lint(aot("Invoice|price|vat ==@price*0.2", "A      |100  |20"), "Book");
  check("lint: '==' on a header cell defines nothing: it is part of the cell's name",
    !doubled.nodes.some((n) => n.name === "vat") && !doubled.nodes.some((n) => n.constraints && n.constraints.length));
  const values = lint(aot("Note", "    - A", "        text: a == b", "        plain: a \\= b"), "Book");
  check("lint: a doubled '=' in a value reads as one, and a backslash is only a backslash",
    values.errors.length === 0
    && values.nodes.find((n) => n.name === "text").value === "a = b" && values.nodes.find((n) => n.name === "text").formula === undefined
    && values.nodes.find((n) => n.name === "plain").value === "a \\= b");
}

// --- the parent column (1.13): a table nests through it, never by indent -------
{
  const parentsOf = (text) => {
    const r = lint(text, "Zoo");
    return { r, of: (name) => { const n = r.nodes.find((x) => x.kind === 0 && x.name === name); return n && n.parent.name; } };
  };
  const ok = parentsOf(aot("Thing  |parent (thing)|age", "Parent |              |", "Child 1|Parent        |10", "Child 2|parent        |12"));
  check("parent column: a row is filed under the row its cell names, case aside",
    ok.of("Child 1") === "Parent" && ok.of("Child 2") === "Parent" && ok.of("Parent") === "Thing" && ok.r.errors.length === 0);
  check("parent column: it is structure, not an attribute — no node, no value",
    !ok.r.nodes.some((n) => n.name === "parent") && ok.r.nodes.find((n) => n.name === "Thing").parentColumns.length === 1);
  const fwd = parentsOf(aot("Thing  |parent (thing)", "Child 1|Parent", "Parent |"));
  check("parent column: a parent written below its child is still its parent",
    fwd.of("Child 1") === "Parent" && fwd.r.errors.length === 0);
  const same = parentsOf(aot("Thing|parent (thing)", "X    |", "X    |X"));
  check("parent column: a child named like its parent is filed under it, and meets the whole-and-part rule",
    same.r.nodes.filter((n) => n.kind === 0)[1].parent === same.r.nodes.filter((n) => n.kind === 0)[0]
    && same.r.errors.some((e) => /same name as the Example it sits under/.test(e.message)));
  const bad = parentsOf(aot("Thing|parent (thing)", "A    |Nobody", "B    |B", "C    |D", "D    |C"));
  check("parent column: a name no row carries, a row naming itself and a circle are errors, each row left a row of the Concept",
    bad.r.errors.some((e) => e.line === 2 && /no row of this table is called 'Nobody'/.test(e.message) && e.startCol === 6 && e.endCol === 12)
    && bad.r.errors.some((e) => e.line === 3 && /names itself as its parent/.test(e.message))
    && bad.r.errors.filter((e) => /go round in a circle/.test(e.message)).length === 2
    && ["A", "B", "C", "D"].every((n) => bad.of(n) === "Thing"));
  const alias = parentsOf(aot("1. Thing (stuff)|parent (stuff)", "A               |", "B               |A"));
  check("parent column: its (alias) may be any name the Concept answers to, numbering aside", alias.of("B") === "A");
  const plain = parentsOf(aot("Person|parent (person)|age", "Ann   |              |40", "Bob   |Ann           |9", "", "Dog|parent (person)", "Rex|Ann"));
  check("parent column: a 'parent' typed by another Concept is an attribute like any other",
    plain.of("Rex") === "Dog" && plain.r.nodes.some((n) => n.kind === 1 && n.name === "parent" && n.value === "Ann"));
  const noDefault = lint(aot("Thing|parent (thing): X", "A    |"), "Zoo");
  check("parent column: it takes no default, and says so", noDefault.errors.some((e) => /gives the parent column a default/.test(e.message)));
  const chi = lint(aot("Thing  |parent (thing)", "Child 1|Parent", "Parent |"), "Zoo");
  const child = chi.nodes.find((n) => n.name === "Child 1"), parent = chi.nodes.find((n) => n.name === "Parent");
  check("parent column: a child written above its parent is still numbered under it (chi divisible)",
    child.chi % parent.chi === 0n);
}

// What stands one level under a table is the Concept's, never the last row's
{
  const owner = (text, name) => {
    const n = lint(text, "Zoo").nodes.find((x) => x.name === name);
    return n && n.parent.name;
  };
  const trip = aot("Trip|distance", "A   |120", "B   |75", "    total: 195", "    stops");
  check("under a table: a value and a bare attribute are the Concept's",
    owner(trip, "total") === "Trip" && owner(trip, "stops") === "Trip" && lint(trip, "Zoo").errors.length === 0);
  check("under a table: the last row holds only its own cells",
    lint(trip, "Zoo").nodes.find((n) => n.name === "B").children.every((c) => c.cell));
  check("under a table: a blank line above it changes nothing", owner(aot("Trip|distance", "A   |120", "", "    total: 195"), "total") === "Trip");
  check("under a table: a header with no rows yet has its lines too", owner(aot("Trip|distance", "    total: 195"), "total") === "Trip");
  const whole = aot("Trip|distance", "A   |120", "    Leg", "        x: 1", "    - Odd", "        ... why", "    y: 2");
  check("under a table: a sub-Concept, an Example and what they hold keep their places",
    owner(whole, "Leg") === "Trip" && owner(whole, "x") === "Leg" && owner(whole, "Odd") === "Trip" && owner(whole, "y") === "Trip"
    && lint(whole, "Zoo").errors.length === 0);
  const nested = aot("Outer", "    Trip|distance", "    A   |120", "        total: 195", "    other: 1");
  check("under a table: at any depth, and a line level with the table is the table's neighbour",
    owner(nested, "total") === "Trip" && owner(nested, "other") === "Outer");
  const tree = aot("Thing  |parent (thing)|age", "Parent |              |", "Child 1|Parent        |10", "    note: x");
  check("under a table: nor the last row's when that row sits under another", owner(tree, "note") === "Thing" && owner(tree, "Child 1") === "Parent");
  const merged = aot("Order", "    Order|price", "    A    |1", "        deep: 1", "    level: 2");
  check("under a table: a table filling in its Concept's line files them on that Concept",
    owner(merged, "deep") === "Order" && owner(merged, "level") === "Order");
  check("under a table: a bare = line is filed there too",
    lint(aot("Trip|distance", "A   |120", "    =write()"), "Zoo").generators[0].parent.name === "Trip");
  const ends = lint(aot("Trip|distance", "A   |120", "    total: 195", "B   |75"), "Zoo");
  check("under a table: the line ends the table, as any line carrying no pipe does",
    ends.nodes.find((n) => n.name === "B").parent.name === "Zoo");
}

// ---------------------------------------------------------------------------
// any alphabet: case is read from Unicode, so a lowercase first letter means an
// attribute whichever alphabet it is from
// ---------------------------------------------------------------------------
{
  const kindOf = (term) => {
    const r = lint(["Thing", `    ${term}`, ""].join("\n"), "Model");
    return r.nodes[1] && r.nodes[1].kind;
  };
  check("alphabets: a lowercase letter of any alphabet opens an attribute",
    kindOf("ête") === ATTRIBUTE && kindOf("цена") === ATTRIBUTE && kindOf("ñandu") === ATTRIBUTE);
  check("alphabets: with a value it is a value line",
    kindOf("één: 1") === DEFAULT && kindOf("ñandu: x") === DEFAULT && kindOf("цена: 3") === DEFAULT);
  check("alphabets: a capital of any alphabet opens a Concept",
    kindOf("Éclair") === CONCEPT && kindOf("Цена") === CONCEPT);
  check("alphabets: a number opens a Concept",
    kindOf("3D Print") === CONCEPT && kindOf("1. Trip") === CONCEPT);
  check("alphabets: a script with no capitals: a term with a value is a value line, a bare term a Concept",
    kindOf("名前: 太郎") === DEFAULT && kindOf("名前") === CONCEPT);
  const bound = lint(["Thing", "    ête >=1", "    価格 >=1", ""].join("\n"), "Model");
  check("alphabets: a bound is an attribute's in any alphabet",
    bound.nodes.filter((n) => n.kind === ATTRIBUTE && n.constraints).length === 2);
  const shouty = lint(["Thing|Цена", "A|1", ""].join("\n"), "Model");
  check("alphabets: a capitalised column is told to lowercase in any alphabet",
    shouty.errors.some((e) => /lowercase column 'Цена'/.test(e.message)));
  const low = lint(["ête|size", "A|1", ""].join("\n"), "Model");
  check("alphabets: a lowercase first header cell is an error in any alphabet",
    low.errors.some((e) => /first header cell/.test(e.message)));
  const row = lint(["Trip|cost", "10:30 Standup|5", "Éclair|6", "3D Print|7", ""].join("\n"), "Model");
  check("alphabets: a row name opening with a number or a capital of any alphabet stays a row, colon and all",
    row.errors.length === 0 && row.nodes.filter((n) => n.kind === INDIVIDUAL).map((n) => n.name).join() === "10:30 Standup,Éclair,3D Print");
}

// ---------------------------------------------------------------------------
// a `...` line: what Ctrl+/ makes of a line — out of the model, and a table
// goes on past it
// ---------------------------------------------------------------------------
{
  const row = lint(["Trip|cost", "Bus|10", "... Rail|20", "Air|30", ""].join("\n"), "Model");
  const names = row.nodes.filter((n) => n.kind === INDIVIDUAL).map((n) => n.name);
  const map = row.nodes.find((n) => n.kind === MAP);
  check("'...' row: it is no Example, and the rows around it are one table",
    row.errors.length === 0 && names.join() === "Bus,Air");
  check("'...' row: it is the table's Concept's Map", map && map.parent.name === "Trip" && map.name === "Rail|20");
  check("'...' row: a row after it keeps the table's columns",
    row.nodes.find((n) => n.name === "Air").children.some((c) => c.name === "cost" && c.value === "30"));
  const line = lint(["Trip", "    cost", "    ... Hotel", "    - Bus", "        cost: 10", ""].join("\n"), "Model");
  check("'...' line: out of the model in line form too",
    line.errors.length === 0 && !line.nodes.some((n) => n.kind === CONCEPT && /Hotel/.test(n.name)));
  const two = lint(["Trip", "    ... Hotel", "    ...     cost: 10", "    - Bus", ""].join("\n"), "Model");
  check("'...' lines: a parent and its child taken out together read with no error",
    two.errors.length === 0 && two.nodes.filter((n) => n.kind === MAP).length === 2);
  const orphan = lint(["Trip", "    ... Hotel", "        cost: 10", ""].join("\n"), "Model");
  check("'...' line: a parent taken out with its child left behind is the Map error",
    orphan.errors.some((e) => /move those lines out from under it/.test(e.message)));
  const shallow = lint(["Trip", "    Pet|age", "    Rex|3", "... rest", "Other", ""].join("\n"), "Model");
  check("'...' line: one shallower than the rows still ends the table",
    shallow.errors.length === 0 && shallow.nodes.find((n) => n.kind === MAP).parent.name === "Model");
}

// ---------------------------------------------------------------------------
// a tab: only the indentation is the language's
// ---------------------------------------------------------------------------
{
  const inValue = lint(["Thing", "    note: one\ttwo", ""].join("\n"), "Model");
  check("tab: inside a value it is a character of the value, and no error",
    inValue.errors.length === 0 && inValue.nodes.find((n) => n.name === "note").value === "one\ttwo");
  const inRow = lint(["Thing|note", "A|one\ttwo", ""].join("\n"), "Model");
  check("tab: inside a table cell likewise", inRow.errors.length === 0);
  const leading = lint(["Thing", "\tfoo", ""].join("\n"), "Model");
  check("tab: in the indentation it is still an error, and reads as a level",
    leading.errors.some((e) => /tab in the indentation/.test(e.message)) && leading.nodes.find((n) => n.name === "foo").depth === 1);
}

// ---------------------------------------------------------------------------
// no line can stall a keystroke's parse
// ---------------------------------------------------------------------------
{
  const quick = (name, text) => {
    const t = Date.now();
    lint(text, "Model");
    const ms = Date.now() - t;
    check(`pathological line: ${name} (${ms} ms)`, ms < 1500);
  };
  quick("a line of nothing but '='", "x " + "= ".repeat(3200) + "\n");
  quick("a long line of mixed operators", "x " + ">= <= = ".repeat(1200) + "\n");
  quick("a bound made of a long reference", "x =@" + "a ".repeat(2000) + "\n");
  quick("a paragraph at the left margin", "Word " + Array.from({ length: 1600 }, (_, i) => `word${i}`).join(" ") + "\nOther\n");
  const chained = lint(["Thing", "    age >=18 <=65", ""].join("\n"), "Model").nodes.find((n) => n.name === "age");
  check("pathological line: an ordinary chain still reads as bounds", chained && chained.constraints.length === 2);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
