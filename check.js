#!/usr/bin/env node
// One command that can fail on the numbers.
//
//     node check.js [file or folder]            (default: the current folder)
//     node check.js [file or folder] --python <path to python>
//
// verify.js judges what a file says and never runs a formula, so it is safe on a
// pull request nobody has read. This goes on: it checks every file and every
// agreement between files as verify.js does, then calculates every formula and
// every rule, and fails on any of these:
//
//     a violation (V) or a contradiction between files
//     a value naming a row its file's own list does not hold
//     a formula that fails, or a rule that does
//     a broken rule
//     a value differing from what its formula computes, to 15 significant digits
//
// An empty cell in front of a formula is a note, not a failure: the formula has
// simply not written yet. A chart or a long text is only checked for running, and
// so is what a bare `=` line writes. It never writes to a file.
//
// **Running this runs the code in these files**, with your permissions, and that
// is its one consent: so never on a pull request you have not read. It starts
// Python as the editor does: no other program may start, the places credentials
// are kept are refused, and the secrets in the environment are withheld.
//
// Exit code: 0 when nothing is wrong, 1 when something is, 2 when it could not look.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const gates = require("./src/gates");
const python = require("./src/python");
const park = require("./src/park");
const repo = require("./src/repo");
const table = require("./src/table");
const derive = require("./src/derive");
const { unlistedValues, externalIndex } = require("./src/crosslinks");

const BATCH = 64;
const GUARDS = { memoryMb: 4096, subprocess: false, network: true, credentials: true };

const tally = {
  violations: 0, contradictions: 0, unlisted: 0,
  formulas: 0, failed: 0, stale: 0, unwritten: 0,
  values: 0, broken: 0, badRules: 0, skipped: 0,
};
const shown = (file) => path.relative(process.cwd(), file) || file;
const say = (file, line, level, message) => console.log(`${shown(file)}:${line}: ${level}: ${message}`);

// Every Python file a derivation may reach, as the editor walks them. A virtual
// environment, node_modules, bytecode and hidden folders are not the repository's.
function pythonFilesUnder(root) {
  const skip = new Set(["node_modules", "__pycache__", "site-packages"]);
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 16 || files.length > 5000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === "pyvenv.cfg")) return;
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !skip.has(e.name)) walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile() && /\.py$/i.test(e.name)) files.push(path.join(dir, e.name));
    }
  };
  walk(root, 0);
  return files.sort();
}

function findPython(explicit, root) {
  if (explicit) return python.resolveExecutable(explicit, { base: process.cwd() });
  for (const name of python.defaultPythons(process.platform)) {
    const exe = python.resolveExecutable(name, { base: root });
    if (exe) return exe;
  }
  return null;
}

function startSession(exe, cwd) {
  const session = new python.Session(spawn, {
    python: exe,
    runtime: path.join(__dirname, "src", "aot_runtime.py"),
    cwd,
    env: python.scrubbedEnv(process.env).env,
    timeoutMs: 15000,
  }).start();
  return session;
}

// What a Concept's own formula wrote, against what it gives now: one message for
// the first difference, or null when they agree.
function tableDiffers(lines, h, rootName, grid) {
  const written = derive.gridOfConcept(lines, h.node, rootName);
  if (!written) return `the table isn't written yet`;
  if (written.rows.length !== grid.rows.length) {
    return `'${h.node.name}' holds ${written.rows.length} row${written.rows.length === 1 ? "" : "s"} here, and its formula gives ${grid.rows.length}`;
  }
  for (let r = 0; r < grid.rows.length; r++) {
    for (let c = 1; c < grid.rows[r].length; c++) {
      const at = table.splitCell(String(written.rows[r][c] || "").trim()).value;
      if (!python.sameResult(at, grid.rows[r][c])) {
        return `'${h.node.name}' says '${at}' in its row ${grid.rows[r][0]}, and its formula gives '${grid.rows[r][c]}'`;
      }
    }
  }
  return null;
}

