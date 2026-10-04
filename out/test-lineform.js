// Unit tests for the table keys in free text (src/lineform.js): the grid a
// Concept's '- ' Examples make, every operation's edit, and that each one
// touches only the lines it is about.
//
// Plain Node script, no framework — run with: node out/test-lineform.js
const { lint } = require("../src/linter");
const lf = require("../src/lineform");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const PEOPLE = [
  "Person",
  "    age",
  "    - Ann",
  "        age: 30",
  "        city: Paris",
  "    - Bob",
  "        city: Rome",
  "",
  "    - Cid",
  "        age: 50",
  "        - Kid",
  "            age: 2",
];

const gridOf = (lines, line) => lf.gridAt(lines, lint(lines.join("\n"), "Sheet").nodes, line);
// run an operation at a line; answers { lines, cursor, anchor } or null
function run(lines, line, name, span) {
  const g = gridOf(lines, line);
  if (!g) return undefined;
  const answer = typeof name === "function" ? name(g) : lf.ops[name](g, span);
  return answer ? lf.resolve(lines, answer) : null;
}
const text = (r) => r && r.lines.join("\n");
const at = (r) => r && r.cursor && `${r.cursor.line}:${r.cursor.ch}`;

// ---------------------------------------------------------------------------
// the grid: rows are Examples depth-first, columns the attributes in the
// order the Examples write them, a cell an Example's value line
// ---------------------------------------------------------------------------
{
  const g = gridOf(PEOPLE, 3);
  check("grid: the rows are the Examples, sub-Examples after their parent",
    g && g.rows.map((r) => r.name).join() === "Ann,Bob,Cid,Kid");
  check("grid: the columns are the attributes in the order the Examples write them",
    g && g.columns.map((c) => c.key).join() === "age,city");
  check("grid: a value line is its attribute's cell, an Example's line its name",
    g && g.col === 1 && gridOf(PEOPLE, 2).col === 0 && gridOf(PEOPLE, 4).col === 2);
  check("grid: a bare attribute line and the Concept's line are no cells",
    gridOf(PEOPLE, 1) === null && gridOf(PEOPLE, 0) === null);
  const withDefault = ["Person", "    species: human", "    status", "        - draft", "    - Ann", "        age: 3"];
  check("grid: a Concept's own value and an attribute's allowed values are no cells",
    gridOf(withDefault, 1) === null && gridOf(withDefault, 3) === null && gridOf(withDefault, 5) !== null);
  const mixed = ["Person|age", "Ann   |30", "    - Bob", "        age: 4"];
  check("grid: an Example written as a table row is the table's, not a line row",
    gridOf(mixed, 1) === null);
}

// ---------------------------------------------------------------------------
// the context: decided from the text alone
// ---------------------------------------------------------------------------
{
  const cell = (i) => lf.looksLikeCell((k) => PEOPLE[k], i);
  check("looksLikeCell: an Example's line and its values are cells",
    cell(2) && cell(3) && cell(4) && cell(11));
  check("looksLikeCell: a bare attribute, the Concept, a blank line are not",
    !cell(1) && !cell(0) && !cell(7));
  const concept = ["Person", "    species: human"];
  check("looksLikeCell: a Concept's own value is not a cell",
    !lf.looksLikeCell((k) => concept[k], 1));
  check("looksLikeCell: a table row is the table's",
    !lf.looksLikeCell((k) => ["Otter|size", "Ollie|5"][k], 1));
}

// ---------------------------------------------------------------------------
// Tab / Shift+Tab walk the Examples and their values
// ---------------------------------------------------------------------------
{
  check("Tab: from an Example's name to its first value",
    at(run(PEOPLE, 2, "nextCell")) === "3:13");
  check("Tab: from the last value of one Example to the next Example's name",
    at(run(PEOPLE, 4, "nextCell")) === "5:6");
  const grown = run(PEOPLE, 11, "nextCell");
  check("Tab: past the last cell a new Example grows, at the last row's depth",
    grown && grown.lines[12] === "        - " && at(grown) === "12:10" && grown.lines.length === 13);
  check("Shift+Tab: back to the previous cell, over a blank line",
    at(run(PEOPLE, 8, "prevCell")) === "6:14");
}

