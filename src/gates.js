// The gates a verdict on one file goes through, shared by verify.js and check.js
// so the two commands cannot drift apart, and matching the extension's analyse().
//
// The FCA audit (drift / exhaustion) and the content-identical Gödel clash are
// errors counted in V; the inferred functional dependencies are warnings (not
// counted in V). All of them mean nothing over a tree that does not yet verify,
// so they run only once the syntactic/subsumption pass is clean. The content
// clash surfaces only the strong case; `--clashes` reports both strengths, `--fd`
// the full set of inferred dependencies.
//
// Nothing here runs a formula. It reads what a file says: python.js is required
// for the pure part that counts formulas, and never given a way to start one.

const fs = require("fs");
const path = require("path");
const { lint, KIND } = require("./linter");
const { suggest } = require("./fca");
const godel = require("./godel");
const armstrong = require("./armstrong");
const python = require("./python");

// past this many Examples the lattice is no longer cheap; matches the extension
const MAX_FCA_OBJECTS = 200;

// What a file over the limit loses, said where it can be seen: without this, one
// long table quietly switches off the row-level checks for the whole file.
const rowLimitNote = (rows) => `move the long table into a file of its own to bring these back — this file has ${rows.toLocaleString("en-US")} rows, and misfiled rows, overlaps and gaps are only checked in a file of up to ${MAX_FCA_OBJECTS}`;

function judge(text, rootName) {
  const { root, nodes, errors, warnings, subsumption } = lint(text, rootName);
  let deepErrors = [];
  let depWarnings = [];
  const notes = [];
  if (!errors.length) {
    const objects = nodes.filter((n) => n.kind === KIND.INDIVIDUAL).length;
    if (objects >= 2 && objects <= MAX_FCA_OBJECTS) {
      deepErrors = suggest(root, nodes).findings;
      depWarnings = armstrong.findings(root, nodes).filter((f) => f.confidence >= armstrong.MIN_CONFIDENCE && !f.incomplete && !f.implied);
    } else if (objects > MAX_FCA_OBJECTS) {
      notes.push({ line: 1, message: rowLimitNote(objects) });
    }
    deepErrors = deepErrors.concat(godel.clashes(root, nodes).findings.filter((f) => f.kind === "content"));
    // a value every child states belongs on the parent; a default every
    // child overrides is in force for nothing — warnings, as in the editor
    depWarnings = depWarnings.concat(godel.hoists(root, nodes));
  }
  return { root, nodes, errors, warnings, subsumption, deepErrors, depWarnings, notes };
}

// How many formulas and rules a file carries that a check of its text alone says
// nothing about: { formulas, rules }.
function uncalculated(nodes, lines, rootName) {
  return {
    formulas: python.calcHosts(nodes, lines, rootName).length,
    rules: nodes.filter((n) => n.kind === KIND.ATTRIBUTE && n.constraints && n.constraints.some((c) => c.op !== "==")).length,
  };
}

// Every .aot under `dir`, skipping the noise directories.
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

module.exports = { MAX_FCA_OBJECTS, rowLimitNote, judge, uncalculated, walkAot, repoRootOf };
