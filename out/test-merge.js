// Unit tests for the semantic three-way merge (src/merge.js) and, where git
// is installed, the merge driver end to end (verify.js --merge): what merges
// cleanly by meaning, what conflicts attribute by attribute, and what falls
// back to git's own merge.
//
// Plain Node script, no framework — run with: node out/test-merge.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { merge, MARK_OURS, MARK_MID, MARK_THEIRS } = require("../src/merge");
const { lint } = require("../src/linter");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const aot = (...lines) => lines.join("\n");
const BASE = aot(
  "Pet",
  "    legs: 4",
  "    Dog",
  "        sound: bark",
  "        colour: brown",
  "    Cat",
  "        sound: meow",
);

// --- what merges cleanly ------------------------------------------------------
{
  const r = merge(BASE, BASE.replace("sound: bark", "sound: woof"), BASE.replace("colour: brown", "colour: black"), "Zoo");
  check("merge: two attributes of one node, on neighbouring lines, both land",
    r.clean && !r.fallback && r.text === BASE.replace("sound: bark", "sound: woof").replace("colour: brown", "colour: black"));
}
{
  const r = merge(BASE, BASE.replace("    Dog", "    Hound"), BASE.replace("sound: bark", "sound: woof"), "Zoo");
  check("merge: a rename on one side and a value change on the other both apply",
    r.clean && r.text === BASE.replace("    Dog", "    Hound").replace("sound: bark", "sound: woof"));
}
{
  const ours = BASE + "\n    Bird\n        sound: tweet";
  const theirs = BASE.replace("    Cat", "    Fish\n        sound: blub\n    Cat");
  const r = merge(BASE, ours, theirs, "Zoo");
  const alone = merge(BASE, BASE.replace("sound: meow", "sound: purr"), theirs, "Zoo");
  check("merge: a node added on one side, a value changed on the other",
    alone.clean && alone.text === theirs.replace("sound: meow", "sound: purr"));
  // where an addition lands: the first attribute of a node that had none
  // goes under its line; a first child after its parent's attributes; a new
  // top-level Concept at the file's own level, blank lines and all
  const kennel = aot("Pet", "    legs: 4", "    Dog", "        - Rex", "            age: 3", "    Cat", "        sound: meow");
  const older = kennel.replace("age: 3", "age: 4");
  const firstSlot = merge(kennel, older, kennel.replace("    Dog\n", "    Dog\n        sound: bark\n"), "Zoo");
  check("merge: the first attribute of a node that had none goes directly under it",
    firstSlot.clean && firstSlot.text === older.replace("    Dog\n", "    Dog\n        sound: bark\n"));
  const firstChild = merge(kennel, older, kennel.replace("    legs: 4\n", "    legs: 4\n    Ant\n        legs: 6\n"), "Zoo");
  check("merge: a new first child goes after its parent's attributes",
    firstChild.clean && firstChild.text === older.replace("    legs: 4\n", "    legs: 4\n    Ant\n        legs: 6\n"));
  const topLevel = merge(kennel, older, kennel + "\nToy\n    kind: ball\n\n    colour: red", "Zoo");
  check("merge: a new top-level Concept lands at the file's level, its blank line kept",
    topLevel.clean && topLevel.text === older + "\nToy\n    kind: ball\n\n    colour: red");
  check("merge: two siblings added, one on each side, both land where their side put them",
    r.clean && r.text === aot("Pet", "    legs: 4", "    Dog", "        sound: bark", "        colour: brown",
      "    Fish", "        sound: blub", "    Cat", "        sound: meow", "    Bird", "        sound: tweet"));
}
{
  const t = aot("Order|price|qty", "A    |10   |1", "B    |20   |2");
  const r = merge(t, t.replace("A    |10   |1", "A    |11   |1"), t.replace("A    |10   |1", "A    |10   |5"), "Zoo");
  check("merge: two different cells of one table row, cell by cell",
    r.clean && r.text === aot("Order|price|qty", "A    |11   |5", "B    |20   |2"));
}
{
  const t = aot("Order|price", "A    |10", "B    |20");
  const r = merge(t, t + "\nC    |30", t.replace("A    |10", "A    |12"), "Zoo");
  check("merge: a row added on one side and a cell changed on the other",
    r.clean && r.text === aot("Order|price", "A    |12", "B    |20", "C    |30"));
}
{
  const r = merge(BASE, BASE.replace("sound: bark", "sound: woof"), BASE.replace("sound: bark", "sound: woof"), "Zoo");
  check("merge: the same change on both sides is taken once", r.clean && r.text === BASE.replace("sound: bark", "sound: woof"));
}

