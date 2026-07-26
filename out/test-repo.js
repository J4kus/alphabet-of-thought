// Unit tests for what a Concept means across files (src/repo.js): the
// intension is univocal and reconciled automatically, the extension is a
// partial sample per file and never merged away, and the disagreements no
// tool may settle stay put as errors.
//
// Plain Node script, no framework — run with: node out/test-repo.js
const { lint } = require("../src/linter");
const repo = require("../src/repo");
const { conceptRegistry } = require("../src/derive");
const { mergeRegistries } = require("../src/table");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const aot = (...lines) => lines.join("\n");

// A repo as { file: text }. Every helper below takes one, so a test reads as
// the two or three files it is really about.
const build = (files) => Object.entries(files).map(([file, text]) => {
  const rootName = file.replace(/\.[^.]*$/, "");
  return { file, text, rootName, ...lint(text, rootName) };
});
const indexOf = (files) => repo.occurrences(build(files));

// One file reconciled against the rest, as the text it becomes.
function reconciled(files, file) {
  const entries = build(files);
  const all = repo.occurrences(entries);
  const entry = entries.find((e) => e.file === file);
  const registry = mergeRegistries(...entries.map((e) => conceptRegistry(e.root, e.nodes)));
  const lines = entry.text.split(/\r?\n/);
  const ops = repo.reconcileFile(file, all, lines, entry.rootName, registry);
  return { ops, text: repo.applyOps(lines, ops).join("\n") };
}

const errorsIn = (files, file) => {
  const entries = build(files);
  return repo.findings(file, repo.occurrences(entries), { autoReconcile: true }).errors;
};

// The case the whole design is for: one person, two files, each listing the
// motivations its own subject needs. Nothing here is in conflict.
const JAKUS = {
  "monthly close.aot": aot(
    "- Motivation",
    "    Jakus",
    "        - Do Monthly Processing (Monthly Work Currently Done By Jaco)",
  ),
  "bank recon.aot": aot(
    "- Motivation",
    "    Jakus",
    "        - All Transactions Are Reconciled",
    "        - Transactions Are Reconciled Correctly",
    "        - Incorrectly Reconciled Transactions Are Trivially Flagged (un-allocated expense)",
    "        - Future Transactions Are Reconciled With Automated Banking Rules",
  ),
};

// ---------------------------------------------------------------------------
// the extension is a partial sample: differing Examples are never a conflict,
// and are never merged away
// ---------------------------------------------------------------------------
{
  check("a split extension is no error at all",
    errorsIn(JAKUS, "monthly close.aot").length === 0
    && errorsIn(JAKUS, "bank recon.aot").length === 0);

  const close = reconciled(JAKUS, "monthly close.aot");
  check("the `...` line states the count and where the rest live",
    close.text.split("\n").includes("        ... 4 more in bank recon.aot:2"));
  check("no peer's Example is copied in — the extension stays split",
    !/All Transactions Are Reconciled/.test(close.text));
  check("this file's own Example is untouched",
    /- Do Monthly Processing \(Monthly Work Currently Done By Jaco\)/.test(close.text));

  const recon = reconciled(JAKUS, "bank recon.aot");
  check("the peer's own `...` counts the other way",
    recon.text.split("\n").includes("        ... 1 more in monthly close.aot:2"));

  // reconciling is a fixpoint: the second pass has nothing left to say
  const again = reconciled({ ...JAKUS, "monthly close.aot": close.text }, "monthly close.aot");
  check("a second reconcile is a no-op", again.ops.length === 0);
}

