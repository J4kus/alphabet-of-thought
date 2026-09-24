// Unit tests for src/derive.js: where derivations and constraints stand, the
// constraint a value is held to, the copy-to-siblings edit, the CSV mirror,
// the Example edits, renumbering and the table/line-form flip. (What a
// derivation or a bound computes is Python's — out/test-python.js.)
//
// Plain Node script, no framework — run with: node out/test-derive.js
const { lint, KIND } = require("../src/linter");
const { derivationSpans, constraintOf, definitionOf, copyToSiblings, conceptRegistry, addExample, updateExamples, mirrorGrids, updateScope, renumberExamples, renumberConcepts, flipForm, gridOfConcept } = require("../src/derive");

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
    "        case: Flags \\=a() | b()",
    "    Case|note",
    "    Row |a \\= b",
  );
  const { root, nodes, lines } = parsed(text);
  const grid = mirrorGrids(root, nodes).find((g) => g.name === "Case");
  const concept = nodes.find((n) => n.name === "Case");
  const same = updateScope(lines, root, nodes, concept, grid.header, grid.rows, "Sheet");
  check("fold: the mirror's own CSV folds back as no change — an escaped '=' and a pipe survive the round trip",
    same.length === 0);
  const csvHeader = ["Case", "case", "note"];
  const edited = [["Pipe", "x =__import__('os').getpid()", ""], ["Row", "", "y =boom()"], ["Fresh", "", "=evil()"]];
  const ops = updateScope(lines, root, nodes, concept, csvHeader, edited, "Sheet");
  const written = ops.map((o) => o.text || (o.block || []).join("\n")).join("\n");
  check("fold: a value a CSV brings is escaped, never a derivation — in line form, in a table cell, and on a fresh row",
    /case: x \\=__import__\('os'\)\.getpid\(\)/.test(written) && /Row {2}\|y \\=boom\(\)/.test(written) && /Fresh\|\\=evil\(\)/.test(written)
    && !/(^|[^\\])=(__import__|boom|evil)/.test(written));
}

// ---------------------------------------------------------------------------
// where the code stands: each derivation from its '=' to its end, and each
// constraint's bound — what the colouring paints and spelling skips
// ---------------------------------------------------------------------------
{
  const text = aot(
    "Order",
    "    age >=18 <=65",
    '    status ==("draft", "sent")',
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
    at(3).join("|") === '==("draft", "sent")');
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

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
