// Gödel numbering over a parsed .aot tree, after Gödel (1931) and Leibniz.
//
// The prime/divisibility numbering in linter.js (chi = prime * chi(parent))
// encodes only a node's ANCESTRY — where the line sits — as a squarefree
// product. This module adds a second, complementary integer that encodes the
// line's CONTENT: a Gödel number G(n) in which primes are raised to POWERS.
//
//     one prime per attribute name      (the slot)
//     its exponent encodes the value    (the symbol in the slot)
//         exponent 0   the attribute is absent (the prime does not divide G)
//         exponent 1   the attribute is present but unvalued
//         exponent k>1   the attribute is set to a value, k a stable code
//
//     G(n) = product over attributes a of  prime(a) ^ code_a(n)
//                                                       = 2^3 * 3^5 * 5^2 ...
//
// chi answers "where"; G answers "what". Together the two cover both axes of a
// line. What G buys, all as plain arithmetic on big integers:
//
//     present        attribute a is on n          prime(a) divides G(n)
//     same names     n, m carry the same attrs    radical(G(n)) == radical(G(m))
//     subset         n's attrs are a subset of m's radical(G(n)) | radical(G(m))
//     clash          n, m are content-identical    G(n) == G(m)
//     value of a     decode the slot               valuation(G(n), prime(a))
//     override       n redeclares an inherited     v_p(G(n)), v_p(G(anc)) both
//                    default with a new value       >= 2 and unequal
//     diff           version-to-version change     compare factorisations
//
// The feature universe (attribute names, with crosslinked Concept names folded
// in) and the override-aware "nearest value wins" walk mirror fca.buildContext
// exactly, so G and the FCA context agree on what a node carries. Pure: no I/O,
// depends only on ./linter and ./crosslinks.

const { KIND, primes, gcd } = require("./linter");
const { index, wordStarts, instantiates } = require("./crosslinks");
const { INDIVIDUAL, DEFAULT, CONCEPT, ATTRIBUTE, MAP } = KIND;

// gcd takes the min exponent per prime (the content two numbers agree on);
// lcm takes the max (their merge).
function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}

const keyOf = (text) => text.trim().toLowerCase();
const isSubstance = (n) => n.kind === CONCEPT || n.kind === INDIVIDUAL;
const display = (n) => (n.kind === INDIVIDUAL ? `- ${n.name}` : n.name);

// The exponent of prime p in g (its p-adic valuation): how many times p
// divides g. 0 when p does not divide g.
function valuation(g, p) {
  let v = 0n;
  if (g <= 0n) return v;
  while (g % p === 0n) {
    g /= p;
    v++;
  }
  return v;
}

// The radical of g over a known set of feature primes: the product of the
// distinct primes that divide it, exponents stripped. Two nodes share an
// attribute-name set exactly when their radicals are equal.
function radical(g, primeList) {
  let r = 1n;
  for (const p of primeList) if (g % p === 0n) r *= p;
  return r;
}

// The longest trailing run of a node's name words that names a Concept
// (attribute-is-a-Concept), as in crosslinks.js / fca.js.
function conceptOf(node, concepts) {
  for (const start of wordStarts(node.name)) {
    const target = concepts.get(node.name.slice(start).toLowerCase());
    if (target && target !== node) return target;
  }
  return null;
}

// The override-aware effective features of a substance node: every attribute
// name it carries (its own and inherited, plus the Concepts those attributes
// crosslink to) and, for each, the value of its nearest value-assigning
// declaration. A bare attribute contributes its name but no value, so an
// ancestor's default still wins — the same rule fca.buildContext applies.
function effFeatures(node, concepts) {
  const names = new Set(); // attrKey present (name or crosslinked Concept)
  const valueByAttr = new Map(); // attrKey -> nearest declared value string
  const valued = new Set();
  for (let n = node; n; n = n.parent) {
    for (const child of n.children) {
      if (child.kind !== ATTRIBUTE && child.kind !== DEFAULT) continue;
      const aKey = keyOf(child.name);
      names.add(aKey);
      const type = conceptOf(child, concepts);
      if (type && type !== child) names.add(keyOf(type.name));
      if (child.kind !== DEFAULT) continue;
      if (valued.has(aKey)) continue; // a nearer declaration already won
      valued.add(aKey);
      valueByAttr.set(aKey, child.value);
    }
  }
  return { names, valueByAttr };
}

