// README.md stays short and stays true: its word limit, its example, every message
// it quotes, the name, and every link in it and in the docs it sends people to.
//
// Plain Node script, no framework — run with: node out/test-readme.js
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

const ROOT = path.join(__dirname, "..");
const CHECK = path.join(ROOT, "check.js");
const VERIFY = path.join(ROOT, "verify.js");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const README = read("README.md");
const MAX_WORDS = 1800;
const REFERENCE = ["language", "tables", "formulas", "trust", "checks", "settings", "cli", "llm", "team", "why", "repository"];

// A file's fenced blocks, and its lines outside them.
function parts(text) {
  const fences = [];
  const prose = [];
  let open = null;
  for (const line of text.split("\n")) {
    const m = /^\s*```(\S*)/.exec(line);
    if (m) {
      if (open) { fences.push(open); open = null; }
      else open = { lang: m[1], lines: [] };
      continue;
    }
    if (open) open.lines.push(line);
    else prose.push(line);
  }
  return { fences, prose };
}
const { fences, prose } = parts(README);

// --- it stays short -----------------------------------------------------------
{
  const words = prose.join(" ").split(/\s+/).filter(Boolean).length;
  check(`the README is at most ${MAX_WORDS} words outside its code blocks (${words})`, words <= MAX_WORDS);
}

// --- the name, and the language the brief retired ---------------------------------
const docs = fs.readdirSync(path.join(ROOT, "docs")).filter((n) => /\.md$/.test(n)).map((n) => `docs/${n}`);
{
  const named = (rel) => parts(read(rel)).prose
    .map((l) => l.replace(/`[^`]*`/g, ""))
    .filter((l) => /\bAlpha\b/.test(l));
  for (const rel of ["README.md", ...docs]) {
    const left = named(rel);
    check(`${rel} calls the product by its name`, left.length === 0, left[0]);
  }
  const RETIRED = [
    "prove consistent", "world's smallest", "strongest ideas", "coffee break",
    "no chance of a plausible", "take the model's word", "rolling up the tree",
  ];
  const current = ["README.md", ...REFERENCE.map((n) => `docs/${n}.md`)];
  for (const phrase of RETIRED) {
    const hit = current.find((rel) => read(rel).includes(phrase));
    check(`nothing says '${phrase}'`, !hit, hit);
  }
}

