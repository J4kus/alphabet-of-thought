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
// line. What G buys, all as plain arithmetic:
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
// G is KEPT AS ITS FACTORISATION. By the fundamental theorem of arithmetic a
// number and its prime factorisation are one and the same thing, and every
// row above is a question about exponents: divisibility is "no exponent
// larger", the radical is the primes present, equality is the same pairs,
// gcd and lcm the smaller and the larger exponent, a valuation one lookup.
// So each is answered on the few (prime, exponent) pairs a node carries,
// never by dividing an integer of thousands of digits by every prime in the
// repository — which is what had a hover take most of a second on a
// thousand-row table. The integer itself, `node.godel` (a BigInt), is made
// only when something reads it: the hover's short numbers, verify.js
// --godel. See docs/godel-numbers.md.
//
// The feature universe (attribute names, with crosslinked Concept names folded
// in) and the override-aware "nearest value wins" walk mirror fca.buildContext
// exactly, so G and the FCA context agree on what a node carries. Pure: no I/O,
// depends only on ./linter, ./crosslinks, ./table (for name folding) and
// ./primes.

const { KIND, primes, gcd } = require("./linter");
const { index, conceptType, typeDefault } = require("./crosslinks");
const { numberless } = require("./table");
const { isPrime } = require("./primes");
const { INDIVIDUAL, DEFAULT, CONCEPT, ATTRIBUTE, MAP } = KIND;

// gcd takes the min exponent per prime (the content two numbers agree on);
// lcm takes the max (their merge). On integers; vecGcd / vecLcm do the same
// on factorisations without multiplying anything out.
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

// --- G as its factorisation ---------------------------------------------------
// A factorisation: the primes in ascending order beside their exponents, every
// one at least 1 (an absent prime is simply not listed), and what every reader
// wants of it without rebuilding it — `key`, the canonical text of the pairs,
// so two numbers are equal exactly when their keys are; `support`, the primes
// alone, so two radicals are equal exactly when their supports are; `log10`,
// the integer's logarithm, which says how long it is without making it; and
// `big`, the integer, once something has asked for it.

const asCount = (x) => {
  const n = typeof x === "bigint" ? Number(x) : x;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`a Gödel prime or exponent must be a whole number below 2^53, not ${x}`);
  }
  return n;
};

// A factorisation from [prime, exponent] pairs in any order; one prime given
// twice is one prime with the exponents added, as multiplying would.
function vecOf(pairs) {
  const sorted = pairs
    .map(([q, k]) => [asCount(q), asCount(k)])
    .filter(([, k]) => k > 0)
    .sort((a, b) => a[0] - b[0]);
  const p = [], e = [];
  for (const [q, k] of sorted) {
    if (p.length && p[p.length - 1] === q) e[e.length - 1] += k;
    else { p.push(q); e.push(k); }
  }
  let log10 = 0;
  for (let i = 0; i < p.length; i++) log10 += e[i] * Math.log10(p[i]);
  return {
    p, e, log10,
    key: p.map((q, i) => (e[i] === 1 ? String(q) : `${q}^${e[i]}`)).join("."),
    support: p.join("."),
    big: undefined,
  };
}

// The exponent of prime p in v (its p-adic valuation): 0 when p is absent.
function vecValuation(v, p) {
  const q = typeof p === "bigint" ? Number(p) : p;
  let lo = 0, hi = v.p.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (v.p[mid] === q) return v.e[mid];
    if (v.p[mid] < q) lo = mid + 1; else hi = mid - 1;
  }
  return 0;
}

// Two factorisations prime by prime, in order: fn(p, ea, eb) for every prime
// either carries, an absent one's exponent being 0.
function eachPrime(a, b, fn) {
  let i = 0, j = 0;
  while (i < a.p.length || j < b.p.length) {
    const pa = i < a.p.length ? a.p[i] : Infinity;
    const pb = j < b.p.length ? b.p[j] : Infinity;
    if (pa === pb) fn(pa, a.e[i++], b.e[j++]);
    else if (pa < pb) fn(pa, a.e[i++], 0);
    else fn(pb, 0, b.e[j++]);
  }
}

const vecEqual = (a, b) => a.key === b.key;