// Gather per-node features and the raw material for the global tables, without
// assigning primes yet — so a version diff can pool two documents first.
function gather(root, nodes) {
  const { concepts } = index(root, nodes);
  const substances = [root, ...nodes].filter(isSubstance);
  const featByNode = new Map();
  const allAttrKeys = new Set();
  const valuesByAttr = new Map(); // attrKey -> Set(value strings)
  const naming = new Map(); // attrKey -> original-cased display, first seen
  for (const n of substances) {
    const f = effFeatures(n, concepts);
    featByNode.set(n, f);
    for (const a of f.names) allAttrKeys.add(a);
    for (const [a, v] of f.valueByAttr) {
      allAttrKeys.add(a);
      if (!valuesByAttr.has(a)) valuesByAttr.set(a, new Set());
      valuesByAttr.get(a).add(v);
    }
  }
  // remember a readable label for each key from the declarations themselves
  for (const n of [root, ...nodes]) {
    for (const child of n.children) {
      if (child.kind === ATTRIBUTE || child.kind === DEFAULT) {
        const k = keyOf(child.name);
        if (!naming.has(k)) naming.set(k, child.name.trim());
      }
    }
  }
  return { substances, featByNode, allAttrKeys, valuesByAttr, naming };
}

// Assign a prime to every attribute key and a code (>= 2) to every value, both
// in sorted order so the numbers are reproducible across runs and files.
function assignTables(allAttrKeys, valuesByAttr) {
  const attrPrime = new Map();
  const gen = primes();
  for (const a of [...allAttrKeys].sort()) attrPrime.set(a, gen.next().value);
  const valueCode = new Map(); // attrKey -> Map(value -> BigInt code)
  for (const [a, vs] of valuesByAttr) {
    const m = new Map();
    let code = 2;
    for (const v of [...vs].sort()) m.set(v, BigInt(code++));
    valueCode.set(a, m);
  }
  return { attrPrime, valueCode };
}

// Set node.godel for every gathered substance node from the shared tables.
function applyGodel(featByNode, attrPrime, valueCode) {
  for (const [n, f] of featByNode) {
    let g = 1n;
    for (const a of f.names) {
      const p = attrPrime.get(a);
      const code = f.valueByAttr.has(a)
        ? valueCode.get(a).get(f.valueByAttr.get(a))
        : 1n;
      g *= p ** code;
    }
    n.godel = g;
  }
}

// Build the Gödel numbers for one document. Sets node.godel on every Concept
// and Example (and the root) and returns the tables for decoding/queries.
function buildGodel(root, nodes) {
  const { substances, featByNode, allAttrKeys, valuesByAttr, naming } = gather(root, nodes);
  const { attrPrime, valueCode } = assignTables(allAttrKeys, valuesByAttr);
  applyGodel(featByNode, attrPrime, valueCode);
  return { attrPrime, valueCode, naming, substances, featByNode };
}

// Reverse a value code back to its string for one attribute (1 -> unvalued).
function valueOfCode(aKey, code, valueCode) {
  if (code === 1n) return "(unvalued)";
  const table = valueCode.get(aKey);
  if (table) for (const [v, c] of table) if (c === code) return v;
  return `?${code}`;
}

// Decode any Gödel number into its slots: [{ attr, value, prime, exponent }]
// for every attribute the number carries, sorted by attribute label.
function decodeNumber(g, attrPrime, valueCode, naming) {
  const out = [];
  for (const [aKey, p] of attrPrime) {
    const e = valuation(g, p);
    if (e === 0n) continue;
    out.push({
      attr: (naming && naming.get(aKey)) || aKey,
      value: valueOfCode(aKey, e, valueCode),
      prime: p,
      exponent: e,
    });
  }
  out.sort((a, b) => a.attr.localeCompare(b.attr));
  return out;
}

// Decode a node's number (its content).
function decode(node, attrPrime, valueCode, naming) {
  return decodeNumber(node.godel, attrPrime, valueCode, naming);
}

// The number of feature primes on which two numbers disagree: a content
// distance (Hamming over the attribute slots).
function distance(a, b, primeList) {
  let d = 0;
  for (const p of primeList) if (valuation(a, p) !== valuation(b, p)) d++;
  return d;
}

const isAncestor = (a, c) => {
  for (let p = c.parent; p; p = p.parent) if (p === a) return true;
  return false;
};
const related = (a, b) => a === b || isAncestor(a, b) || isAncestor(b, a);

