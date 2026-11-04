// Every finding says how to fix it first, then why it is a finding:
// `<fix> — <why>`, with a rule's label (`drift:`) allowed ahead of the fix.
//
// Each case fires one rule and pins the fix it opens with. Every message any
// fixture produces, the case's own or incidental, must also open with a fix.
// A new rule is only held to this once a fixture here raises it: give it a case.
//
// Plain Node script, no framework — run with: node out/test-messages.js
const { lint } = require("../src/linter");
const { suggest } = require("../src/fca");
const godel = require("../src/godel");
const armstrong = require("../src/armstrong");
const repo = require("../src/repo");
const synonyms = require("../src/synonyms");
const spelling = require("../src/spelling");
const { unlistedValues } = require("../src/crosslinks");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const aot = (...lines) => lines.join("\n");

const LABEL = "(?:(?:drift|exhaustion|clash|dependency|dependency cycle|redundant dependency): )?";
const VERB = "(?:add|align|change|check|drop|empty|file|gather|give|if|indent|keep|lowercase|merge|move|name|pick|place|put|remove|rename|replace|run|set|split|start|use|write)";
const FIX_FIRST = new RegExp(`^${LABEL}${VERB}\\b[^]*? — `);

const seen = new Set();
function opens(name, messages, fix) {
  for (const m of messages) seen.add(m);
  const hit = messages.find((m) => m.startsWith(fix));
  check(`${name}: opens with '${fix}'`, !!hit && hit.includes(" — "));
  if (!hit) console.log(`     got ${JSON.stringify(messages)}`);
}

const said = (r) => [...r.errors, ...r.warnings].map((f) => f.message);
const linted = (text, root) => said(lint(text, root || "Zoo"));

