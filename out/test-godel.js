// Smoke test for the Gödel numbering (src/godel.js): build small in-memory
// .aot fixtures, number them, and check the radical/override/clash/decode
// semantics the CLI queries rest on.
const { lint } = require("../src/linter");
const {
  buildGodel, clashes, overrides, diff, decode, valuation, radical,
  find, common, near,
} = require("../src/godel");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const node = (root, nodes, name) => [root, ...nodes].find((n) => n.name === name);

// 1) same attribute names, different values: equal radical, different G
const colours = [
  "Thing",
  "    - Cherry",
  "        colour: red",
  "        weight: light",
  "    - Apple",
  "        colour: green",
  "        weight: light",
].join("\n");
{
  const { root, nodes, errors } = lint(colours, "World");
  check("colours fixture parses clean", errors.length === 0);
  const { attrPrime } = buildGodel(root, nodes);
  const cherry = node(root, nodes, "Cherry"), apple = node(root, nodes, "Apple");
  const primeList = [...attrPrime.values()];
  check("same attribute names -> equal radical", radical(cherry.godel, primeList) === radical(apple.godel, primeList));
  check("different values -> different G", cherry.godel !== apple.godel);
  // decode round-trips the written value
  const slots = decode(cherry, attrPrime, buildGodel(root, nodes).valueCode, null);
  const colour = slots.find((s) => s.attr === "colour");
  check("decode round-trips colour: red", colour && colour.value === "red");
}

// 2) override: a child Example redeclares an inherited default with a new value
const override = [
  "Drink",
  "    temperature: cold",
  "    - Coffee",
  "        temperature: hot",
  "    - Water",
].join("\n");
{
  const { root, nodes, errors } = lint(override, "Menu");
  check("override fixture parses clean", errors.length === 0);
  const report = overrides(root, nodes);
  check(
    "override: '- Coffee' overrides inherited temperature cold -> hot",
    report.findings.some((f) => /override: '- Coffee'/.test(f.message) && f.message.includes("hot") && f.message.includes("cold")),
  );
  check("'- Water' inherits, no override reported", !report.findings.some((f) => f.message.includes("Water")));
}

// 3) clash: two unrelated nodes with identical content -> G equal; a clash
// when they are Concepts, or Examples sharing their name too
const clash = [
  "Left",
  "    - Twin A",
  "        height: tall",
  "        mood: calm",
  "Right",
  "    - Twin B",
  "        height: tall",
  "        mood: calm",
].join("\n");
{
  const { root, nodes, errors } = lint(clash, "Pair");
  check("clash fixture parses clean", errors.length === 0);
  const a = node(root, nodes, "Twin A"), b = node(root, nodes, "Twin B");
  buildGodel(root, nodes);
  check("identical content -> equal G", a.godel === b.godel && a.godel > 1n);
  // an Example's name is part of what it is: two differently named Examples
  // are two individuals, whatever they carry
  check("clash: differently named Examples never clash, identical content or not",
    clashes(root, nodes).findings.length === 0);
}
{
  // the same name, the same content, two places: one idea written twice
  const same = clash.replace("Twin A", "Twin").replace("Twin B", "1. twin");
  const { root, nodes, errors } = lint(same, "Pair");
  check("clash: same-name fixture parses clean", errors.length === 0);
  const twins = nodes.filter((n) => /twin/i.test(n.name));
  const report = clashes(root, nodes);
  const pair = report.findings.filter((f) => f.kind === "content");
  check("clash: same-named twins both report, each related to the other (case and numbering aside)",
    pair.length === 2
    && pair[0].line === twins[0].line && pair[1].line === twins[1].line
    && pair[0].related[0].line === twins[1].line && pair[1].related[0].line === twins[0].line);
  check(
    "clash: identical-content finding for the twins",
    report.findings.some((f) => /^clash:/.test(f.message) && f.message.includes("identical attributes and values")),
  );
}
{
  // a Concept is its definition: two Concepts of one content clash, whatever
  // they are called
  const kinds = ["Left", "    Tall One", "        height: tall", "Right", "    High One", "        height: tall"].join("\n");
  const { root, nodes } = lint(kinds, "Pair");
  check("clash: differently named Concepts of one content still clash",
    clashes(root, nodes).findings.filter((f) => f.kind === "content").length === 2);
}