// Two distinct, unrelated substance nodes that carry the same attributes are a
// clash. Reported in two strengths: identical full content (G equal) is a
// stronger finding than a shared attribute-name set with differing values
// (equal radicals). Each finding is tagged kind: "content" | "names" so a
// caller can surface only the strong, content-identical clashes (the always-on
// editor hint does) while the CLI reports both. Nodes with no attributes, and
// `...`-Map-marked nodes (intentionally incomplete), are skipped — as the
// FCA/subsumption checks do.
function clashes(root, nodes) {
  const { attrPrime } = buildGodel(root, nodes);
  const primeList = [...attrPrime.values()];
  const eligible = [root, ...nodes].filter(
    (n) => isSubstance(n) && n.godel > 1n && !n.children.some((c) => c.kind === MAP),
  );
  const radCache = new Map();
  const rad = (n) => {
    if (!radCache.has(n)) radCache.set(n, radical(n.godel, primeList));
    return radCache.get(n);
  };
  const findings = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i], b = eligible[j];
      if (related(a, b)) continue;
      const line = Math.max(a.line, b.line);
      if (a.godel === b.godel) {
        findings.push({
          line,
          kind: "content",
          message: `clash: '${display(a)}' and '${display(b)}' carry identical attributes and values (G = ${a.godel}) — the data cannot tell them apart: give one a differentia, or merge them`,
        });
      } else if (rad(a) === rad(b)) {
        findings.push({
          line,
          kind: "names",
          message: `clash: '${display(a)}' and '${display(b)}' carry the same attribute names, differing only in values (same radical) — confirm the values alone are meant to distinguish them`,
        });
      }
    }
  }
  findings.sort((x, y) => x.line - y.line);
  return { findings };
}

// Every node that overrides an inherited default: an attribute it values
// differently from the nearest substance ancestor that already values it.
// Detected arithmetically — both p-adic valuations are >= 2 and unequal.
function overrides(root, nodes) {
  const { attrPrime, valueCode, naming } = buildGodel(root, nodes);
  const findings = [];
  for (const n of nodes) {
    if (!isSubstance(n)) continue;
    let anc = n.parent;
    while (anc && anc.godel === undefined) anc = anc.parent;
    if (!anc) continue;
    for (const [aKey, p] of attrPrime) {
      const vn = valuation(n.godel, p);
      const va = valuation(anc.godel, p);
      if (vn >= 2n && va >= 2n && vn !== va) {
        const label = naming.get(aKey) || aKey;
        findings.push({
          line: n.line,
          message: `override: '${display(n)}' sets '${label}' to '${valueOfCode(aKey, vn, valueCode)}', overriding the inherited '${valueOfCode(aKey, va, valueCode)}'`,
        });
      }
    }
  }
  findings.sort((x, y) => x.line - y.line);
  return { findings };
}

// Version diff as factorisation comparison. Pool both documents into one
// shared table, number both, then match substance nodes by their ancestry path
// and report per-node deltas: an attribute added or removed is a prime that
// appears in one factorisation and not the other; a changed value is the same
// prime with a different exponent.
function pathOf(node) {
  const parts = [];
  for (let n = node; n; n = n.parent) parts.push(n.name);
  return parts.reverse().join(" < ");
}

function diff(rootA, nodesA, rootB, nodesB) {
  const A = gather(rootA, nodesA), B = gather(rootB, nodesB);
  const allAttrKeys = new Set([...A.allAttrKeys, ...B.allAttrKeys]);
  const valuesByAttr = new Map();
  for (const src of [A, B]) {
    for (const [a, vs] of src.valuesByAttr) {
      if (!valuesByAttr.has(a)) valuesByAttr.set(a, new Set());
      for (const v of vs) valuesByAttr.get(a).add(v);
    }
  }
  const naming = new Map([...A.naming, ...B.naming]);
  const { attrPrime, valueCode } = assignTables(allAttrKeys, valuesByAttr);
  applyGodel(A.featByNode, attrPrime, valueCode);
  applyGodel(B.featByNode, attrPrime, valueCode);

  const byPathA = new Map(), byPathB = new Map();
  for (const n of A.substances) byPathA.set(pathOf(n), n);
  for (const n of B.substances) byPathB.set(pathOf(n), n);

  const findings = [];
  const paths = new Set([...byPathA.keys(), ...byPathB.keys()]);
  for (const path of [...paths].sort()) {
    const a = byPathA.get(path), b = byPathB.get(path);
    if (a && !b) {
      findings.push({ message: `removed: ${path}` });
      continue;
    }
    if (b && !a) {
      findings.push({ message: `added: ${path}` });
      continue;
    }
    if (a.godel === b.godel) continue;
    const changes = [];
    for (const [aKey, p] of attrPrime) {
      const va = valuation(a.godel, p), vb = valuation(b.godel, p);
      if (va === vb) continue;
      const label = naming.get(aKey) || aKey;
      if (va === 0n) changes.push(`+ '${label}' = '${valueOfCode(aKey, vb, valueCode)}'`);
      else if (vb === 0n) changes.push(`- '${label}'`);
      else changes.push(`~ '${label}': '${valueOfCode(aKey, va, valueCode)}' -> '${valueOfCode(aKey, vb, valueCode)}'`);
    }
    if (changes.length) findings.push({ message: `changed: ${path}\n    ${changes.join("\n    ")}` });
  }
  return { findings };
}