// ---------------------------------------------------------------------------
// the intension is univocal: silence is filled in, disagreement is an error
// ---------------------------------------------------------------------------
{
  const files = {
    "a.aot": aot("Team", "    Jakus", "        - Close The Books"),
    "b.aot": aot("Team", "    Jakus", "        role: analyst", "        - Reconcile The Bank"),
  };
  const a = reconciled(files, "a.aot");
  check("an attribute only the peer declares is written in",
    a.text.split("\n").includes("        role: analyst"));
  check("it lands above the Examples, so the definition still reads first",
    a.text.indexOf("role: analyst") < a.text.indexOf("- Close The Books"));
  check("filling an attribute is not an error", errorsIn(files, "a.aot").length === 0);

  // absence is not disagreement, in either direction
  const b = reconciled(files, "b.aot");
  check("the peer that said more gains nothing back",
    !b.ops.some((o) => o.type === "insert" && /role/.test(o.text || "")));

  // a bare attribute facing a valued one takes the value
  const bare = reconciled({
    "a.aot": aot("Team", "    Jakus", "        role"),
    "b.aot": aot("Team", "    Jakus", "        role: analyst"),
  }, "a.aot");
  check("a bare attribute takes the peer's value rather than counting as a clash",
    bare.text.split("\n").includes("        role: analyst"));

  // an attribute the peer merely *inherits* is already in force here too
  const inherited = {
    "a.aot": aot("Team", "    role: analyst", "    Jakus", "        - Close The Books"),
    "b.aot": aot("Team", "    Jakus", "        role: analyst"),
  };
  check("an inherited attribute is not copied in as a declared one",
    !reconciled(inherited, "a.aot").text.split("\n").includes("        role: analyst"));
}

// ---------------------------------------------------------------------------
// the two decisions no tool may take
// ---------------------------------------------------------------------------
{
  const clash = {
    "a.aot": aot("Team", "    Jakus", "        role: analyst"),
    "b.aot": aot("Team", "    Jakus", "        role: bookkeeper"),
  };
  const ours = errorsIn(clash, "a.aot");
  check("one attribute with two values errors", ours.length === 1);
  check("the error names both values and where the other is",
    /sets 'role' to 'analyst' here but 'bookkeeper' in b\.aot:3/.test(ours[0].message));
  check("it errors on the other side too, pointing back",
    errorsIn(clash, "b.aot").length === 1);
  check("a contradiction is never auto-resolved",
    !reconciled(clash, "a.aot").text.includes("bookkeeper"));

  const genus = {
    "a.aot": aot("- Motivation", "    Jakus"),
    "b.aot": aot("Team", "    Jakus"),
  };
  check("one Concept under two kinds errors",
    /is filed under 'Motivation' here but 'Team'/.test(errorsIn(genus, "a.aot")[0].message));

  // silence about the kind is not a second kind
  check("top level beside a filed one is silence, not a clash",
    errorsIn({ "a.aot": "Jakus", "b.aot": aot("Team", "    Jakus") }, "a.aot").length === 0);
}