// 4) valuation: an absent attribute has exponent 0, a present one >= 1
{
  const { root, nodes } = lint(colours, "World");
  const { attrPrime } = buildGodel(root, nodes);
  const cherry = node(root, nodes, "Cherry");
  check("valuation of a carried attribute is >= 1", valuation(cherry.godel, attrPrime.get("colour")) >= 1n);
}

// 5) diff: a file against itself reports no changes; a changed value shows up
{
  const a = lint(override, "Menu"), b = lint(override, "Menu");
  const same = diff(a.root, a.nodes, b.root, b.nodes);
  check("diff of identical trees -> no changes", same.findings.length === 0);
  const changed = lint(override.replace("temperature: hot", "temperature: warm"), "Menu");
  const report = diff(a.root, a.nodes, changed.root, changed.nodes);
  check("diff reports the changed Coffee temperature", report.findings.some((f) => /changed:/.test(f.message) && f.message.includes("temperature")));
}

// 6) find: query-by-example via divisibility
{
  const { root, nodes } = lint(colours, "World");
  buildGodel(root, nodes);
  const red = find(root, nodes, ["colour: red"]);
  check("find colour: red -> only Cherry", red.matches.length === 1 && red.matches[0].name === "Cherry");
  const light = find(root, nodes, ["weight: light"]);
  check("find weight: light -> both Cherry and Apple", light.matches.length === 2);
  const both = find(root, nodes, ["colour: green", "weight: light"]);
  check("find colour: green AND weight: light -> only Apple", both.matches.length === 1 && both.matches[0].name === "Apple");
  const miss = find(root, nodes, ["colour: purple"]);
  check("find an undeclared value -> unknown, no match", miss.matches.length === 0 && miss.unknown.length === 1);
}

// 7) common: gcd of two contents is what they agree on
{
  const { root, nodes } = lint(colours, "World");
  buildGodel(root, nodes);
  const cherry = node(root, nodes, "Cherry"), apple = node(root, nodes, "Apple");
  const c = common(root, nodes, cherry, apple);
  const attrs = c.slots.map((s) => `${s.attr}: ${s.value}`);
  check("common(Cherry, Apple) keeps weight: light", attrs.includes("weight: light"));
  check("common(Cherry, Apple) drops the differing colour", !attrs.some((a) => a.startsWith("colour")));
}

// 8) near: nearest neighbour by content distance
{
  const fruit = [
    "Bowl",
    "    - Lemon",
    "        colour: yellow",
    "        taste: sour",
    "    - Lime",
    "        colour: green",
    "        taste: sour",
    "    - Brick",
    "        colour: red",
    "        weight: heavy",
  ].join("\n");
  const { root, nodes } = lint(fruit, "Kitchen");
  buildGodel(root, nodes);
  const lemon = node(root, nodes, "Lemon");
  const ranked = near(root, nodes, lemon, 1);
  check("nearest to Lemon is Lime (shares taste: sour)", ranked[0].node.name === "Lime");
}

const G = require("../src/godel");
const aot = (...lines) => lines.join("\n");

