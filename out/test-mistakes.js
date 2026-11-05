// The adoption brief's 18 plausible mistakes and its table of wrong numbers, as a
// standing record of what the checks catch and what they cannot.
//
// When the brief was written, 11 of the 18 passed `verify.js` with no finding at
// all. Here each is run through `check.js`. Two can never be caught as written,
// because nothing in the file says the numbers should agree: both are caught as
// soon as a rule or a definition states the relationship, and that is tested too.
//
// Plain Node script, no framework — run with: node out/test-mistakes.js
// Fixtures live in os.tmpdir(), since a folder under OneDrive gets rewritten mid-test.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const CHECK = path.join(__dirname, "..", "check.js");
const VERIFY = path.join(__dirname, "..", "verify.js");
const interpreter = (process.platform === "win32" ? ["python"] : ["python3", "python"]).find((p) => {
  const r = spawnSync(p, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 15000 });
  return r.status === 0 && String(r.stdout).trim() === "3";
});
if (!interpreter) {
  console.log("SKIP the brief's mistakes (no python on PATH)");
  console.log("\nall passed");
  process.exit(0);
}

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-mistakes-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
function run(script, files, target) {
  const dir = folder(files);
  try {
    const r = spawnSync(process.execPath, [script, target || "."], { cwd: dir, encoding: "utf8", timeout: 180000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const checked = (files, target) => run(CHECK, files, target);
const one = (text) => ({ "Report.aot": text });
const lines = (...l) => l.join("\n");

const SALE = lines("Sale|amount", "North|20000", "South|33760");

// [the mistake, its file(s), what must say so]
const caught = [
  ["one row, one attribute, two values", one(lines("Customer", "    discount", "    - Acme", "        discount: 10%", "        discount: 15%", "    - Bolt", "        discount: 5%")),
    /a number has one value/],
  ["same customer, different discount, two files, line form",
    { "a.aot": lines("Customer", "    discount", "    - Acme", "        discount: 10%"), "b.aot": lines("Customer", "    discount", "    - Acme", "        discount: 15%") },
    /'Acme' of 'Customer' sets 'discount' to '10%' here but '15%' in b\.aot/],
  ["same customer, different discount, two files, table form",
    { "a.aot": lines("Customer|discount", "Acme|10%"), "b.aot": lines("Customer|discount", "Acme|15%") },
    /'Acme' of 'Customer' sets 'discount' to '10%' here but '15%' in b\.aot/],
  ["a stale value in front of a formula", one(lines(SALE, "", "Summary", "    total revenue: 60000 =@Sale@amount.sum()")),
    /'60000' is written here, and its formula gives '53,760'/],
  ["a rule broken: qty >=1, a row says -5", one(lines("Order|qty >=1", "Acme|-5", "Bolt|3")),
    /'-5' breaks 'qty >=1'/],
  ["a value outside an allowed list", one(lines("Order|status =(\"draft\", \"sent\", \"paid\")", "Acme|void", "Bolt|sent")),
    /'void' breaks 'status =/],
  ["a value naming a row that doesn't exist", one(lines("Country|code", "France|FR", "Japan|JP", "", "Order|country", "Acme|Narnia", "Bolt|France")),
    /'Narnia' is not an Example of Concept 'Country'/],
  ["a formula naming a missing column", one(lines("Order|price|vat", "Acme|100|20 =@prce*0.2", "Bolt|40|8 =@prce*0.2")),
    /@prce names nothing here/],
  ["a broken formula", one(lines("Order|price|vat", "Acme|100|20 =@price/0", "Bolt|40|8 =(((")),
    /fix this formula — (division by zero|this isn't a formula yet)/],
  ["a row name repeated with different values", one(lines("Customer|discount", "Acme|10%", "Acme|15%", "Bolt|5%")),
    /Example 'Acme' is written 2 times under 'Customer'/],
  ["a row copied", one(lines("Order|price", "Acme|100", "Acme|100")), /Example 'Acme' is written 2 times/],
  ["a metric defined twice", one(lines("Revenue", "    definition: gross of refunds", "Finance", "    Revenue", "        definition: net of refunds")),
    /Revenue/],
  ["a row filed under the wrong kind", one(lines("Fish", "    fins", "    water type", "    - Trout", "        fins: 2", "        water type: fresh", "Fowl", "    wings", "    - Hen", "        wings: 2", "    - Goldfish", "        fins: 2", "        water type: fresh")),
    /Goldfish/],
  ["\"and\" in a kind's name", one(lines("Growth and Retention", "    - revenue growth", "        actual: 11%", "        target: 15%")),
    /and/],
  ["an assumption differing across files", { "a.aot": lines("Order", "    tax rate: 0.2", "    - Acme"), "b.aot": lines("Order", "    tax rate: 0.25", "    - Bolt") },
    /'Order' sets 'tax rate' to '0\.2' here but '0\.25' in b\.aot/],
];
for (const [name, files, re] of caught) {
  const r = checked(files);
  check(`caught: ${name}`, r.status === 1 && re.test(r.out), r.out);
}
{
  const r = checked(one(lines("Order|country|currency", "A|France|EUR", "B|France|EUR", "C|France|EUR", "D|Japan|JPY", "E|Japan|JPY", "F|Japan|JPY")));
  check("said, as a warning: one column deciding another", r.status === 0 && /warning: .*currency/.test(r.out), r.out);
}

// the two no check can see as written, and how to make them seeable
{
  const typed = checked(one(lines(SALE, "", "Summary", "    total: 60000")));
  check("not catchable as written: a typed total with no formula", typed.status === 0, typed.out);
  const stated = checked(one(lines(SALE, "", "Summary", "    total: 60000 =@Sale@amount.sum()")));
  check("caught once a formula states it: the total", stated.status === 1 && /'60000' is written here, and its formula gives '53,760'/.test(stated.out), stated.out);
  const bound = checked(one(lines(SALE, "", "Claim", "    stated <=@Sale@amount.sum() >=@Sale@amount.sum()", "    - Q3", "        stated: 60000")));
  check("caught once a rule states it: the tie-out", bound.status === 1 && /'60000' breaks 'stated/.test(bound.out), bound.out);
  const green = checked(one(lines("Metric", "    - new client count", "        actual: 46", "        target: 60", "        influence: Green")));
  check("not catchable as written: a status of Green against a missed target", green.status === 0, green.out);
  const ruled = checked(one(lines("Metric", "    influence =\"Green\" if @actual>=@target else \"Red\"", "    - new client count", "        actual: 46", "        target: 60", "        influence: Green")));
  check("caught once a definition states it: the status", ruled.status === 1 && /'Green' is written here, and its formula gives 'Red'/.test(ruled.out), ruled.out);
}

// verify.js stays the check that runs nothing, and now says so
{
  const dir = folder({ "Report.aot": lines("Order|qty >=1", "Acme|-5", "", "Summary", "    n: 2 =len(@Order)", "    m: 3 =open(\"ran.txt\", \"w\").write(\"x\")") });
  try {
    const r = spawnSync(process.execPath, [VERIFY, "Report.aot"], { cwd: dir, encoding: "utf8", timeout: 60000 });
    check("verify: passes the structure", r.status === 0 && /V = 0: true/.test(r.stdout), r.stdout);
    check("verify: says what it did not calculate", /2 formulas and 1 rule not calculated here — run check\.js/.test(r.stdout), r.stdout);
    check("verify: ran nothing", !fs.existsSync(path.join(dir, "ran.txt")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
{
  const r = run(VERIFY, { "Plain.aot": lines("Order|qty", "Acme|5") }, "Plain.aot");
  check("verify: a file with no formulas is told nothing more", r.status === 0 && !/not calculated/.test(r.out), r.out);
  const big = ["Big|n", ...Array.from({ length: 205 }, (_, i) => `row ${i}|${i}`)].join("\n");
  const said = run(VERIFY, { "Big.aot": big }, "Big.aot");
  check("verify: says when the row checks stopped", /warning: move the long table into a file of its own .* this file has 205 rows/.test(said.out), said.out);
}

// the brief's table of wrong numbers, each now right or a visible error
{
  const ENGINE = [
    ["$100,000 less 30%", lines("Deal|list price|discount|net", "Acme|$100,000|30%|$70,000 =@list price*(1-@discount)"), true],
    ["€20,000 less 15%", lines("Deal|list price|discount|net", "Kite|€20,000|15%|€17,000 =@list price*(1-@discount)"), true],
    ["€100 × 2", lines("Deal|p|q", "A|€100|€200 =@p*2"), true],
    ["the sum of €100 and €200", lines("Deal|p", "A|€100", "B|€200", "", "Summary", "    all: €300 =@Deal@p.sum()"), true],
    ["R1,204 × 2", lines("Deal|p|q", "A|R1,204|R2,408 =@p*2"), true],
    ["£1,204 × 2", lines("Deal|p|q", "A|£1,204|£2,408 =@p*2"), true],
    ["(1,000) + 1", lines("Deal|p|q", "A|(1,000)|-999 =@p+1"), true],
    ["a default on Deal, read two levels down", lines("Deal", "    limit: 100", "    Kind", "        Big", "            - A", "                price: 5", "                over: No =@price>@limit"), true],
    ["@Deal@net.sum() across its kinds", lines("Deal", "    net", "    ... more kinds to come", "    - Direct", "        net: 5", "    Enterprise Deal", "        - Acme", "            net: 70000", "    Standard Deal", "        channel: direct", "        - Kite", "            net: 17000", "Summary", "    total: 87,005 =@Deal@net.sum()"), true],
    ["@discount cap beside a discount column", lines("Deal", "    discount cap: 0.2", "    Deal|discount|ok", "    Acme|0.1|Yes =@discount cap>@discount"), true],
    ["n/a × 2", lines("Deal|p|q", "A|n/a|=@p*2"), /'n\/a' is text, so it can't be multiplied/],
    [".mean() of a column with text in it", lines("Deal|p", "A|100", "B|n/a", "", "Summary", "    avg: =@Deal@p.mean()"), /fix this formula/],
    ["1.2M × 2", lines("Deal|p|q", "A|1.2M|=@p*2"), /'1\.2M' is text/],
    ["1.204,50 × 2", lines("Deal|p|q", "A|1.204,50|=@p*2"), /is text/],
    ["15/01/2026 × 2", lines("Deal|p|q", "A|15/01/2026|=@p*2"), /is text/],
    ["$100,000 less 30% written as a subtraction", lines("Deal|p|d|n", "A|$100,000|30%|=@p-@d"), /write the unit on 0\.3/],
  ];
  for (const [name, text, want] of ENGINE) {
    const r = checked(one(text));
    if (want === true) check(`engine: ${name} is right`, r.status === 0, r.out);
    else check(`engine: ${name} is a visible error`, r.status === 1 && want.test(r.out), r.out);
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