// ---------------------------------------------------------------------------
// the `...` line: many peers, hand-written Maps, and going stale
// ---------------------------------------------------------------------------
{
  const many = {
    "close.aot": aot("Team", "    Jakus", "        - One"),
    "bank.aot": aot("Team", "    Jakus", "        - Two", "        - Three"),
    "payroll.aot": aot("Team", "    Jakus", "        - Four"),
    "vat.aot": aot("Team", "    Jakus", "        - Five"),
  };
  const note = reconciled(many, "close.aot").text.split("\n").find((l) => l.includes("..."));
  check("the total comes first and the files follow, filename-sorted",
    note === "        ... 4 more in bank.aot:2, payroll.aot:2, vat.aot:2");

  const five = { ...many, "yearend.aot": aot("Team", "    Jakus", "        - Six") };
  const capped = reconciled(five, "close.aot").text.split("\n").find((l) => l.includes("..."));
  check("past three peers the line stops growing and ends in an ellipsis",
    capped === "        ... 5 more in bank.aot:2, payroll.aot:2, vat.aot:2, …");

  // a note you wrote is not a note the tool maintains
  const kept = reconciled({
    "close.aot": aot("Team", "    Jakus", "        - One", "        ... still to do"),
    "bank.aot": aot("Team", "    Jakus", "        - Two"),
  }, "close.aot");
  check("a hand-written Map survives untouched beside the maintained line",
    kept.text.split("\n").includes("        ... still to do")
    && kept.text.split("\n").includes("        ... 1 more in bank.aot:2"));

  // a maintained line that has stopped being true is rewritten, not doubled
  const stale = reconciled({
    "close.aot": aot("Team", "    Jakus", "        - One", "        ... 9 more in bank.aot:2"),
    "bank.aot": aot("Team", "    Jakus", "        - Two"),
  }, "close.aot");
  check("a stale maintained line is corrected in place",
    stale.text.split("\n").filter((l) => repo.NOTE_RE.test(l.trim().slice(3).trim())).length === 1
    && stale.text.includes("... 1 more in bank.aot:2"));

  // and dropped once it stops being true at all
  const dropped = reconciled({
    "close.aot": aot("Team", "    Jakus", "        - One", "        ... 1 more in bank.aot:2"),
    "bank.aot": aot("Team", "    Jakus"),
  }, "close.aot");
  check("a maintained line with nothing left to say is removed",
    !dropped.text.includes("more in"));
  check("removing it is the only deletion, and it is the tool's own line",
    dropped.ops.filter((o) => o.type === "delete").length === 1);

  // a peer with nothing extra earns no line in the first place
  check("no `...` where no peer adds an Example",
    !reconciled({
      "a.aot": aot("Team", "    Jakus", "        - One"),
      "b.aot": aot("Team", "    Jakus", "        - One"),
    }, "a.aot").text.includes("..."));
}

// ---------------------------------------------------------------------------
// a Concept written as a table: the note only goes where it can actually be
// the Concept's own child, and strays from before that rule are cleared
// ---------------------------------------------------------------------------
{
  // A standalone table names its Concept in the first header cell, so the
  // Concept and its rows sit at the same depth: a line one level in attaches
  // to the last row, not to the Concept. Writing a note there anyway meant
  // the next pass could not see it and wrote another — once per save.
  const standalone = {
    "close.aot": aot(
      "- Motivation",
      "    |Jakus                 |role|",
      "    |----------------------+----|",
      "    |Do Monthly Processing |    |",
    ),
    "bank.aot": aot("- Motivation", "    Jakus", "        - All Transactions Are Reconciled"),
  };
  const table = reconciled(standalone, "close.aot");
  check("a standalone table gets no `...` — there is no slot under it to hold one",
    !table.text.includes("more in"));

  // and the same input twice running must not grow
  const twice = reconciled({ ...standalone, "close.aot": table.text }, "close.aot");
  check("a standalone table is stable across saves", twice.ops.length === 0);

  // the strays an earlier pass left behind are the tool's own lines, so they
  // are cleared rather than orphaned
  const strays = reconciled({
    ...standalone,
    "close.aot": aot(
      "- Motivation",
      "    |Jakus                 |role|",
      "    |----------------------+----|",
      "    |Do Monthly Processing |    |",
      "        ... 4 more in bank.aot:2",
      "        ... 4 more in bank.aot:2",
      "        ... 4 more in bank.aot:2",
    ),
  }, "close.aot");
  check("strays left under a row are cleared away",
    !strays.text.includes("more in")
    && strays.ops.filter((o) => o.type === "delete").length === 3);

  // the merge form — a Concept with its own line above its table — does have
  // a slot, and must keep working
  const merged = reconciled({
    "close.aot": aot(
      "- Motivation",
      "    Jakus",
      "        |Jakus                 |role|",
      "        |----------------------+----|",
      "        |Do Monthly Processing |    |",
    ),
    "bank.aot": aot("- Motivation", "    Jakus", "        - All Transactions Are Reconciled"),
  }, "close.aot");
  check("the merge form still gets its `...`, as the Concept's own child",
    merged.text.split("\n").includes("        ... 1 more in bank.aot:2"));
}