// --- the syntax and the tables ----------------------------------------------
const nine = Array.from({ length: 9 }, (_, i) => `    ${"ABCDEFGHI"[i]}${"ABCDEFGHI"[i]}\n        - x${i}\n        - y${i}`);
for (const [name, text, fix, root] of [
  ["a tab", aot("Thing", "\tfoo"), "replace the tab in the indentation with spaces"],
  ["an uneven indent", aot("Thing", "  foo"), "add or remove spaces to reach a multiple of 4"],
  ["a depth jump", aot("Thing", "        foo"), "indent this line to depth 1"],
  ["a bare =", aot("="), "write the expression, or remove the line"],
  ["a bound with no attribute", aot("Thing", '    ==("a", "b")'), "put the attribute's name in front of"],
  ["no space after a dash", aot("Thing", "    -Apple"), "add the missing space after the '-'"],
  ["an empty header default", aot("Currency:|symbol", "Euro|x"), "write the Concept's default, or drop the colon"],
  ["a derived header default", aot("Currency: =1|symbol", "Euro|x"), "write the value, or double a literal '=' (==)"],
  ["an empty first header cell", aot("|age", "Ann|3"), "write the Concept's name in the table's first header cell"],
  ["two defaults", aot("Person: a", "    Person: b|age", "    Ann|3"), "keep one default for 'Person'"],
  ["a lowercase first header cell", aot("name|age", "Ann|3"), "write the Concept's name in the first header cell, capitalised"],
  ["an empty Concept derivation", aot("Thing ="), "write the expression, or remove the '='"],
  ["a second parent column", aot("Thing|parent (thing)|parent (thing)", "A||"), "remove this column"],
  ["a default on the parent column", aot("Thing|parent (thing): x", "A|"), "drop the ':' and what follows it"],
  ["a capitalised column", aot("Thing|Size", "A|1"), "lowercase column 'Size'"],
  ["an empty column default", aot("Thing|size:", "A|1"), "write the column's default, or drop the colon"],
  ["a derived column default", aot("Thing|size: =1", "A|1"), "write the value, or put the derivation on the Concept's own line"],
  ["a bound on the parent column", aot("Thing|parent (thing) >=1", "A|"), "drop the '>=' and what follows it"],
  ["an empty row name", aot("Thing|age", "|3"), "write the Example's name in the row's first cell"],
  ["too many cells", aot("Thing|age", "A|3|4"), "remove the extra cells, or add columns to the header"],
  ["an empty attribute definition", aot("Thing", "    age ="), "write the definition, or remove the '='"],
  ["a definition that is not Python", aot("Thing", "    note =some words"), "write the definition as Python, or add a colon"],
  ["an empty value", aot("Thing", "    age:"), "add the value, or drop the colon"],
  ["a derived Concept default", aot("Thing: =1"), "write the value, or double a literal '=' (==)"],
  ["a row its own parent", aot("Thing|parent (thing)", "A|A"), "name the row it sits under, or empty the cell"],
  ["a parent no row has", aot("Thing|parent (thing)", "A|Ghost"), "name one of the table's rows, or empty the cell"],
  ["a circle of parents", aot("Thing|parent (thing)", "A|B", "B|A"), "empty one of these parent cells to break the circle"],
  ["the file name repeated", aot("Zoo"), "start with the children of 'Zoo'"],
  ["a Map holding content", aot("Thing", "    ... rest", "        age"), "move those lines out from under it, or remove the '...'"],
  ["'and' in a Concept", aot("Cats and Dogs"), "split 'Cats and Dogs' into two Concepts"],
  ["a Concept defined twice", aot("Thing", "Thing"), "give all but one 'Thing' a distinguishing qualifier, or merge them"],
  ["an alias of itself", aot("Thing (Thing)"), "drop the alias, or make it a genuinely different name"],
  ["an alias naming another Concept", aot("Dog (Cat)", "Cat"), "merge 'Dog' and 'Cat'"],
  ["one alias on two Concepts", aot("Dog (Pet)", "Cat (Pet)"), "rename one alias"],
  ["Examples differing only in case", aot("Thing", "    - Socrates", "    - socrates"), "align the spelling"],
  ["identical siblings", aot("Thing", "    age", "    age"), "give each 'age' a different value, or keep just one"],
  ["an Example named as its parent", aot("Thing", "    - A", "        - A"), "rename one of them"],
  ["a plural Concept", aot("Animals"), "use the singular form"],
  ["'actual' alone", aot("Thing", "    actual: 1"), "add a 'target', or remove 'actual'"],
  ["'target' alone", aot("Thing", "    target: 1"), "add an 'actual', or remove 'target'"],
  ["nine sub-Concepts", aot("Thing", ...nine), "gather related sub-Concepts under an in-between kind"],
  ["a lone sub-Concept", aot("Thing", "    Part"), "add a sibling subtype, or merge the two"],
  ["a lone sub-Example", aot("Thing", "    - A", "        - B"), "add another sub-Example, or merge the two"],
  ["siblings told apart by order", aot("Thing", "    Dog", "        legs: 4", "    Cat", "        legs: 4"), "give each a differentia"],
  // --- what the facts say a Concept is (subsumption.js)
  ["mutual is-a", aot("Top", "    a", "    Aa", "        b", "        c", "Other", "    b", "    Bb", "        a", "        c"), "give one a differentia the others lack, to break the loop"],
  ["two genera", aot("Animal", "    Fish", "        fins", "        scales", "    Bird", "        wings", "        beak", "        Trout", "            fins", "            scales", "            spots"), "place it under one and crosslink the other's attributes, or split 'Trout'"],
  ["a misfiled Concept", aot("Animal", "    Fish", "        fins", "        scales", "    Bird", "        beak", "        Trout", "            fins", "            scales", "            spots"), "file it under 'Fish', or give it a differentia"],
  ["one definition twice", aot("Land", "    Pack", "        Dog", "            legs", "            fur", "        Stray", "Sea", "    Pod", "        Seal", "            legs", "            fur", "        Lost"), "give one a differentia, or merge them"],
  // --- what the attributes rest on (armstrong.js, in the lint)
  ["a dependency cycle", aot("Hen", "    egg: Egg", "Egg", "    hen: Hen"), "dependency cycle: remove or retype one of the attributes that carry the loop"],
  ["a redundant dependency", aot("Aa", "    bb: Bb", "    cc: Cc", "Bb", "    cc: Cc", "Cc"), "redundant dependency: drop 'cc', or drop an intermediate link"],
]) {
  opens(name, linted(text, root), fix);
}