// Calculate one file. Nothing it computes is written anywhere.
async function calculate(e, others, root, exe) {
  const lines = e.text.split(/\r?\n/);
  const aotFiles = path.join(root, "aot.files");
  let stored = [];
  try { stored = park.parse(fs.readFileSync(path.join(aotFiles, `${path.basename(e.file).replace(/\.aot$/i, "")}.formulas`), "utf8")); } catch { /* no store */ }
  const parked = park.parkedConstraints(e.nodes, e.rootName, stored);
  const hosts = python.calcHosts(e.nodes, lines, e.rootName, parked);
  const checks = python.constraintChecks(e.nodes, lines, parked);
  if (!hosts.length && !checks.length) return;
  if (!exe) {
    console.error(`${shown(e.file)}: ${python.spawnMessage({ code: "ENOENT" }, "python")}`);
    process.exit(2);
  }
  const registry = table.mergeRegistries(...others.map((o) => derive.conceptRegistry(o.root, o.nodes)), derive.conceptRegistry(e.root, e.nodes));
  const ctx = { lines, registry, rootName: e.rootName, index: python.hostIndex(hosts, undefined, e.nodes, lines) };
  const byAddress = new Map(hosts.map((h) => [h.address, h]));
  const resolved = new Map(hosts.map((h) => {
    try { return [h.address, python.resolveHost(h, ctx)]; }
    catch (err) { return [h.address, { code: "", targets: [], deps: [], errors: [err.message], spans: [] }]; }
  }));
  const depsOf = (a) => (resolved.get(a) || { deps: [] }).deps;
  const { order, cycles } = python.orderDerivations(hosts, depsOf);
  const failed = new Set();
  for (const loop of cycles) {
    for (const a of loop) {
      failed.add(a);
      tally.failed++;
      say(e.file, byAddress.get(a).line, "error", `remove one of these references — circular reference (${[...loop, loop[0]].join(" → ")}): none of these can run first`);
    }
  }

  const cwd = fs.existsSync(aotFiles) ? aotFiles : root;
  const session = startSession(exe, cwd);
  try {
    await session.request({ op: "hello", guards: GUARDS }, 30000);
    const files = pythonFilesUnder(root);
    const approved = {};
    // running this is the consent, for the Python files as for the formulas
    for (const f of files) approved[f] = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    const sidecar = path.join(aotFiles, `${e.rootName}.py`);
    let sidecarMtime = null;
    try { sidecarMtime = fs.statSync(sidecar).mtimeMs; } catch { /* no sidecar */ }
    try {
      await session.request({
        op: "open", file: e.file, root: e.rootName, aotFiles,
        sidecar: sidecarMtime === null ? null : sidecar, sidecarMtime,
        repo: root, pyFiles: files, approved, tree: python.treeOf(e.root),
      });
    } catch (err) {
      tally.failed++;
      say(e.file, 1, "error", `fix what ${path.basename(sidecar)} does as it loads — it failed: ${err.message}`);
      return;
    }

    const finish = (h, msg) => {
      tally.formulas++;
      if (msg.many) return; // a definition naming what a value may be writes nothing
      let out;
      try { out = python.resultOf(h, msg.result, 120); } catch (err) {
        failed.add(h.address);
        tally.failed++;
        say(e.file, h.line, "error", `fix this formula — ${err.message}`);
        return;
      }
      if (h.kind === "generator" || out.file) return; // it ran: nothing here to compare
      if (h.kind === "concept") {
        const differs = tableDiffers(lines, h, e.rootName, out.grid);
        if (differs === `the table isn't written yet`) tally.unwritten++;
        else if (differs) {
          tally.stale++;
          say(e.file, h.line, "error", `recalculate, or change the formula — ${differs}`);
        }
        return;
      }
      const written = table.readValue(String(h.value || "")).trim();
      if (!written || python.onlyAUnit(written)) { tally.unwritten++; return; }
      if (python.sameResult(written, out.text, h.unit)) return;
      tally.stale++;
      say(e.file, h.line, "error", `change the value, or the formula — '${written}' is written here, and its formula gives '${table.readValue(out.text)}'`);
    };
    const fail = (h, msg) => {
      // a formula reading one that failed did not fail itself
      const blocker = depsOf(h.address).find((d) => failed.has(d) && d !== h.address);
      failed.add(h.address);
      if (blocker) {
        tally.skipped++;
        say(e.file, h.line, "error", `fix what it reads — it did not calculate: ${blocker} failed`);
        return;
      }
      tally.failed++;
      say(e.file, h.line, "error", `fix this formula — ${python.plainError(msg.error || "the formula failed")}`);
    };
    for (let at = 0; at < order.length; at += BATCH) {
      const targets = [];
      const shared = new Map();
      const items = [];
      const sent = [];
      for (const a of order.slice(at, at + BATCH)) {
        const h = byAddress.get(a);
        const r = resolved.get(a);
        if (r.errors && r.errors.length) {
          failed.add(a);
          tally.failed++;
          say(e.file, h.line, "error", `fix this reference — ${r.errors[0]}`);
          continue;
        }
        const blocker = r.deps.find((d) => failed.has(d));
        if (blocker) {
          failed.add(a);
          tally.skipped++;
          say(e.file, h.line, "error", `fix what it reads — it did not calculate: ${blocker} failed`);
          continue;
        }
        const refs = r.targets.map((t) => {
          if (!shared.has(t)) { shared.set(t, targets.length); targets.push(t); }
          return shared.get(t);
        });
        items.push(python.evalItem(h, r, refs));
        sent.push(h);
      }
      if (!items.length) continue;
      const heard = new Set();
      try {
        await session.request({ op: "evalBatch", targets, items }, undefined, (msg) => {
          const h = sent[msg.k];
          heard.add(h);
          if (msg.ok === false) fail(h, msg);
          else finish(h, msg);
        });
      } catch (err) {
        // a hung formula takes its session with it: what it did not reach did not
        // calculate, and that is no pass
        for (const h of sent) if (!heard.has(h)) fail(h, { error: err.message });
        for (const a of order.slice(at + BATCH)) {
          failed.add(a);
          tally.skipped++;
          say(e.file, byAddress.get(a).line, "error", `fix what stopped the session — it did not calculate: ${err.message}`);
        }
        tally.badRules += checks.length ? 1 : 0;
        if (checks.length) say(e.file, 1, "error", `fix what stopped the session — the rules were not checked: ${err.message}`);
        return;
      }
    }

    const plan = python.checkItems(checks, ctx);
    const asked = plan.filter((p) => p.item);
    let answers = [];
    if (asked.length) answers = (await session.request({ op: "checks", items: asked.map((p) => p.item) }, 120000)).results || [];
    const answerOf = new Map(asked.map((p, k) => [p, answers[k] || { ok: false, error: "no answer" }]));
    const counted = new Set();
    const badBounds = new Set();
    const badBound = (p, message) => {
      const key = `${p.check.a.line}:${p.k}:${message}`;
      if (badBounds.has(key)) return;
      badBounds.add(key);
      tally.badRules++;
      say(e.file, p.clause.parked ? p.check.host.line : p.check.a.line, "error", message);
    };
    for (const p of plan) {
      if (!counted.has(p.check)) { counted.add(p.check); tally.values++; }
      if (p.errors.length) { badBound(p, `fix the bound ${python.boundSaid(p)} — ${p.errors[0]}`); continue; }
      const r = answerOf.get(p);
      if (!r.ok) { badBound(p, `fix the bound ${python.boundSaid(p)} — it failed: ${python.plainError(r.error)}`); continue; }
      if (r.define || r.holds) continue;
      tally.broken++;
      say(e.file, p.check.host.line, "error", python.breachMessage(p, r));
    }
  } finally {
    try { await session.request({ op: "bye" }, 2000); } catch { /* already gone */ }
    session.kill("done");
  }
}