// --- every link resolves ----------------------------------------------------------
{
  const slug = (t) => t.replace(/`/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
  const anchorsOf = new Map();
  const anchors = (rel) => {
    if (anchorsOf.has(rel)) return anchorsOf.get(rel);
    const seen = new Map();
    const out = new Set();
    for (const l of parts(read(rel)).prose) {
      const m = /^#{1,6} (.*)$/.exec(l);
      if (!m) continue;
      const s = slug(m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"));
      const n = seen.get(s) || 0;
      seen.set(s, n + 1);
      out.add(n ? `${s}-${n}` : s);
    }
    anchorsOf.set(rel, out);
    return out;
  };
  const broken = [];
  let links = 0;
  for (const rel of ["README.md", "CHANGELOG.md", ...docs]) {
    for (const line of parts(read(rel)).prose) {
      for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
        const url = m[1];
        if (/^[a-z]+:/i.test(url)) continue;
        links++;
        const [file, anchor] = url.split("#");
        const target = file ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), decodeURI(file))) : rel;
        if (!fs.existsSync(path.join(ROOT, target))) { broken.push(`${rel}: ${url}`); continue; }
        if (anchor && /\.md$/.test(target) && !anchors(target).has(decodeURI(anchor))) broken.push(`${rel}: ${url}`);
      }
    }
  }
  check(`all ${links} relative links and anchors resolve`, broken.length === 0, broken.slice(0, 8).join(" ; "));
  for (const name of REFERENCE) {
    check(`the README links to docs/${name}.md`, README.includes(`](docs/${name}.md`));
    check(`docs/${name}.md links back to the README`, read(`docs/${name}.md`).includes("](../README.md)"));
  }
}

// --- the example does what the README says ------------------------------------------
const interpreter = (process.platform === "win32" ? ["python"] : ["python3", "python"]).find((p) => {
  const r = spawnSync(p, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 15000 });
  return r.status === 0 && String(r.stdout).trim() === "3";
});
if (!interpreter) {
  console.log("SKIP the README's example (no python on PATH)");
} else {
  const run = (script, files, args) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-readme-"));
    try {
      for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
      const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", timeout: 180000 });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const NAME = "Q3 Revenue.aot";
  const model = fences.find((f) => f.lang === "aot").lines.join("\n");
  const diff = fences.find((f) => f.lang === "diff").lines;
  const quoted = fences.find((f) => f.lang === "text" && f.lines[0].startsWith("$ node check.js")).lines.slice(1).filter(Boolean);

  const clean = run(CHECK, { [NAME]: model }, [NAME]);
  check("the model passes every check, as it says", clean.status === 0 && /0 problems/.test(clean.out), clean.out);

  const context = diff[0].slice(1);
  const added = diff[1].slice(1);
  check("the diff's context line is in the model", model.includes(context));
  const edited = model.replace(context, `${context}\n${added}`);
  const caught = run(CHECK, { [NAME]: edited }, [NAME]);
  check("the LLM's row fails the check", caught.status === 1, caught.out);
  for (const line of quoted) {
    check(`check.js says: ${line.slice(0, 70)}`, caught.out.includes(line), caught.out);
  }

  const restated = run(CHECK, { [NAME]: model, "LLM Patch.aot": "Standard Deal\n    max discount: 25%\n    - Finch\n        list price: $10,000\n        discount: 24%\n" }, ["."]);
  check("a limit restated in the LLM's own file turns both files red",
    restated.status === 1 && /LLM Patch\.aot:\d+: error: .*'25%' here/.test(restated.out) && /Q3 Revenue\.aot:\d+: error: .*'20%' here/.test(restated.out), restated.out);

  const ASSUMPTIONS = "Standard Deal\n    max discount: 20%\n    ...\nEnterprise Deal\n    max discount: 35%\n    ...\n";
  const kept = run(CHECK, { [NAME]: model, "assumptions.aot": ASSUMPTIONS }, ["."]);
  check("assumptions in their own file agree with the model", kept.status === 0, kept.out);
  const raised = run(CHECK, { [NAME]: model.replace("max discount: 20%", "max discount: 50%"), "assumptions.aot": ASSUMPTIONS }, ["."]);
  check("a limit raised in the model alone turns both files red",
    raised.status === 1 && /assumptions\.aot:\d+: error/.test(raised.out) && /Q3 Revenue\.aot:\d+: error/.test(raised.out), raised.out);

  // what the README says can't be caught, so that it is told if that changes
  const loosened = run(CHECK, { [NAME]: model.replace("discount <=@max discount", "discount <=@max discount*2") }, [NAME]);
  check("still so: a rule someone edited passes the check", loosened.status === 0, loosened.out);
  const elsewhere = run(CHECK, { [NAME]: model, "LLM Patch.aot": "Standard Deal|list price|discount|net\nWren         |$50,000   |30%     |$99,999\n" }, ["."]);
  check("still so: rows in another file are not held to the rule", elsewhere.status === 0, elsewhere.out);
  const invented = run(CHECK, { [NAME]: model.replace("$20,000   |15%     |$17,000", "$40,000   |15%     |$34,000").replace("$159,000", "$176,000") }, [NAME]);
  check("still so: a wrong list price passes", invented.status === 0, invented.out);

  const FLAT = "Deal|list price|max discount: 20%|discount <=@max discount|net =@list price*(1-@discount)\nAcme|$100,000|35%|30%|$70,000\nKite|$20,000||15%|$17,000\n";
  const flat = run(CHECK, { "R.aot": FLAT }, ["R.aot"]);
  check("a row overrides a default the header states, and the rest read it", flat.status === 0, flat.out);
  const overrides = run(VERIFY, { "R.aot": FLAT }, ["R.aot", "--overrides"]);
  check("--overrides lists that row", /'- Acme' sets 'max discount' to '35%', replacing the '20%'/.test(overrides.out), overrides.out);

  const EXCEL = [
    "Order|region|price|tax rate: 20%|vat =@price*@tax rate|status =(\"draft\", \"sent\", \"paid\")|qty >=1",
    "Acme|North|$100|||sent|2",
    "Bolt|South|$40|||draft|1",
    "",
    "Total",
    "    all: =@Order@price.sum()",
    "    one cell: =@Order@price@Acme",
    "By Region =@Order.groupby(\"region\", as_index=False)[\"price\"].sum()",
  ].join("\n");
  const excel = run(CHECK, { "R.aot": EXCEL }, ["R.aot"]);
  check("the translations from Excel all calculate", excel.status === 0, excel.out);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-readme-"));
  try {
    const csv = path.join(dir, "data.csv");
    fs.writeFileSync(csv, "region,amount\nNorth,20000\nSouth,33760\n");
    const p = csv.split(path.sep).join("/");
    fs.writeFileSync(path.join(dir, "Own.aot"), `Sale =pd.read_csv("${p}")\n\nReport\n    raw: =pd.read_csv("${p}")\n    total: =@raw["amount"].sum()\n`);
    const r = spawnSync(process.execPath, [CHECK, "Own.aot"], { cwd: dir, encoding: "utf8", timeout: 180000 });
    check("your own data: a whole file, and a live frame", r.status === 0 && /3 calculated/.test(r.stdout), `${r.stdout}${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
