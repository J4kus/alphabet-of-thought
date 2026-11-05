// Unit tests for src/derive.js: where derivations and constraints stand, the
// constraint a value is held to, the copy-to-siblings edit, the CSV mirror,
// the Example edits, renumbering and the table/line-form flip. (What a
// derivation or a bound computes is Python's — out/test-python.js.)
//
// Plain Node script, no framework — run with: node out/test-derive.js
const { lint, KIND } = require("../src/linter");
const { derivationSpans, constraintOf, definitionOf, copyToSiblings, conceptRegistry, addExample, updateExamples, mirrorGrids, updateScope, renumberExamples, renumberConcepts, flipForm, gridOfConcept, conceptScope, makeCtx } = require("../src/derive");

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
  check("copy: a peer's existing attribute gains the derivation, without a value until it runs",
    replaced && replaced.line === 7 && replaced.text === "        vat: =@price*0.2");
  check("copy: a peer without the attribute gains a fresh line after its block",
    inserted && inserted.afterLine === 9 && inserted.text === "        vat: =@price*0.2");
  check("copy: a non-derivation line copies nothing", copyToSiblings(root, nodes, lines, 2) === null);
}

// ---------------------------------------------------------------------------
// a CSV is data: what comes back through the mirror never becomes code, and
// a value round-trips unchanged — escape, pipe and all
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Case",
    "    - Pipe",
    "        case: Flags ==a() | b()",
    "    - Doubled",
    "        case: c == d === e",
    "    Case|note",
    "    Row |a == b",
  );
  const { root, nodes, lines } = parsed(text);
  const grid = mirrorGrids(root, nodes).find((g) => g.name === "Case");
  const concept = nodes.find((n) => n.name === "Case");
  check("mirror: a CSV holds the values as read, the doubled escape read as one",
    grid.rows.some((r) => r.includes("c = d == e")) && grid.rows.some((r) => r.includes("a = b")));
  const same = updateScope(lines, root, nodes, concept, grid.header, grid.rows, "Sheet");
  check("fold: the mirror's own CSV folds back as no change — an escaped '=' and a pipe survive the round trip",
    same.length === 0);
  const csvHeader = ["Case", "case", "note"];
  const edited = [["Pipe", "x =__import__('os').getpid()", ""], ["Row", "", "y =boom()"], ["Fresh", "", "=evil()"]];
  const ops = updateScope(lines, root, nodes, concept, csvHeader, edited, "Sheet");
  const written = ops.map((o) => o.text || (o.block || []).join("\n")).join("\n");
  check("fold: a value a CSV brings is escaped, never a derivation — in line form, in a table cell, and on a fresh row",
    /case: x ==__import__\('os'\)\.getpid\(\)/.test(written) && /Row {2}\|y ==boom\(\)/.test(written) && /Fresh\|==evil\(\)/.test(written)
    && !/(^|\s|\|)=(__import__|boom|evil)/.test(written));
}