// 9) the registry: stable numbers across edits, files and branches
{
  const reg0 = G.parseRegistry("");
  const first = lint(aot("Pet", "    legs: 4", "    - Dog", "        sound: bark"), "Zoo");
  const t1 = G.buildGodel(first.root, first.nodes, reg0);
  check("registry: a fresh registry numbers as the sorted order would, and grows",
    t1.grown && t1.attrPrime.get("legs") === 2n && t1.attrPrime.get("sound") === 3n);
  const text = G.formatRegistry(t1.registry);
  const back = G.parseRegistry(text);
  check("registry: formatting and parsing round-trip, sorted by prime then code",
    /^# /.test(text) && text.split("\n")[1] === "a\tlegs\t2" && back.attrs.get("sound") === 3n
    && back.values.get("legs").get("4") === 2n && G.formatRegistry(back) === text);
  // a new attribute that sorts FIRST must not renumber the others
  const second = lint(aot("Pet", "    age: 3", "    legs: 4", "    - Dog", "        sound: bark"), "Zoo");
  const t2 = G.buildGodel(second.root, second.nodes, back);
  check("registry: an attribute added later keeps every existing number, even sorting first",
    t2.attrPrime.get("legs") === 2n && t2.attrPrime.get("sound") === 3n && t2.attrPrime.get("age") === 5n && t2.grown);
  const t3 = G.buildGodel(second.root, second.nodes, t2.registry);
  check("registry: nothing new, nothing grown", t3.grown === false);
  const repaired = G.parseRegistry([
    "# kept by the extension", "a\tlegs\t7", "a\tlegs\t2", "<<<<<<< ours", "a\tsound\t3", "=======", "a\ttail\t3", ">>>>>>> theirs",
    "v\tlegs\t2\t4", "v\tlegs\t2\tfour", "a\tbad\t4",
  ].join("\n"));
  check("registry: repairs itself — the smaller of two primes, the first-sorting of two claimants, markers skipped",
    repaired.attrs.get("legs") === 2n && repaired.attrs.get("sound") === 3n && !repaired.attrs.has("tail")
    && !repaired.attrs.has("bad") && repaired.values.get("legs").get("4") === 2n && !repaired.values.get("legs").has("four"));
  const odd = G.parseRegistry(["a\tone\t1", "v\tlegs\t1\tone", "v\tlegs\t5\tfour", "v\tlegs\t3\tfour"].join("\n"));
  check("registry: 1 is no prime and no value code; of two codes for one value the smaller stays",
    !odd.attrs.has("one") && !odd.values.get("legs").has("one") && odd.values.get("legs").get("four") === 3n);
  check("registry: written sorted by prime, whatever order it was kept in",
    G.formatRegistry({ attrs: new Map([["tail", 5n], ["legs", 2n]]), values: new Map() }).split("\n").slice(1, 3).join() === "a\tlegs\t2,a\ttail\t5");
  const late = G.profile(second.root, second.nodes, second.nodes.find((n) => n.name === "Dog"), t2);
  check("registry: a factorisation lists its primes in order, though the attributes sort otherwise",
    /^2\S* · 3\S* · 5\S*$/.test(late.factors) && late.slots.map((s) => s.attr).join() === "age,legs,sound");
  const clashA = aot("Thing", "    - Cherry", "        colour: red", "    - Cherry", "        colour: red");
  const cl = lint(clashA, "World");
  check("registry: clashes are unchanged by it", clashes(cl.root, cl.nodes).findings.length === 2);
}

// 10) pool: one numbering over several documents
{
  const a = lint(aot("Pet", "    legs: 4"), "A"), b = lint(aot("Beast", "    legs: 4", "    fur: yes"), "B");
  const P = G.pool([a, b]);
  const pet = a.nodes.find((n) => n.name === "Pet"), beast = b.nodes.find((n) => n.name === "Beast");
  check("pool: one attribute takes one prime in every document",
    P.attrPrime.get("legs") && pet.godel % P.attrPrime.get("legs") === 0n && beast.godel % P.attrPrime.get("legs") === 0n
    && P.gathered.length === 2);
}