// ---------------------------------------------------------------------------
// the spreadsheet keys
// ---------------------------------------------------------------------------
{
  check("Ctrl+↓: from a filled cell over a gap to the next filled one",
    at(run(PEOPLE, 3, (g) => lf.jump(g, 1, 0))) === "9:13");
  check("Ctrl+→: along an Example's values to the last",
    at(run(PEOPLE, 2, (g) => lf.jump(g, 0, 1))) === "4:14");
  check("Ctrl+Home / Ctrl+End: the first Example's name, the last Example's last value",
    at(run(PEOPLE, 6, (g) => lf.corner(g, "home"))) === "2:6"
    && at(run(PEOPLE, 6, (g) => lf.corner(g, "end"))) === "11:17");
  const span = lf.conceptSpan(gridOf(PEOPLE, 3));
  check("Ctrl+A: the Concept's lines, first to last",
    span && span.from === 0 && span.to === 11);

  const down = run(PEOPLE, 6, (g) => lf.ops.fillDown({ ...g, col: 1 }));
  check("Ctrl+D: a missing value is filled from the Example above, in column order",
    down && down.lines[6] === "        age: 30" && down.lines[7] === "        city: Rome");
  const over = run(PEOPLE, 6, "fillDown");
  check("Ctrl+D: a value is overwritten from the Example above, and only that line changes",
    over && over.lines[6] === "        city: Paris"
    && over.lines.filter((l, i) => l !== PEOPLE[i]).length === 1);
  check("Ctrl+D: nothing above the first Example, and a name is never filled",
    run(PEOPLE, 3, "fillDown") === null && run(PEOPLE, 5, "fillDown") === null);
  const range = run(PEOPLE, 6, "fillDown", { anchor: { line: 2, ch: 6 }, active: { line: 6, ch: 8 } });
  check("Ctrl+D over a selection: the first Example's selected values fill the rest, selection kept",
    range && range.lines.slice(5, 8).join("|") === "    - Bob|        age: 30|        city: Paris"
    && range.anchor.line === 2 && range.cursor.line === 7);
  const right = run(["P", "    - A", "        x: 1", "        y: 2"], 3, "fillRight");
  check("Ctrl+R: the attribute before fills this one",
    right && right.lines[3] === "        y: 1");
  const priced = ["Order", "    - A", "        price: 2 =1+1", "    - B", "        price: 3"];
  const formula = run(priced, 4, "copyFormulaFromAbove");
  check("Ctrl+': the formula alone from the Example above",
    formula && formula.lines[4] === "        price: =1+1");
  const value = run(priced, 4, "copyValueFromAbove");
  check("Ctrl+Shift+': the value alone from the Example above",
    value && value.lines[4] === "        price: 2");
  const filled = run(priced, 4, "fillDown");
  check("Ctrl+D: a derivation arrives alone — the value above was computed for the Example above",
    filled && filled.lines[4] === "        price: =1+1");
  check("AutoSum is gone with the formula language — a sum is Python's",
    lf.ops.autoSum === undefined);
}