// --- what conflicts, and where the markers go ---------------------------------
{
  const r = merge(BASE, BASE.replace("sound: bark", "sound: woof"), BASE.replace("sound: bark", "sound: yap"), "Zoo");
  const lines = r.text.split("\n");
  check("conflict: one attribute changed two ways is marked on that line alone",
    !r.clean && !r.fallback && r.conflicts.length === 1 && /'sound' of 'Dog' was changed two ways/.test(r.conflicts[0].message)
    && lines.join("\n") === aot("Pet", "    legs: 4", "    Dog", MARK_OURS, "        sound: woof", MARK_MID, "        sound: yap", MARK_THEIRS,
      "        colour: brown", "    Cat", "        sound: meow")
    && r.conflicts[0].line === 4);
}
{
  const r = merge(BASE, BASE.replace("\n    Cat\n        sound: meow", ""), BASE.replace("sound: meow", "sound: purr"), "Zoo");
  check("conflict: removed on one side and changed on the other is marked on the node's block",
    !r.clean && /'Cat' was removed by ours and changed by theirs/.test(r.conflicts[0].message)
    && r.text.includes([MARK_OURS, MARK_MID, "    Cat", "        sound: purr", MARK_THEIRS].join("\n")));
}
{
  const r = merge(BASE, BASE.replace("    Dog", "    Hound"), BASE.replace("    Dog", "    Canine"), "Zoo");
  check("conflict: one name changed two ways is marked on its line",
    !r.clean && /'Dog' was renamed two ways/.test(r.conflicts[0].message)
    && r.text.includes([MARK_OURS, "    Hound", MARK_MID, "    Canine", MARK_THEIRS].join("\n")));
}

// --- what falls back to git ---------------------------------------------------
{
  const moved = BASE.replace("\n    Cat\n        sound: meow", "").replace("        colour: brown", "        colour: brown\n        Cat\n            sound: meow");
  const r = merge(BASE, BASE, moved, "Zoo");
  check("fallback: a move is an edit the merge will not guess at", r.fallback && /moved/.test(r.fallback) && r.text === null);
  const reordered = aot("Pet", "    legs: 4", "    Cat", "        sound: meow", "    Dog", "        sound: bark", "        colour: brown");
  const r2 = merge(BASE, BASE.replace("sound: bark", "sound: woof"), reordered, "Zoo");
  check("fallback: an edit it cannot replay (a reordering) fails the replay guard", !!r2.fallback);
  const mapped = BASE + "\n    ... more to come";
  const r3 = merge(BASE, BASE, mapped, "Zoo");
  check("fallback: a '...' line is nothing it models, so it hands back to git", !!r3.fallback);
  // two edits each fine alone, wrong together: theirs renames A to the name
  // ours gave a new Concept. Each node's number is right; the file is not.
  const two = aot("P", "    A", "        x: 1");
  const r4 = merge(two, two + "\n    B\n        y: 2", two.replace("    A", "    B"), "Zoo");
  check("fallback: a merge that would bring an error neither side had — one name, two Concepts",
    /^the merge would bring an error neither side had — give all but one 'B' a distinguishing qualifier, or merge them — Concept 'B' defined 2 times/.test(r4.fallback || ""));
  // the numbers catch what the text does not: ours links Dog to Owner by an
  // attribute's name, theirs renames Owner — the link would quietly break
  const linked = aot("Owner", "    name: Ann", "Pet", "    Dog", "        sound: bark");
  const r5 = merge(linked, linked + "\n        dog owner: Ann", linked.replace("Owner", "Keeper"), "Zoo");
  check("fallback: a rename that would cut the other side's link fails the arithmetic", r5.fallback === "'Dog' did not merge to what both sides say");
}