async function main() {
  const args = process.argv.slice(2);
  let explicit = null;
  const pyAt = args.indexOf("--python");
  if (pyAt !== -1) {
    explicit = args[pyAt + 1];
    if (!explicit) {
      console.error("usage: node check.js [file or folder] [--python <path>]");
      process.exit(2);
    }
    args.splice(pyAt, 2);
  }
  // an unquoted name splits into several arguments: glue them back
  const target = path.resolve(args.join(" ") || ".");
  let stat;
  try { stat = fs.statSync(target); } catch {
    console.error(`no such file or folder: '${args.join(" ") || "."}'`);
    process.exit(2);
  }
  const base = stat.isDirectory() ? target : path.dirname(target);
  const root = gates.repoRootOf(base) || base;
  // every file of the repository is read, since a formula may reach any of them
  // and a Concept must agree across them, and only those asked about are reported
  const universe = gates.walkAot(root);
  if (!stat.isDirectory() && !universe.includes(target)) universe.push(target);
  const inScope = (f) => (stat.isDirectory() ? !path.relative(target, f).startsWith("..") : f === target);
  const asked = universe.filter(inScope).sort();
  if (!asked.length) {
    // a check of nothing must never read as a pass
    console.error(`no .aot files under '${args.join(" ") || "."}', so nothing was checked`);
    process.exit(2);
  }
  const entries = universe.map((file) => {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch (err) {
      console.error(`could not read '${file}' — ${err.message}`);
      process.exit(2);
    }
    const rootName = path.basename(file).replace(/\.[^.]*$/, "");
    return { file, text, rootName, ...gates.judge(text, rootName) };
  });
  const all = repo.occurrences(entries);
  const exe = findPython(explicit, root);
  let warned = false;

  for (const e of entries.filter((x) => inScope(x.file))) {
    const others = entries.filter((x) => x !== e);
    for (const { line, message } of [...e.errors, ...e.deepErrors]) {
      tally.violations++;
      say(e.file, line, "error", message);
    }
    for (const { line, message } of [...e.warnings, ...e.depWarnings, ...e.notes]) say(e.file, line, "warning", message);
    const cross = repo.findings(e.file, all, { autoReconcile: false });
    for (const { line, message } of cross.errors) {
      tally.contradictions++;
      say(e.file, line, "error", message);
    }
    for (const { line, message } of cross.warnings) say(e.file, line, "warning", message);
    // numbers over a broken tree mean nothing: the tree first, as everywhere
    if (e.errors.length || e.deepErrors.length) {
      console.log(`${shown(e.file)}: formulas not calculated: fix the errors above first`);
      continue;
    }
    // A list in this file says what it holds. One in another file is that file's
    // partial sample of the Concept (repo.js), so a name it lacks proves nothing:
    // that is said, and fails nothing.
    for (const u of unlistedValues(e.text, e.root, e.nodes, externalIndex(others))) {
      let top = u.concept;
      while (top.parent) top = top.parent;
      if (top === e.root) {
        tally.unlisted++;
        say(e.file, u.line, "error", u.message);
      } else say(e.file, u.line, "warning", u.message);
    }
    if (!warned && python.hasFormulas(e.nodes, e.text)) {
      warned = true;
      console.error("check.js runs the formulas in these files and any Python they name, with your permissions.");
    }
    await calculate(e, others, root, exe);
  }

  const problems = tally.violations + tally.contradictions + tally.unlisted + tally.failed + tally.skipped
    + tally.stale + tally.broken + tally.badRules;
  const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
  console.log("");
  console.log(`${plural(asked.length, "file")}: violations V = ${tally.violations}, ${plural(tally.contradictions, "contradiction")} between files, ${plural(tally.unlisted, "value")} naming no row`);
  console.log(`formulas: ${tally.formulas.toLocaleString("en-US")} calculated, ${tally.failed + tally.skipped} failed, ${tally.stale} differ from what is written, ${tally.unwritten} not written yet`);
  console.log(`rules: ${plural(tally.values, "value")} checked, ${tally.broken} broken, ${tally.badRules} could not be checked`);
  console.log(problems === 0
    ? "0 problems — every file agrees with itself, its rules, its formulas and the other files. That says nothing about whether a typed number is true."
    : `${plural(problems, "problem")}`);
  process.exitCode = problems ? 1 : 0;
}

// Whatever goes wrong is one line and a failing exit, never a stack trace.
main().catch((e) => {
  console.error(`check.js could not finish — ${e && e.message ? e.message : e}`);
  process.exit(2);
});
