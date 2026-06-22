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

// Whether a node asserts an ATTRIBUTE of its OWN: an attribute or default value
// it declares. A substance node that asserts none has an implied `...` — with
// nothing of its own yet to tell it apart, its differentia is still to come —
// exactly as the differentia check in linter.js reads an empty slot signature.
// An inline Example (a capitalised line's `: value`, e.g. `Run Command: code
// ...`) is content, not an attribute: it is materialised as an Example child
// and never enters G, so a Concept carrying only an inline Example asserts no
// slot G can compare — two such Concepts would clash on inherited columns alone
// while their inline Examples plainly differ, a false clash. They are excused,
// just as a bare `- Example` with no attributes is. Inherited attributes (which
// still drive G) do not count: they are the genus, shared by every sibling,
// never a differentia.
const assertsOwnSlot = (n) =>
  n.children.some((c) => c.kind === ATTRIBUTE || c.kind === DEFAULT);

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
// editor hint does) while the CLI reports both. Nodes that assert no attribute
// of their own (an implied `...`, even when they inherit attributes that make G
// match a sibling's), and `...`-Map-marked nodes (intentionally incomplete),
// are skipped — as the differentia/FCA/subsumption checks do.
function clashes(root, nodes) {
  const { attrPrime } = buildGodel(root, nodes);
  const primeList = [...attrPrime.values()];
  const eligible = [root, ...nodes].filter(
    (n) =>
      isSubstance(n) &&
      n.godel > 1n &&
      assertsOwnSlot(n) &&
      !n.children.some((c) => c.kind === MAP),
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
          message: `clash: '${display(a)}' and '${display(b)}' carry identical attributes and values — nothing in the data tells them apart, so they are one idea written twice; give one a differentia (a distinguishing attribute or value), or merge them (G = ${a.godel})`,
        });
      } else if (rad(a) === rad(b)) {
        findings.push({
          line,
          kind: "names",
          message: `clash: '${display(a)}' and '${display(b)}' have the same attribute names and differ only in their values — check that the values alone are meant to tell them apart (same radical)`,
        });
      }
    }
  }
  findings.sort((x, y) => x.line - y.line);
  return { findings };
}

module.exports = {
  buildGodel, clashes, gather, assignTables, applyGodel,
  valuation, radical, lcm, isSubstance,
};