// 11) profile: what the hover shows
{
  const pets = aot("Pet", "    legs: 4", "    sound: none", "    - Dog", "        sound: bark", "        fur: short",
    "    - Cat", "        sound: meow", "        fur: short", "    - Fish", "        sound: bark", "        fur: short");
  const { root, nodes } = lint(pets, "Zoo");
  const t = G.buildGodel(root, nodes);
  const dog = nodes.find((n) => n.name === "Dog"), fish = nodes.find((n) => n.name === "Fish");
  const p = G.profile(root, nodes, dog, t);
  const legs = p.slots.find((s) => s.attr === "legs"), sound = p.slots.find((s) => s.attr === "sound");
  check("profile: an inherited slot says where it came from, an own one that it is its own",
    legs && !legs.own && legs.from.name === "Pet" && legs.fromLine === 2 && sound.own && sound.value === "bark");
  check("profile: an override names what it replaces",
    p.overrides.some((o) => o.attr === "sound" && o.value === "bark" && o.replaces === "none"));
  check("profile: the nearest sibling, with the slots that differ, the earlier winning a tie",
    p.nearest && p.nearest.node.name === "Fish" && p.nearest.dist === 0 && G.profile(root, nodes, fish, t).nearest.node.name === "Dog");
  const cat = G.profile(root, nodes, nodes.find((n) => n.name === "Cat"), t);
  check("profile: a differing sibling lists how it differs",
    cat.nearest.dist === 1 && cat.nearest.diff.some((d) => /^~ sound: meow \| bark$/.test(d)));
  check("profile: G written as its factorisation", /^\d+(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]*)?( · \d+[⁰¹²³⁴⁵⁶⁷⁸⁹]*)*$/.test(p.factors));
  const linked = lint(aot("Owner", "    name: Ann", "Pet", "    Dog", "        dog owner: Ann"), "Zoo");
  const lt = G.buildGodel(linked.root, linked.nodes);
  const viaSlot = G.profile(linked.root, linked.nodes, linked.nodes.find((n) => n.name === "Dog"), lt).slots.find((s) => s.via);
  check("profile: a Concept an attribute's name links to says which attribute it came through",
    !!viaSlot && viaSlot.attr === "owner" && viaSlot.via === "dog owner" && viaSlot.from.name === "Dog" && viaSlot.fromLine === 5);
  const sib = lint(aot("P", "    A", "        x: 1", "    B", "        x: 1", "        y: 2"), "Zoo");
  const ts = G.buildGodel(sib.root, sib.nodes);
  check("profile: a slot only the nearest sibling has is a '+'",
    G.profile(sib.root, sib.nodes, sib.nodes.find((n) => n.name === "A"), ts).nearest.diff.join() === "+ y: 2");
  check("profile: an attribute has none, and the file itself no sibling",
    G.profile(sib.root, sib.nodes, sib.nodes.find((n) => n.name === "x"), ts) === null && G.profile(sib.root, sib.nodes, sib.root, ts).nearest === null);
}

// 12) hoists: a value every child sets belongs to the parent; a default
// every child overrides is in force for nothing
{
  const hoistsOf = (...lines) => { const r = lint(aot(...lines), "Zoo"); return G.hoists(r.root, r.nodes); };
  const line = hoistsOf("Vehicle", "    Car", "        wheels: 4", "    Van", "        wheels: 4", "        doors: 5");
  check("hoists: every child setting one value is a hoist, on the parent, naming each child's line",
    line.length === 1 && line[0].kind === "hoist" && line[0].line === 1 && line[0].attr === "wheels" && line[0].value === "4"
    && line[0].related.map((r) => r.line).join() === "3,5");
  const grid = hoistsOf("Payment|currency|amount", "P1     |EUR     |10", "P2     |EUR     |20", "P3     |EUR     |30");
  check("hoists: a table column holding one value in every row is a hoist too",
    grid.some((h) => h.kind === "hoist" && h.attr === "currency" && h.value === "EUR"));
  const dead = hoistsOf("Drink", "    temperature: cold", "    Tea", "        temperature: hot", "    Soup", "        temperature: warm");
  check("hoists: a default every child overrides is dead",
    dead.length === 1 && dead[0].kind === "dead" && dead[0].line === 2 && /never in force/.test(dead[0].message));
  const replace = hoistsOf("Drink", "    temperature: cold", "    Tea", "        temperature: hot", "    Soup", "        temperature: hot");
  check("hoists: a dead default the children agree on offers to replace it",
    replace.length === 1 && replace[0].kind === "hoist" && replace[0].replaces === "cold" && /which no child keeps/.test(replace[0].message));
  const mixedKinds = hoistsOf("Vehicle", "    Car", "        wheels: 4", "    - Herbie", "        wheels: 4");
  check("hoists: Concepts and Examples together are everything under the parent",
    mixedKinds.length === 1 && /holds for everything under 'Vehicle'/.test(mixedKinds[0].message));
  const atRoot = hoistsOf("Car", "    wheels: 4", "Van", "    wheels: 4");
  check("hoists: at the file's own level, said on the first child's line",
    atRoot.length === 1 && atRoot[0].line === 2 && atRoot[0].parent.line === 0 && /every child of 'Zoo'/.test(atRoot[0].message));
  const several = hoistsOf("Drink", "    temperature: cold", "    Tea", "        temperature: hot", "    Soup", "        temperature: warm",
    "Vehicle", "    Car", "        wheels: 4", "    Van", "        wheels: 4");
  check("hoists: several, in line order", several.map((h) => `${h.kind}@${h.line}`).join() === "dead@2,hoist@7");
  check("hoists: not when one child differs, or lacks it",
    !hoistsOf("V", "    A", "        w: 4", "    B", "        w: 3").length && !hoistsOf("V", "    A", "        w: 4", "    B", "        d: 3").length);
  check("hoists: not when the parent already holds the value",
    !hoistsOf("V", "    w: 4", "    A", "        x: 1", "    B", "        x: 2").some((h) => h.attr === "w"));
  check("hoists: not under a '...' Map, which says the division is still open",
    !hoistsOf("V", "    ... more to come", "    A", "        w: 4", "    B", "        w: 4").length);
  check("hoists: not for derived values",
    !hoistsOf("T|n", "A|2 =1+1", "B|2 =1+1", "C|2 =1+1").length && !hoistsOf("V", "    A", "        w: 4 =2*2", "    B", "        w: 4 =2*2").length);
  check("hoists: two rows of data agreeing are not yet a rule; three are",
    !hoistsOf("T|n", "A|1", "B|1").length && hoistsOf("T|n", "A|1", "B|1", "C|1").length === 1);
}

