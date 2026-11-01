// Unit tests for the CSV mirror's three-way merge (src/csvsync.js) and the
// edits it drives (derive.updateScope's erasures, derive.deleteExamples).
//
// Plain Node script, no framework — run with: node out/test-csvsync.js
const { threeWay, unionGrids, closestBaseline, distance } = require("../src/csvsync");
const { lint, KIND } = require("../src/linter");
const { updateScope, deleteExamples, mirrorGrids } = require("../src/derive");
const { applyOps } = require("../src/repo");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const grid = (...rows) => rows.map((r) => r.split(","));
const B = grid("Order,price,qty", "Acme,100,1", "Bolt,50,2");

// --- the truth table, cell by cell ------------------------------------------
{
  // the .aot changed a cell, the CSV did not: the .aot's — nothing to fold
  const p1 = threeWay(B, B, grid("Order,price,qty", "Acme,110,1", "Bolt,50,2"));
  check("threeWay: the .aot changed a cell the CSV did not — nothing folds, the CSV is the one rewritten",
    !p1.fold && !p1.erase.length && !p1.conflicts.length && !p1.deletions.length);
  // the CSV changed a cell, the .aot did not: the CSV's
  const p2 = threeWay(B, grid("Order,price,qty", "Acme,120,1", "Bolt,50,2"), B);
  check("threeWay: the CSV changed a cell the .aot did not — that cell folds, and nothing else",
    p2.fold && p2.fold.length === 2 && p2.fold[1].join(",") === "Acme,120," && !p2.conflicts.length);
  // both changed it the same way
  const p3 = threeWay(B, grid("Order,price,qty", "Acme,120,1", "Bolt,50,2"), grid("Order,price,qty", "Acme,120,1", "Bolt,50,2"));
  check("threeWay: both changed a cell the same way — nothing to do",
    !p3.fold && !p3.conflicts.length);
  // both changed it, apart: the later save wins, and it is said
  const C4 = grid("Order,price,qty", "Acme,120,1", "Bolt,50,2");
  const A4 = grid("Order,price,qty", "Acme,110,1", "Bolt,50,2");
  const aotWins = threeWay(B, C4, A4, { csvNewer: false });
  const csvWins = threeWay(B, C4, A4, { csvNewer: true });
  check("threeWay: changed two ways, the .aot saved later — the .aot's value stays, the conflict named",
    !aotWins.fold && aotWins.conflicts.length === 1
    && JSON.stringify(aotWins.conflicts[0]) === JSON.stringify({ row: "Acme", col: "price", aot: "110", csv: "120", winner: "aot" }));
  check("threeWay: changed two ways, the CSV saved later — the CSV's value folds, the conflict named",
    csvWins.fold && csvWins.fold[1].join(",") === "Acme,120," && csvWins.conflicts[0].winner === "csv");
  // a CSV agreeing with its baseline has nothing to say
  check("threeWay: a CSV still saying what both last agreed on folds nothing, whatever the .aot did",
    !threeWay(B, B, grid("Order,price,qty", "Acme,999,9")).fold);
}