// --- tables: rows and headers -------------------------------------------------
const GRID = aot("Order|price|qty", "A    |10   |1", "B    |20   |2");
{
  const loose = aot("Order|price|qty", "A|10|1", "B|20|2"); // never aligned: compared aligned
  const r = merge(loose, loose.replace("A|10|1", "A|11|1"), loose.replace("B|20|2", "B|20|5"), "Zoo");
  check("merge: an unaligned table is compared as drawn, and merged cell by cell",
    r.clean && r.text === aot("Order|price|qty", "A    |11   |1", "B    |20   |5"));
  const gone = merge(GRID, GRID.replace("A    |10   |1", "A    |11   |1"), GRID.replace("\nB    |20   |2", ""), "Zoo");
  check("merge: a row removed on one side, another row changed on the other",
    gone.clean && gone.text === aot("Order|price|qty", "A    |11   |1"));
  const renamed = merge(GRID, GRID.replace("B    |20   |2", "B    |20   |9"), GRID.replace("A    |10   |1", "A2   |10   |1"), "Zoo");
  check("merge: a row renamed on one side, another row changed on the other",
    renamed.clean && renamed.text === aot("Order|price|qty", "A2   |10   |1", "B    |20   |9"));
  const concept = merge(GRID, GRID.replace("B    |20   |2", "B    |20   |9"), GRID.replace("Order|price|qty", "Purchase|price|qty"), "Zoo");
  check("merge: the table's Concept renamed in its header, a cell changed on the other side",
    concept.clean && concept.text === aot("Purchase|price|qty", "A       |10   |1", "B       |20   |9"));
  const bound = merge(GRID, GRID.replace("B    |20   |2", "B    |20   |9"), GRID.replace("Order|price|qty", "Order|price|qty >=1"), "Zoo");
  check("merge: a column's header changed on one side, a cell on the other",
    bound.clean && bound.text === aot("Order|price|qty >=1", "A    |10   |1", "B    |20   |9"));
  const column = merge(GRID, GRID, aot("Order|price|qty|note", "A    |10   |1  |x", "B    |20   |2  |"), "Zoo");
  check("fallback: a column added is an edit it hands back to git", /a column of 'Order' was added or removed/.test(column.fallback || ""));
  const lined = aot("Order", "    price", "    - A", "        price: 10", "        qty: 1", "    - B", "        price: 20");
  const underRow = merge(aot("Order|price", "A    |10", "B    |20"), aot("Order|price", "A    |10", "B    |20"), lined, "Zoo");
  check("fallback: an attribute written as a line under what the other side has as a row", /written as a line under the row 'A'/.test(underRow.fallback || ""));
  const split = merge(GRID, GRID, GRID.replace("A    |10   |1", "A    |10   |1\n    note: x"), "Zoo");
  check("fallback: a line between two rows ends the table, and the rest reads as another", /'B' is a table the other side has no place for/.test(split.fallback || ""));
  // what stands under a table is the Concept's, so it merges as the Concept's
  const under = merge(GRID, GRID.replace("B    |20   |2", "B    |20   |9"), GRID + "\n    note: x", "Zoo");
  check("merge: a line added under a table, a cell changed on the other side",
    under.clean && under.text === aot("Order|price|qty", "A    |10   |1", "B    |20   |9", "    note: x"));
  check("merge: and that line is the Concept's, never the last row's",
    lint(under.text, "Zoo").nodes.find((n) => n.name === "note").parent.name === "Order");
  const underBoth = merge(GRID + "\n    a: 1", GRID + "\n    a: 1\n    b: 2", GRID + "\n    a: 1\n    c: 3", "Zoo");
  check("merge: a line added under a table on each side, both land",
    underBoth.clean && underBoth.text === aot(GRID, "    a: 1", "    b: 2", "    c: 3"));
  const underRowAdded = merge(GRID, GRID + "\nC    |30   |3", GRID + "\n    note: x", "Zoo");
  check("merge: a row added on one side, a line under the table on the other",
    underRowAdded.clean && underRowAdded.text === aot(GRID, "C    |30   |3", "    note: x"));
  const underSub = merge(GRID, GRID, GRID + "\n    Sub\n        x: 1", "Zoo");
  check("merge: a sub-Concept added under a table lands below its rows", underSub.clean && underSub.text === aot(GRID, "    Sub", "        x: 1"));
  const defaulted = aot("Order|price|tax: 1", "A    |10   |", "B    |20   |");
  const underDefault = merge(defaulted, defaulted, defaulted + "\n    note: x", "Zoo");
  check("merge: a column's default in the header is not where a new line goes", underDefault.clean && underDefault.text === aot(defaulted, "    note: x"));
  const underTwoWays = merge(GRID + "\n    a: 1", GRID + "\n    a: 2", GRID + "\n    a: 3", "Zoo");
  check("conflict: a line under a table changed two ways is marked on that line, the table untouched",
    !underTwoWays.clean && underTwoWays.text === aot(GRID, MARK_OURS, "    a: 2", MARK_MID, "    a: 3", MARK_THEIRS));
  const cell = merge(GRID, GRID.replace("A    |10   |1", "A    |11   |1"), GRID.replace("A    |10   |1", "A    |12   |1"), "Zoo");
  check("conflict: one cell changed two ways is marked on its row, theirs as theirs wrote it",
    !cell.clean && /'price' of 'A' was changed two ways/.test(cell.conflicts[0].message) && cell.conflicts[0].line === 2
    && cell.text === aot("Order|price|qty", MARK_OURS, "A    |11   |1", MARK_MID, "A    |12   |1", MARK_THEIRS, "B    |20   |2"));
  const both = merge(GRID, GRID.replace("A    |10   |1", "A    |11   |3"), GRID.replace("A    |10   |1", "A    |12   |4"), "Zoo");
  check("conflict: two cells of one row each changed two ways share one mark, which names both",
    both.conflicts.length === 1 && both.conflicts[0].message === "'price' of 'A' was changed two ways; 'qty' of 'A' was changed two ways"
    && both.text.split("\n").filter((l) => l === MARK_OURS).length === 1);
  const emptied = merge(GRID, GRID.replace("A    |10   |1", "A    |11   |1"), GRID.replace("B    |20   |2", "B    |20   |"), "Zoo");
  check("merge: a cell emptied on one side, another cell changed on the other",
    emptied.clean && emptied.text === aot("Order|price|qty", "A    |11   |1", "B    |20   |"));
  const top = merge(GRID, GRID.replace("B    |20   |2", "B    |20   |9"), GRID.replace("Order|price|qty\n", "Order|price|qty\nZ    |5    |1\n"), "Zoo");
  check("fallback: a row added above every other row has no row to follow, so it is git's",
    top.fallback === "theirs: nowhere to put the row 'Z'");
  const asLines = aot("Order", "    price", "    qty", "    - A", "        price: 10", "        qty: 1", "    - B", "        price: 20", "        qty: 2");
  const flip = merge(GRID, asLines, GRID.replace("B    |20   |2", "B    |20   |9"), "Zoo");
  check("fallback: a table turned into lines on one side, a cell changed on the other", flip.fallback === "ours: an edit this merge cannot replay");
  const short = aot("Order|price|qty", "A    |10   |1", "B    |20");
  const filled = merge(short, short.replace("A    |10   |1", "A    |11   |1"), short.replace("B    |20", "B    |20   |7"), "Zoo");
  check("merge: a row written short of the header gains the cell the other side filled",
    filled.clean && filled.text === aot("Order|price|qty", "A    |11   |1", "B    |20   |7"));
  // a divider under the header stays where it stands, as every table edit
  // in the editor keeps it (1.13)
  const ruled = aot("Order|price|qty", "-----|-----|---", "A    |10   |1", "B    |20   |2");
  const kept = merge(ruled, ruled.replace("A    |10   |1", "A    |11   |1"), ruled.replace("B    |20   |2", "B    |20   |9"), "Zoo");
  check("merge: a table with a divider merges cell by cell, the divider kept",
    kept.clean && kept.text === aot("Order|price|qty", "-----|-----|---", "A    |11   |1", "B    |20   |9"));
  // a row removed on one side takes the rows naming it as their parent
  const tree = aot("Order|parent (order)|price", "A    |              |10", "A1   |A             |1", "B    |              |20");
  const pruned = merge(tree, tree.replace("B    |              |20", "B    |              |21"),
    aot("Order|parent (order)|price", "B    |              |20"), "Zoo");
  check("merge: a row removed on one side goes with the rows naming it, the other side's edit kept",
    pruned.clean && pruned.text === aot("Order|parent (order)|price", "B    |              |21"));
}

