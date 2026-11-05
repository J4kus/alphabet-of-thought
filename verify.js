#!/usr/bin/env node
// Command-line front end for the arithmetic linter in src/linter.js.
//
// Usage:
//     node verify.js "alphabet of thought.aot"
//     node verify.js file.aot --ask "Socrates" "Human"   (is-a by divisibility)
//     node verify.js file.aot --genus "X" "Y"            (genus by gcd)
//     node verify.js file.aot --number "X"               (characteristic number)
//     node verify.js file.aot --godel "X"                (Gödel number: the line's content)
//     node verify.js file.aot --clashes                  (nodes carrying the same attributes/values)
//     node verify.js file.aot --overrides                (nodes overriding an inherited default)
//     node verify.js file.aot --diff old.aot new.aot     (version diff as factorisation comparison, renames and moves recognised)
//     node verify.js --diff-rev REV file.aot             (the same, against the file as it stood at a git revision)
//     node verify.js --merge %O %A %B %P                  (git merge driver: merge by meaning, markers per attribute)
//     node verify.js file.aot --suggest                  (FCA: audit the tree against the concept lattice)
//     node verify.js --workspace [dir]                   (repo: shared Concepts, contradictions; exit 1 if any)
//     node verify.js --workspace [dir] --reconcile       (repo: write the agreement in first, then check)
//     node verify.js --workspace [dir] --primes          (repo: extend and write the stable Gödel numbers, aot.files/godel.tsv)

const fs = require("fs");
const path = require("path");
const { lint, gcd, KIND } = require("./src/linter");
const { suggest } = require("./src/fca");
const godel = require("./src/godel");
const armstrong = require("./src/armstrong");
const table = require("./src/table");
const derive = require("./src/derive");
const repo = require("./src/repo");

// past this many Examples the lattice is no longer cheap; matches the extension
const MAX_FCA_OBJECTS = 200;

function find(root, nodes, name) {
  const match = [root, ...nodes].find((n) => n.name === name);
  if (!match) {
    console.error(`no idea named '${name}' in the file`);
    process.exit(2);
  }
  return match;
}

function pathOf(node) {
  const parts = [];
  for (; node; node = node.parent) parts.push(node.name);
  return parts.join(" < ");
}

// Every .aot under `dir`, skipping the noise directories — shared by the
// --workspace duplicate scan and the cross-table registry.
function walkAot(dir) {
  const files = [];
  const skip = new Set(["node_modules", ".git", "aot.files"]);
  const walk = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name) && !e.name.endsWith(".tables") && !e.name.startsWith("tables.")) walk(p); }
      else if (/\.aot$/i.test(e.name)) files.push(p);
    }
  };
  walk(dir);
  return files;
}