// ---------------------------------------------------------------------------
// rows: move, copy, insert, delete, nest, sort
// ---------------------------------------------------------------------------
{
  const down = run(PEOPLE, 3, "moveRowDown");
  check("Alt+↓: the Example trades places with the next, the cursor with it",
    down && down.lines.slice(2, 7).join("|") === "    - Bob|        city: Rome|    - Ann|        age: 30|        city: Paris"
    && at(down) === "5:13");
  const up = run(PEOPLE, 8, "moveRowUp");
  check("Alt+↑: sub-Examples travel with their Example; the blank line stays between",
    up && up.lines.slice(5, 12).join("|")
      === "    - Cid|        age: 50|        - Kid|            age: 2||    - Bob|        city: Rome");
  check("Alt+↑: the first Example goes no further",
    run(PEOPLE, 2, "moveRowUp") === null);
  const copied = run(PEOPLE, 3, "copyRowDown");
  check("Ctrl+Alt+↓: a copy below, the cursor in it",
    copied && copied.lines.slice(5, 8).join("|") === "    - Ann|        age: 30|        city: Paris" && at(copied) === "6:13");
  const copiedUp = run(PEOPLE, 9, "copyRowUp");
  check("Ctrl+Alt+↑: a copy above, of the Example's own lines without its sub-Examples",
    copiedUp && copiedUp.lines.slice(8, 11).join("|") === "    - Cid|        age: 50|    - Cid");
  const inserted = run(PEOPLE, 6, "insertRow");
  check("Alt+Shift+↓: an empty Example above, waiting for its name",
    inserted && inserted.lines[5] === "    - " && at(inserted) === "5:6");
  const gone = run(PEOPLE, 9, "deleteRow");
  check("Alt+Shift+↑: the Example goes with its sub-Examples",
    gone && gone.lines.length === 8 && !gone.lines.some((l) => /Cid|Kid/.test(l)));
  const nested = run(PEOPLE, 5, "demoteRow");
  check("nest: the Example moves a level under the one above",
    nested && nested.lines[5] === "        - Bob" && nested.lines[6] === "            city: Rome");
  const lifted = run(PEOPLE, 10, "promoteRow");
  check("lift: a sub-Example comes out a level; a top-level one cannot",
    lifted && lifted.lines[10] === "    - Kid" && run(PEOPLE, 2, "promoteRow") === null);
  const sorted = run(["P", "    - B", "        n: 2", "    - A", "        n: 10"], 2, "sortRows");
  check("sort: by the cursor's column, numbers as numbers",
    sorted && sorted.lines.join("|") === "P|    - B|        n: 2|    - A|        n: 10"
    && run(["P", "    - B", "        n: 2", "    - A", "        n: 10"], 1, "sortRows").lines[1] === "    - A");
}

// ---------------------------------------------------------------------------
// columns: move, insert, delete, copy
// ---------------------------------------------------------------------------
{
  const moved = run(PEOPLE, 3, "moveColumnRight");
  check("Alt+→: the attribute trades places with the next in every Example stating both",
    moved && moved.lines[3] === "        city: Paris" && moved.lines[4] === "        age: 30" && at(moved) === "4:13");
  const again = moved && run(moved.lines, 4, "moveColumnRight");
  check("Alt+→: the move sticks — the column is now the last, and goes no further",
    again === null);
  const deleted = run(PEOPLE, 3, "deleteColumn");
  check("Alt+Shift+←: the attribute goes from every Example and from the declarations",
    deleted && !deleted.lines.some((l) => /\bage\b/.test(l)) && deleted.lines.length === 8);
  const added = run(PEOPLE, 3, "insertColumn");
  check("Alt+Shift+→: an empty declaration line, before the column's own, for its name",
    added && added.lines[1] === "    " && added.lines[2] === "    age" && at(added) === "1:4");
  const dup = run(PEOPLE, 3, "copyColumnRight");
  check("Ctrl+Alt+→: a second line of the attribute beside the first, everywhere",
    dup && dup.lines.filter((l) => l.trim() === "age").length === 2
    && dup.lines.filter((l) => /age: 30/.test(l)).length === 2);
}