// Query by example: every substance node whose content satisfies a partial
// spec, by one divisibility test. Each term is either a bare attribute name
// (present, any value) or `attribute: value` (that exact value). The terms are
// multiplied into a single query number Q; a node matches iff Q divides G(n)
// for the name parts and each valued term's exponent matches exactly. Returns
// { matches, unknown } — unknown lists terms naming an attribute or value the
// document never declares.
function find(root, nodes, terms) {
  const { attrPrime, valueCode } = buildGodel(root, nodes);
  const wants = []; // { prime, exponent|null }
  const unknown = [];
  for (const raw of terms) {
    const colon = raw.indexOf(":");
    const name = (colon === -1 ? raw : raw.slice(0, colon)).trim();
    const value = colon === -1 ? null : raw.slice(colon + 1).trim();
    const p = attrPrime.get(name.toLowerCase());
    if (!p) {
      unknown.push(raw);
      continue;
    }
    if (value === null) {
      wants.push({ prime: p, exponent: null });
    } else {
      const code = valueCode.get(name.toLowerCase()) && valueCode.get(name.toLowerCase()).get(value);
      if (!code) {
        unknown.push(raw);
        continue;
      }
      wants.push({ prime: p, exponent: code });
    }
  }
  // an all-unknown query constrains nothing; do not let `every` match the world
  const matches = wants.length
    ? [root, ...nodes].filter((n) =>
        isSubstance(n) && wants.every((w) =>
          w.exponent === null ? n.godel % w.prime === 0n : valuation(n.godel, w.prime) === w.exponent))
    : [];
  return { matches, unknown };
}

// The content two nodes share: every attribute they both carry *at the same
// value* (a value-aware genus). Built prime by prime — a prime is kept only when
// its exponent is equal and non-zero in both numbers, so an attribute one omits,
// or both set to different values, drops out. (Raw gcd would keep the smaller
// code of two differing values, conflating disagreement with agreement.)
function common(root, nodes, x, y) {
  const { attrPrime, valueCode, naming } = buildGodel(root, nodes);
  let g = 1n;
  for (const p of attrPrime.values()) {
    const vx = valuation(x.godel, p), vy = valuation(y.godel, p);
    if (vx >= 1n && vx === vy) g *= p ** vx;
  }
  return { number: g, slots: decodeNumber(g, attrPrime, valueCode, naming) };
}

// The k nearest substance nodes to x by content distance, with the slots that
// differ. Excludes x and the root.
function near(root, nodes, x, k = 5) {
  const { attrPrime, valueCode, naming } = buildGodel(root, nodes);
  const primeList = [...attrPrime.values()];
  const ranked = [root, ...nodes]
    .filter((n) => isSubstance(n) && n !== x && n !== root && n.godel !== undefined)
    .map((n) => ({ node: n, dist: distance(x.godel, n.godel, primeList) }))
    .sort((a, b) => a.dist - b.dist || a.node.line - b.node.line)
    .slice(0, k);
  for (const r of ranked) {
    r.diff = [];
    for (const [aKey, p] of attrPrime) {
      const vx = valuation(x.godel, p), vn = valuation(r.node.godel, p);
      if (vx === vn) continue;
      const label = (naming.get(aKey) || aKey);
      if (vx === 0n) r.diff.push(`+ ${label}: ${valueOfCode(aKey, vn, valueCode)}`);
      else if (vn === 0n) r.diff.push(`- ${label}`);
      else r.diff.push(`~ ${label}: ${valueOfCode(aKey, vx, valueCode)} | ${valueOfCode(aKey, vn, valueCode)}`);
    }
  }
  return ranked;
}

module.exports = {
  buildGodel, clashes, overrides, diff, find, common, near,
  decode, decodeNumber, gather, assignTables, applyGodel,
  valuation, radical, distance, lcm, valueOfCode, pathOf, isSubstance,
};
