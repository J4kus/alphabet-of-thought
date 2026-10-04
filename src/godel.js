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
// depends only on ./linter, ./crosslinks and ./table (for name folding).

const { KIND, primes, gcd } = require("./linter");
const { index, wordStarts, instantiates } = require("./crosslinks");
const { numberless } = require("./table");
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
//
// Also where each came from, for a reader (the hover): `fromByAttr` is the
// declaration that won each attribute — the value's own, else the nearest
// that names it — and `via` the attribute a crosslinked Concept name came
// in through. Neither changes what G is.
function effFeatures(node, concepts) {
  const names = new Set(); // attrKey present (name or crosslinked Concept)
  const valueByAttr = new Map(); // attrKey -> nearest declared value string
  const fromByAttr = new Map(); // attrKey -> the declaration it came from
  const via = new Map(); // crosslinked Concept key -> the attribute it came through
  const valued = new Set();
  for (let n = node; n; n = n.parent) {
    for (const child of n.children) {
      if (child.kind !== ATTRIBUTE && child.kind !== DEFAULT) continue;
      const aKey = keyOf(child.name);
      names.add(aKey);
      if (!fromByAttr.has(aKey)) fromByAttr.set(aKey, child);
      const type = conceptOf(child, concepts);
      if (type && type !== child) {
        const tKey = keyOf(type.name);
        names.add(tKey);
        if (!via.has(tKey)) via.set(tKey, child);
      }
      if (child.kind !== DEFAULT) continue;
      if (valued.has(aKey)) continue; // a nearer declaration already won
      valued.add(aKey);
      valueByAttr.set(aKey, child.value);
      fromByAttr.set(aKey, child); // the value's own declaration is its source
    }
  }
  return { names, valueByAttr, fromByAttr, via };
}

// Gather per-node features and the raw material for the global tables, without
// assigning primes yet — so a version diff can pool two documents first.
//
// Cached per parse: a tree is never changed after parsing (only its chi and
// godel fields are written), so the same nodes array gathers the same way,
// and numbering the whole workspace on every keystroke costs only the files
// that changed.
const gatherCache = new WeakMap();
function gather(root, nodes) {
  const hit = gatherCache.get(nodes);
  if (hit && hit.root === root) return hit.data;
  const data = gatherFresh(root, nodes);
  gatherCache.set(nodes, { root, data });
  return data;
}

