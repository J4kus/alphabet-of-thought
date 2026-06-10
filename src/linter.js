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

// Parse text into a tree rooted at the file name (without extension).
function parse(text, rootName) {
  const errors = [];
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
      errors.push({ line, message: "tab character (4 spaces only)" });
      content = content.replace(/\t/g, " ".repeat(INDENT));
    }
    const spaces = content.length - content.replace(/^ +/, "").length;
    if (spaces % INDENT) {
      errors.push({ line, message: `indent of ${spaces} spaces: ${spaces} mod ${INDENT} = ${spaces % INDENT}, expected 0` });
    }
    let depth = Math.floor(spaces / INDENT);
    if (depth - prevDepth > 1) {
      errors.push({ line, message: `depth jump ${prevDepth} -> ${depth}: ${depth} - ${prevDepth} > 1, no parent at depth ${depth - 1}` });
      depth = prevDepth + 1;
    }
    const { kind, name, value } = classify(content.trim());
    const parent = stack[Math.min(depth, stack.length - 1)];
    const node = { line, depth, kind, name, value, parent, children: [] };
    parent.children.push(node);
    nodes.push(node);
    stack.length = depth + 1;
    stack.push(node);
    prevDepth = depth;
  });
  return { root, nodes, errors };
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

// Run the arithmetic checks. Appends to errors, returns warnings.
function verify(root, nodes, errors) {
  const warnings = [];
  const all = [root, ...nodes];

  // Maps mark omitted information; they explain a node, they have no children
  for (const node of nodes) {
    if (node.kind === MAP && node.children.length) {
      errors.push({ line: node.line, message: `Map '... ${node.name}' has ${node.children.length} children, expected 0 (a Map is a leaf)` });
    }
  }

  // A Concept names one kind; 'and' joins two
  for (const node of nodes) {
    if (node.kind === CONCEPT && /\band\b/i.test(node.name)) {
      errors.push({ line: node.line, message: `Concept '${node.name}' contains 'and': 2 kinds under 1 prime, expected 1 — split it into two Concepts` });
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
        errors.push({ line: def.line, message: `Concept '${name}' defined ${defs.length} times (lines ${where}): ${defs.length} primes for one term, expected 1 — add a distinguishing qualifier` });
      }
    }
  }

  // Ambiguity: identical siblings (same name AND same value) collapse meaning
  for (const node of all) {
    const groups = new Map();
    for (const child of node.children) {
      if (child.kind === MAP) continue;
      const key = `${child.kind} ${child.name} ${child.value}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    for (const dup of groups.values()) {
      if (dup.length > 1) {
        const where = dup.map((d) => d.line).join(", ");
        for (const d of dup.slice(1)) {
          errors.push({ line: d.line, message: `${TYPE_NAME[d.kind]} '${d.name}' repeated under '${node.name}' with the same value (lines ${where}) — siblings may share a slot only if default values differ` });
        }
      }
    }
  }

  // Single inheritance: gcd of any two siblings is exactly the parent
  for (const node of all) {
    const kids = node.children.filter((c) => c.kind !== MAP);
    for (let i = 1; i < kids.length; i++) {
      if (gcd(kids[i - 1].chi, kids[i].chi) !== node.chi) {
        errors.push({ line: kids[i].line, message: `gcd(chi('${kids[i - 1].name}'), chi('${kids[i].name}')) != chi('${node.name}') — siblings do not share exactly one parent` });
      }
    }
  }

  // Child counts: more than one child, no more than twelve
  for (const node of nodes) {
    const kids = node.children.filter((c) => c.kind !== MAP);
    if (kids.length === 1) {
      warnings.push({ line: node.line, message: `'${node.name}' has 1 child, expected more than one — a kind with one subtype is the subtype` });
    }
    if (kids.length > 12) {
      warnings.push({ line: node.line, message: `'${node.name}' has ${kids.length} children, expected no more than twelve` });
    }
  }
  return warnings;
}

// Full lint pass over a document's text. Returns the numbered tree along
// with errors and warnings as { line, message } (lines are 1-based).
function lint(text, rootName) {
  const { root, nodes, errors } = parse(text, rootName);
  number(root, nodes);
  const warnings = verify(root, nodes, errors);
  const byLine = (a, b) => a.line - b.line;
  return { root, nodes, errors: errors.sort(byLine), warnings: warnings.sort(byLine) };
}

module.exports = { lint, parse, number, verify, gcd, INDENT };
