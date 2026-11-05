// Unit tests for the CSV mirror's one rule (src/csvsync.js): what the .aot takes
// when the CSV is the file saved last, and the edits that drives
// (derive.updateScope's erasures, derive.deleteExamples).
//
// Plain Node script, no framework — run with: node out/test-csvsync.js
const { csvOverrides, unionGrids, saysTheSame } = require("../src/csvsync");
const { lint, KIND } = require("../src/linter");
const { updateScope, deleteExamples, mirrorGrids } = require("../src/derive");
const { applyOps } = require("../src/repo");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const grid = (...rows) => rows.map((r) => r.split(","));
const A = grid("Order,price,qty", "Acme,100,1", "Bolt,50,2");
const over = (csv, aot = A) => csvOverrides(csv, aot);

// --- the CSV saved last overrides, cell by cell ---------------------------------
{
  const one = over(grid("Order,price,qty", "Acme,120,1", "Bolt,50,2"));
  check("csvOverrides: a cell the CSV says differently folds, and nothing else",
    one.fold && one.fold.length === 2 && one.fold[1].join(",") === "Acme,120," && !one.erase.length && !one.deletions.length);
  const all = over(grid("Order,price,qty", "Acme,120,9", "Bolt,60,2"));
  check("csvOverrides: every cell it says differently folds — there is no merging, and no side kept",
    all.fold.length === 3 && all.fold[1].join(",") === "Acme,120,9" && all.fold[2].join(",") === "Bolt,60,");
  check("csvOverrides: a CSV saying what the .aot says has nothing to fold", (() => {
    const p = over(A);
    return !p.fold && !p.erase.length && !p.deletions.length;
  })());
  // the .aot edited a cell since they agreed; the CSV saved after, still saying
  // the old value: the .aot's edit goes, which is what the rule asks
  const oldValue = over(grid("Order,price,qty", "Acme,100,1", "Bolt,50,2"), grid("Order,price,qty", "Acme,110,1", "Bolt,50,2"));
  check("csvOverrides: the CSV wins even where the .aot was edited too, and even where the CSV says an older value",
    oldValue.fold && oldValue.fold[1].join(",") === "Acme,100,");
}

// --- what else a CSV can say: an empty cell, a new row, a row gone ----------------
{
  const emptied = over(grid("Order,price,qty", "Acme,,1", "Bolt,50,2"));
  check("csvOverrides: a value the CSV emptied is erased",
    !emptied.fold && emptied.erase.length === 1 && emptied.erase[0].row === "Acme" && emptied.erase[0].col === "price");
  const dropped = over(grid("Order,price,qty", "Acme,100,1"));
  check("csvOverrides: a row the CSV lacks is a deletion",
    dropped.deletions.join(",") === "Bolt" && !dropped.fold);
  const fresh = over(grid("Order,price,qty", "Acme,100,1", "Bolt,50,2", "Cog,7,"));
  check("csvOverrides: a new row in the CSV folds in whole",
    fresh.fold && fresh.fold.length === 2 && fresh.fold[1].join(",") === "Cog,7,");
  const column = over(grid("Order,price,qty,colour", "Acme,100,1,red", "Bolt,50,2,"));
  check("csvOverrides: a column the CSV added is not read — columns come from the .aot",
    !column.fold);
  const narrow = over(grid("Order,price", "Acme,100", "Bolt,50"));
  check("csvOverrides: a column the CSV does not have says nothing",
    !narrow.fold && !narrow.erase.length);
}

// --- the parent column ------------------------------------------------------------
{
  const P = grid("Thing,parent,age", "Parent,,40", "Kid,Parent,3");
  const moved = over(grid("Thing,parent,age", "Parent,,40", "Kid,,3"), P);
  check("csvOverrides: a parent cell the CSV emptied moves the row to the top — a fold of '', not an erase",
    moved.fold && moved.fold[1].join(",") === "Kid,," && !moved.erase.length);
  const aged = over(grid("Thing,parent,age", "Parent,,40", "Kid,Parent,4"), P);
  check("csvOverrides: a row folded for another cell keeps its parent cell as the .aot has it",
    aged.fold && aged.fold[1].join(",") === "Kid,Parent,4");
}

// --- unsaved edits: no save, so they are overridden like anything else --------
{
  const typed = grid("Order,price,qty", "Acme,100,5", "Bolt,50,2", "Cog,7,1"); // Acme's qty and a whole row, unsaved
  const plan = over(grid("Order,price,qty", "Acme,100,1", "Bolt,60,2"), typed);
  check("csvOverrides: a cell the CSV did not change still takes its word over an unsaved edit",
    plan.fold && plan.fold.find((r) => r[0] === "Acme").join(",") === "Acme,,1");
  check("csvOverrides: and a row an unsaved edit added goes too", plan.deletions.join(",") === "Cog");
  const gone = over(grid("Order,price,qty", "Acme,100,1", "Bolt,50,2"), grid("Order,price,qty", "Acme,100,1"));
  check("csvOverrides: a row an unsaved edit deleted comes back",
    gone.fold && gone.fold[1].join(",") === "Bolt,50,2");
}

// --- one Concept in several files ---------------------------------------------------
{
  const u = unionGrids([grid("Order,price", "Acme,100", "Bolt,"), grid("Order,qty,price", "Bolt,2,50", "Cog,1,")]);
  check("unionGrids: every file's rows, the columns as first met, an empty cell filled by a later file",
    u.map((r) => r.join(",")).join(";") === "Order,price,qty;Acme,100,;Bolt,50,2;Cog,,1");
}

