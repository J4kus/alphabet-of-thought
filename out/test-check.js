// check.js: the one command that can fail on the numbers. What it fails on, that it
// never writes to a file, and that it runs formulas under the editor's guards.
//
// Plain Node script, no framework — run with: node out/test-check.js
// Fixtures live in os.tmpdir(), since a folder under OneDrive gets rewritten mid-test.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const CHECK = path.join(__dirname, "..", "check.js");
const VERIFY = fs.readFileSync(path.join(__dirname, "..", "verify.js"), "utf8");
const lines = (...l) => l.join("\n");

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-check-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const digest = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
};
function run(dir, args, env) {
  const r = spawnSync(process.execPath, [CHECK, ...args], { cwd: dir, encoding: "utf8", timeout: 180000, env: Object.assign({}, process.env, env || {}) });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}
const inFolder = (files, args, env, then) => {
  const dir = folder(files);
  try {
    const r = run(dir, args || [], env);
    return then ? then(r, dir) : r;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// checks that need no Python at all
{
  const r = spawnSync(process.execPath, [CHECK, "no such place"], { encoding: "utf8", cwd: os.tmpdir() });
  check("no such path: says so, exit 2", r.status === 2 && /no such file or folder/.test(r.stderr), r.stderr);
  const empty = inFolder({ "note.txt": "x" });
  check("nothing to check is no pass: exit 2", empty.status === 2 && /nothing was checked/.test(empty.stderr), empty.out);
  const clean = inFolder({ "Plain.aot": lines("Order|qty", "Acme|5") });
  check("a clean file with no formulas: exit 0, and no word of running anything", clean.status === 0 && /0 problems/.test(clean.stdout) && !/runs the formulas/.test(clean.out), clean.out);
  check("it states the limit it has", /says nothing about whether a typed number is true/.test(clean.stdout), clean.stdout);
  const wrong = inFolder({ "Bad.aot": lines("Growth and Retention", "    - x") });
  check("a violation: exit 1, the numbers not attempted", wrong.status === 1 && /formulas not calculated: fix the errors above first/.test(wrong.stdout), wrong.out);
  const missing = inFolder({ "F.aot": lines("Case", "    n: 1 =1+0") }, ["--python", "C:/no/such/python.exe"]);
  check("no Python to run them with: exit 2, never a pass", missing.status === 2, missing.out);
}

// the security of the command that does not run anything
check("security: verify.js still never reaches a session", !/child_process|Session|src\/python/.test(VERIFY));
check("security: nor does what it shares", !/child_process|\bspawn\b|new python\.Session|Session\(/.test(fs.readFileSync(path.join(__dirname, "..", "src", "gates.js"), "utf8")));

const interpreter = (process.platform === "win32" ? ["python"] : ["python3", "python"]).find((p) => {
  const r = spawnSync(p, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 15000 });
  return r.status === 0 && String(r.stdout).trim() === "3";
});
if (!interpreter) {
  console.log("SKIP what check.js calculates (no python on PATH)");
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

const MODEL = lines(
  "Deal",
  "    discount <=@max discount",
  "    net =@list price*(1-@discount)",
  "    Enterprise Deal",
  "        max discount: 35%",
  "        Enterprise Deal|list price|discount|net",
  "        Acme           |$100,000  |30%     |$70,000",
  "    Standard Deal",
  "        max discount: 20%",
  "        Standard Deal|list price|discount|net",
  "        Kite         |$20,000   |15%     |$17,000",
  "",
  "Summary",
  "    total net: $87,000 =@Deal@net.sum()",
);

{
  const r = inFolder({ "Q3.aot": MODEL }, [], {}, (res, dir) => Object.assign(res, { files: digest(dir) }));
  check("a model that agrees with itself: exit 0", r.status === 0 && /0 problems/.test(r.stdout), r.out);
  check("it says it runs the formulas", /runs the formulas in these files .* with your permissions/.test(r.stderr), r.stderr);
  check("it reports what it did", /formulas: 3 calculated, 0 failed, 0 differ/.test(r.stdout) && /rules: \d+ values? checked, 0 broken/.test(r.stdout), r.stdout);
}
{
  const dir = folder({ "Q3.aot": MODEL.replace("$17,000", "$99,999").replace("$87,000", "$260,000"), "Other.aot": "Order|qty >=1\nAcme|-5\n" });
  try {
    const before = digest(dir);
    const r = run(dir, []);
    check("a plug: names the value and what the formula gives", /Q3\.aot:11: error: change the value, or the formula — '\$99,999' is written here, and its formula gives '\$17,000'/.test(r.stdout), r.out);
    check("a false claim: the same", /'\$260,000' is written here, and its formula gives '\$87,000'/.test(r.stdout), r.out);
    check("every file in the folder is checked", /Other\.aot:2: error: .*'-5' breaks 'qty >=1'/.test(r.stdout), r.out);
    check("exit 1", r.status === 1, r.status);
    check("it wrote nothing", JSON.stringify(digest(dir)) === JSON.stringify(before));
    const single = run(dir, ["Other.aot"]);
    check("one file: only that file is reported", single.status === 1 && !/Q3\.aot/.test(single.stdout) && /1 file:/.test(single.stdout), single.out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
{
  // a value a reader might round, against what a float gives
  const close = inFolder({ "N.aot": lines("Case", "    a: 0.3 =0.1+0.2", "    b: 0.30000000000000004 =0.1+0.2") });
  check("15 significant digits: a float's noise is no difference", close.status === 0, close.out);
  const off = inFolder({ "N.aot": lines("Case", "    a: 0.31 =0.1+0.2") });
  check("but a different number is", off.status === 1, off.out);
  const unitless = inFolder({ "N.aot": lines("Trip|distance (km)|twice (km) =@distance*2", "A|5|10", "B|75 mi|150 mi") });
  check("column units: agreeing values pass, a cell's own unit too", unitless.status === 0, unitless.out);
  const units = inFolder({ "N.aot": lines("Trip|distance (km)|twice (km) =@distance*2", "A|5|11") });
  check("column units: a different number is caught", units.status === 1 && /'11' is written here, and its formula gives '10'/.test(units.stdout), units.out);
  const unwritten = inFolder({ "N.aot": lines("Case", "    a: =1+1", "    b: mph =100 km/2 h") });
  check("an empty cell in front of a formula is a note, and a unit alone is empty", unwritten.status === 0 && /2 not written yet/.test(unwritten.stdout), unwritten.out);
  const failing = inFolder({ "N.aot": lines("Case", "    a: 1 =1/0", "    b: 2 =@a*2") });
  check("a failure, and what reads it does not run", failing.status === 1 && /division by zero/.test(failing.stdout) && /it did not calculate: @Case@a failed/.test(failing.stdout), failing.out);
  const cycle = inFolder({ "N.aot": lines("Case", "    a: 1 =@b", "    b: 2 =@a") });
  check("a cycle is a failure", cycle.status === 1 && /circular reference/.test(cycle.stdout), cycle.out);
  const table = inFolder({ "N.aot": lines("Sales =[{\"n\": 1}, {\"n\": 2}]|n", "1|1", "2|3") });
  check("a table a formula writes is compared too", table.status === 1 && /'3' in its row 2, and its formula gives '2'/.test(table.stdout), table.out);
  const chart = inFolder({ "N.aot": lines("Case", "    long: aot.files/x.md =\"x\" * 500") });
  check("a long text is only checked for running", chart.status === 0, chart.out);
  // a table and the lines under it are one Concept: each reads the other
  const under = inFolder({ "N.aot": lines("Order|price|vat =@price*@tax rate|discount <=@max discount", "Acme |100  |20 |30%", "Kite |50   |10 |5%", "    tax rate: 0.2", "    max discount: 35%", "    total: 30 =@Order@vat.sum()") });
  check("under a table: a cell's formula and a column's rule read the values there, and a total there reads the table", under.status === 0, under.out);
  const underWrong = inFolder({ "N.aot": lines("Order|price|vat =@price*@tax rate", "Acme |100  |21", "    tax rate: 0.2") });
  check("under a table: and a number that disagrees is still caught", underWrong.status === 1 && /'21' is written here, and its formula gives '20'/.test(underWrong.stdout), underWrong.out);
  const underBroken = inFolder({ "N.aot": lines("Deal|discount <=@max discount", "Acme|40%", "Kite|5%", "    max discount: 35%") });
  check("under a table: a value there holds every row, not only the last", underBroken.status === 1 && /'40%' breaks/.test(underBroken.stdout), underBroken.out);
  const underWritten = inFolder({ "N.aot": lines("Sales =[{\"n\": 1}, {\"n\": 2}]|n", "1|1", "2|2", "    total: 2 =len(@Sales)") });
  check("under a table: a total there reads the table a formula writes", underWritten.status === 0, underWritten.out);
}
{
  // the guards: what the editor holds a formula to
  const code = lines("Case", "    a: 1 =__import__(\"subprocess\").run([\"whoami\"]).returncode");
  const refused = inFolder({ "N.aot": code });
  check("guards: a formula may not start another program", refused.status === 1 && /fix this formula/.test(refused.stdout), refused.out);
  const secret = inFolder({ "N.aot": lines("Case", "    a: x =__import__(\"os\").environ.get(\"GITHUB_TOKEN\", \"x\")") }, [], { GITHUB_TOKEN: "ghp_notreal" });
  check("guards: the environment's secrets are withheld", secret.status === 0, secret.out);
  const home = os.homedir().split(path.sep).join("/");
  const creds = inFolder({ "N.aot": lines("Case", `    a: 1 =open("${home}/.ssh/id_rsa").read()`) });
  check("guards: the places credentials are kept are refused", creds.status === 1 && /is where credentials are kept|fix this formula/.test(creds.stdout), creds.out);
}
{
  // the repository's Python: running this is the consent, for the files as for the formulas
  const sidecar = inFolder({ "N.aot": lines("Case", "    a: 42 =twice(21)"), "aot.files/N.py": "def twice(x):\n    return x * 2\n", ".git/HEAD": "ref: x\n" });
  check("a sidecar runs without a question", sidecar.status === 0, sidecar.out);
  const module = inFolder({ "N.aot": lines("Case", "    a: 42 =helpers.twice(21)"), "helpers.py": "def twice(x):\n    return x * 2\n", ".git/HEAD": "ref: x\n" });
  check("a module of the repository too", module.status === 0, module.out);
  const raising = inFolder({ "N.aot": lines("Case", "    a: 1 =1"), "aot.files/N.py": "raise ValueError('nope')\n", ".git/HEAD": "ref: x\n" });
  check("a sidecar that raises is a failure", raising.status === 1 && /failed: ValueError: nope|nope/.test(raising.stdout), raising.out);
}
{
  // across files: a formula reaches another file, and they must agree
  const reach = inFolder({ "a.aot": lines("Order|price", "Acme|100"), "b.aot": lines("Case", "    p: 100 =@Order@price@Acme") });
  check("a formula reads a Concept in another file", reach.status === 0, reach.out);
  const parked = inFolder({ "N.aot": lines("Order|qty", "Acme|-5"), "aot.files/N.formulas": "@Order@qty: >=1\n", ".git/HEAD": "ref: x\n" });
  check("a parked rule is still checked", parked.status === 1 && /'-5' breaks 'qty >=1'/.test(parked.stdout), parked.out);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