// a divides b: no prime's exponent in a is larger than in b
function vecDivides(a, b) {
  for (let i = 0; i < a.p.length; i++) if (a.e[i] > vecValuation(b, a.p[i])) return false;
  return true;
}

function vecGcd(a, b) {
  const pairs = [];
  eachPrime(a, b, (p, ea, eb) => { const k = Math.min(ea, eb); if (k) pairs.push([p, k]); });
  return vecOf(pairs);
}

function vecLcm(a, b) {
  const pairs = [];
  eachPrime(a, b, (p, ea, eb) => pairs.push([p, Math.max(ea, eb)]));
  return vecOf(pairs);
}

// The number of primes on which two numbers disagree: a content distance
// (Hamming over the attribute slots).
function vecDistance(a, b) {
  let d = 0;
  eachPrime(a, b, (p, ea, eb) => { if (ea !== eb) d++; });
  return d;
}

// The integer itself, made once and kept. Each prime power is one BigInt
// exponentiation (square-and-multiply), and the powers are multiplied as a
// balanced tree — pairs, then pairs of pairs — so the two sides of every
// product are of a size and V8's Karatsuba, Toom-Cook and FFT multiplication
// can work, where a running product multiplies a huge number by a small one
// at every step.
function toBigInt(v) {
  if (v.big !== undefined) return v.big;
  let xs = v.p.map((p, i) => BigInt(p) ** BigInt(v.e[i]));
  if (!xs.length) return (v.big = 1n);
  while (xs.length > 1) {
    const next = [];
    for (let i = 0; i < xs.length; i += 2) next.push(i + 1 < xs.length ? xs[i] * xs[i + 1] : xs[i]);
    xs = next;
  }
  return (v.big = xs[0]);
}

// How many decimal digits the integer has, from the logarithms alone:
// floor(sum of e * log10 p) + 1. Floating point is exact enough everywhere
// but within a hair of a power of ten, and only there is the integer made
// and counted.
function digits(v) {
  const l = v.log10;
  const whole = Math.floor(l);
  if (l - whole > 1e-6 && whole + 1 - l > 1e-6) return whole + 1;
  return String(toBigInt(v)).length;
}

// The integer to three figures at any size, from its logarithm:
// `4.12 × 10^1,234`. One short enough to read is better written whole.
function approx(v) {
  let exp = Math.floor(v.log10);
  let mantissa = 10 ** (v.log10 - exp);
  if (mantissa >= 9.995) { mantissa /= 10; exp += 1; }
  return `${mantissa.toFixed(2)} × 10^${exp.toLocaleString("en-US")}`;
}

const SUPERSCRIPT = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const superscript = (k) => String(k).split("").map((d) => SUPERSCRIPT[d]).join("");

// G written as its factorisation, `2³ · 5 · 11²` — prime order, an exponent of
// one left off — which is what G says, at any size.
function factorsOf(v) {
  if (!v.p.length) return "1";
  return v.p.map((p, i) => `${p}${v.e[i] === 1 ? "" : superscript(v.e[i])}`).join(" · ");
}

// `node.godel`: the integer, made from the node's factorisation (`node.gvec`)
// only when read. Not enumerable, so nothing that copies or lists a node's
// fields makes an integer by accident.
const GODEL = {
  configurable: true,
  enumerable: false,
  get() { return this.gvec ? toBigInt(this.gvec) : undefined; },
};
function setNumber(n, v) {
  n.gvec = v;
  if (!Object.prototype.hasOwnProperty.call(n, "godel")) Object.defineProperty(n, "godel", GODEL);
}

const isVec = (g) => g !== null && typeof g === "object";