// 13) twins: the same content under two names in two files
{
  const doc = (file, ...lines) => ({ file, ...lint(aot(...lines), file.replace(/\.aot$/, "")) });
  const a = doc("a.aot", "Hound", "    legs: 4", "    sound: bark");
  const b = doc("b.aot", "Dog", "    legs: 4", "    sound: bark");
  const found = G.twins([a, b], "a.aot");
  check("twins: one content under two names in two files, on this file's side, the peer related",
    found.length === 1 && found[0].line === 1 && found[0].other.name === "Dog" && found[0].related[0].file === "b.aot"
    && /'Hound' and 'Dog' \(b\.aot:1\) carry exactly the same attributes and values/.test(found[0].message));
  check("twins: not the same name", !G.twins([a, doc("b.aot", "Hound", "    legs: 4", "    sound: bark")], "a.aot").length);
  check("twins: not an alias", !G.twins([doc("a.aot", "Hound (dog)", "    legs: 4", "    sound: bark"), b], "a.aot").length);
  check("twins: not an alias, whichever side writes it", !G.twins([a, doc("b.aot", "Dog (hound)", "    legs: 4", "    sound: bark")], "a.aot").length);
  const pairs = G.twins([doc("a.aot", "Kettle", "    power: 2000", "Hound", "    legs: 4", "    sound: bark"),
    doc("b.aot", "Dog", "    legs: 4", "    sound: bark", "Boiler", "    power: 2000")], "a.aot");
  check("twins: several, in this file's line order", pairs.map((f) => `${f.name}@${f.line}`).join() === "Kettle@1,Hound@3");
  check("twins: not a pair the writer keeps apart", !G.twins([a, b], "a.aot", { dismissed: new Set(["dog|hound"]) }).length);
  check("twins: not within one file (the clash's business)",
    !G.twins([doc("a.aot", "Hound", "    legs: 4", "Dog", "    legs: 4")], "a.aot").length);
  check("twins: not a Concept with no attribute of its own",
    !G.twins([doc("a.aot", "Pet", "    legs: 4", "    Hound"), doc("b.aot", "Pet", "    legs: 4", "    Dog")], "a.aot").length);
}