// --- attribute lines, and nodes removed on one side ---------------------------
const REX = aot("Pet", "    legs: 4", "    Dog", "        sound: bark", "        colour: brown", "        - Rex", "            age: 3", "    Cat", "        sound: meow");
const NO_DOG = REX.replace("\n    Dog\n        sound: bark\n        colour: brown\n        - Rex\n            age: 3", "");
{
  const removed = merge(REX, REX.replace("    Dog", "    Hound"), REX.replace("\n        colour: brown", ""), "Zoo");
  check("merge: an attribute line removed on one side, its node renamed on the other",
    removed.clean && removed.text === REX.replace("    Dog", "    Hound").replace("\n        colour: brown", ""));
  const added = merge(REX, REX.replace("sound: meow", "sound: purr"), REX.replace("        colour: brown", "        colour: brown\n        size: big"), "Zoo");
  check("merge: an attribute added on one side lands after the node's own attributes",
    added.clean && added.text === REX.replace("sound: meow", "sound: purr").replace("        colour: brown", "        colour: brown\n        size: big"));
  const untouched = merge(REX, REX.replace("sound: bark", "sound: woof"), REX.replace("\n    Cat\n        sound: meow", ""), "Zoo");
  check("merge: a node one side removed and the other left alone is removed",
    untouched.clean && untouched.text === REX.replace("sound: bark", "sound: woof").replace("\n    Cat\n        sound: meow", ""));
  const both = merge(REX, NO_DOG, REX.replace("\n        - Rex\n            age: 3", ""), "Zoo");
  check("merge: a node one side removed and the other removed something under is simply removed", both.clean && both.text === NO_DOG);
  const kept = merge(REX, REX.replace("sound: meow", "sound: purr"), REX.replace("\n    Cat\n        sound: meow", ""), "Zoo");
  check("conflict: removed by theirs and changed by ours keeps ours' block between the markers",
    !kept.clean && /'Cat' was removed by theirs and changed by ours/.test(kept.conflicts[0].message)
    && kept.text.includes([MARK_OURS, "    Cat", "        sound: purr", MARK_MID, MARK_THEIRS].join("\n")));
  for (const [what, theirs, carried] of [
    ["renamed something under it", REX.replace("- Rex", "- Rexy"), "        - Rexy"],
    ["changed something under it", REX.replace("age: 3", "age: 4"), "            age: 4"],
    ["added something under it", REX.replace("            age: 3", "            age: 3\n        - Fido"), "        - Fido"],
  ]) {
    const r = merge(REX, NO_DOG, theirs, "Zoo");
    check(`conflict: removed by ours while theirs ${what} — theirs' block is marked`,
      !r.clean && /'Dog' was removed by ours and changed by theirs/.test(r.conflicts[0].message) && r.text.includes(carried)
      && r.text.includes(MARK_OURS + "\n" + MARK_MID));
  }
}