// The exponent of prime p in g (its p-adic valuation): how many times p
// divides g, 0 when it does not. A factorisation answers by lookup; any other
// integer is divided out.
function valuation(g, p) {
  if (isVec(g)) return BigInt(vecValuation(g, p));
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
// attribute-name set exactly when their radicals are equal — when their
// factorisations' supports are.
function radical(g, primeList) {
  if (isVec(g)) return g.p.reduce((r, p) => r * BigInt(p), 1n);
  let r = 1n;
  for (const p of primeList) if (g % p === 0n) r *= p;
  return r;
}

// The number of feature primes on which two numbers disagree.
function distance(a, b, primeList) {
  if (isVec(a) && isVec(b)) return vecDistance(a, b);
  let d = 0;
  for (const p of primeList) if (valuation(a, p) !== valuation(b, p)) d++;
  return d;
}

// Which attribute a prime stands for in one numbering, and where that
// attribute sorts — built once per numbering. The rank keeps a node's slots
// in the order every report has always listed them: the attributes' sorted
// order, not the primes'.
const primeKeys = new WeakMap(); // attrPrime -> Map(prime -> attrKey)
const keyRanks = new WeakMap(); // attrPrime -> Map(attrKey -> position)
function keyOfPrime(attrPrime) {
  let m = primeKeys.get(attrPrime);
  if (!m) {
    m = new Map();
    for (const [k, p] of attrPrime) m.set(Number(p), k);
    primeKeys.set(attrPrime, m);
  }
  return m;
}
function rankOf(attrPrime) {
  let m = keyRanks.get(attrPrime);
  if (!m) {
    m = new Map();
    let i = 0;
    for (const k of attrPrime.keys()) m.set(k, i++);
    keyRanks.set(attrPrime, m);
  }
  return m;
}

// The type of an attribute: the Concept it names, as crosslinks.js and
// fca.js read it — the (alias) alone when it carries one, else the longest
// trailing run of its name.
const conceptOf = (node, concepts) => conceptType(node, concepts);

// The override-aware effective features of a substance node: every attribute
// name it carries (its own and inherited, plus the Concepts those attributes
// crosslink to) and, for each, the value of its nearest value-assigning
// declaration. A bare attribute contributes its name but no value, so an
// ancestor's default still wins — the same rule fca.buildContext applies.
// What a node inherits comes from its kinds: the Concepts above it. An
// Example above it — the row a nested row sits under, the `- Parent` of a
// `- Child` — is the whole it is a part of, and a part inherits nothing from
// its whole, so its lines lend the node nothing.
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
    if (n !== node && n.kind === INDIVIDUAL) continue;
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
  // an attribute nothing values reads the default of the Concept that types
  // it (`Currency: EUR` for a `currency`) — marked, since the node states
  // nothing: a reader names where it came from, and no rule lifts it
  const typed = new Map(); // attrKey -> the Concept whose default it reads
  for (const [aKey, decl] of fromByAttr) {
    if (valued.has(aKey)) continue;
    const td = typeDefault(decl, concepts);
    if (!td) continue;
    valueByAttr.set(aKey, td.value);
    typed.set(aKey, td.concept);
  }
  return { names, valueByAttr, fromByAttr, via, typed };
}

// Gather per-node features and the raw material for the global tables, without
// assigning primes yet — so a version diff can pool two documents first.
//
// Cached per parse: a tree is never changed after parsing (only its chi and
// Gödel fields are written), so the same nodes array gathers the same way,
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

