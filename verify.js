#!/usr/bin/env node
// Command-line front end for the arithmetic linter in src/linter.js.
//
// Usage:
//     node verify.js "alphabet of thought.aot"
//     node verify.js file.aot --ask "Socrates" "Human"   (is-a by divisibility)
//     node verify.js file.aot --genus "X" "Y"            (genus by gcd)
//     node verify.js file.aot --number "X"               (characteristic number)
//     node verify.js file.aot --suggest                  (FCA: audit the tree against the concept lattice)

const fs = require("fs");
const path = require("path");
const { lint, gcd } = require("./src/linter");
const { suggest } = require("./src/fca");

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
    console.error("usage: node verify.js <file.aot> [--ask X Y | --genus X Y | --number X | --suggest]");
    process.exit(2);
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
  const v = errors.length;
  console.log(`\n${nodes.length} nodes, ${nodes.length} edges, largest prime ${nodes[nodes.length - 1].prime}, violations V = ${v}`);
  console.log(`subsumption: ${subsumption.edges} derived is-a edges, hierarchy ${subsumption.consistent ? "consistent" : "inconsistent"}`);
  console.log(`V = 0: ${v === 0 ? "true — the file verifies" : "FALSE"}`);
  process.exit(v ? 1 : 0);
}

main();
