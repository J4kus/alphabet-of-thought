// Arithmetic linting of .aot files, after Leibniz (1679).
//
// Every node receives a unique prime. A node's characteristic number is
// its prime multiplied by its parent's characteristic number, so the
// whole ancestry of an idea is encoded in one integer:
//
//     is-a        X is under Y         <=>  chi(Y) divides chi(X)
//     genus       nearest common kind   =   gcd(chi(X), chi(Y))
//     differentia what sets X apart     =   chi(X) / chi(genus)
//
// The file is valid if and only if the violation count V = 0.
//
// Shared by the CLI (verify.js) and the VS Code extension (extension.js).

const INDENT = 4;

// Node types as Said-of / Present-in bits: t = 2*S + P
const INDIVIDUAL = 0, DEFAULT = 1, CONCEPT = 2, ATTRIBUTE = 3, MAP = 4;
const TYPE_NAME = ["Individual", "Default Value", "Concept", "attribute", "Map"];

// One home for every finding. parse and verify both report through this,
// so no check has to know whether it produces an error or a warning until
// it calls error() or warn().
function makeReport() {
  const errors = [], warnings = [];
  return {
    errors, warnings,
    error: (line, message) => errors.push({ line, message }),
    warn: (line, message) => warnings.push({ line, message }),
  };
}

// A node's children that carry real content. Maps describe a node rather
// than divide it, so the structural checks skip them.
const realChildren = (node) => node.children.filter((c) => c.kind !== MAP);

function* primes() {
  const found = [];
  for (let n = 2; ; n++) {
    if (found.every((p) => n % p)) {
      found.push(n);
      yield BigInt(n);
    }
  }
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

// Return { kind, name, value } for one stripped line of content.
function classify(text) {
  if (text.startsWith("...")) return { kind: MAP, name: text.slice(3).trim(), value: null };
  if (text.startsWith("- ")) return { kind: INDIVIDUAL, name: text.slice(2).trim(), value: null };
  let value = null;
  const colon = text.indexOf(":");
  if (colon !== -1) {
    value = text.slice(colon + 1).trim();
    text = text.slice(0, colon).trim();
  }
  // trailing (alias) does not change identity
  if (text.endsWith(")") && text.includes("(")) {
    text = text.slice(0, text.lastIndexOf("(")).trim();
  }
  if (value !== null) return { kind: DEFAULT, name: text, value };
  if (text && text[0] >= "a" && text[0] <= "z") return { kind: ATTRIBUTE, name: text, value: null };
  return { kind: CONCEPT, name: text, value: null };
}

// Parse text into a tree rooted at the file name (without extension),
// reporting indentation and shape problems to the report.
function parse(text, rootName, report) {
  const root = {
    line: 0, depth: -1, kind: CONCEPT, name: rootName,
    value: null, parent: null, children: [],
  };
  const nodes = [];
  const stack = [root]; // stack[d + 1] is the last node seen at depth d
  let prevDepth = -1;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    let content = raw;
    if (!content.trim()) return;
    if (content.includes("\t")) {
      report.error(line, "tab character (4 spaces only)");
      content = content.replace(/\t/g, " ".repeat(INDENT));
    }
    const spaces = content.length - content.replace(/^ +/, "").length;
    if (spaces % INDENT) {
      report.error(line, `indent of ${spaces} spaces: ${spaces} mod ${INDENT} = ${spaces % INDENT}, expected 0`);
    }
    let depth = Math.floor(spaces / INDENT);
    if (depth - prevDepth > 1) {
      report.error(line, `depth jump ${prevDepth} -> ${depth}: ${depth} - ${prevDepth} > 1, no parent at depth ${depth - 1}`);
      depth = prevDepth + 1;
    }
    let trimmed = content.trim();
    if (trimmed[0] === "-" && !trimmed.startsWith("- ")) {
      report.error(line, `'${trimmed}' has 0 spaces after '-', expected 1 — an Individual must begin with '- ' (dash + space)`);
      trimmed = "- " + trimmed.slice(1);
    }
    const { kind, name, value } = classify(trimmed);
    if (kind === DEFAULT && !value) {
      report.error(line, `'${name}:' has 0 characters after ':', expected a value — supply one or drop the colon`);
    }
    const parent = stack[Math.min(depth, stack.length - 1)];
    const node = { line, depth, kind, name, value, parent, children: [] };
    parent.children.push(node);
    nodes.push(node);
    stack.length = depth + 1;
    stack.push(node);
    prevDepth = depth;
  });
  return { root, nodes };
}

// Assign primes and characteristic numbers: chi = prime * chi(parent).
function number(root, nodes) {
  const gen = primes();
  root.prime = gen.next().value;
  root.chi = root.prime;
  for (const node of nodes) {
    node.prime = gen.next().value;
    node.chi = node.prime * node.parent.chi;
  }
}