// ---------------------------------------------------------------------------
// an Example has an intension too, and the same rule settles it
// ---------------------------------------------------------------------------
{
  const files = {
    "a.aot": aot("Team", "    Jakus", "        - Close The Books", "            owner: Jaco"),
    "b.aot": aot("Team", "    Jakus", "        - Close The Books", "            due: monthly"),
  };
  const a = reconciled(files, "a.aot");
  check("a shared Example gains the attribute the peer gave it",
    a.text.split("\n").includes("            due: monthly"));
  check("and keeps its own", a.text.includes("owner: Jaco"));
  check("a shared Example is not an error", errorsIn(files, "a.aot").length === 0);
}

// ---------------------------------------------------------------------------
// nothing you wrote is ever deleted, whatever the shape of the disagreement
// ---------------------------------------------------------------------------
{
  const gnarly = {
    "a.aot": aot(
      "Vehicle",
      "    Car",
      "        wheels: 4",
      "        - Beetle",
      "            year: 1938",
    ),
    "b.aot": aot(
      "Fleet",
      "    Car",
      "        doors: 2",
      "        - Beetle",
      "            colour: blue",
      "        - Model T",
    ),
  };
  const a = reconciled(gnarly, "a.aot");
  const lines = a.text.split("\n");
  check("the shape that used to lose Examples keeps every one of them",
    lines.includes("        - Beetle") && lines.includes("            year: 1938"));
  check("the same-named Example gains the peer's attribute rather than being replaced",
    lines.includes("            colour: blue"));
  check("the peer's own Example is left in the peer's file",
    !a.text.includes("Model T"));
  check("no op deletes a line anyone wrote",
    a.ops.every((o) => o.type !== "delete"));
}

// ---------------------------------------------------------------------------
// noteSpans: what the DocumentLinkProvider hangs the links on
// ---------------------------------------------------------------------------
{
  const text = aot("Team", "    Jakus", "        - One", "        ... 4 more in bank.aot:2, payroll.aot:9");
  const { root, nodes } = lint(text, "close");
  const spans = repo.noteSpans(text.split(/\r?\n/), root, nodes);
  check("every file:line in a maintained line becomes a span", spans.length === 2);
  check("a span carries the file and the line it opens",
    spans[0].file === "bank.aot" && spans[0].target === 2
    && spans[1].file === "payroll.aot" && spans[1].target === 9);
  check("the span covers exactly the file:line text",
    text.split(/\r?\n/)[spans[0].line - 1].slice(spans[0].startCol, spans[0].endCol) === "bank.aot:2");
  check("a hand-written Map yields no spans",
    repo.noteSpans(["... still to do"], ...Object.values(
      (({ root: r, nodes: n }) => ({ root: r, nodes: n }))(lint("... still to do", "x")))).length === 0);
}

// ---------------------------------------------------------------------------
// V: cross-file errors count only when the caller supplies a repo
// ---------------------------------------------------------------------------
{
  const text = aot("Team", "    Jakus", "        role: analyst");
  const peer = aot("Team", "    Jakus", "        role: bookkeeper");
  const alone = lint(text, "a");
  check("a file linted on its own is judged on its own terms", alone.errors.length === 0);

  const other = lint(peer, "b");
  const inRepo = lint(text, "a", undefined, {
    file: "a.aot",
    others: [{ file: "b.aot", text: peer, root: other.root, nodes: other.nodes }],
  });
  check("given the repo, a contradiction is an error counted in V",
    inRepo.errors.some((e) => /sets 'role' to 'analyst' here but 'bookkeeper'/.test(e.message)));
  check("the error carries the other file as related information",
    inRepo.errors.some((e) => (e.related || []).some((r) => r.file === "b.aot")));

  // a split extension still costs nothing, repo or no repo
  const split = lint(JAKUS["monthly close.aot"], "monthly close", undefined, {
    file: "monthly close.aot",
    others: [{
      file: "bank recon.aot",
      text: JAKUS["bank recon.aot"],
      ...lint(JAKUS["bank recon.aot"], "bank recon"),
    }],
  });
  check("a split extension leaves V exactly where it was", split.errors.length === 0);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