// --- what a CSV could not say before: an empty cell, a row gone ---------------
{
  const emptied = threeWay(B, grid("Order,price,qty", "Acme,,1", "Bolt,50,2"), B);
  check("threeWay: a value the CSV emptied is erased, not ignored",
    !emptied.fold && emptied.erase.length === 1 && emptied.erase[0].row === "Acme" && emptied.erase[0].col === "price");
  const dropped = threeWay(B, grid("Order,price,qty", "Acme,100,1"), B);
  check("threeWay: a row the CSV dropped, unchanged in the .aot, is a deletion to ask about",
    dropped.deletions.join(",") === "Bolt" && !dropped.fold);
  const droppedChanged = threeWay(B, grid("Order,price,qty", "Acme,100,1"), grid("Order,price,qty", "Acme,100,1", "Bolt,55,2"));
  check("threeWay: a row the CSV dropped that the .aot has changed since is kept, the conflict named",
    !droppedChanged.deletions.length && droppedChanged.conflicts.length === 1 && droppedChanged.conflicts[0].col === null
    && droppedChanged.conflicts[0].winner === "aot");
  const aotDropped = threeWay(B, B, grid("Order,price,qty", "Acme,100,1"));
  check("threeWay: a row the .aot dropped stays dropped while the CSV did not touch it",
    !aotDropped.fold && !aotDropped.conflicts.length);
  const revived = threeWay(B, grid("Order,price,qty", "Acme,100,1", "Bolt,60,2"), grid("Order,price,qty", "Acme,100,1"), { csvNewer: true });
  check("threeWay: a row the .aot dropped but the CSV changed after comes back, said",
    revived.fold && revived.fold[1].join(",") === "Bolt,60,2" && revived.conflicts[0].col === null && revived.conflicts[0].winner === "csv");
  const fresh = threeWay(B, grid("Order,price,qty", "Acme,100,1", "Bolt,50,2", "Cog,7,"), B);
  check("threeWay: a new row in the CSV folds in whole",
    fresh.fold && fresh.fold.length === 2 && fresh.fold[1].join(",") === "Cog,7,");
  const column = threeWay(B, grid("Order,price,qty,colour", "Acme,100,1,red", "Bolt,50,2,"), B);
  check("threeWay: a column the CSV added is not read — columns come from the .aot",
    !column.fold);
}

// --- the parent column ------------------------------------------------------------
{
  const P = grid("Thing,parent,age", "Parent,,40", "Kid,Parent,3");
  const moved = threeWay(P, grid("Thing,parent,age", "Parent,,40", "Kid,,3"), P);
  check("threeWay: a parent cell the CSV emptied moves the row to the top — a fold of '', not an erase",
    moved.fold && moved.fold[1].join(",") === "Kid,," && !moved.erase.length);
  const aged = threeWay(P, grid("Thing,parent,age", "Parent,,40", "Kid,Parent,4"), P);
  check("threeWay: a row folded for another cell keeps its parent cell as the .aot has it",
    aged.fold && aged.fold[1].join(",") === "Kid,Parent,4");
}

// --- no baseline: the rule before 1.13 -----------------------------------------
{
  const C = grid("Order,price,qty", "Acme,120,", "Bolt,50,2");
  const p = threeWay(null, C, B);
  check("threeWay: with no baseline, what the CSV says where it says something folds; a blank says nothing",
    p.fold && p.fold.length === 2 && p.fold[1].join(",") === "Acme,120," && !p.erase.length && !p.deletions.length);
  check("threeWay: with no baseline, a row the CSV lacks is never a deletion",
    !threeWay(null, grid("Order,price,qty", "Acme,100,1"), B).deletions.length);
}

// --- a stale copy is merged against its own ancestor ------------------------------
{
  // the two agreed on B1, then on B2 (the .aot raised Bolt's price and the
  // CSV was rewritten); a program still holding B1 saves it back with one
  // edit of its own
  const B1 = B;
  const B2 = grid("Order,price,qty", "Acme,100,1", "Bolt,55,2");
  const stale = grid("Order,price,qty", "Acme,100,3", "Bolt,50,2");
  const at = closestBaseline([B2, B1], stale);
  check("closestBaseline: a stale save descends from the older baseline", at === 1);
  check("closestBaseline: a tie goes to the newer", closestBaseline([B2, B2], B2) === 0);
  const p = threeWay([B2, B1][at], stale, B2);
  check("threeWay: merged against its own ancestor, a stale copy brings only its own edit, never the reversal of the .aot's",
    p.fold && p.fold.length === 2 && p.fold[1].join(",") === "Acme,,3" && !p.conflicts.length && !p.erase.length);
  check("distance: counts the cells two grids hold differently", distance(B1, B2) === 1 && distance(B1, B1) === 0);
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

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