// The numbering one gathered document gets, kept per registry: assigning
// sorts every attribute and every value, and one lint pass numbers the same
// tree for the clash, the hoists and the dependencies alike.
const NO_REGISTRY = {};
function tablesFor(data, registry) {
  if (!data.tables) data.tables = new WeakMap();
  const key = registry || NO_REGISTRY;
  let t = data.tables.get(key);
  if (!t) {
    t = assignTables(data.allAttrKeys, data.valuesByAttr, registry);
    data.tables.set(key, t);
  }
  return t;
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
  return Object.assign({ naming, gathered, primeKey: keyOfPrime(tables.attrPrime) }, tables);
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

function parseRegistry(text) {
  const attrs = new Map();
  const values = new Map();
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (!raw || raw.startsWith("#") || /^(<{7}|={7}|>{7}|\|{7})/.test(raw)) continue;
    const parts = raw.split("\t");
    if (parts[0] === "a" && parts.length >= 3 && parts[1] && /^\d+$/.test(parts[2])) {
      const p = BigInt(parts[2]);
      if (!isPrime(p)) continue;
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

// Number every gathered substance node from the shared tables: its
// factorisation, read straight off its features — no integer is multiplied
// here. A node already carrying this numbering is left as it is, so a lint
// pass that asks for the same numbering three times builds it once.
const numberedWith = new WeakMap(); // node -> the attrPrime its factorisation was read with
function applyGodel(featByNode, attrPrime, valueCode) {
  for (const [n, f] of featByNode) {
    if (numberedWith.get(n) === attrPrime) continue;
    const pairs = [];
    for (const a of f.names) {
      const code = f.valueByAttr.has(a) ? valueCode.get(a).get(f.valueByAttr.get(a)) : 1n;
      pairs.push([attrPrime.get(a), code]);
    }
    setNumber(n, vecOf(pairs));
    numberedWith.set(n, attrPrime);
  }
}

// Build the Gödel numbers for one document. Gives every Concept and Example
// (and the root) its factorisation — `node.gvec`, with the integer behind
// `node.godel` — and returns the tables for decoding and queries.
// `registry` (optional) makes the numbers stable (assignTables).
function buildGodel(root, nodes, registry) {
  const data = gather(root, nodes);
  const tables = tablesFor(data, registry);
  applyGodel(data.featByNode, tables.attrPrime, tables.valueCode);
  return Object.assign({
    naming: data.naming, substances: data.substances, featByNode: data.featByNode,
    primeKey: keyOfPrime(tables.attrPrime),
  }, tables);
}

// Reverse a value code back to its string for one attribute (1 -> unvalued).
// The first value holding a code wins, as a scan of the table in order would
// have it; the reversed table is built once per numbering.
const codeValues = new WeakMap(); // valueCode -> Map(attrKey -> Map(code -> value))
function valueOfCode(aKey, code, valueCode) {
  const c = typeof code === "bigint" ? code : BigInt(code);
  if (c === 1n) return "(unvalued)";
  let byAttr = codeValues.get(valueCode);
  if (!byAttr) { byAttr = new Map(); codeValues.set(valueCode, byAttr); }
  let reversed = byAttr.get(aKey);
  if (!reversed) {
    reversed = new Map();
    const table = valueCode.get(aKey);
    if (table) for (const [v, k] of table) if (!reversed.has(String(k))) reversed.set(String(k), v);
    byAttr.set(aKey, reversed);
  }
  return reversed.has(String(c)) ? reversed.get(String(c)) : `?${c}`;
}

// Decode a Gödel number into its slots: [{ attr, value, prime, exponent }]
// for every attribute it carries, sorted by attribute label. A factorisation
// is read pair by pair; any other integer is divided by each feature prime.
function decodeNumber(g, attrPrime, valueCode, naming) {
  const out = [];
  const slot = (aKey, p, e) => out.push({
    attr: (naming && naming.get(aKey)) || aKey,
    value: valueOfCode(aKey, e, valueCode),
    prime: p,
    exponent: e,
  });
  if (isVec(g)) {
    const keys = keyOfPrime(attrPrime);
    for (let i = 0; i < g.p.length; i++) {
      const aKey = keys.get(g.p[i]);
      if (aKey !== undefined) slot(aKey, attrPrime.get(aKey), BigInt(g.e[i]));
    }
  } else {
    for (const [aKey, p] of attrPrime) {
      const e = valuation(g, p);
      if (e !== 0n) slot(aKey, p, e);
    }
  }
  out.sort((a, b) => a.attr.localeCompare(b.attr));
  return out;
}

// Decode a node's number (its content).
function decode(node, attrPrime, valueCode, naming) {
  return decodeNumber(node.gvec || node.godel, attrPrime, valueCode, naming);
}

const isAncestor = (a, c) => {
  for (let p = c.parent; p; p = p.parent) if (p === a) return true;
  return false;
};
const related = (a, b) => a === b || isAncestor(a, b) || isAncestor(b, a);

// The kind a node's values are measured against: its nearest numbered
// ancestor that is a Concept. An Example above it is its whole, and lends it
// nothing to override (effFeatures).
function kindAbove(n) {
  let anc = n.parent;
  while (anc && (anc.kind === INDIVIDUAL || !anc.gvec)) anc = anc.parent;
  return anc || null;
}

// How `b` differs from `a`, slot by slot, in attribute order: `+ attr: value`
// for one only b carries, `- attr` for one only a carries, `~ attr: a | b`
// for one they value differently.
function slotDiff(a, b, tables) {
  const { attrPrime, valueCode, naming } = tables;
  const keys = keyOfPrime(attrPrime), rank = rankOf(attrPrime);
  const label = (aKey) => (naming && naming.get(aKey)) || aKey;
  const differing = [];
  eachPrime(a, b, (p, ea, eb) => { if (ea !== eb) differing.push({ aKey: keys.get(p), ea, eb }); });
  differing.sort((x, y) => rank.get(x.aKey) - rank.get(y.aKey));
  return differing.map(({ aKey, ea, eb }) => (ea === 0
    ? `+ ${label(aKey)}: ${valueOfCode(aKey, eb, valueCode)}`
    : eb === 0
      ? `- ${label(aKey)}`
      : `~ ${label(aKey)}: ${valueOfCode(aKey, ea, valueCode)} | ${valueOfCode(aKey, eb, valueCode)}`));
}

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
  buildGodel(root, nodes);
  const eligible = [root, ...nodes].filter(
    (n) =>
      isSubstance(n) &&
      n.gvec && n.gvec.p.length > 0 &&
      assertsOwnSlot(n) &&
      !n.children.some((c) => c.kind === MAP),
  );
  const findings = [];
  // Two nodes can only clash when their radicals agree: an identical G is the
  // strong reading, an equal radical with a differing G the weak one. Both
  // tests are equalities — of a factorisation's key, of its support — so the
  // pairs worth looking at are the ones that share a support, and grouping
  // finds them without comparing every node with every other. An Example's
  // name joins the key, so differently named Examples never meet.
  const keyOfNode = (n) => identityOf(n) + n.gvec.support;
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
        if (vecEqual(a.gvec, b.gvec)) {
          findings.push({
            line: self.line,
            kind: "content",
            message: `clash: give one a differentia (a distinguishing attribute or value), or merge them — '${display(self)}' and '${display(other)}' carry identical attributes and values: nothing in the data tells them apart, so they are one idea written twice (G = ${factorsOf(a.gvec)})`,
            related: [{ line: other.line, message: `clashes with '${display(other)}'` }],
          });
        } else if (a.gvec.support === b.gvec.support) {
          findings.push({
            line: self.line,
            kind: "names",
            message: `clash: check that the values alone are meant to tell them apart — '${display(self)}' and '${display(other)}' have the same attribute names and differ only in their values (same radical)`,
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
// differently from the nearest Concept above it that already values it.
// Detected arithmetically — both p-adic valuations are >= 2 and unequal.
function overrides(root, nodes) {
  const { attrPrime, valueCode, naming, primeKey } = buildGodel(root, nodes);
  const rank = rankOf(attrPrime);
  const findings = [];
  for (const n of nodes) {
    if (!isSubstance(n) || !n.gvec) continue;
    const anc = kindAbove(n);
    if (!anc) continue;
    const found = [];
    for (let i = 0; i < n.gvec.p.length; i++) {
      const vn = n.gvec.e[i];
      if (vn < 2) continue;
      const va = vecValuation(anc.gvec, n.gvec.p[i]);
      if (va >= 2 && va !== vn) found.push({ aKey: primeKey.get(n.gvec.p[i]), vn, va });
    }
    found.sort((x, y) => rank.get(x.aKey) - rank.get(y.aKey));
    for (const { aKey, vn, va } of found) {
      const label = naming.get(aKey) || aKey;
      findings.push({
        line: n.line,
        message: `override: '${display(n)}' sets '${label}' to '${valueOfCode(aKey, vn, valueCode)}', replacing the '${valueOfCode(aKey, va, valueCode)}' it would otherwise inherit`,
      });
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
  const keys = keyOfPrime(attrPrime), rank = rankOf(attrPrime);

  const changesOf = (a, b) => {
    const out = [];
    if (vecEqual(a.gvec, b.gvec)) return out;
    const differing = [];
    eachPrime(a.gvec, b.gvec, (p, va, vb) => { if (va !== vb) differing.push({ aKey: keys.get(p), va, vb }); });
    differing.sort((x, y) => rank.get(x.aKey) - rank.get(y.aKey));
    for (const { aKey, va, vb } of differing) {
      const attr = naming.get(aKey) || aKey;
      const from = va === 0 ? null : valueOfCode(aKey, va, valueCode);
      const to = vb === 0 ? null : valueOfCode(aKey, vb, valueCode);
      out.push({ attr, key: aKey, op: va === 0 ? "+" : vb === 0 ? "-" : "~", from, to });
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
  const sameContent = (a, b) => (a.gvec.p.length
    ? vecEqual(a.gvec, b.gvec)
    : !b.gvec.p.length && childNames(a) !== "" && childNames(a) === childNames(b));
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
    ["renamed", (a, b) => b.parent === mapAB.get(a.parent) && mapAB.has(a.parent) && vecDistance(a.gvec, b.gvec) <= 1],
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
// spec. Each term is either a bare attribute name (present, any value) or
// `attribute: value` (that exact value). Together the terms are one query
// number Q, and a node matches when Q divides G(n) for the bare names and
// each valued term's exponent matches exactly — read off the factorisation,
// one lookup per term. Returns { matches, unknown } — unknown lists terms
// naming an attribute or value the document never declares.
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
      wants.push({ prime: p, exponent: Number(code) });
    }
  }
  // an all-unknown query constrains nothing; do not let `every` match the world
  const matches = wants.length
    ? [root, ...nodes].filter((n) =>
        isSubstance(n) && n.gvec && wants.every((w) =>
          w.exponent === null ? vecValuation(n.gvec, w.prime) > 0 : vecValuation(n.gvec, w.prime) === w.exponent))
    : [];
  return { matches, unknown };
}

// The content two nodes share: every attribute they both carry *at the same
// value* (a value-aware genus). Kept prime by prime — a prime is kept only
// when its exponent is equal and non-zero in both, so an attribute one omits,
// or both set to different values, drops out. (A raw gcd would keep the
// smaller code of two differing values, conflating disagreement with
// agreement.)
function common(root, nodes, x, y) {
  const { attrPrime, valueCode, naming } = buildGodel(root, nodes);
  const pairs = [];
  eachPrime(x.gvec, y.gvec, (p, ex, ey) => { if (ex >= 1 && ex === ey) pairs.push([p, ex]); });
  const shared = vecOf(pairs);
  return { number: toBigInt(shared), vec: shared, slots: decodeNumber(shared, attrPrime, valueCode, naming) };
}

// The k nearest substance nodes to x by content distance, with the slots that
// differ. Excludes x and the root.
function near(root, nodes, x, k = 5) {
  const tables = buildGodel(root, nodes);
  const ranked = [root, ...nodes]
    .filter((n) => isSubstance(n) && n !== x && n !== root && n.gvec)
    .map((n) => ({ node: n, dist: vecDistance(x.gvec, n.gvec) }))
    .sort((a, b) => a.dist - b.dist || a.node.line - b.node.line)
    .slice(0, k);
  for (const r of ranked) r.diff = slotDiff(x.gvec, r.node.gvec, tables);
  return ranked;
}

// --- what a node carries, for a reader ---------------------------------------

// G written as its factorisation, `2³ · 5 · 11²` — prime order, an exponent
// of one left off — from decoded slots (factorsOf does it from the
// factorisation itself).
function factorisation(g, slots) {
  if (!slots.length) return "1";
  return [...slots].sort((x, y) => (x.prime < y.prime ? -1 : 1))
    .map((s) => `${s.prime}${s.exponent === 1n ? "" : superscript(s.exponent)}`)
    .join(" · ");
}

// A node's content, laid out for the hover: { vec, digits, number, factors,
// slots: [{ attr, value, prime, exponent, from, fromLine, own, via }],
// overrides: [{ attr, value, replaces, from }], nearest: { node, dist, diff }
// | null }. `from` is the node whose declaration the slot came from (the node
// itself when `own`), `via` the attribute a crosslinked Concept came in
// through. `nearest` is the closest sibling of the same kind by content
// distance, the earlier line winning a tie, with its differing slots written
// as near() writes them. `digits` says how long G is without making it;
// `number`, the integer, is made only when read. `tables` is what buildGodel
// or pool answered for the document.
function profile(root, nodes, node, tables) {
  const { attrPrime, valueCode, naming } = tables;
  const gathered = gather(root, nodes);
  const f = gathered.featByNode.get(node);
  if (!f || !node.gvec) return null;
  const v = node.gvec;
  const keys = keyOfPrime(attrPrime), rank = rankOf(attrPrime);
  const label = (aKey) => (naming && naming.get(aKey)) || aKey;
  const slots = [];
  for (let i = 0; i < v.p.length; i++) {
    const aKey = keys.get(v.p[i]);
    if (aKey === undefined) continue;
    const e = BigInt(v.e[i]);
    const decl = f.fromByAttr.get(aKey);
    const through = f.via.get(aKey);
    const type = f.typed.get(aKey); // a value read from its type's default
    const owner = type || (decl ? decl.parent : through ? through.parent : null);
    slots.push({
      attr: label(aKey), key: aKey, value: valueOfCode(aKey, e, valueCode), prime: attrPrime.get(aKey), exponent: e,
      from: owner, fromLine: type ? type.line : decl ? decl.line : through ? through.line : null, own: !type && owner === node,
      via: through && !decl ? through.name : null, typeDefault: !!type,
    });
  }
  slots.sort((a, b) => a.attr.localeCompare(b.attr));
  const overridesOut = [];
  const anc = kindAbove(node);
  if (anc) {
    const found = [];
    for (let i = 0; i < v.p.length; i++) {
      const vn = v.e[i];
      if (vn < 2) continue;
      const va = vecValuation(anc.gvec, v.p[i]);
      if (va >= 2 && va !== vn) found.push({ aKey: keys.get(v.p[i]), vn, va });
    }
    found.sort((x, y) => rank.get(x.aKey) - rank.get(y.aKey));
    for (const { aKey, vn, va } of found) {
      overridesOut.push({ attr: label(aKey), value: valueOfCode(aKey, vn, valueCode), replaces: valueOfCode(aKey, va, valueCode), from: anc });
    }
  }
  let nearest = null;
  for (const s of (node.parent ? node.parent.children : [])) {
    if (s === node || s.kind !== node.kind || !s.gvec) continue;
    const dist = vecDistance(v, s.gvec);
    if (!nearest || dist < nearest.dist || (dist === nearest.dist && s.line < nearest.node.line)) nearest = { node: s, dist };
  }
  if (nearest) nearest.diff = slotDiff(v, nearest.node.gvec, tables);
  return {
    vec: v,
    digits: digits(v),
    get number() { return toBigInt(v); },
    factors: factorsOf(v),
    slots, overrides: overridesOut, nearest,
  };
}

// --- values every child shares, and defaults nothing keeps -------------------
// State a fact once, at the most general place it holds: a value every child
// of X sets for itself is a fact about X, written once per child. And a
// default X sets that every child overrides is in force for nothing under X.
// Both are warnings — the file still verifies — found one attribute prime at
// a time, for every node X with two or more children — three when they are
// all Examples — and no `...` Map (an open division may yet gain a child
// that differs). A value a derivation computes is its own row's, never
// lifted. Both readings need every child to value the attribute, so only the
// primes every child carries at a value are looked at, never the whole
// universe. Answers [{ line, kind: "hoist" | "dead", parent, attr, key,
// value, replaces?, message, related }].
function hoists(root, nodes) {
  const { attrPrime, valueCode, naming, featByNode, primeKey } = buildGodel(root, nodes);
  const rank = rankOf(attrPrime);
  const label = (aKey) => (naming && naming.get(aKey)) || aKey;
  const derived = (d) => d && (d.formula !== undefined || d.derived);
  const out = [];
  for (const x of [root, ...nodes]) {
    // only a kind lends its children anything: a fact every sub-Example of
    // an Example states is no fact about that Example (a part inherits
    // nothing from its whole), so it would leave them if it moved there
    if (!isSubstance(x) || !x.gvec || x.kind === INDIVIDUAL) continue;
    if (x.children.some((c) => c.kind === MAP)) continue;
    const kids = x.children.filter((c) => isSubstance(c) && c.gvec && c.line !== x.line);
    // two kinds agreeing is a rule; two rows of data agreeing is as often
    // chance, so Examples alone need three before their agreement says
    // anything about the Concept
    if (kids.length < (kids.every((k) => k.kind === INDIVIDUAL) ? 3 : 2)) continue;
    // the primes every child carries at a value: the first child's valued
    // primes, kept while each other child values them too
    let candidates = kids[0].gvec.p.filter((p, i) => kids[0].gvec.e[i] >= 2);
    for (const k of kids.slice(1)) {
      if (!candidates.length) break;
      candidates = candidates.filter((p) => vecValuation(k.gvec, p) >= 2);
    }
    const ordered = candidates.map((p) => primeKey.get(p)).sort((a, b) => rank.get(a) - rank.get(b));
    const ownDecl = (aKey) => x.children.find((c) => c.kind === DEFAULT && keyOf(c.name) === aKey) || null;
    // a value the attribute's definition writes (`vat =@price*0.2` on its
    // declaration — a line, a header cell — here or above) is the
    // definition's, not a fact each child states: never lifted. A collection
    // written out (`status =("a", "b")`) only lists what a value may be, and
    // writes nothing.
    const definedAbove = (aKey) => {
      for (let n = x; n; n = n.parent) {
        for (const c of n.children) {
          if (c.kind === ATTRIBUTE && keyOf(c.name) === aKey && c.constraints
            && c.constraints.some((k) => k.op === "==" && !/^[([{]/.test(String(k.formula).trim()))) return true;
        }
      }
      return false;
    };
    for (const aKey of ordered) {
      if (definedAbove(aKey)) continue;
      // a value a child reads from its type's default is no fact it states
      if (kids.some((k) => featByNode.get(k).typed.has(aKey))) continue;
      const p = attrPrime.get(aKey);
      const vs = kids.map((k) => vecValuation(k.gvec, p));
      const xv = vecValuation(x.gvec, p);
      const decls = kids.map((k) => featByNode.get(k).fromByAttr.get(aKey));
      if (decls.some(derived)) continue;
      const related = kids.map((k, i) => ({ line: decls[i] ? decls[i].line : k.line, message: `'${display(k)}' sets it here` }));
      const own = ownDecl(aKey);
      const shared = vs[0] >= 2 && vs.every((v) => v === vs[0]) && xv !== vs[0];
      if (shared) {
        const value = valueOfCode(aKey, vs[0], valueCode);
        const lines = related.map((r) => r.line).join(", ");
        const replacing = own && !derived(own) ? ` in place of the '${label(aKey)}: ${own.value}' it says now, which no child keeps,` : "";
        const every = kids.every((k) => k.kind === CONCEPT) ? "every kind of" : kids.every((k) => k.kind === INDIVIDUAL) ? "every Example of" : "everything under";
        out.push({
          line: own ? own.line : x.line || related[0].line, kind: "hoist", parent: x, attr: label(aKey), key: aKey, value,
          replaces: own ? own.value : null,
          message: `write '${label(aKey)}: ${value}' once under '${display(x)}'${replacing} and drop it from each child — every child of '${display(x)}' sets it (lines ${lines}), and a fact that holds for ${every} '${display(x)}' belongs to '${display(x)}' (advisory: the file still verifies)`,
          related,
        });
        continue;
      }
      if (own && !derived(own) && xv >= 2 && vs.every((v) => v >= 2 && v !== xv)) {
        out.push({
          line: own.line, kind: "dead", parent: x, attr: label(aKey), key: aKey, value: own.value,
          message: `keep just '${label(aKey)}', or drop the line — '${display(x)}' sets '${label(aKey)}: ${own.value}' but every child overrides it, and a default no child keeps is never in force for anything under '${display(x)}' (advisory: the file still verifies)`,
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
      if (n.kind !== CONCEPT || !(n.gvec && n.gvec.p.length) || !assertsOwnSlot(n) || n.children.some((c) => c.kind === MAP)) continue;
      candidates.push({ file: d.file, node: n });
    }
  }
  const byG = new Map();
  for (const c of candidates) {
    const k = c.node.gvec.key;
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
          message: `rename one to the other, or give one a differentia (a distinguishing attribute or value) if they are two ideas — '${a.name}' and '${b.name}' (${base(peer.file)}:${b.line}) carry exactly the same attributes and values, and one idea takes one name`,
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
  // the factorisation itself
  vecOf, vecValuation, vecDivides, vecGcd, vecLcm, vecEqual, vecDistance, eachPrime,
  toBigInt, digits, approx, factorsOf,
};