// 14) diff that recognises renames and moves
{
  const d = (x, y) => { const a = lint(x, "Zoo"), b = lint(y, "Zoo"); return diff(a.root, a.nodes, b.root, b.nodes).findings; };
  const base = aot("Pet", "    legs: 4", "    Dog", "        sound: bark", "        - Rex", "            age: 3", "    Cat", "        sound: meow");
  const renamed = d(base, base.replace("    Dog", "    Hound"));
  check("diff: a rename is one finding, its descendants matched through it",
    renamed.length === 1 && renamed[0].kind === "renamed" && renamed[0].b.name === "Hound" && /^renamed: Zoo < Pet < Dog -> 'Hound'$/.test(renamed[0].message));
  const moved = d(aot("A", "    x: 1", "B", "    y: 2", "    Leaf", "        z: 3"), aot("A", "    x: 1", "    Leaf", "        z: 3", "B", "    y: 2"));
  check("diff: a move is one finding", moved.length === 1 && moved[0].kind === "moved" && /-> Zoo < A < Leaf/.test(moved[0].message));
  const renamedChanged = d(base, base.replace("    Dog", "    Hound").replace("sound: bark", "sound: woof"));
  // (Rex inherits the sound, so its content changed with it: that is said,
  // but nothing under the renamed Concept is removed and added again)
  const rn = renamedChanged.find((f) => f.kind === "renamed");
  check("diff: a rename with one change is one finding carrying the change",
    rn && rn.changes.length === 1 && rn.changes[0].op === "~" && rn.changes[0].to === "woof"
    && !renamedChanged.some((f) => f.kind === "removed" || f.kind === "added"));
  const ambiguous = d(aot("P", "    A", "        x: 1", "    B", "        x: 1"), aot("P", "    C", "        x: 1", "    D", "        x: 1"));
  check("diff: an ambiguous pairing is left as removed and added",
    ambiguous.filter((f) => f.kind === "removed").length === 2 && ambiguous.filter((f) => f.kind === "added").length === 2);
  const same = d(base, base);
  check("diff: nothing changed, nothing said", same.length === 0);
  // with no attribute of its own, a Concept is known by its children
  const kinds = aot("Animal", "    Mammal", "        Dog", "            legs: 4", "        Cat", "            legs: 4", "    Bird", "        wings: 2");
  const kindsRenamed = d(kinds, kinds.replace("    Mammal", "    Mammals"));
  check("diff: a Concept with no attribute of its own, renamed, is known by its children",
    kindsRenamed.length === 1 && kindsRenamed[0].kind === "renamed" && kindsRenamed[0].b.name === "Mammals");
  const files = (() => { const a = lint(kinds, "Old"), b = lint(kinds, "New"); return diff(a.root, a.nodes, b.root, b.nodes).findings; })();
  check("diff: two files of different names compare what they say, not what they are called", files.length === 0);
  const alike = d(aot("P", "    A", "        x: 1", "    B", "        x: 1", "    K", "        z: 9"), aot("P", "    C", "        x: 1", "    K", "        z: 9"));
  check("diff: two removed of one content and one added pair with neither",
    alike.filter((f) => f.kind === "removed").length === 2 && alike.filter((f) => f.kind === "added").length === 1);
}