// --- the same node added on both sides ----------------------------------------
{
  const twice = merge(REX, REX + "\n    Bird\n        sound: tweet", REX + "\n    Bird\n        sound: tweet", "Zoo");
  check("merge: one node added alike on both sides lands once", twice.clean && twice.text === REX + "\n    Bird\n        sound: tweet");
  const twoWays = merge(REX, REX + "\n    Bird\n        sound: tweet", REX + "\n    Bird\n        sound: chirp", "Zoo");
  check("conflict: one node added two ways is marked on its block",
    !twoWays.clean && /'Bird' was added two ways/.test(twoWays.conflicts[0].message)
    && twoWays.text.endsWith([MARK_OURS, "    Bird", "        sound: tweet", MARK_MID, "    Bird", "        sound: chirp", MARK_THEIRS].join("\n")));
}

// every clean result above verifies as a file
{
  const r = merge(BASE, BASE.replace("    Dog", "    Hound"), BASE.replace("sound: bark", "sound: woof"), "Zoo");
  check("merge: what it writes verifies", lint(r.text, "Zoo").errors.length === 0);
}

// --- the driver end to end, when git is here ----------------------------------
function driver() {
  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (git.status !== 0) {
    console.log("SKIP merge driver end to end (no git on PATH)");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-merge-"));
  const run = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    run("init", "-q", "-b", "main");
    run("config", "user.email", "test@example.com");
    run("config", "user.name", "Test");
    run("config", "commit.gpgsign", "false");
    // this machine's line-ending conversion is not what is under test
    run("config", "core.autocrlf", "false");
    const verify = path.join(__dirname, "..", "verify.js").split(path.sep).join("/");
    run("config", "merge.aot.driver", `node "${verify}" --merge %O %A %B %P`);
    fs.writeFileSync(path.join(dir, ".gitattributes"), "*.aot merge=aot\n");
    const file = path.join(dir, "zoo.aot");
    fs.writeFileSync(file, BASE + "\n");
    run("add", ".");
    run("commit", "-q", "-m", "base");
    run("checkout", "-q", "-b", "theirs");
    fs.writeFileSync(file, BASE.replace("sound: bark", "sound: woof") + "\n");
    run("commit", "-q", "-am", "theirs: Dog woofs");
    run("checkout", "-q", "main");
    fs.writeFileSync(file, BASE.replace("    Dog", "    Hound") + "\n");
    run("commit", "-q", "-am", "ours: Dog is a Hound");
    const merged = run("merge", "-q", "--no-edit", "theirs");
    check("driver: a rename against a value change on the next line merges cleanly through git",
      merged.status === 0 && fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") === BASE.replace("    Dog", "    Hound").replace("sound: bark", "sound: woof") + "\n");

    // and a genuine conflict comes back marked on its one attribute
    run("checkout", "-q", "-b", "left", "main");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("sound: meow", "sound: purr"));
    run("commit", "-q", "-am", "left");
    run("checkout", "-q", "-b", "right", "main");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("sound: meow", "sound: hiss"));
    run("commit", "-q", "-am", "right");
    const conflicted = run("merge", "-q", "--no-edit", "left");
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    check("driver: a value changed two ways conflicts on that attribute, and git says so",
      conflicted.status !== 0 && text.includes([MARK_OURS, "        sound: hiss", MARK_MID, "        sound: purr", MARK_THEIRS].join("\n")));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a file a moment */ }
  }
}
driver();