// ---------------------------------------------------------------------------
// where the code stands: each derivation from its '=' to its end, and each
// constraint's bound — what the colouring paints and spelling skips
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    age >=18 <=65",
    '    status =("draft", "sent")',
    "    - A",
    "        age: 30",
    "        vat: 2 =@price*0.2",
    "        status: draft",
    "    speed > none noted",
  );
  const { root, nodes, lines } = parsed(text);
  const spans = derivationSpans(root, nodes, lines);
  const at = (line) => spans.filter((s) => s.line === line).map((s) => lines[line - 1].slice(s.startCol, s.endCol));
  check("derivationSpans: a line-form value's derivation, from its '=' to the end",
    at(6).join("|") === "=@price*0.2");
  check("derivationSpans: each bound of a chain is its own constraint span",
    at(2).join("|") === ">=18|<=65" && spans.filter((s) => s.line === 2).every((s) => s.constraint));
  check("derivationSpans: a collection bound is one span, its inner operator no divider",
    at(3).join("|") === '=("draft", "sent")');
  check("derivationSpans: prose is no bound, so no span",
    at(8).length === 0 && at(5).length === 0);

  const age = nodes.find((n) => n.line === 5);
  const held = constraintOf(age);
  check("constraintOf: a value is held by the declaration above its Example",
    held && held.a.line === 2 && held.constraints.map((c) => c.op + c.formula).join(" ") === ">=18 <=65");
  const status = nodes.find((n) => n.line === 3);
  check("definitionOf: a '==' clause is found; whether it names one value is the run's to say",
    definitionOf(status) === '("draft", "sent")' && definitionOf(nodes.find((n) => n.line === 2)) === null);
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
      "Thing  |parent (thing)|age",
      "Parent |              |",
      "Child 1|Parent        |10",
      "Child 2|Parent        |12",
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
    check("mirror: folding back keeps the tree and applies the edit, in the parent column",
      block && block.block.join("\n") === aot(
        "Thing  |parent (thing)|age",
        "Parent |              |",
        "Child 1|Parent        |11",
        "Child 2|Child 1       |12",
      ));
    // a flat table nesting for the first time gains the column, second
    const flat = aot("Thing  |age", "Parent |", "Child 1|10");
    const p3 = parsed(flat);
    const thing3 = p3.nodes.find((n) => n.kind === KIND.CONCEPT && n.name === "Thing");
    const ops3 = updateScope(p3.lines, p3.root, p3.nodes, thing3, ["Thing", "parent", "age"],
      [["Parent", "", ""], ["Child 1", "Parent", "10"], ["Child 2", "Parent", "4"]], "Sheet");
    const block3 = ops3.find((o) => o.type === "block");
    check("mirror: a CSV nesting a flat table's rows adds its parent column, new rows filed by it",
      block3 && block3.block.join("\n") === aot(
        "Thing  |parent (thing)|age",
        "Parent |              |",
        "Child 1|Parent        |10",
        "Child 2|Parent        |4",
      ));
    // a CSV row the spreadsheet moved back to the top empties its parent cell
    const p4 = parsed(block3.block.join("\n"));
    const thing4 = p4.nodes.find((n) => n.kind === KIND.CONCEPT && n.name === "Thing");
    const ops4 = updateScope(p4.lines, p4.root, p4.nodes, thing4, ["Thing", "parent", "age"],
      [["Parent", "", ""], ["Child 1", "", "10"], ["Child 2", "Parent", "4"]], "Sheet");
    const block4 = ops4.find((o) => o.type === "block");
    check("mirror: a row the CSV files at the top has its parent cell emptied",
      block4 && block4.block[2] === "Child 1|              |10");
  }
  // a nested '- ' Example is found where it is written, never appended again
  // at the top with a literal 'parent:' line
  {
    const text = aot(
      "Thing",
      "    - Parent",
      "        - Child 1",
      "            age: 10",
    );
    const p = parsed(text);
    const thing = p.nodes.find((n) => n.kind === KIND.CONCEPT && n.name === "Thing");
    const ops = updateScope(p.lines, p.root, p.nodes, thing, ["Thing", "parent", "age"],
      [["Parent", "", ""], ["Child 1", "Parent", "11"], ["Child 2", "Parent", "3"]], "Sheet");
    const out = require("../src/repo").applyOps(p.lines, ops).join("\n");
    check("mirror: folding into nested line-form Examples updates them where they stand, and files a new one under its parent",
      out === aot(
        "Thing",
        "    - Parent",
        "        - Child 1",
        "            age: 11",
        "        - Child 2",
        "            age: 3",
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
  check("flipForm: a Concept with a Map keeps its own line and files the grid under it — its default rides in the header",
    mixedLines[0] === "Order" && mixedLines[1] === "    ... more to come"
    && mixedLines[2].startsWith("    Order|tax rate: 0.2|price|vat"));
  check("flipForm: the flip never recomputes — a cell reading the Concept's default keeps its value",
    /Acme \| +\|100 +\|20 =@price\*@tax rate/.test(mixedTable.text));
  // the maintained `... N more` note decides nothing: a table has a place for
  // it, one level under its last row, where reconcile itself writes it
  const noted = aot(
    "- Motivation",
    "    Jakus |role",
    "    Do Work|",
    "        ... 4 more in bank recon.aot:2",
  );
  const notedLines = flip(noted, "Jakus");
  check("flipForm: a table's maintained note stays with the Concept on the way to lines",
    notedLines.form === "lines" && notedLines.text === aot(
      "- Motivation",
      "    Jakus",
      "        role",
      "        - Do Work",
      "        ... 4 more in bank recon.aot:2",
    ));
  const notedBack = flip(notedLines.text, "Jakus");
  check("flipForm: and it does not force the merge form on the way back — the table returns, its note under its last row",
    notedBack.form === "table" && notedBack.text === aot(
      "- Motivation",
      "    Jakus  |role",
      "    Do Work|",
      "        ... 4 more in bank recon.aot:2",
    ));
  check("flipForm: a table with a maintained note flips and flips back, whole, every time",
    flip(flip(notedBack.text, "Jakus").text, "Jakus").text === notedBack.text);
  const notedMap = flip(aot("Order", "    price", "    ... more to come", "    - Acme", "        price: 100", "    ... 2 more in a.aot:1"), "Order");
  check("flipForm: a Map you wrote still keeps the merge form, and the note stays among the lines it keeps",
    notedMap.text === aot("Order", "    ... more to come", "    ... 2 more in a.aot:1", "    Order|price", "    Acme |100"));
  const defaultsOnly = aot("Order", "    tax rate: 0.2", "    price", "    - Acme", "        price: 100");
  const standalone = flip(defaultsOnly, "Order");
  check("flipForm: a Concept whose only extra is a default flips to one standalone table, the default in the header",
    standalone.text.split("\n")[0] === "Order|tax rate: 0.2|price" && flip(standalone.text, "Order").text === defaultsOnly);
  const typed = aot("Currency: EUR", "    symbol", "    - USD", "        symbol: $");
  const typedTable = flip(typed, "Currency");
  check("flipForm: a Concept's own default moves into the first header cell, and back",
    typedTable.text.split("\n")[0] === "Currency: EUR|symbol" && flip(typedTable.text, "Currency").text === typed);
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

  // A sub-Example IS a row — one naming its parent row in the `parent
  // (thing)` column — so a nested list and a nested grid are the same idea
  // in two spellings, and the flip between them loses nothing either way.
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
  check("flipForm: a nested list flips to a flat grid, each sub-Example naming its parent in the column second",
    nestedGrid.form === "table"
    && nestedGrid.text === aot(
      "Thing       |parent (thing)|age",
      "Parent      |              |",
      "Child 1     |Parent        |10",
      "Child 2     |Parent        |12",
      "Other Parent|              |",
      "Child 3     |Other Parent  |7",
    ));
  check("flipForm: and back again, exactly as it was written",
    flip(nestedGrid.text, "Thing").text === nestedLines);
  check("flipForm: a row whose parent is written below it is still filed under it on the way back",
    flip(aot("Thing  |parent (thing)|age", "Child 1|Parent        |10", "Parent |              |"), "Thing").text
    === aot("Thing", "    age", "    - Parent", "        - Child 1", "            age: 10"));

  // a blank line above an Example is a divider above its row, and back
  const spaced = aot(
    "Thing",
    "    age",
    "",
    "    - A",
    "        age: 1",
    "",
    "    - B",
    "        age: 2",
  );
  const spacedGrid = flip(spaced, "Thing");
  check("flipForm: blank lines between Examples become dividers, one under the header for the first",
    spacedGrid.text === aot("Thing|age", "-----|---", "A    |1", "-----|---", "B    |2"));
  check("flipForm: and the dividers come back as the blank lines they were",
    flip(spacedGrid.text, "Thing").text === spaced);

  // the grid must not run into a table written straight after the Concept
  const swallowed = flip(aot("Person", "    - Ann", "        age: 3", "Dog|legs", "Rex|4"), "Person");
  check("flipForm: a table right after the Concept is kept apart from the grid by a blank line",
    swallowed.text === aot("Person|age", "Ann   |3", "", "Dog|legs", "Rex|4")
    && lint(swallowed.text, "Sheet").nodes.filter((n) => n.kind === KIND.CONCEPT).map((n) => n.name).join(",") === "Person,Dog");

  // a row with no name keeps its values on the way out of the grid
  check("flipForm: a row with an empty name cell comes back as a '- ' waiting for its name, values and all",
    flip(aot("Thing|age", "A    |1", "     |2"), "Thing").text === aot("Thing", "    age", "    - A", "        age: 1", "    - ", "        age: 2"));
  check("flipForm: a sub-Example's own attribute still becomes a column",
    flip(aot(
      "Thing",
      "    - Parent",
      "        - Child",
      "            nickname: Kid",
    ), "Thing").text.includes("nickname"));

  // a Concept with no Examples is a header and nothing more, and back
  const headerOnly = flip(aot("Colour", "    hue"), "Colour");
  check("flipForm: a Concept with no Examples flips to its header alone",
    headerOnly && headerOnly.form === "table" && headerOnly.text === "Colour|hue");
  check("flipForm: and a header with no rows flips back to the Concept's lines",
    flip("Colour|hue", "Colour").text === aot("Colour", "    hue")
    && flip("Colour", "Colour").text === "Colour|" && flip("Colour|", "Colour").text === "Colour");

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
// ideaAt / positionOf: the cursor stays on its idea across a flip
// ---------------------------------------------------------------------------
{
  const { ideaAt, positionOf } = require("../src/derive");
  // flip the Concept at `pos` and say where the cursor's idea now stands
  const across = (text, name, pos) => {
    const p = parsed(text);
    const concept = p.nodes.find((n) => n.kind === KIND.CONCEPT && n.name === name);
    const idea = ideaAt(p.lines, p.nodes, concept, pos);
    const edit = flipForm(p.lines, concept, "Sheet");
    const out = p.lines.slice();
    out.splice(edit.from, edit.to - edit.from + 1, ...edit.block);
    const q = parsed(out.join("\n"));
    const at = positionOf(q.lines, q.root, q.nodes, idea, edit.from);
    return { lines: q.lines, at, text: at ? q.lines[at.line].slice(at.character) : null };
  };
  const lineForm = aot(
    "Invoice: EUR",
    "    tax rate: 0.2",
    "    price",
    "    - Acme",
    "        price: 110",
    "        - Acme Sub",
    "            price: 5",
    "    - Bolt",
  );
  const value = across(lineForm, "Invoice", { line: 4, character: 17 }); // the '0' of 110
  check("ideaAt/positionOf: a value line's cursor lands inside the same value in its cell, as far in",
    value.at && value.lines[value.at.line].startsWith("Acme ") && value.text === "0");
  const sub = across(lineForm, "Invoice", { line: 5, character: 12 }); // the 'm' of 'Acme Sub'
  check("ideaAt/positionOf: an Example's line lands on its row's name, the same character in",
    sub.at && sub.text.startsWith("me Sub") && sub.at.character === 2);
  const decl = across(lineForm, "Invoice", { line: 1, character: 6 }); // in 'tax rate'
  check("ideaAt/positionOf: a declaration lands on its header cell",
    decl.at && decl.at.line === 0 && decl.text.startsWith("x rate: 0.2"));
  const own = across(lineForm, "Invoice", { line: 0, character: 10 }); // in the default 'EUR'
  check("ideaAt/positionOf: the Concept's default lands in the header's first cell, on the default",
    own.at && own.at.line === 0 && own.text.startsWith("UR|"));

  const grid = aot(
    "Invoice: EUR|parent (invoice)|tax rate: 0.2|price",
    "Acme        |                |             |110",
    "Acme Sub    |Acme            |             |5",
    "Bolt        |                |             |",
  );
  const cellBack = across(grid, "Invoice", { line: 2, character: 44 }); // Acme Sub's price, '5'
  check("ideaAt/positionOf: a cell lands on its value line, as far in",
    cellBack.at && cellBack.lines[cellBack.at.line].trim() === "price: 5" && cellBack.text === "5");
  const emptyBack = across(grid, "Invoice", { line: 3, character: 46 }); // Bolt's empty price
  check("ideaAt/positionOf: an empty cell lands on its Example's name in line form, where it writes no line",
    emptyBack.at && emptyBack.text === "Bolt");
  const parentCell = across(grid, "Invoice", { line: 2, character: 15 }); // Acme Sub's parent cell
  check("ideaAt/positionOf: the parent cell lands on the Example it files",
    parentCell.at && parentCell.text === "Acme Sub");
  // and an empty cell comes back to itself when the table comes back
  const there = across(aot("Thing", "    age", "    size", "    - A", "        size: 2"), "Thing", { line: 3, character: 6 });
  const p2 = parsed(there.lines.join("\n"));
  const thing2 = p2.nodes.find((n) => n.name === "Thing");
  const idea2 = ideaAt(p2.lines, p2.nodes, thing2, { line: 1, character: 6 }); // A's empty age cell
  const edit2 = flipForm(p2.lines, thing2, "Sheet");
  const mid = p2.lines.slice();
  mid.splice(edit2.from, edit2.to - edit2.from + 1, ...edit2.block);
  const p3 = parsed(mid.join("\n"));
  const thing3 = p3.nodes.find((n) => n.name === "Thing");
  const idea3 = ideaAt(p3.lines, p3.nodes, thing3, positionOf(p3.lines, p3.root, p3.nodes, idea2, edit2.from));
  const edit3 = flipForm(p3.lines, thing3, "Sheet");
  const fin = p3.lines.slice();
  fin.splice(edit3.from, edit3.to - edit3.from + 1, ...edit3.block);
  const p4 = parsed(fin.join("\n"));
  const at4 = positionOf(p4.lines, p4.root, p4.nodes, { ...idea2 }, edit3.from);
  check("ideaAt/positionOf: an empty cell is that cell again when the table comes back",
    there.lines[0] === "Thing|age|size" && idea2.part === "cell" && idea2.column === "age"
    && at4 && at4.line === 1 && at4.character === "Thing|".length && idea3 !== null);
  check("ideaAt/positionOf: a cursor outside the Concept has no idea to keep",
    (() => {
      const p = parsed(aot("Other", "    - X", "Thing", "    - A"));
      return ideaAt(p.lines, p.nodes, p.nodes.find((n) => n.name === "Thing"), { line: 1, character: 6 }) === null;
    })());
}

// ---------------------------------------------------------------------------
// hoistOps: a fact every child states, written once on the parent
// ---------------------------------------------------------------------------
{
  const { hoistOps } = require("../src/derive");
  const { applyOps } = require("../src/repo");
  const { hoists } = require("../src/godel");
  const run = (lines, parentLine, attr, value, mode) => {
    const { root, nodes } = lint(lines.join("\n"), "Zoo");
    const ops = hoistOps(lines, root, nodes, parentLine, attr, value, "Zoo", undefined, mode);
    return ops && applyOps(lines, ops);
  };
  const quiet = (lines) => { const r = lint(lines.join("\n"), "Zoo"); return !r.errors.length && !hoists(r.root, r.nodes).length; };
  const vehicles = ["Vehicle", "    Car", "        wheels: 4", "        doors: 3", "    Van", "        wheels: 4", "        doors: 5"];
  const moved = run(vehicles, 1, "wheels", "4");
  check("hoistOps: the fact goes onto the parent once, off every child, and the warning goes",
    moved && moved.join("\n") === ["Vehicle", "    wheels: 4", "    Car", "        doors: 3", "    Van", "        doors: 5"].join("\n") && quiet(moved));
  const table = ["Payment|currency|amount", "P1     |EUR     |10", "P2     |EUR     |20", "P3     |EUR     |30"];
  const lifted = run(table, 1, "currency", "EUR");
  check("hoistOps: a table column holding it in every row is dropped, the table taking the merge form",
    lifted && lifted.join("\n") === ["Payment", "    currency: EUR", "    Payment|amount", "    P1     |10", "    P2     |20", "    P3     |30"].join("\n") && quiet(lifted));
  // the merge form: the Concept has a line of its own, the table beneath it
  const merged = ["Payment", "    note: monthly", "    Payment|currency|amount", "    P1     |EUR     |10", "    P2     |EUR     |20", "    P3     |EUR     |30"];
  const liftedMerged = run(merged, 1, "currency", "EUR");
  check("hoistOps: under a Concept with a line of its own, the column goes and the fact joins its attributes",
    liftedMerged && liftedMerged.join("\n") === ["Payment", "    note: monthly", "    currency: EUR", "    Payment|amount", "    P1     |10", "    P2     |20", "    P3     |30"].join("\n")
    && quiet(liftedMerged));
  const agreed = ["Drink", "    temperature: cold", "    Tea", "        temperature: hot", "    Soup", "        temperature: hot"];
  const rewritten = run(agreed, 1, "temperature", "hot");
  check("hoistOps: a dead default the children agree against is rewritten, not doubled",
    rewritten && rewritten.join("\n") === ["Drink", "    temperature: hot", "    Tea", "    Soup"].join("\n"));
  const dead = ["Drink", "    temperature: cold", "    Tea", "        temperature: hot", "    Soup", "        temperature: warm"];
  const bare = run(dead, 1, "temperature", "", "bare");
  check("hoistOps: 'keep just the attribute' takes the dead value off",
    bare && bare[1] === "    temperature" && quiet(bare));
  const top = run(["Car", "    wheels: 4", "Van", "    wheels: 4"], 0, "wheels", "4");
  check("hoistOps: at the file's own level the fact opens the file, unindented",
    top && top.join("\n") === ["wheels: 4", "Car", "Van"].join("\n") && quiet(top));
  // a part inherits nothing from its whole: what every sub-Example states is
  // no fact about the Example above, so it is never offered for lifting there
  const family = ["Family", "    - Parent", "        - Child One", "            age: 10", "        - Child Two", "            age: 10",
    "        - Child Three", "            age: 10"];
  const fam = lint(family.join("\n"), "Zoo");
  check("hoists: a value every sub-Example states stays theirs — an Example lends nothing, so nothing moves onto it",
    !hoists(fam.root, fam.nodes).some((h) => h.parent.name === "Parent"));
  // a fact moved up keeps its '=' as written: the model's value is written
  // back the way the file must hold it, never as a derivation
  const escaped = run(["Box", "    - A", "        note: a == b", "    - B", "        note: a == b", "    - C", "        note: a == b"], 1, "note", "a = b");
  const reread = escaped && lint(escaped.join("\n"), "Zoo").nodes.find((n) => n.name === "note" && n.parent.name === "Box");
  check("hoistOps: a fact holding a literal '=' lands escaped, and reads as itself",
    escaped && escaped[1] === "    note: a == b" && reread && reread.value === "a = b" && reread.formula === undefined);
  const nested = ["Payment|parent (payment)|currency|amount", "P1     |                |EUR     |10", "P1a    |P1              |EUR     |5",
    "P2     |                |EUR     |20", "P3     |                |EUR     |30"];
  const liftedGrid = ["Payment", "    currency: EUR", "    Payment|parent (payment)|amount", "    P1     |                |10",
    "    P1a    |P1              |5", "    P2     |                |20", "    P3     |                |30"].join("\n");
  check("hoistOps: a table with rows under rows keeps them under, the column gone",
    run(nested, 1, "currency", "EUR").join("\n") === liftedGrid);
  check("hoistOps: nothing to do where the parent is gone, or there is no default to keep just",
    run(vehicles, 99, "wheels", "4") === null && run(["Car", "    wheels", "    - Mini", "        wheels: 4"], 1, "wheels", "", "bare") === null);
}

// 1.13: a Concept's default (`Currency: EUR`) is what an attribute typed by
// it reads where nothing values it — read the same way by the mirror, a
// Concept's scope, a line-form reference, the links and the Gödel number —
// and a header cell may state a column's default
{
  const { resolve, unlistedValues } = require("../src/crosslinks");
  const godel = require("../src/godel");
  const lines = [
    "Currency: EUR",
    "    - USD",
    "    - GBP",
    "Order",
    "    currency",
    "    total",
    "    - Acme",
    "        total: =@currency",
    "    - Bolt",
    "        currency: EUR",
    "    - Kite",
    "        currency: GBP",
  ];
  const { root, nodes } = lint(lines.join("\n"), "Shop");
  const order = nodes.find((n) => n.name === "Order");
  const grid = mirrorGrids(root, nodes).find((g) => g.name === "Order");
  const col = grid.header.indexOf("currency");
  check("type default: the CSV mirror writes it for an Example silent on the attribute, and an Example's own value wins",
    grid.rows.find((r) => r[0] === "Acme")[col] === "EUR" && grid.rows.find((r) => r[0] === "Kite")[col] === "GBP");
  const scope = conceptScope(order);
  check("type default: a Concept's scope (what @Order reads) reads it too",
    scope.cellAt("currency", 0) === "EUR" && scope.typeDefault("currency") === "EUR");
  const acmeTotal = nodes.find((n) => n.name === "total" && n.parent.name === "Acme");
  check("type default: a line-form reference to the attribute reads it",
    makeCtx(acmeTotal, (n) => n.value || "").cell("currency") === "EUR");
  const links = resolve(lines.join("\n"), root, nodes);
  const toDefault = links.find((l) => l.line === 10 && l.connection === "value-is-a-default");
  check("type default: a value naming the default links to the Concept that states it, as a value",
    toDefault && toDefault.target.name === "Currency" && toDefault.asValue === true);
  check("type default: the default is never hinted as a missing Example",
    !unlistedValues(lines.join("\n"), root, nodes).some((h) => h.value === "EUR"));
  const t = godel.buildGodel(root, nodes);
  const acme = nodes.find((n) => n.name === "Acme");
  const p = godel.profile(root, nodes, acme, t);
  const slot = p.slots.find((s) => s.attr === "currency");
  check("type default: the Gödel number carries it, and the hover says whose default it is",
    slot && slot.value === "EUR" && slot.typeDefault === true && slot.from.name === "Currency" && !slot.own);
  check("type default: no rule lifts a value read from a type's default",
    !godel.hoists(root, nodes).some((h) => h.attr === "currency"));

  const header = lint(["Order|price|tax rate: 0.2", "Acme |100  |", "Bolt |50   |0.1"].join("\n"), "Shop");
  const hgrid = mirrorGrids(header.root, header.nodes).find((g) => g.name === "Order");
  const tcol = hgrid.header.indexOf("tax rate");
  check("header default: an empty cell inherits the column's default the header states; a cell's own value wins",
    tcol > 0 && hgrid.rows.find((r) => r[0] === "Acme")[tcol] === "0.2" && hgrid.rows.find((r) => r[0] === "Bolt")[tcol] === "0.1");
}

// a link covers the value as written: an escaped '=' is two characters on
// the line though the model reads it as one
{
  const { resolve } = require("../src/crosslinks");
  const lines = ["Rule", "    - x = y", "Check", "    rule", "    - First", "        rule: x == y", "    Check|rule", "    Second|x == y"];
  const { root, nodes } = lint(lines.join("\n"), "Zoo");
  const links = resolve(lines.join("\n"), root, nodes).filter((l) => l.connection === "default-is-a-Example");
  const span = (l) => lines[l.line - 1].slice(l.startCol, l.endCol);
  check("links: a value holding a literal '=' links across its whole written text, in line form and in a cell",
    links.length === 2 && links.every((l) => span(l) === "x == y"));
}

// the parent column links: each cell to the row it names, the column's
// (alias) to the table's own Concept — what Ctrl+click, hover and a rename
// follow
{
  const { resolve } = require("../src/crosslinks");
  const lines = ["Thing  |parent (thing)|age", "Child 1|Parent        |10", "Parent |              |", "Stray  |Nobody        |"];
  const { root, nodes } = lint(lines.join("\n"), "Zoo");
  const links = resolve(lines.join("\n"), root, nodes);
  const span = (l) => lines[l.line - 1].slice(l.startCol, l.endCol);
  const cell = links.find((l) => l.connection === "parent-is-a-Example");
  check("links: a parent cell links the row it names — written below it here",
    cell && cell.line === 2 && span(cell) === "Parent" && cell.target.line === 3
    && links.filter((l) => l.connection === "parent-is-a-Example").length === 1);
  const alias = links.find((l) => l.connection === "attribute-is-a-Concept" && l.line === 1);
  check("links: the parent column's (alias) links the table's own Concept",
    alias && span(alias) === "thing" && alias.target.name === "Thing");
}

// a Concept's alias links the Concepts its words name, as its name does
{
  const { resolve } = require("../src/crosslinks");
  const lines = ["Person", "Legal Entity (Company)", "Human (Natural Person)", "Firm (Legal Company Body)", "Auto (Car)", "Car"];
  const { root, nodes } = lint(lines.join("\n"), "Zoo");
  const links = resolve(lines.join("\n"), root, nodes);
  const span = (l) => lines[l.line - 1].slice(l.startCol, l.endCol);
  const on = (line) => links.filter((l) => l.line === line).map((l) => `${l.connection}:${span(l)}->${l.target.name}`);
  check("links: a word of an alias naming another Concept links to it",
    on(3).join(",") === "concept-contains-Concept:Person->Person");
  check("links: a word of an alias naming another Concept's alias links to that Concept",
    on(4).join(",") === "concept-contains-Concept:Company->Legal Entity");
  check("links: an alias that is wholly another Concept's name still links whole, once",
    on(5).join(",") === "alias-is-a-Concept:Car->Car");
}

// ---------------------------------------------------------------------------
// the flip keeps every value, whatever alphabet or numbering the name is in
// ---------------------------------------------------------------------------
{
  const { flipForm } = require("../src/derive");
  for (const name of ["Trip", "1. Trip", "Éclair", "3D Print", "日本語"]) {
    const lines = [`${name}|cost`, "Bus|10", "Rail|20"];
    const parsed = lint(lines.join("\n"), "Model");
    const concept = parsed.nodes.find((n) => n.kind === KIND.CONCEPT);
    const edit = flipForm(lines, concept, "Model");
    const out = edit.block.join("\n");
    check(`flip: '${name}' keeps every value`,
      edit.form === "lines" && /cost: 10/.test(out) && /cost: 20/.test(out) && out.startsWith(name));
  }
}

// ---------------------------------------------------------------------------
// a `...` line in a table: out of the model, in its place, through every redraw
// ---------------------------------------------------------------------------
{
  const { flipForm, hoistOps } = require("../src/derive");
  const lines = ["Trip|cost", "Bus |10", "... Rail|20", "Air |30"];
  const parsed = lint(lines.join("\n"), "Model");
  const concept = parsed.nodes.find((n) => n.kind === KIND.CONCEPT);
  const grid = mirrorGrids(parsed.root, parsed.nodes).find((g) => g.name === "Trip");
  check("'...' row: the Example is gone from the model and the CSV", grid.rows.map((r) => r[0]).join() === "Bus,Air");
  // a CSV arriving redraws the table: the line stays between the same rows
  const ops = updateScope(lines, parsed.root, parsed.nodes, concept, ["Trip", "cost"], [["Bus", "11"], ["New", "5"]], "Model");
  const block = ops.find((o) => o.type === "block");
  check("'...' row: a CSV folding in keeps it between the same rows",
    block && block.block.join("\n") === ["Trip|cost", "Bus |11", "... Rail|20", "Air |30", "New |5"].join("\n"));
  // the flip writes it as a line, and nothing is lost
  const flipped = flipForm(lines, concept, "Model");
  const out = flipped.block.join("\n");
  check("'...' row: the flip keeps it, in its place among the Examples",
    flipped.form === "lines" && /- Bus\n\s+cost: 10\n\s+\.\.\. Rail\|20\n\s+- Air/.test(out));
  const back = lint(out, "Model");
  check("'...' row: what the flip wrote reads with no error", back.errors.length === 0);
}

// ---------------------------------------------------------------------------
// the flip stops rather than lose a value, and says where
// ---------------------------------------------------------------------------
{
  const { flipBlockers } = require("../src/derive");
  const blockers = (...lines) => {
    const parsed = lint(lines.join("\n"), "Model");
    const concept = parsed.nodes.find((n) => n.kind === KIND.CONCEPT);
    return flipBlockers(lines, concept, "Model");
  };
  const repeated = blockers("Order", "    - A1", "        tag: red", "        tag: blue");
  check("flip stops: an attribute with two values on one Example, on both its lines",
    repeated.map((b) => b.line).join() === "3,4" && /^keep one value for 'tag' on 'A1' before flipping — /.test(repeated[0].message));
  const listed = blockers("Order", "    status", "        - draft", "        - sent", "    - A1", "        status: draft");
  check("flip stops: an attribute listing its values on lines, with the bound to write instead",
    listed.length === 1 && listed[0].line === 2 && listed[0].message.startsWith(`write 'status =("draft", "sent")' on one line before flipping — `));
  check("flip goes ahead: an attribute repeated with one value loses nothing",
    !blockers("Order", "    - A1", "        tag: red", "        tag: red").length);
  check("flip goes ahead: an allowed-values list no Example gives a value",
    !blockers("Order", "    status", "        - draft", "    - A1", "        size: 3").length);
  check("flip goes ahead: a table flipping to lines loses nothing",
    !blockers("Order|tag", "A1|red").length);
  check("flip goes ahead: an ordinary Concept", !blockers("Order", "    - A1", "        tag: red", "    - A2", "        tag: blue").length);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