// --- the audits, which run over a tree that lints clean ----------------------
const parsed = (...lines) => lint(aot(...lines), "Zoo");
{
  const misfiled = parsed("Animal", "    Fish", "        fins", "        - Trout", "        - Carp", "    Bird", "        wings", "        - Robin", "        - Goldfish", "            fins", "    - Sponge");
  opens("drift", suggest(misfiled.root, misfiled.nodes).findings.map((f) => f.message), "drift: move it under 'Fish', or give 'Fish' a differentia");
  opens("a kind the division misses", suggest(misfiled.root, misfiled.nodes).findings.map((f) => f.message), "exhaustion: add the kind the division misses");
  const same = parsed("Animal", "    Fish", "        fins", "        - Trout", "    Whale", "        fins", "        - Orca");
  opens("two kinds with one attribute set", suggest(same.root, same.nodes).findings.map((f) => f.message), "exhaustion: give each a differentia the other lacks");

  const clash = parsed("Thing", "    Dog", "        legs: 4", "        tail: yes", "    Hound", "        legs: 4", "        tail: yes", "    Bird", "        legs: 2", "        tail: yes");
  const clashes = godel.clashes(clash.root, clash.nodes).findings.map((f) => f.message);
  opens("one content twice", clashes, "clash: give one a differentia");
  opens("values alone apart", clashes, "clash: check that the values alone are meant to tell them apart");

  const hoists = (...lines) => { const r = parsed(...lines); return godel.hoists(r.root, r.nodes).map((h) => h.message); };
  opens("a value every child sets", hoists("Vehicle", "    Car", "        wheels: 4", "        doors: 3", "    Van", "        wheels: 4", "        doors: 5"), "write 'wheels: 4' once under 'Vehicle' and drop it from each child");
  opens("a hoist replacing a default no child keeps", hoists("Vehicle", "    wheels: 3", "    Car", "        wheels: 4", "        doors: 3", "    Van", "        wheels: 4", "        doors: 5"), "write 'wheels: 4' once under 'Vehicle' in place of the 'wheels: 3' it says now, which no child keeps, and drop it from each child");
  opens("a default every child overrides", hoists("Drink", "    temperature: cold", "    Tea", "        temperature: hot", "    Soup", "        temperature: warm"), "keep just 'temperature', or drop the line");

  const deps = (...lines) => { const r = parsed(...lines); return armstrong.findings(r.root, r.nodes).map((f) => f.message); };
  opens("one-way dependency", deps("Order|region|tax", "A|EU|20", "B|EU|20", "C|UK|20", "D|US|5"), "dependency: set 'tax' once from 'region'");
  opens("two attributes equivalent", deps("Order|region|tax", "A|EU|20", "B|EU|20", "C|US|5", "D|US|5"), "dependency: keep whichever reads clearer and derive the other");
  opens("two attributes that only covary", deps("Order|region|tax", "A|EU|20", "B|UK|15", "C|US|5"), "dependency: if they are meant to be the same distinction, model it once");
}

// --- across files ------------------------------------------------------------
{
  const build = (files) => Object.entries(files).map(([file, text]) => {
    const rootName = file.replace(/\.[^.]*$/, "");
    return { file, text, rootName, ...lint(text, rootName) };
  });
  const found = (files, opts) => {
    const entries = build(files);
    const f = repo.findings("a.aot", repo.occurrences(entries), opts);
    return [...f.errors, ...f.warnings].map((x) => x.message);
  };
  const on = { autoReconcile: true }, off = { autoReconcile: false };
  opens("one attribute with two values", found({ "a.aot": aot("Pet", "    colour: red"), "b.aot": aot("Pet", "    colour: blue") }, on), "pick the value that is right and set it everywhere");
  opens("one Concept under two kinds", found({ "a.aot": aot("Animal", "    Pet", "        age"), "b.aot": aot("Thing", "    Pet", "        age") }, on), "move one, or qualify one of the two names");
  opens("a note no other file backs", found({ "a.aot": aot("Person", "    - Ann", "    ... 1 more in b.aot:1"), "b.aot": aot("Dog") }, off), "run 'AOT: Reconcile Concepts Across Files', or turn aot.autoReconcile back on to have the note removed on save");
  opens("a note that should read otherwise", found({ "a.aot": aot("Person", "    - Ann"), "b.aot": aot("Person", "    - Bob") }, off), "run 'AOT: Reconcile Concepts Across Files', or turn aot.autoReconcile back on to have the note kept true on save");

  const entries = build({ "a.aot": aot("Toaster", "    power: 1800", "    racks: 2"), "b.aot": aot("Grill", "    power: 1800", "    racks: 2") });
  opens("one content under two names", godel.twins(entries, "a.aot").map((t) => t.message), "rename one to the other, or give one a differentia");

  const at = (name, line) => ({ name, line, file: "World.aot", alias: null });
  opens("two words for one idea", synonyms.findings([at("Client", 1), at("Customer", 2)], new Set()).map((f) => f.message), "rename one to the other, or write 'Client (Customer)'");
  opens("one word with two endings", synonyms.findings([at("Governance", 1), at("Government", 2)], new Set()).map((f) => f.message), "rename one to the other, or write 'Governance (Government)'");
}

// --- the hints ---------------------------------------------------------------
{
  opens("a word no dictionary knows", spelling.check("Thing\n    - recieve", new Set()).map((h) => h.message), "check the spelling");
  const text = aot("Person", "    - Socrates", "Club", "    person: James");
  const r = lint(text, "Zoo");
  opens("a value no Example names", unlistedValues(text, r.root, r.nodes).map((h) => h.message), "add it as an Example of 'Person', or use one already listed");
}

// ...and whatever else any fixture happened to raise reads the same way
const late = [...seen].filter((m) => !FIX_FIRST.test(m));
check(`all ${seen.size} messages open with a fix`, late.length === 0);
for (const m of late) console.log(`     ${m}`);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