// --- verify.js: the numbering from the command line ----------------------------
// In a folder of its own holding a .git, so the registry --primes writes and
// the notes --reconcile writes land there and nowhere else.
{
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { spawnSync } = require("child_process");
  const verify = path.join(__dirname, "..", "verify.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-godel-cli-"));
  const node = (...args) => spawnSync(process.execPath, [verify, ...args], { cwd: dir, encoding: "utf8" });
  const write = (name, ...lines) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), lines.join("\n") + "\n");
  };
  const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
  try {
    fs.mkdirSync(path.join(dir, ".git"));
    const shop = ["Lantern", "    fuel", "    - Storm Lantern", "        fuel: paraffin",
      "Toaster", "    power: 1800", "    racks: 2",
      "Boat", "    Canoe", "        hull: wood", "        paddles: 1", "    Kayak", "        hull: wood", "        paddles: 2"];
    write("shop.aot", ...shop);
    write("depot.aot", "Lantern", "    fuel", "    - Camping Lantern", "        fuel: gas", "Grill", "    power: 1800", "    racks: 2");

    const usage = node();
    check("verify.js: no arguments says how, and exits 2", usage.status === 2 && /^usage: node verify\.js/.test(usage.stderr));
    const plain = node("shop.aot");
    check("verify.js: a value every child sets is a warning on a file that verifies",
      plain.status === 0 && /shop\.aot:\d+: warning: every child of 'Boat' sets 'hull: wood'/.test(plain.stdout) && /V = 0: true/.test(plain.stdout));

    // numbered alone, each file gives its attributes its own primes: one
    // content, two numbers. The registry makes it one number everywhere.
    const g = (file, name) => (node(file, "--godel", name).stdout.match(/^G\(\w+\) = (.*)$/m) || [])[1];
    const alone = [g("shop.aot", "Toaster"), g("depot.aot", "Grill")];
    check("verify.js --godel: a file numbered alone numbers its own attributes", !!alone[0] && !!alone[1] && alone[0] !== alone[1]);
    const primes = node("--workspace", ".", "--primes");
    check("verify.js --workspace --primes: writes the registry at the repository's root",
      primes.status === 0 && /wrote .*godel\.tsv \(5 attributes\)/.test(primes.stdout) && fs.existsSync(path.join(dir, "aot.files", "godel.tsv")));
    check("verify.js --workspace --primes: run again, there is nothing new to number",
      /already numbers every attribute and value here/.test(node("--workspace", ".", "--primes").stdout));
    const pooled = [g("shop.aot", "Toaster"), g("depot.aot", "Grill")];
    check("verify.js --godel: with the registry, one content is one number in every file",
      !!pooled[0] && pooled[0] === pooled[1]);

    // a file that does not verify has no content to compare yet: its twin is not said
    write("broken.aot", "Heater", "    power: 1800", "    racks: 2", "Heater", "    power: 900");
    const ws = node("--workspace", ".");
    fs.rmSync(path.join(dir, "broken.aot"));
    check("verify.js --workspace: two names for one content in two files are warned of, from both sides, and fail nothing",
      ws.status === 0 && /Concept 'Lantern' is written in 2 places/.test(ws.stdout)
      && /shop\.aot:5  warning: 'Toaster' and 'Grill' \(depot\.aot:5\) carry exactly the same attributes and values/.test(ws.stdout)
      && /depot\.aot:5  warning: 'Grill' and 'Toaster' \(shop\.aot:5\)/.test(ws.stdout));
    check("verify.js --workspace: a file with errors is left out of the comparison", !/Heater/.test(ws.stdout));

    const rec = node("--workspace", ".", "--reconcile");
    check("verify.js --workspace --reconcile: the shared Concept's notes are written",
      rec.status === 0 && /reconciled .*shop\.aot/.test(rec.stdout) && /1 more in depot\.aot:\d+/.test(read("shop.aot")));
    write("depot.aot", "Grill", "    power: 1800", "    racks: 2");
    const sweep = node("--workspace", ".", "--reconcile");
    check("verify.js --workspace --reconcile: once no other file lists the Concept, its note is deleted",
      /reconciled .*shop\.aot/.test(sweep.stdout) && !/more in/.test(read("shop.aot")));
    check("verify.js --workspace --reconcile: run again, everything is already in step",
      /every shared Concept was already in step/.test(node("--workspace", ".", "--reconcile").stdout));

    // last, as two more files would join the workspace passes above
    write(path.join("old", "shop.aot"), ...shop);
    write(path.join("new", "shop.aot"), ...shop.map((l) => l.replace("Kayak", "Sea Kayak")));
    const df = node("--diff", path.join("old", "shop.aot"), path.join("new", "shop.aot"));
    check("verify.js --diff: a rename between two files is one finding",
      df.status === 0 && /renamed: shop < Boat < Kayak -> 'Sea Kayak'/.test(df.stdout) && /^1 node changed$/m.test(df.stdout));
    write(path.join("new", "shop.aot"), ...shop.map((l) => l.replace("Kayak", "Sea Kayak").replace("paddles: 1", "paddles: 3")));
    check("verify.js --diff: and with a value changed beside it, two",
      /^2 nodes changed$/m.test(node("--diff", path.join("old", "shop.aot"), path.join("new", "shop.aot")).stdout));
    // a repository of its own inside, with one attribute in it
    fs.mkdirSync(path.join(dir, "one", ".git"), { recursive: true });
    write(path.join("one", "kettle.aot"), "Kettle", "    power: 2000");
    check("verify.js --primes: names its own repository's registry, one attribute and all",
      /wrote .*one[\\/]aot\.files[\\/]godel\.tsv \(1 attribute\)/.test(node("--workspace", "one", "--primes").stdout));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a file a moment */ }
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