// The repository a path sits in: the nearest folder above it holding a .git
// (the extension's own rule), or null outside any repository.
function repoRootOf(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// The stable Gödel numbers the repository keeps (aot.files/godel.tsv at its
// root), so `--godel` and `--diff` print the numbers the editor shows. An
// empty registry where there is none: the numbers then come out as a fresh
// registry would give them.
function godelRegistryFile(near) {
  const root = repoRootOf(fs.existsSync(near) && fs.statSync(near).isDirectory() ? near : path.dirname(path.resolve(near))) || process.cwd();
  return path.join(root, "aot.files", "godel.tsv");
}
function godelRegistryFor(near) {
  try { return godel.parseRegistry(fs.readFileSync(godelRegistryFile(near), "utf8")); }
  catch { return godel.parseRegistry(""); }
}

// Read a file or exit with a message instead of a stack trace.
function readFile(f) {
  try {
    return fs.readFileSync(f, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") {
      console.error(`no such file: '${f}'`);
    } else if (e.code === "EISDIR") {
      console.error(`'${f}' is a folder — check a whole folder with: node verify.js --workspace "${f}"`);
    } else {
      console.error(`could not read '${f}' — ${e.message}`);
    }
    process.exit(2);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: node verify.js <file.aot> [--ask X Y | --genus X Y | --number X | --godel X | --clashes | --overrides | --find \"a: v\" | --common X Y | --near X | --fd | --depends X | --diff old.aot new.aot | --suggest] | --diff-rev REV file.aot | --workspace [dir] [--reconcile] [--primes]");
    process.exit(2);
  }

  // --workspace [dir]: the repo-wide check. Every Concept written in more
  // than one .aot under dir (default: the current directory) is listed, and
  // the disagreements no tool may settle — one attribute carrying two values,
  // one Concept filed under two kinds — are reported as errors and exit 1, so
  // CI can gate on them. Add --reconcile to write the agreement in first:
  // missing attributes filled, the `...` line kept true, nothing deleted.
  let w;
  if ((w = args.indexOf("--workspace")) !== -1) {
    const root = args[w + 1] && !args[w + 1].startsWith("-") ? args[w + 1] : ".";
    const fix = args.includes("--reconcile");
    // a check of nothing must never read as a pass: a mistyped path in a CI job
    // would otherwise report 0 contradictions and exit 0 forever
    let isFolder = false;
    try { isFolder = fs.statSync(root).isDirectory(); } catch { /* answered just below */ }
    if (!isFolder) {
      console.error(`no such folder: '${root}'`);
      process.exit(2);
    }
    const files = walkAot(root);
    if (!files.length) {
      console.error(`no .aot files under '${root}', so nothing was checked`);
      process.exit(2);
    }
    const read = () => files.map((f) => ({
      file: f,
      text: readFile(f),
      rootName: path.basename(f).replace(/\.[^.]*$/, ""),
    })).map((e) => ({ ...e, ...lint(e.text, e.rootName) }));

    let entries = read();
    if (fix) {
      const all = repo.occurrences(entries);
      const registry = table.mergeRegistries(
        ...entries.map((e) => derive.conceptRegistry(e.root, e.nodes)));
      let written = 0;
      for (const e of entries) {
        const ops = repo.reconcileFile(e.file, all, e.text.split(/\r?\n/), e.rootName, registry, e.root);
        if (!ops.length) continue;
        const eol = /\r\n/.test(e.text) ? "\r\n" : "\n";
        fs.writeFileSync(e.file, repo.applyOps(e.text.split(/\r?\n/), ops).join(eol));
        console.log(`reconciled ${e.file} (${ops.length} edit${ops.length === 1 ? "" : "s"})`);
        written++;
      }
      console.log(written ? `\n${written} file${written === 1 ? "" : "s"} reconciled\n`
        : "\nevery shared Concept was already in step\n");
      entries = read(); // judge what is now on disk, not what was
    }

    // --primes: the stable Gödel numbers extended by every file here, and
    // written back, as a save in the editor does
    if (args.includes("--primes")) {
      const file = godelRegistryFile(root);
      const pooled = godel.pool(entries, godelRegistryFor(root));
      if (pooled.grown) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, godel.formatRegistry(pooled.registry));
        console.log(`wrote ${file} (${pooled.registry.attrs.size} attribute${pooled.registry.attrs.size === 1 ? "" : "s"})\n`);
      } else {
        console.log(`${file} already numbers every attribute and value here\n`);
      }
    }

    const all = repo.occurrences(entries);
    let shared = 0;
    for (const [, list] of all) {
      if (new Set(list.map((o) => o.file)).size < 2) continue;
      shared++;
      console.log(`Concept '${list[0].node.name}' is written in ${list.length} places:`);
      for (const o of list) console.log(`  ${o.file}:${o.node.line}`);
    }
    // one content under two names in two files: warnings, not contradictions
    const registry = godelRegistryFor(root);
    for (const e of entries) {
      if (e.errors.length) continue;
      for (const t of godel.twins(entries.filter((x) => !x.errors.length), e.file, { registry })) {
        console.log(`\n${e.file}:${t.line}  warning: ${t.message}`);
      }
    }
    // without --reconcile nothing is going to close a stale `...` line, so it
    // is worth reporting; with it, the pass above has already made it true
    let bad = 0;
    for (const e of entries) {
      const found = repo.findings(e.file, all, { autoReconcile: fix });
      for (const f of found.errors) {
        console.log(`\n${e.file}:${f.line}  ${f.message}`);
        bad++;
      }
      for (const f of found.warnings) console.log(`\n${e.file}:${f.line}  ${f.message}`);
    }
    console.log(`\n${files.length} file${files.length === 1 ? "" : "s"} scanned, `
      + `${shared} name${shared === 1 ? "" : "s"} written in more than one, `
      + `${bad} contradiction${bad === 1 ? "" : "s"}`);
    if (bad) process.exit(1);
    return;
  }

  // --merge %O %A %B %P: git's merge driver (merge.aot.driver). %O the
  // ancestor, %A ours — where the result is written — %B theirs, %P the
  // path. git's own line merge first: when it is clean it is kept, and any
  // error the merge brought that neither side had is said. Otherwise the
  // semantic merge (src/merge.js): clean, it is written and git goes on;
  // with conflicts, marked attribute by attribute; when it cannot vouch for
  // itself, git's conflicted text is written instead. Never worse than git.
  let d;
  if ((d = args.indexOf("--merge")) !== -1) {
    const [basePath, oursPath, theirsPath, pathName] = args.slice(d + 1);
    if (!basePath || !oursPath || !theirsPath) {
      console.error("usage: node verify.js --merge %O %A %B %P   (git's merge driver)");
      process.exit(2);
    }
    const shown = pathName || oursPath;
    const rootName = path.basename(shown).replace(/\.[^.]*$/, "");
    const oursText = readFile(oursPath), baseText = readFile(basePath), theirsText = readFile(theirsPath);
    const eol = /\r\n/.test(oursText) ? "\r\n" : "\n";
    const semantic = require("./src/merge");
    const line = require("./src/git").mergeFile(oursPath, basePath, theirsPath);
    if (!line.error && line.clean) {
      fs.writeFileSync(oursPath, line.text);
      // compared without their line numbers: an error a side had that the
      // merge only moved is still that side's
      const had = new Set([...lint(oursText, rootName).errors, ...lint(theirsText, rootName).errors].map(semantic.errorKind));
      for (const e of lint(line.text, rootName).errors) {
        if (!had.has(semantic.errorKind(e))) console.error(`${shown}:${e.line}: the merge brought an error neither side had — ${e.message}`);
      }
      process.exit(0);
    }
    const result = semantic.merge(baseText, oursText, theirsText, rootName);
    if (!result.fallback) {
      fs.writeFileSync(oursPath, result.text.replace(/\n/g, eol));
      if (result.clean) {
        console.error(`${shown}: merged by meaning — git's line merge conflicted, the semantic merge did not`);
        process.exit(0);
      }
      for (const c of result.conflicts) console.error(`${shown}:${c.line}: conflict — ${c.message}`);
      process.exit(1);
    }
    console.error(`${shown}: the semantic merge fell back to git's line merge — ${result.fallback}`);
    if (!line.error && typeof line.text === "string") fs.writeFileSync(oursPath, line.text);
    process.exit(1);
  }
  const printDiff = (label, a, b, near) => {
    const report = godel.diff(a.root, a.nodes, b.root, b.nodes, godelRegistryFor(near));
    console.log(`diff ${label}`);
    for (const { message } of report.findings) console.log(`  ${message}`);
    console.log(`\n${report.findings.length} node${report.findings.length === 1 ? "" : "s"} changed`);
  };
  // --diff-rev REV file.aot: the file as it stood at a git revision, against
  // the file as it stands — renames and moves recognised
  if ((d = args.indexOf("--diff-rev")) !== -1) {
    const rev = args[d + 1];
    const file = args.slice(d + 2).filter((x) => !x.startsWith("--")).join(" ");
    if (!rev || !file) {
      console.error("usage: node verify.js --diff-rev REV file.aot");
      process.exit(2);
    }
    const root = repoRootOf(path.dirname(path.resolve(file)));
    if (!root) {
      console.error(`'${file}' is in no git repository`);
      process.exit(2);
    }
    const rel = path.relative(root, path.resolve(file)).split(path.sep).join("/");
    const old = require("./src/git").show(root, rev, rel);
    if (old.error) {
      console.error(`git could not show ${rev}:${rel} — ${old.error}`);
      process.exit(2);
    }
    const name = path.basename(file).replace(/\.[^.]*$/, "");
    printDiff(`${rev}:${rel} -> ${file}`, lint(old.text, name), lint(readFile(file), name), file);
    return;
  }
  if ((d = args.indexOf("--diff")) !== -1) {
    if (!args[d + 1] || !args[d + 2]) {
      console.error("usage: node verify.js --diff old.aot new.aot");
      process.exit(2);
    }
    const lintFile = (f) => {
      const name = path.basename(f).replace(/\.[^.]*$/, "");
      return lint(readFile(f), name);
    };
    printDiff(`${args[d + 1]} -> ${args[d + 2]}`, lintFile(args[d + 1]), lintFile(args[d + 2]), args[d + 2]);
    return;
  }

  // The file name is every leading argument up to the first --flag, joined:
  // a shell splits an unquoted name like `examples/clean code.aot` into two
  // arguments, and gluing them back beats a stack trace. A quoted name is a
  // single argument and passes through unchanged.
  let flagAt = args.findIndex((a) => a.startsWith("--"));
  if (flagAt === -1) flagAt = args.length;
  const file = args.slice(0, flagAt).join(" ");
  if (!file) {
    console.error("usage: node verify.js <file.aot> [flags] — the file name must come first");
    process.exit(2);
  }
  const rootName = path.basename(file).replace(/\.[^.]*$/, "");
  const text = readFile(file);
  const { root, nodes, errors, warnings, subsumption } = lint(text, rootName);

  let i;
  if ((i = args.indexOf("--ask")) !== -1) {
    const x = find(root, nodes, args[i + 1]), y = find(root, nodes, args[i + 2]);
    const holds = x.chi % y.chi === 0n;
    console.log(`chi(${y.name}) = ${y.chi}`);
    console.log(`chi(${x.name}) = ${x.chi}`);
    console.log(`${y.chi} ${holds ? "divides" : "does not divide"} ${x.chi}`);
    console.log(`=> '${x.name}' is${holds ? "" : " NOT"} under '${y.name}'`);
    return;
  }
  if ((i = args.indexOf("--genus")) !== -1) {
    const x = find(root, nodes, args[i + 1]), y = find(root, nodes, args[i + 2]);
    const g = gcd(x.chi, y.chi);
    const genus = [root, ...nodes].find((n) => n.chi === g);
    console.log(`gcd(chi(${x.name}), chi(${y.name})) = ${g}`);
    console.log(`=> the genus of '${x.name}' and '${y.name}' is '${genus.name}'`);
    console.log(`   (${pathOf(genus)})`);
    return;
  }
  if ((i = args.indexOf("--number")) !== -1) {
    const x = find(root, nodes, args[i + 1]);
    const chain = [];
    for (let n = x; n; n = n.parent) chain.unshift(n);
    console.log(`chi(${x.name}) = ${chain.map((n) => n.prime).join(" * ")} = ${x.chi}`);
    console.log(`   (${pathOf(x)})`);
    return;
  }
  if ((i = args.indexOf("--godel")) !== -1) {
    const x = find(root, nodes, args[i + 1]);
    const { attrPrime, valueCode, naming } = godel.buildGodel(root, nodes, godelRegistryFor(file));
    const slots = godel.decode(x, attrPrime, valueCode, naming);
    if (!slots.length) {
      console.log(`G(${x.name}) = 1 — '${x.name}' carries no attributes`);
      return;
    }
    const factors = slots.map((s) => `${s.prime}^${s.exponent}`).join(" * ");
    console.log(`G(${x.name}) = ${factors} = ${x.godel}`);
    const length = godel.digits(x.gvec);
    console.log(`   ${length.toLocaleString("en-US")} digit${length === 1 ? "" : "s"}`);
    console.log("   legend (prime^exponent -> attribute: value):");
    for (const s of slots) console.log(`     ${s.prime}^${s.exponent} -> ${s.attr}: ${s.value}`);
    return;
  }
  if (args.includes("--clashes")) {
    const report = godel.clashes(root, nodes);
    for (const { line, message } of report.findings) console.log(`${file}:${line}: ${message}`);
    console.log(`\n${report.findings.length} clash${report.findings.length === 1 ? "" : "es"}`);
    return;
  }
  if (args.includes("--overrides")) {
    const report = godel.overrides(root, nodes);
    for (const { line, message } of report.findings) console.log(`${file}:${line}: ${message}`);
    console.log(`\n${report.findings.length} override${report.findings.length === 1 ? "" : "s"}`);
    return;
  }
  if ((i = args.indexOf("--find")) !== -1) {
    const terms = args.slice(i + 1).filter((a) => !a.startsWith("--"));
    if (!terms.length) {
      console.error("usage: node verify.js <file.aot> --find \"attribute: value\" [\"attribute\" ...]");
      process.exit(2);
    }
    const { matches, unknown } = godel.find(root, nodes, terms);
    for (const u of unknown) console.log(`(no idea carries '${u}' in the file)`);
    for (const n of matches) console.log(`${file}:${n.line}: ${n.kind === KIND.INDIVIDUAL ? "- " : ""}${n.name}   (${pathOf(n)})`);
    console.log(`\n${matches.length} idea${matches.length === 1 ? "" : "s"} match { ${terms.join(", ")} }`);
    return;
  }
  if ((i = args.indexOf("--common")) !== -1) {
    const x = find(root, nodes, args[i + 1]), y = find(root, nodes, args[i + 2]);
    const { number, slots } = godel.common(root, nodes, x, y);
    console.log(`shared core of '${x.name}' and '${y.name}' = ${number}`);
    if (!slots.length) console.log(`   '${x.name}' and '${y.name}' carry no attribute in common at the same value`);
    else for (const s of slots) console.log(`   ${s.attr}: ${s.value}`);
    return;
  }
  if ((i = args.indexOf("--near")) !== -1) {
    const x = find(root, nodes, args[i + 1]);
    const k = Number(args[i + 2]) || 5;
    const ranked = godel.near(root, nodes, x, k);
    console.log(`nearest ${ranked.length} to '${x.name}' by content distance:`);
    for (const r of ranked) {
      console.log(`  ${r.dist}  ${r.node.kind === KIND.INDIVIDUAL ? "- " : ""}${r.node.name} (line ${r.node.line})`);
      for (const d of r.diff) console.log(`        ${d}`);
    }
    return;
  }
  if (args.includes("--fd")) {
    if (errors.length) {
      for (const { line, message } of errors) console.log(`${file}:${line}: error: ${message}`);
      console.log(`\nV = ${errors.length}: functional dependencies over a broken tree mean nothing — fix the file first`);
      process.exit(1);
    }
    const fds = armstrong.findings(root, nodes);
    // --fd shows everything (covariation, provisional and transitively
    // implied findings included); the editor only flags the confident,
    // complete, non-implied ones. Tag each line with kind/confidence so the
    // difference shows.
    for (const { line, message, kind, confidence, incomplete, implied } of fds) {
      const flagged = implied
        ? ` [implied by ${implied.map((l) => `'${l}'`).join(" → ")} — editor: on demand only]`
        : confidence >= armstrong.MIN_CONFIDENCE && !incomplete ? "" : " [editor: on demand only]";
      console.log(`${file}:${line}: [${kind} ·conf ${confidence}]${flagged} ${message}`);
    }
    const flaggedCount = fds.filter((f) => f.confidence >= armstrong.MIN_CONFIDENCE && !f.incomplete && !f.implied).length;
    console.log(`\n${fds.length} functional dependenc${fds.length === 1 ? "y" : "ies"} inferred from the Examples (${flaggedCount} flagged in the editor, ${fds.length - flaggedCount} below the threshold or provisional)`);
    return;
  }
  if ((i = args.indexOf("--depends")) !== -1) {
    const x = find(root, nodes, args[i + 1]);
    const { direct, transitive } = armstrong.dependsOf(root, nodes, x);
    console.log(`'${x.name}' depends on:`);
    for (const d of direct) console.log(`   ${d.name}   (directly)`);
    for (const { node, through } of transitive) {
      console.log(`   ${node.name}   (through ${through.map((n) => n.name).join(" -> ")})`);
    }
    if (!direct.length && !transitive.length) console.log("   nothing — it references no other Concept");
    return;
  }
  if (args.includes("--suggest")) {
    if (errors.length) {
      for (const { line, message } of errors) console.log(`${file}:${line}: error: ${message}`);
      console.log(`\nV = ${errors.length}: a lattice over a broken tree means nothing — fix the file first`);
      process.exit(1);
    }
    const report = suggest(root, nodes);
    if (report.tooFew) {
      console.log(`nothing to suggest: ${report.objects} Example${report.objects === 1 ? "" : "s"}, expected at least 2`);
      return;
    }
    console.log(`formal context: ${report.objects} objects x ${report.columns} attributes, ${report.concepts} formal concepts`);
    console.log("");
    if (report.confirmed.length) {
      console.log(`confirmed: ${report.confirmed.length} Concept${report.confirmed.length === 1 ? " is" : "s are"} exactly the grouping${report.confirmed.length === 1 ? "" : "s"} the Examples' attributes support: ${report.confirmed.join(", ")}`);
    }
    // drift and exhaustion are errors counted in V, not advisories
    for (const { line, message } of report.findings) console.log(`${file}:${line}: error: ${message}`);
    console.log(`\nFCA audit: V = ${report.findings.length}${report.findings.length ? "" : " — the audit finds no violations"}`);
    process.exit(report.findings.length ? 1 : 0);
  }

  for (const { line, message } of errors) console.log(`${file}:${line}: error: ${message}`);
  // The FCA audit (drift / exhaustion) and the content-identical Gödel clash are
  // errors counted in V; the inferred functional dependencies are warnings (not
  // counted in V). All of them mean nothing over a tree that does not yet verify,
  // so they run only once the syntactic/subsumption pass is clean. The content
  // clash surfaces only the strong case; `--clashes` reports both strengths,
  // `--fd` the full set of inferred dependencies. The gates and filters match
  // the extension's analyse() exactly, so the CLI verdict is the editor's.
  let deepErrors = [];
  let depWarnings = [];
  if (!errors.length) {
    const objects = nodes.filter((n) => n.kind === KIND.INDIVIDUAL).length;
    if (objects >= 2 && objects <= MAX_FCA_OBJECTS) {
      deepErrors = suggest(root, nodes).findings;
      depWarnings = armstrong.findings(root, nodes).filter((f) => f.confidence >= armstrong.MIN_CONFIDENCE && !f.incomplete && !f.implied);
    }
    deepErrors = deepErrors.concat(godel.clashes(root, nodes).findings.filter((f) => f.kind === "content"));
    // a value every child states belongs on the parent; a default every
    // child overrides is in force for nothing — warnings, as in the editor
    depWarnings = depWarnings.concat(godel.hoists(root, nodes));
  }
  // Derivations and constraint bounds are Python, and this never runs
  // Python: a CI job that verified a pull request by running its code would
  // run whatever its author wrote. What the values say is the text's; the
  // editor's calculation is what computes and checks them.
  for (const { line, message } of deepErrors) console.log(`${file}:${line}: error: ${message}`);
  for (const { line, message } of warnings) console.log(`${file}:${line}: warning: ${message}`);
  for (const { line, message } of depWarnings) console.log(`${file}:${line}: warning: ${message}`);
  const v = errors.length + deepErrors.length;
  const largest = nodes.length ? `, largest prime ${nodes[nodes.length - 1].prime}` : "";
  console.log(`\n${nodes.length} nodes, ${nodes.length} edges${largest}, violations V = ${v}`);
  console.log(`subsumption: ${subsumption.edges} derived is-a edges, hierarchy ${subsumption.consistent ? "consistent" : "inconsistent"}`);
  console.log(`V = 0: ${v === 0 ? "true — the file verifies" : "FALSE"}`);
  process.exit(v ? 1 : 0);
}

// Whatever goes wrong is one line and a failing exit, never a stack trace.
try {
  main();
} catch (e) {
  console.error(`verify.js could not finish — ${e && e.message ? e.message : e}`);
  process.exit(2);
}
