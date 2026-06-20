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
//     node verify.js file.aot --diff old.aot new.aot     (version diff as factorisation comparison)
//     node verify.js file.aot --suggest                  (FCA: audit the tree against the concept lattice)

const fs = require("fs");
const path = require("path");
const { lint, gcd, KIND } = require("./src/linter");
const { suggest } = require("./src/fca");
const godel = require("./src/godel");
const armstrong = require("./src/armstrong");

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

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: node verify.js <file.aot> [--ask X Y | --genus X Y | --number X | --godel X | --clashes | --overrides | --find \"a: v\" | --common X Y | --near X | --fd | --depends X | --diff old.aot new.aot | --suggest]");
    process.exit(2);
  }

  let d;
  if ((d = args.indexOf("--diff")) !== -1) {
    const lintFile = (f) => {
      const name = path.basename(f).replace(/\.[^.]*$/, "");
      return lint(fs.readFileSync(f, "utf-8"), name);
    };
    const a = lintFile(args[d + 1]), b = lintFile(args[d + 2]);
    const report = godel.diff(a.root, a.nodes, b.root, b.nodes);
    console.log(`diff ${args[d + 1]} -> ${args[d + 2]}`);
    for (const { message } of report.findings) console.log(`  ${message}`);
    console.log(`\n${report.findings.length} node${report.findings.length === 1 ? "" : "s"} changed`);
    return;
  }

  const file = args[0];
  const rootName = path.basename(file).replace(/\.[^.]*$/, "");
  const { root, nodes, errors, warnings, subsumption } = lint(fs.readFileSync(file, "utf-8"), rootName);

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
    const { attrPrime, valueCode, naming } = godel.buildGodel(root, nodes);
    const slots = godel.decode(x, attrPrime, valueCode, naming);
    if (!slots.length) {
      console.log(`G(${x.name}) = 1 — '${x.name}' carries no attributes`);
      return;
    }
    const factors = slots.map((s) => `${s.prime}^${s.exponent}`).join(" * ");
    console.log(`G(${x.name}) = ${factors} = ${x.godel}`);
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
    for (const { line, message } of fds) console.log(`${file}:${line}: ${message}`);
    console.log(`\n${fds.length} functional dependenc${fds.length === 1 ? "y" : "ies"} inferred from the Examples`);
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
    for (const { line, message } of report.findings) console.log(`${file}:${line}: ${message}`);
    console.log(`\nsuggestions S = ${report.findings.length}`);
    return;
  }

  for (const { line, message } of errors) console.log(`${file}:${line}: error: ${message}`);
  for (const { line, message } of warnings) console.log(`${file}:${line}: warning: ${message}`);
  // Clash and dependency hints are advisory, like the FCA suggestions: only
  // over a tree that verifies, and never counted in V. The always-on clash
  // hint surfaces only the strong, content-identical clashes; `--clashes`
  // reports both strengths, `--fd` the full set of inferred dependencies.
  if (!errors.length) {
    for (const { line, message, kind } of godel.clashes(root, nodes).findings) {
      if (kind === "content") console.log(`${file}:${line}: hint: ${message}`);
    }
    for (const { line, message } of armstrong.findings(root, nodes)) {
      console.log(`${file}:${line}: hint: ${message}`);
    }
  }
  const v = errors.length;
  console.log(`\n${nodes.length} nodes, ${nodes.length} edges, largest prime ${nodes[nodes.length - 1].prime}, violations V = ${v}`);
  console.log(`subsumption: ${subsumption.edges} derived is-a edges, hierarchy ${subsumption.consistent ? "consistent" : "inconsistent"}`);
  console.log(`V = 0: ${v === 0 ? "true — the file verifies" : "FALSE"}`);
  process.exit(v ? 1 : 0);
}

main();