// --- verify.js --merge called as git calls it, and --diff-rev ------------------
function commandLine() {
  if (spawnSync("git", ["--version"], { encoding: "utf8" }).status !== 0) {
    console.log("SKIP the command line's merge and diff-rev (no git on PATH)");
    return;
  }
  const verify = path.join(__dirname, "..", "verify.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-cli-"));
  const node = (...args) => spawnSync(process.execPath, [verify, ...args], { cwd: dir, encoding: "utf8" });
  const three = (base, ours, theirs) => {
    for (const [name, text] of [["base.aot", base], ["ours.aot", ours], ["theirs.aot", theirs]]) fs.writeFileSync(path.join(dir, name), text);
    const r = node("--merge", "base.aot", "ours.aot", "theirs.aot", "zoo.aot");
    return { status: r.status, stderr: r.stderr, text: fs.readFileSync(path.join(dir, "ours.aot"), "utf8").replace(/\r\n/g, "\n") };
  };
  try {
    check("--merge: called without its four paths says how, and exits 2", node("--merge").status === 2);
    const far = aot("Pet", "    legs: 4", "    Dog", "        sound: bark", "    Cat", "        sound: meow", "    Cow", "        sound: moo", "    Owl", "        sound: hoot");
    const lineClean = three(far, far.replace("sound: bark", "sound: woof"), far.replace("sound: hoot", "sound: who"));
    check("--merge: git's own line merge, when clean, is kept",
      lineClean.status === 0 && lineClean.text === far.replace("sound: bark", "sound: woof").replace("sound: hoot", "sound: who") && !lineClean.stderr);
    const twinBirds = three(far, far + "\n    Bird\n        sound: tweet", far.replace("    Pet", "    Pet").replace("Pet\n", "Pet\n    Bird\n        sound: chirp\n"));
    check("--merge: an error the line merge brought that neither side had is said",
      twinBirds.status === 0 && /the merge brought an error neither side had — give all but one 'Bird' a distinguishing qualifier, or merge them — Concept 'Bird' defined 2 times/.test(twinBirds.stderr));
    const meaning = three(BASE, BASE.replace("    Dog", "    Hound"), BASE.replace("sound: bark", "sound: woof"));
    check("--merge: where the line merge conflicts and the meaning does not, merged by meaning",
      meaning.status === 0 && meaning.text === BASE.replace("    Dog", "    Hound").replace("sound: bark", "sound: woof") && /merged by meaning/.test(meaning.stderr));
    // a Windows checkout: the merge keeps ours' line endings
    const crlf = (t) => t.replace(/\n/g, "\r\n");
    for (const [name, text] of [["base.aot", BASE], ["ours.aot", BASE.replace("    Dog", "    Hound")], ["theirs.aot", BASE.replace("sound: bark", "sound: woof")]]) {
      fs.writeFileSync(path.join(dir, name), crlf(text));
    }
    const kept = node("--merge", "base.aot", "ours.aot", "theirs.aot");
    check("--merge: CRLF in, CRLF out; and without git's %P it names the file it wrote",
      kept.status === 0 && fs.readFileSync(path.join(dir, "ours.aot"), "utf8") === crlf(BASE.replace("    Dog", "    Hound").replace("sound: bark", "sound: woof"))
      && /^ours\.aot: merged by meaning/.test(kept.stderr));
    // both sides add lines above it, so it stands lower in the result than
    // on either side: still theirs and ours, not the merge's
    const broken = far + "\n    Pig\n        sound: oink\n    Pig\n        sound: grunt";
    const alreadyBroken = three(broken, broken.replace("sound: bark", "sound: bark\n    Hen\n        sound: cluck"),
      broken.replace("sound: moo", "sound: moo\n    Ox\n        sound: low\n    Yak\n        sound: hum"));
    check("--merge: an error a side already had is not blamed on the merge, wherever the merge moved it",
      alreadyBroken.status === 0 && !alreadyBroken.stderr && /Hen[\s\S]*Ox[\s\S]*Yak[\s\S]*Pig[\s\S]*Pig/.test(alreadyBroken.text));
    const conflicted = three(BASE, BASE.replace("sound: bark", "sound: woof"), BASE.replace("sound: bark", "sound: yap"));
    check("--merge: a real conflict is marked on its attribute, said with its line, and exits 1",
      conflicted.status === 1 && conflicted.text.includes([MARK_OURS, "        sound: woof", MARK_MID, "        sound: yap", MARK_THEIRS].join("\n"))
      && /zoo\.aot:4: conflict — 'sound' of 'Dog' was changed two ways/.test(conflicted.stderr));
    const moved = BASE.replace("\n    Cat\n        sound: meow", "").replace("        colour: brown", "        colour: brown\n        Cat\n            sound: meow");
    const fellBack = three(BASE, moved, BASE.replace("sound: meow", "sound: purr"));
    check("--merge: what it cannot vouch for is git's own conflicted text, and exits 1",
      fellBack.status === 1 && /fell back to git's line merge — 'Cat' moved/.test(fellBack.stderr) && /^<<<<<<< ours$/m.test(fellBack.text));

    // --diff-rev: the file as it stood at a revision, renames recognised
    const run = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    run("init", "-q", "-b", "main");
    run("config", "user.email", "test@example.com");
    run("config", "user.name", "Test");
    run("config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(dir, "zoo.aot"), BASE + "\n");
    run("add", "zoo.aot");
    run("commit", "-q", "-m", "base");
    fs.writeFileSync(path.join(dir, "zoo.aot"), BASE.replace("    Dog", "    Hound") + "\n");
    const rev = node("--diff-rev", "HEAD", "zoo.aot");
    check("--diff-rev: a rename since the revision is one finding",
      rev.status === 0 && /renamed: zoo < Pet < Dog -> 'Hound'/.test(rev.stdout) && /1 node changed/.test(rev.stdout));
    const bad = node("--diff-rev", "no-such-rev", "zoo.aot");
    check("--diff-rev: a revision git does not know is said, and exits 2", bad.status === 2 && /git could not show no-such-rev:zoo\.aot/.test(bad.stderr));
    check("--diff-rev: without its revision and file says how", node("--diff-rev").status === 2);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a file a moment */ }
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aot-norepo-"));
  try {
    fs.writeFileSync(path.join(outside, "lone.aot"), "Pet\n");
    const lone = spawnSync(process.execPath, [verify, "--diff-rev", "HEAD", "lone.aot"], { cwd: outside, encoding: "utf8" });
    check("--diff-rev: a file in no git repository is said, and exits 2",
      lone.status === 2 && /in no git repository/.test(lone.stderr));
    const unnumbered = spawnSync(process.execPath, [verify, "lone.aot", "--godel", "Pet"], { cwd: outside, encoding: "utf8" });
    check("--godel: outside any repository there is no registry to read, and the numbers are the file's own",
      unnumbered.status === 0 && /^G\(Pet\) = 1 — 'Pet' carries no attributes/.test(unnumbered.stdout));
  } finally {
    try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* as above */ }
  }

  // git itself not there: both calls say so rather than throw
  const git = require("../src/git");
  check("git: a program that is not there is an error, never a throw",
    !!git.show(os.tmpdir(), "HEAD", "x.aot", "no-such-git-program").error
    && !!git.mergeFile("a", "b", "c", "no-such-git-program").error);
}
commandLine();

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