function gatherFresh(root, nodes) {
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
//
// With a `registry` ({ attrs: Map(key -> prime), values: Map(key ->
// Map(value -> code)) }, see parseRegistry) the numbers are stable instead:
// every attribute and value already in it keeps its number, new attributes
// take the next primes it does not hold, and new values the next codes
// their attribute has free — so adding an unrelated attribute renumbers
// nothing, and two files, or two branches, number one attribute alike.
// Answers the tables limited to these keys, and with a registry the
// extended registry and whether it grew.
function assignTables(allAttrKeys, valuesByAttr, registry) {
  if (registry) return assignFromRegistry(allAttrKeys, valuesByAttr, registry);
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

function assignFromRegistry(allAttrKeys, valuesByAttr, registry) {
  const attrs = new Map(registry.attrs || []);
  const values = new Map([...(registry.values || [])].map(([a, m]) => [a, new Map(m)]));
  let grown = false;
  const taken = new Set([...attrs.values()].map(String));
  const gen = primes();
  const nextPrime = () => {
    for (;;) {
      const p = gen.next().value;
      if (!taken.has(String(p))) { taken.add(String(p)); return p; }
    }
  };
  for (const a of [...allAttrKeys].sort()) {
    if (!attrs.has(a)) { attrs.set(a, nextPrime()); grown = true; }
  }
  for (const [a, vs] of valuesByAttr) {
    if (!values.has(a)) values.set(a, new Map());
    const m = values.get(a);
    const used = new Set([...m.values()].map(String));
    let code = 2n;
    for (const v of [...vs].sort()) {
      if (m.has(v)) continue;
      while (used.has(String(code))) code++;
      m.set(v, code);
      used.add(String(code));
      grown = true;
    }
  }
  const attrPrime = new Map([...allAttrKeys].sort().map((a) => [a, attrs.get(a)]));
  const valueCode = new Map();
  for (const [a, vs] of valuesByAttr) valueCode.set(a, new Map([...vs].map((v) => [v, values.get(a).get(v)])));
  return { attrPrime, valueCode, registry: { attrs, values }, grown };
}

// One numbering over several documents: each gathered, the universes
// unioned, the tables assigned once, and every document numbered from them —
// so a Concept's G means the same in every file. `docs` is [{ root, nodes }].
// Answers the tables (and, with a registry, the extended one and `grown`),
// the shared `naming`, and each document's gathering in order.
function pool(docs, registry) {
  const gathered = docs.map((d) => gather(d.root, d.nodes));
  const allAttrKeys = new Set();
  const valuesByAttr = new Map();
  const naming = new Map();
  for (const g of gathered) {
    for (const a of g.allAttrKeys) allAttrKeys.add(a);
    for (const [a, vs] of g.valuesByAttr) {
      if (!valuesByAttr.has(a)) valuesByAttr.set(a, new Set());
      for (const v of vs) valuesByAttr.get(a).add(v);
    }
    for (const [k, label] of g.naming) if (!naming.has(k)) naming.set(k, label);
  }
  const tables = assignTables(allAttrKeys, valuesByAttr, registry);
  for (const g of gathered) applyGodel(g.featByNode, tables.attrPrime, tables.valueCode);
  return Object.assign({ naming, gathered }, tables);
}

// --- the registry: aot.files/godel.tsv --------------------------------------
// One record per line, tab-separated, sorted by prime and then code so a
// diff of it stays small and git's union merge keeps both sides' additions:
//
//     a<TAB>legs<TAB>2               an attribute's prime
//     v<TAB>legs<TAB>3<TAB>4         a value's code (the value is the rest)
//
// No file stores G, so the registry may be deleted at any time: the numbers
// are rebuilt, only differently. The parser repairs what a merge can leave:
// conflict markers are skipped, an attribute listed with two primes keeps
// the smaller, and a prime (or a code) claimed twice goes to the name that
// sorts first — the other takes a fresh number on the next assignment.

const REGISTRY_HEADER = "# Gödel numbering kept by the AOT extension: a prime per attribute, a code per value, "
  + "stable across edits, files and branches. Safe to delete — it is rebuilt on the next save, with new numbers.";

function isSmallPrime(p) {
  if (p < 2n) return false;
  for (let d = 2n; d * d <= p; d++) if (p % d === 0n) return false;
  return true;
}

function parseRegistry(text) {
  const attrs = new Map();
  const values = new Map();
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (!raw || raw.startsWith("#") || /^(<{7}|={7}|>{7}|\|{7})/.test(raw)) continue;
    const parts = raw.split("\t");
    if (parts[0] === "a" && parts.length >= 3 && parts[1] && /^\d+$/.test(parts[2])) {
      const p = BigInt(parts[2]);
      if (!isSmallPrime(p)) continue;
      const had = attrs.get(parts[1]);
      if (had === undefined || p < had) attrs.set(parts[1], p);
    } else if (parts[0] === "v" && parts.length >= 4 && parts[1] && /^\d+$/.test(parts[2])) {
      const code = BigInt(parts[2]);
      if (code < 2n) continue;
      const value = parts.slice(3).join("\t");
      if (!values.has(parts[1])) values.set(parts[1], new Map());
      const m = values.get(parts[1]);
      if (!m.has(value) || code < m.get(value)) m.set(value, code);
    }
  }
  const byPrime = new Set();
  for (const key of [...attrs.keys()].sort()) {
    const p = String(attrs.get(key));
    if (byPrime.has(p)) attrs.delete(key); else byPrime.add(p);
  }
  for (const m of values.values()) {
    const byCode = new Set();
    for (const v of [...m.keys()].sort()) {
      const c = String(m.get(v));
      if (byCode.has(c)) m.delete(v); else byCode.add(c);
    }
  }
  return { attrs, values };
}

function formatRegistry(registry) {
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const attrs = [...registry.attrs].sort((x, y) => cmp(x[1], y[1]) || x[0].localeCompare(y[0]));
  const out = [REGISTRY_HEADER];
  for (const [key, p] of attrs) out.push(`a\t${key}\t${p}`);
  const order = [...attrs.map(([key]) => key), ...[...registry.values.keys()].filter((k) => !registry.attrs.has(k)).sort()];
  for (const key of order) {
    const m = registry.values.get(key);
    if (!m) continue;
    for (const [value, code] of [...m].sort((x, y) => cmp(x[1], y[1]))) out.push(`v\t${key}\t${code}\t${value}`);
  }
  return out.join("\n") + "\n";
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
// `registry` (optional) makes the numbers stable (assignTables).
function buildGodel(root, nodes, registry) {
  const { substances, featByNode, allAttrKeys, valuesByAttr, naming } = gather(root, nodes);
  const tables = assignTables(allAttrKeys, valuesByAttr, registry);
  applyGodel(featByNode, tables.attrPrime, tables.valueCode);
  return Object.assign({ naming, substances, featByNode }, tables);
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

// What a node is, for the clash: its content — and, for an Example, its
// name as well. An Example is an individual, and an individual is told
// apart by what it is called before anything it carries: two payments of
// 100 to one shop on one day, P1 and P2, are two payments, the way two rows
// of a spreadsheet are two rows. So only Examples that share a name (case
// and a numbering prefix are presentation) can be one idea written twice.
// A Concept is a kind, and a kind is its definition: two Concepts with one
// content still clash whatever they are called.
const identityOf = (n) => (n.kind === INDIVIDUAL ? `${numberless(n.name).trim().toLowerCase()}\0` : "");

// Two distinct, unrelated substance nodes that carry the same attributes are a
// clash. Reported in two strengths: identical full content (G equal) is a
// stronger finding than a shared attribute-name set with differing values
// (equal radicals). Each finding is tagged kind: "content" | "names" so a
// caller can surface only the strong, content-identical clashes (the always-on
// editor hint does) while the CLI reports both. Nodes that assert no attribute
// of their own (an implied `...`, even when they inherit attributes that make G
// match a sibling's), and `...`-Map-marked nodes (intentionally incomplete),
// are skipped — as the differentia/FCA/subsumption checks do. An Example's
// name is part of what it is (identityOf), so two Examples clash only when
// they share their name as well as their content.
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
  // Two nodes can only clash when their radicals agree: an identical G is the
  // strong reading, an equal radical with a differing G the weak one. Both
  // tests are equalities, so the pairs worth looking at are the ones that
  // share a radical, and grouping finds them without comparing every node
  // with every other. The pair scan this replaces was O(n²) over wide
  // BigInts — about 5 ms on a 250-line file but 100 ms on a 2000-line one,
  // on every keystroke a file linted clean. An Example's name joins the key,
  // so differently named Examples never meet.
  const keyOfNode = (n) => identityOf(n) + rad(n);
  const byRadical = new Map();
  for (let i = 0; i < eligible.length; i++) {
    const key = keyOfNode(eligible[i]);
    const group = byRadical.get(key);
    if (group) group.push(i); else byRadical.set(key, [i]);
  }
  // a clash names two nodes, so it reports at both — one finding per node,
  // each related to its partner, so the editor squiggles both occurrences.
  // Each group lists its members in ascending order because it was filled in
  // that order, so walking i upward and taking only the partners after it
  // visits the pairs in the order the full scan did — no list of pairs to
  // build and no sort to undo it.
  for (let i = 0; i < eligible.length; i++) {
    const group = byRadical.get(keyOfNode(eligible[i]));
    if (!group || group.length < 2) continue;
    for (const j of group) {
      if (j <= i) continue;
      const a = eligible[i], b = eligible[j];
      if (related(a, b)) continue;
      for (const [self, other] of [[a, b], [b, a]]) {
        if (a.godel === b.godel) {
          findings.push({
            line: self.line,
            kind: "content",
            message: `clash: '${display(self)}' and '${display(other)}' carry identical attributes and values — nothing in the data tells them apart, so they are one idea written twice; give one a differentia (a distinguishing attribute or value), or merge them (G = ${a.godel})`,
            related: [{ line: other.line, message: `clashes with '${display(other)}'` }],
          });
        } else if (rad(a) === rad(b)) {
          findings.push({
            line: self.line,
            kind: "names",
            message: `clash: '${display(self)}' and '${display(other)}' have the same attribute names and differ only in their values — check that the values alone are meant to tell them apart (same radical)`,
            related: [{ line: other.line, message: `clashes with '${display(other)}'` }],
          });
        }
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
          message: `override: '${display(n)}' sets '${label}' to '${valueOfCode(aKey, vn, valueCode)}', replacing the '${valueOfCode(aKey, va, valueCode)}' it would otherwise inherit`,
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

//
// Nodes the paths do not match are then paired, when the pairing is
// unambiguous — exactly one candidate each way — parents before children:
//
//     moved              same kind and name, a different parent
//     renamed            same kind and (translated) parent, the same content
//                        (G > 1 equal; with no attributes at all, the same
//                        non-empty set of child names)
//     renamed + changed  same kind and parent, one slot apart
//
// and once a node is paired its descendants are matched through it, so a
// renamed Concept is one finding rather than everything under it removed
// and added again. Each finding is { kind: added | removed | changed |
// renamed | moved, a, b, path, changes: [{ attr, key, op: "+" | "-" | "~",
// from, to }], message } — the message as the CLI prints it, the rest for
// callers that act on it (the merge driver). `registry` (optional) numbers
// both sides stably.
function diff(rootA, nodesA, rootB, nodesB, registry) {
  const { P, mapAB, how, removed, added } = pairNodes(rootA, nodesA, rootB, nodesB, registry);
  const { attrPrime, valueCode, naming } = P;

  const changesOf = (a, b) => {
    const out = [];
    if (a.godel === b.godel) return out;
    for (const [aKey, p] of attrPrime) {
      const va = valuation(a.godel, p), vb = valuation(b.godel, p);
      if (va === vb) continue;
      const attr = naming.get(aKey) || aKey;
      const from = va === 0n ? null : valueOfCode(aKey, va, valueCode);
      const to = vb === 0n ? null : valueOfCode(aKey, vb, valueCode);
      out.push({ attr, key: aKey, op: va === 0n ? "+" : vb === 0n ? "-" : "~", from, to });
    }
    return out;
  };
  const said = (c) => (c.op === "+" ? `+ '${c.attr}' = '${c.to}'`
    : c.op === "-" ? `- '${c.attr}'` : `~ '${c.attr}': '${c.from}' -> '${c.to}'`);
  const lines = (changes) => (changes.length ? `\n    ${changes.map(said).join("\n    ")}` : "");

  const findings = [];
  for (const [a, b] of mapAB) {
    const kind = how.get(a);
    const changes = changesOf(a, b);
    const path = pathOf(a);
    if (kind === "moved") {
      findings.push({ kind: "moved", a, b, path, changes, message: `moved: ${path} -> ${pathOf(b)}${lines(changes)}` });
    } else if (kind === "renamed") {
      findings.push({ kind: "renamed", a, b, path, changes, message: `renamed: ${path} -> '${b.name}'${lines(changes)}` });
    } else if (changes.length) {
      findings.push({ kind: "changed", a, b, path: kind === "path" ? path : pathOf(b), changes, message: `changed: ${kind === "path" ? path : pathOf(b)}${lines(changes)}` });
    }
  }
  for (const a of removed) findings.push({ kind: "removed", a, b: null, path: pathOf(a), changes: [], message: `removed: ${pathOf(a)}` });
  for (const b of added) findings.push({ kind: "added", a: null, b, path: pathOf(b), changes: [], message: `added: ${pathOf(b)}` });
  findings.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return { findings, attrPrime, valueCode, naming };
}

// Which substance node of B each of A's is, as diff pairs them: by path,
// then — unambiguously, parents first — through a paired parent, moved,
// renamed, renamed with one change. Answers { P (the pooled numbering),
// mapAB (A node -> B node), how (A node -> "path" | "through" | "moved" |
// "renamed"), removed: [A nodes paired with nothing], added: [B nodes] }.
function pairNodes(rootA, nodesA, rootB, nodesB, registry) {
  const P = pool([{ root: rootA, nodes: nodesA }, { root: rootB, nodes: nodesB }], registry);
  const [A, B] = P.gathered;
  const { attrPrime } = P;
  const primeList = [...attrPrime.values()];

  const byPathA = new Map(), byPathB = new Map();
  for (const n of A.substances) byPathA.set(pathOf(n), n);
  for (const n of B.substances) byPathB.set(pathOf(n), n);

  // what matched, A -> B, and how
  const mapAB = new Map();
  const how = new Map(); // a -> "path" | "through" | "moved" | "renamed"
  for (const [path, a] of byPathA) {
    const b = byPathB.get(path);
    if (b) { mapAB.set(a, b); how.set(a, "path"); }
  }
  if (!mapAB.has(rootA)) { mapAB.set(rootA, rootB); how.set(rootA, "path"); }
  const matchedB = new Set(mapAB.values());
  const depthOf = (n) => { let d = 0; for (let p = n.parent; p; p = p.parent) d++; return d; };
  const fold = (s) => numberless(String(s || "")).trim().toLowerCase();
  const childNames = (n) => n.children.filter(isSubstance).map((c) => fold(c.name)).sort().join("\0");
  const sameContent = (a, b) => (a.godel > 1n ? a.godel === b.godel : a.godel === b.godel && childNames(a) !== "" && childNames(a) === childNames(b));
  const removed = () => A.substances.filter((n) => !mapAB.has(n));
  const added = () => B.substances.filter((n) => !matchedB.has(n));
  const pair = (a, b, kind) => { mapAB.set(a, b); matchedB.add(b); how.set(a, kind); };
  // exactly one candidate on each side, or no pairing at all
  const unique = (a, test) => {
    const cands = added().filter((b) => b.kind === a.kind && test(a, b));
    if (cands.length !== 1) return null;
    const back = removed().filter((x) => x.kind === a.kind && test(x, cands[0]));
    return back.length === 1 && back[0] === a ? cands[0] : null;
  };
  const rules = [
    ["through", (a, b) => b.parent === mapAB.get(a.parent) && fold(a.name) === fold(b.name)],
    ["moved", (a, b) => b.parent !== mapAB.get(a.parent) && fold(a.name) === fold(b.name)],
    ["renamed", (a, b) => b.parent === mapAB.get(a.parent) && mapAB.has(a.parent) && sameContent(a, b)],
    ["renamed", (a, b) => b.parent === mapAB.get(a.parent) && mapAB.has(a.parent) && distance(a.godel, b.godel, primeList) <= 1],
  ];
  const levels = [...new Set(A.substances.map(depthOf))].sort((x, y) => x - y);
  for (const d of levels) {
    for (const [kind, test] of rules) {
      for (const a of removed().filter((n) => depthOf(n) === d)) {
        const b = unique(a, test);
        if (b) pair(a, b, kind);
      }
    }
  }
  return { P, A, B, mapAB, how, removed: removed(), added: added() };
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

// --- what a node carries, for a reader ---------------------------------------

const SUPERSCRIPT = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
// G written as its factorisation, `2³ · 5 · 11²` — prime order, an exponent
// of one left off — which is what G says; the integer itself only while it is
// short enough to read.
function factorisation(g, slots) {
  if (!slots.length) return "1";
  return [...slots].sort((x, y) => (x.prime < y.prime ? -1 : 1))
    .map((s) => `${s.prime}${s.exponent === 1n ? "" : String(s.exponent).split("").map((d) => SUPERSCRIPT[d]).join("")}`)
    .join(" · ");
}

// A node's content, laid out for the hover: { number, slots: [{ attr, value,
// prime, exponent, from, fromLine, own, via }], overrides: [{ attr, value,
// replaces, from }], nearest: { node, dist, diff } | null }. `from` is the
// node whose declaration the slot came from (the node itself when `own`),
// `via` the attribute a crosslinked Concept came in through. `nearest` is
// the closest sibling of the same kind by content distance, the earlier line
// winning a tie, with its differing slots written as near() writes them.
// `tables` is what buildGodel or pool answered for the document.
function profile(root, nodes, node, tables) {
  const { attrPrime, valueCode, naming } = tables;
  const gathered = gather(root, nodes);
  const f = gathered.featByNode.get(node);
  if (!f || node.godel === undefined) return null;
  const label = (aKey) => (naming && naming.get(aKey)) || aKey;
  const slots = [];
  for (const [aKey, p] of attrPrime) {
    const e = valuation(node.godel, p);
    if (e === 0n) continue;
    const decl = f.fromByAttr.get(aKey);
    const through = f.via.get(aKey);
    const owner = decl ? decl.parent : through ? through.parent : null;
    slots.push({
      attr: label(aKey), key: aKey, value: valueOfCode(aKey, e, valueCode), prime: p, exponent: e,
      from: owner, fromLine: decl ? decl.line : through ? through.line : null, own: owner === node,
      via: through && !decl ? through.name : null,
    });
  }
  slots.sort((a, b) => a.attr.localeCompare(b.attr));
  const overridesOut = [];
  let anc = node.parent;
  while (anc && anc.godel === undefined) anc = anc.parent;
  if (anc) {
    for (const [aKey, p] of attrPrime) {
      const vn = valuation(node.godel, p), va = valuation(anc.godel, p);
      if (vn >= 2n && va >= 2n && vn !== va) {
        overridesOut.push({ attr: label(aKey), value: valueOfCode(aKey, vn, valueCode), replaces: valueOfCode(aKey, va, valueCode), from: anc });
      }
    }
  }
  const primeList = [...attrPrime.values()];
  let nearest = null;
  for (const s of (node.parent ? node.parent.children : [])) {
    if (s === node || s.kind !== node.kind || s.godel === undefined) continue;
    const dist = distance(node.godel, s.godel, primeList);
    if (!nearest || dist < nearest.dist || (dist === nearest.dist && s.line < nearest.node.line)) nearest = { node: s, dist };
  }
  if (nearest) {
    nearest.diff = [];
    for (const [aKey, p] of attrPrime) {
      const vx = valuation(node.godel, p), vn = valuation(nearest.node.godel, p);
      if (vx === vn) continue;
      if (vx === 0n) nearest.diff.push(`+ ${label(aKey)}: ${valueOfCode(aKey, vn, valueCode)}`);
      else if (vn === 0n) nearest.diff.push(`- ${label(aKey)}`);
      else nearest.diff.push(`~ ${label(aKey)}: ${valueOfCode(aKey, vx, valueCode)} | ${valueOfCode(aKey, vn, valueCode)}`);
    }
  }
  return { number: node.godel, factors: factorisation(node.godel, slots), slots, overrides: overridesOut, nearest };
}

// --- values every child shares, and defaults nothing keeps -------------------
// State a fact once, at the most general place it holds: a value every child
// of X sets for itself is a fact about X, written once per child. And a
// default X sets that every child overrides is in force for nothing under X.
// Both are warnings — the file still verifies — found one attribute prime at
// a time, for every node X with two or more children — three when they are
// all Examples — and no `...` Map (an open division may yet gain a child
// that differs). A value a derivation
// computes is its own row's, never lifted. Answers [{ line, kind: "hoist" |
// "dead", parent, attr, key, value, replaces?, message, related }].
function hoists(root, nodes) {
  const { attrPrime, valueCode, naming, featByNode } = buildGodel(root, nodes);
  const label = (aKey) => (naming && naming.get(aKey)) || aKey;
  const derived = (d) => d && (d.formula !== undefined || d.derived);
  const out = [];
  for (const x of [root, ...nodes]) {
    if (!isSubstance(x) || x.godel === undefined) continue;
    if (x.children.some((c) => c.kind === MAP)) continue;
    const kids = x.children.filter((c) => isSubstance(c) && c.godel !== undefined && c.line !== x.line);
    // two kinds agreeing is a rule; two rows of data agreeing is as often
    // chance, so Examples alone need three before their agreement says
    // anything about the Concept
    if (kids.length < (kids.every((k) => k.kind === INDIVIDUAL) ? 3 : 2)) continue;
    const ownDecl = (aKey) => x.children.find((c) => c.kind === DEFAULT && keyOf(c.name) === aKey) || null;
    for (const [aKey, p] of attrPrime) {
      const vs = kids.map((k) => valuation(k.godel, p));
      const xv = valuation(x.godel, p);
      const decls = kids.map((k) => featByNode.get(k).fromByAttr.get(aKey));
      if (decls.some(derived)) continue;
      const related = kids.map((k, i) => ({ line: decls[i] ? decls[i].line : k.line, message: `'${display(k)}' sets it here` }));
      const own = ownDecl(aKey);
      const shared = vs[0] >= 2n && vs.every((v) => v === vs[0]) && xv !== vs[0];
      if (shared) {
        const value = valueOfCode(aKey, vs[0], valueCode);
        const lines = related.map((r) => r.line).join(", ");
        const replacing = own && !derived(own) ? ` — '${display(x)}' says '${label(aKey)}: ${own.value}', which no child keeps: write '${label(aKey)}: ${value}' there instead` : "";
        const every = kids.every((k) => k.kind === CONCEPT) ? "every kind of" : kids.every((k) => k.kind === INDIVIDUAL) ? "every Example of" : "everything under";
        out.push({
          line: own ? own.line : x.line || related[0].line, kind: "hoist", parent: x, attr: label(aKey), key: aKey, value,
          replaces: own ? own.value : null,
          message: `every child of '${display(x)}' sets '${label(aKey)}: ${value}' (lines ${lines}) — a fact that holds for ${every} '${display(x)}' belongs to '${display(x)}': write it once under '${display(x)}' and drop it from each child${replacing} (advisory: the file still verifies)`,
          related,
        });
        continue;
      }
      if (own && !derived(own) && xv >= 2n && vs.every((v) => v >= 2n && v !== xv)) {
        out.push({
          line: own.line, kind: "dead", parent: x, attr: label(aKey), key: aKey, value: own.value,
          message: `'${display(x)}' sets '${label(aKey)}: ${own.value}' but every child overrides it — a default no child keeps is never in force for anything under '${display(x)}'; keep just '${label(aKey)}', or drop the line (advisory: the file still verifies)`,
          related,
        });
      }
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

// --- one idea, two names, two files ------------------------------------------
// The content clash catches two Concepts of one content within a file.
// Across files it is a warning: one file may still be adding the differentia.
// `docs` is [{ file, root, nodes }], this file among them; the finding lands
// on this file's side, with the peer as related information. A pair is left
// alone when the names fold alike, when one is the other's alias, or when
// the writer has said they are distinct (`dismissed`, synonyms.pairKey keys).
// Answers [{ line, other: { file, line, name }, name, message, related }].
function twins(docs, file, opts) {
  const o = opts || {};
  pool(docs, o.registry); // one numbering, so equal G means equal content across files
  const fold = (s) => numberless(String(s || "")).trim().toLowerCase();
  const pairKey = (a, b) => [String(a).toLowerCase(), String(b).toLowerCase()].sort().join("|");
  const dismissed = o.dismissed || new Set();
  const candidates = [];
  for (const d of docs) {
    for (const n of d.nodes) {
      if (n.kind !== CONCEPT || !(n.godel > 1n) || !assertsOwnSlot(n) || n.children.some((c) => c.kind === MAP)) continue;
      candidates.push({ file: d.file, node: n });
    }
  }
  const byG = new Map();
  for (const c of candidates) {
    const k = String(c.node.godel);
    if (!byG.has(k)) byG.set(k, []);
    byG.get(k).push(c);
  }
  const base = (f) => String(f).split(/[\\/]/).pop();
  const out = [];
  for (const group of byG.values()) {
    if (group.length < 2) continue;
    for (const mine of group.filter((c) => c.file === file)) {
      for (const peer of group) {
        if (peer.file === file) continue;
        const a = mine.node, b = peer.node;
        if (fold(a.name) === fold(b.name)) continue;
        if ((a.alias && fold(a.alias) === fold(b.name)) || (b.alias && fold(b.alias) === fold(a.name))) continue;
        if (dismissed.has(pairKey(a.name, b.name))) continue;
        out.push({
          line: a.line, name: a.name, other: { file: peer.file, line: b.line, name: b.name },
          message: `'${a.name}' and '${b.name}' (${base(peer.file)}:${b.line}) carry exactly the same attributes and values — one idea takes one name; rename one to the other, or give one a differentia (a distinguishing attribute or value) if they are two ideas`,
          related: [{ file: peer.file, line: b.line, message: `'${b.name}' carries the same content here` }],
        });
      }
    }
  }
  return out.sort((x, y) => x.line - y.line);
}

module.exports = {
  buildGodel, clashes, overrides, diff, find, common, near,
  decode, decodeNumber, gather, assignTables, applyGodel,
  valuation, radical, distance, lcm, valueOfCode, pathOf, isSubstance,
  pool, pairNodes, parseRegistry, formatRegistry, profile, factorisation, hoists, twins, assertsOwnSlot,
};