// ---------------------------------------------------------------------------
// the column keys from a declaration line: `age` under the Concept is that
// column's header, so Alt+Shift+← there deletes the column too
// ---------------------------------------------------------------------------
{
  const nodes = lint(PEOPLE.join("\n"), "Sheet").nodes;
  const headerGrid = lf.gridAt(PEOPLE, nodes, 1, { header: true });
  check("declaration: only the column keys read it as a grid, as the column's header",
    lf.gridAt(PEOPLE, nodes, 1) === null && headerGrid && headerGrid.row === null
    && headerGrid.header && headerGrid.col === 1);
  const runHeader = (lines, line, name) => {
    const g = lf.gridAt(lines, lint(lines.join("\n"), "Sheet").nodes, line, { header: true });
    const answer = g && lf.ops[name](g);
    return answer ? lf.resolve(lines, answer) : null;
  };
  const deleted = runHeader(PEOPLE, 1, "deleteColumn");
  check("declaration: Alt+Shift+← deletes the column, declaration and every value",
    deleted && !deleted.lines.some((l) => /\bage\b/.test(l)) && deleted.lines[1] === "    - Ann" && at(deleted) === "1:6");
  const both = ["Person", "    age", "    city", "    - Ann", "        age: 30", "        city: Paris"];
  const moved = runHeader(both, 1, "moveColumnRight");
  check("declaration: Alt+→ swaps the declarations and the values, the cursor following",
    moved && moved.lines[1] === "    city" && moved.lines[2] === "    age"
    && moved.lines[4] === "        city: Paris" && moved.cursor.line === 2);
  const copied = runHeader(both, 1, "copyColumnRight");
  check("declaration: Ctrl+Alt+→ copies the declaration too, the cursor on the copy",
    copied && copied.lines.filter((l) => l === "    age").length === 2 && copied.cursor.line === 2);
  check("declaration: a Concept with no line-form Example has no column to act on",
    lf.gridAt(["Person", "    age"], lint("Person\n    age", "Sheet").nodes, 1, { header: true }) === null);
  check("declaration: a Concept's own line is no column's header", lf.gridAt(PEOPLE, nodes, 0, { header: true }) === null);
  const decl = (lines, i) => lf.looksLikeDeclaration((k) => lines[k], i);
  check("looksLikeDeclaration: a bare attribute under a Concept written as lines",
    decl(PEOPLE, 1) && !decl(PEOPLE, 0) && !decl(PEOPLE, 2) && !decl(PEOPLE, 3));
  check("looksLikeDeclaration: not without a '- ' Example beside it, nor under an Example",
    !decl(["Person", "    age"], 1) && !decl(["Person", "    - Ann", "        nick", "        - Sub"], 2));
  check("looksLikeDeclaration: past the document's end, a table row, or a term at no indent is none",
    !decl(PEOPLE, 99) && !decl(["T|a", "x|1"], 1) && !decl(["age", "- Ann"], 0));
  check("looksLikeDeclaration: blank lines between are passed over",
    decl(["Person", "", "    age", "", "    - Ann", "        age: 3"], 2));
  check("looksLikeDeclaration: not an indented term with nothing above it, nor one whose Concept ends before an Example",
    !decl(["    age", "    - Ann"], 0) && !decl(["Person", "    age", "Other", "    - Ann"], 1));
}

// ---------------------------------------------------------------------------
// cells: copy and cut into a neighbour
// ---------------------------------------------------------------------------
{
  const down = run(PEOPLE, 3, "copyCellDown");
  check("Ctrl+Alt+Shift+↓: the value into the next Example, following it",
    down && down.lines[6] === "        age: 30" && at(down) === "6:13");
  const cut = run(PEOPLE, 3, "moveCellDown");
  check("cut down: the value moves, leaving its own Example without it",
    cut && !cut.lines.slice(2, 5).some((l) => /age/.test(l)) && cut.lines.some((l) => l === "        age: 30"));
  const across = run(PEOPLE, 3, "copyCellRight");
  check("Ctrl+Alt+Shift+→: the value into the next attribute of the same Example",
    across && across.lines[4] === "        city: 30");
  const grow = run(PEOPLE, 11, "copyCellDown");
  check("down past the last Example grows a new one carrying the value",
    grow && grow.lines.slice(12).join("|") === "        - |            age: 2");
}

// ---------------------------------------------------------------------------
// applying: edits in place, the one changed run
// ---------------------------------------------------------------------------
{
  const done = lf.applyEdits(["a", "b", "c"], [
    { type: "replace", at: 1, text: "B" },
    { type: "insert", after: -1, lines: [{ text: "top", mark: "m" }] },
    { type: "delete", from: 2, to: 2 },
  ]);
  check("applyEdits: replace, insert at the top with a mark, delete",
    done.lines.join() === "top,a,B" && done.marks.m === 0 && done.at[2] === -1 && done.at[1] === 2);
  const change = lf.changedLines(["a", "b", "c", "d"], ["a", "x", "y", "d"]);
  check("changedLines: only the run that differs",
    change && change.from === 1 && change.to === 2 && change.lines.join() === "x,y");
  check("changedLines: a pure insertion and a pure deletion",
    lf.changedLines(["a", "c"], ["a", "b", "c"]).to === 0 && lf.changedLines(["a", "b", "c"], ["a", "c"]).lines.length === 0
    && lf.changedLines(["a"], ["a"]) === null);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