// Run the arithmetic checks, reporting errors and warnings to the report.
function verify(root, nodes, report) {
  const all = [root, ...nodes];

  // The file name is the root Concept; do not repeat it as a top-level line
  for (const child of root.children) {
    if (child.name === root.name) {
      report.error(child.line, `'${child.name}' repeats the file name: 2 primes for the root, expected 1 — the file name is the root Concept, begin with its children`);
    }
  }

  // Maps mark omitted information; they explain a node, so under a Map
  // only further Maps may appear, never real content
  for (const node of nodes) {
    if (node.kind === MAP) {
      const content = realChildren(node);
      if (content.length) {
        report.error(node.line, `Map '... ${node.name}' has ${content.length} non-Map children, expected 0 (a Map may only contain Maps)`);
      }
    }
  }

  // A Concept names one kind; 'and' joins two
  for (const node of nodes) {
    if (node.kind === CONCEPT && /\band\b/i.test(node.name)) {
      report.error(node.line, `Concept '${node.name}' contains 'and': 2 kinds under 1 prime, expected 1 — split it into two Concepts`);
    }
  }

  // Univocity: one Concept name, one prime
  const seen = new Map();
  for (const node of nodes) {
    if (node.kind === CONCEPT) {
      if (!seen.has(node.name)) seen.set(node.name, []);
      seen.get(node.name).push(node);
    }
  }
  for (const [name, defs] of seen) {
    if (defs.length > 1) {
      const where = defs.map((d) => d.line).join(", ");
      for (const def of defs.slice(1)) {
        report.error(def.line, `Concept '${name}' defined ${defs.length} times (lines ${where}): ${defs.length} primes for one term, expected 1 — add a distinguishing qualifier`);
      }
    }
  }

  // Ambiguity: identical siblings (same name AND same value) collapse meaning
  for (const node of all) {
    const groups = new Map();
    for (const child of realChildren(node)) {
      const key = `${child.kind} ${child.name} ${child.value}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    for (const dup of groups.values()) {
      if (dup.length > 1) {
        const where = dup.map((d) => d.line).join(", ");
        for (const d of dup.slice(1)) {
          report.error(d.line, `${TYPE_NAME[d.kind]} '${d.name}' repeated under '${node.name}' with the same value (lines ${where}) — siblings may share a slot only if default values differ`);
        }
      }
    }
  }

  // Single inheritance: gcd of any two siblings is exactly the parent
  for (const node of all) {
    const kids = realChildren(node);
    for (let i = 1; i < kids.length; i++) {
      if (gcd(kids[i - 1].chi, kids[i].chi) !== node.chi) {
        report.error(kids[i].line, `gcd(chi('${kids[i - 1].name}'), chi('${kids[i].name}')) != chi('${node.name}') — siblings do not share exactly one parent`);
      }
    }
  }

  // Always singular form: 'Person' not 'People'. A suffix heuristic, so a
  // warning: it catches 'Persons' and 'Categories', not irregulars.
  const looksPlural = (name) => {
    const last = name.split(/\s+/).pop().toLowerCase();
    return last.length >= 4 && last.endsWith("s") && !/(ss|us|is|os)$/.test(last);
  };
  for (const node of nodes) {
    if (node.kind === CONCEPT && looksPlural(node.name)) {
      report.warn(node.line, `Concept '${node.name}' appears plural: a Concept names 1 kind — use the singular form`);
    }
  }

  // Every measurement carries both a target and an actual value
  for (const node of all) {
    const defs = node.children.filter((c) => c.kind === DEFAULT);
    const actual = defs.find((c) => c.name === "actual");
    const target = defs.find((c) => c.name === "target");
    if (actual && !target) {
      report.warn(actual.line, `'${node.name}' has 'actual' without 'target': 1 of 2 measurement values — an actual without a target has no standard`);
    }
    if (target && !actual) {
      report.warn(target.line, `'${node.name}' has 'target' without 'actual': 1 of 2 measurement values — a target without an actual is potential`);
    }
  }

  // Child counts: more than one child of the same kind, and no more
  // than eight sub-Concepts. Sub-Concepts partition the parent, and a
  // division into more than eight kinds is not graspable at a glance;
  // Individuals (examples) and attributes may come in any quantity.
  // A lone child of the same kind divides nothing: a Concept with exactly
  // one sub-Concept, or an Individual with exactly one sub-Individual, is
  // that child. Children of other kinds describe the parent and don't count.
  // A Map child marks the node intentionally incomplete, so a lone child
  // under it is accepted: the missing siblings are declared, not forgotten.
  for (const node of nodes) {
    const kids = realChildren(node);
    const subConcepts = kids.filter((c) => c.kind === CONCEPT).length;
    if (subConcepts > 8) {
      report.warn(node.line, `'${node.name}' has ${subConcepts} sub-Concepts, expected no more than eight — group some under an intermediate kind (Individuals and attributes may be any quantity)`);
    }
    if (node.children.some((c) => c.kind === MAP)) continue;
    if (node.kind === CONCEPT && subConcepts === 1) {
      report.warn(node.line, `'${node.name}' has 1 sub-Concept, expected 0 or more than one — a kind with one subtype is the subtype`);
    }
    if (node.kind === INDIVIDUAL && kids.filter((c) => c.kind === INDIVIDUAL).length === 1) {
      report.warn(node.line, `'${node.name}' has 1 sub-Individual, expected 0 or more than one — an individual with one sub-individual is the sub-individual`);
    }
  }
}

// Full lint pass over a document's text. Returns the numbered tree along
// with errors and warnings as { line, message } (lines are 1-based).
function lint(text, rootName) {
  const report = makeReport();
  const { root, nodes } = parse(text, rootName, report);
  number(root, nodes);
  verify(root, nodes, report);
  const byLine = (a, b) => a.line - b.line;
  return { root, nodes, errors: report.errors.sort(byLine), warnings: report.warnings.sort(byLine) };
}

module.exports = {
  lint, parse, number, verify, gcd, INDENT,
  KIND: { INDIVIDUAL, DEFAULT, CONCEPT, ATTRIBUTE, MAP },
};