// --- the fold and the deletions, applied ---------------------------------------------
{
  const text = [
    "Order",
    "    tax rate: 0.2",
    "    - Acme",
    "        price: 100",
    "        note: rush",
    "    - Bolt",
    "        price: 50",
    "Part|qty",
    "Cog |4",
    "Nut |9",
  ].join("\n");
  const { root, nodes } = lint(text, "Shop");
  const lines = text.split("\n");
  const order = nodes.find((n) => n.name === "Order" && n.kind === KIND.CONCEPT);
  const part = nodes.find((n) => n.name === "Part" && n.kind === KIND.CONCEPT);
  // the mirror shows an inherited value: a fold of what both say writes nothing
  const mirror = mirrorGrids(root, nodes).find((g) => g.name === "Order");
  const unchanged = updateScope(lines, root, nodes, order, mirror.header, mirror.rows.filter((r) => r[0] === "Bolt"), "Shop");
  check("updateScope: a row whose cells all say what the .aot says changes nothing — an inherited value is not written down",
    unchanged.length === 0);
  const ops = updateScope(lines, root, nodes, order, ["Order", "price", "note"], [], "Shop", { erase: [{ row: "Acme", col: "note" }] });
  const out = applyOps(lines, ops);
  check("updateScope: an erased line-form value loses its line",
    out.join("\n") === lines.filter((l) => l !== "        note: rush").join("\n"));
  const cellOps = updateScope(lines, root, nodes, part, ["Part", "qty"], [], "Shop", { erase: [{ row: "Nut", col: "qty" }] });
  check("updateScope: an erased cell is emptied in its row",
    applyOps(lines, cellOps).slice(7).join("\n") === ["Part|qty", "Cog |4", "Nut |"].join("\n"));
  const del = deleteExamples(lines, root, nodes, order, ["Bolt"]);
  check("deleteExamples: a '- ' Example goes with the lines under it",
    applyOps(lines, del.ops).join("\n") === lines.filter((l, i) => i !== 5 && i !== 6).join("\n") && !del.kept.length);
  const row = deleteExamples(lines, root, nodes, part, ["nut"]);
  check("deleteExamples: a row goes alone, case aside", applyOps(lines, row.ops).slice(7).join("\n") === ["Part|qty", "Cog |4"].join("\n"));

  const tree = ["Thing|parent (thing)", "Parent|", "Kid|Parent"];
  const t = lint(tree.join("\n"), "Shop");
  const thing = t.nodes.find((n) => n.name === "Thing");
  const keep = deleteExamples(tree, t.root, t.nodes, thing, ["Parent"]);
  check("deleteExamples: an Example whose sub-Example stays is kept, and said",
    !keep.ops.length && keep.kept.join(",") === "Parent");
  const both = deleteExamples(tree, t.root, t.nodes, thing, ["Parent", "Kid"]);
  check("deleteExamples: a whole branch the CSV dropped goes", applyOps(tree, both.ops).join("\n") === "Thing|parent (thing)");
}

// A spreadsheet holds 15 significant digits, so it writes a longer number back
// shorter. Nobody edited that cell.
{
  const cellIs = (aotCell, csvCell) => saysTheSame([["T", "n"], ["A", csvCell]], [["T", "n"], ["A", aotCell]]);
  const planOf = (aotCell, csvCell) => csvOverrides([["T", "n"], ["A", csvCell]], [["T", "n"], ["A", aotCell]]);
  for (const [long, short] of [
    ["0.3333333333333333", "0.333333333333333"],
    ["0.30000000000000004", "0.3"],
    ["0.7999999999999999", "0.8"],
    ["1,234.5678901234567", "1234.56789012346"],
    ["1,234.5678901234567", "1,234.56789012346"],
    ["-0.3333333333333333", "-0.333333333333333"],
    ["$0.30000000000000004", "$0.3"],
    ["12,345,678,901,234,567", "12345678901234600"],
    ["12345678901234567", "1.23457E+16"],
    ["1,180,591,620,717,411,303,424", "1,180,591,620,717,410,000,000"],
    ["1000000000000000000", "1E+18"],
  ]) {
    check(`15 digits: ${short} is still ${long}`, cellIs(long, short) && !planOf(long, short).fold && !planOf(long, short).erase.length);
  }
  for (const [written, typed, why] of [
    ["0.3333333333333333", "0.33", "a value someone typed"],
    ["0.3333333333333333", "0.333333333333334", "the 15th digit wrong"],
    ["0.30000000000000004", "0.30000000000000001", "more digits than a spreadsheet holds"],
    ["1.5", "1.50", "a number no longer than 15 digits, in another form"],
    ["1,000", "1000", "a number no longer than 15 digits, in another form"],
    ["12345678901234567", "1.2E+15", "another number"],
    ["0.3333333333333333", "abc", "not a number"],
    ["0.3333333333333333", "", "an emptied cell"],
  ]) {
    check(`15 digits: ${written} to '${typed}' is an edit — ${why}`, !cellIs(written, typed));
  }
  check("15 digits: the plan still takes an edited cell", planOf("0.3333333333333333", "0.5").fold[1][1] === "0.5");
  check("saysTheSame: a row more is something new", !saysTheSame([["T", "n"], ["A", "1"], ["B", "2"]], [["T", "n"], ["A", "1"]]));
  check("saysTheSame: a cell in a further column is something new", !saysTheSame([["T", "n", "m"], ["A", "1", "2"]], [["T", "n"], ["A", "1"]]));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
