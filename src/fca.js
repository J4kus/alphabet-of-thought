// Formal Concept Analysis over a parsed .aot tree, after Wille (1982).
//
// A .aot file already contains FCA's raw input: a formal context whose
// objects are the Examples and whose attributes (columns) are the
// attribute names and attribute: value pairs each Example carries,
// directly or by inheritance. Every formal concept — every grouping the
// data actually supports — is the closure of an intersection of object
// intents. The hand-written Concept tree is then audited against that
// lattice:
//
//     confirmed   a Concept's Examples are exactly a formal concept
//     drift       an Example shares a Concept's full intent but is
//                 filed elsewhere
//     exhaustion  sub-Concepts must cover the parent's Examples by
//                 their attributes, and be distinguishable by them
//
// Shared by the CLI (verify.js). Pure: no I/O, no dependencies.

const { KIND } = require("./linter");
const { index, wordStarts, instantiates } = require("./crosslinks");
const { INDIVIDUAL, DEFAULT, CONCEPT, ATTRIBUTE, MAP } = KIND;

function intersect(a, b) {
  const out = new Set();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

function isSuperset(sup, sub) {
  for (const x of sub) if (!sup.has(x)) return false;
  return true;
}

const setKey = (s) => [...s].sort().join("\0");

// The formal context: objects (Examples) and their intents (column
// keys). A column is an attribute name or an "attribute: value" pair,
// collected from the Example and every ancestor; for the value
// column the nearest declaration wins (an override shadows the
// inherited default). Keys are lowercased; `display` keeps the original
// casing for reports.
//
// Crosslinks deepen the columns, because the primitives define
// Concepts too:
//
//   default-is-a-Example   a value naming an Example elsewhere
//                             also yields that Example's ancestry:
//                             `operation: Ratio` with Ratio filed under
//                             Formula > Arithmetic yields the columns
//                             `operation: Arithmetic`, `operation: Formula`
//   attribute-is-a-Concept    an attribute whose trailing words name a
//                             Concept also yields that Concept as a
//                             column: `age integer` yields `integer`
function buildContext(root, nodes) {
  const { concepts, individuals } = index(root, nodes);
  const display = new Map();
  const keyOf = (text) => {
    const k = text.trim().toLowerCase();
    if (!display.has(k)) display.set(k, text.trim());
    return k;
  };
  // the longest trailing run of words that names a Concept, as in
  // crosslinks.js
  const conceptOf = (node) => {
    for (const start of wordStarts(node.name)) {
      const target = concepts.get(node.name.slice(start).toLowerCase());
      if (target && target !== node) return target;
    }
    return null;
  };
  const objects = nodes.filter((n) => n.kind === INDIVIDUAL);
  const intents = new Map();
  const directs = new Map(); // columns the Example declares itself, not inherited
  for (const g of objects) {
    const intent = new Set();
    const direct = new Set();
    const valued = new Set();
    for (let n = g; n; n = n.parent) {
      const put = (text) => {
        const k = keyOf(text);
        intent.add(k);
        if (n === g) direct.add(k);
      };
      for (const child of n.children) {
        if (child.kind !== ATTRIBUTE && child.kind !== DEFAULT) continue;
        put(child.name);
        const type = conceptOf(child);
        if (type) put(type.name);
        if (child.kind !== DEFAULT) continue;
        const nameKey = keyOf(child.name);
        if (valued.has(nameKey)) continue;
        valued.add(nameKey);
        put(`${child.name}: ${child.value}`);
        const target = individuals.get(child.value);
        if (target && target !== child && instantiates(target, child.name)) {
          for (let a = target.parent; a && a !== root; a = a.parent) {
            if (a.name.toLowerCase() === child.name.toLowerCase()) break;
            put(`${child.name}: ${a.name}`);
          }
        }
      }
    }
    intents.set(g, intent);
    directs.set(g, direct);
  }
  return { objects, intents, directs, display };
}

// All formal concepts of the context. Every concept intent is an
// intersection of object intents, so close the set of intents under
// pairwise intersection, then realise each as (extent, closed intent)
// and deduplicate by extent.
function computeConcepts(objects, intents) {
  const candidates = new Map();
  const add = (s) => {
    const k = setKey(s);
    if (!candidates.has(k)) candidates.set(k, s);
  };
  for (const g of objects) {
    const gi = intents.get(g);
    for (const s of [...candidates.values()]) add(intersect(s, gi));
    add(gi);
  }
  const byExtent = new Map();
  for (const A of candidates.values()) {
    const extent = objects.filter((g) => isSuperset(intents.get(g), A));
    if (!extent.length) continue;
    const k = extent.map((g) => g.line).join(",");
    if (byExtent.has(k)) continue;
    let intent = new Set(intents.get(extent[0]));
    for (const g of extent.slice(1)) intent = intersect(intent, intents.get(g));
    byExtent.set(k, { extent, intent });
  }
  return [...byExtent.values()];
}

// Audit the hand-written tree against the lattice. Returns
// { objects, columns, concepts, confirmed, findings } where findings
// are { line, message } sorted by line; or { tooFew: true } when there
// are fewer than two Examples to analyse.
function suggest(root, nodes) {
  const { objects, intents, display } = buildContext(root, nodes);
  if (objects.length < 2) {
    return { objects: objects.length, columns: display.size, concepts: 0, confirmed: [], findings: [], tooFew: true };
  }
  const lattice = computeConcepts(objects, intents);
  const extKey = (extent) => extent.map((g) => g.line).join(",");

  // Each hand-written Concept's extent (Examples beneath it, by
  // divisibility) and intent (what those Examples all share)
  const infos = new Map();
  for (const c of [root, ...nodes].filter((n) => n.kind === CONCEPT)) {
    const extent = objects.filter((g) => g.chi % c.chi === 0n);
    if (!extent.length) continue;
    let intent = new Set(intents.get(extent[0]));
    for (const g of extent.slice(1)) intent = intersect(intent, intents.get(g));
    infos.set(c, { extent, intent });
  }
  const namedExtents = new Map();
  for (const [c, info] of infos) {
    if (!namedExtents.has(extKey(info.extent))) namedExtents.set(extKey(info.extent), c);
  }

  const latticeExtents = new Set(lattice.map((fc) => extKey(fc.extent)));
  const confirmed = [];
  for (const [c, info] of infos) {
    if (c !== root && info.extent.length >= 2 && latticeExtents.has(extKey(info.extent))) confirmed.push(c.name);
  }

  const findings = [];

  // a Map child marks a node intentionally incomplete, as in the
  // linter: what is missing is declared, not forgotten, so don't flag it
  const incomplete = (n) => n.children.some((c) => c.kind === MAP);

  // vacuous: a Concept whose Examples share nothing beyond what its
  // ancestor's already share adds no attribute of its own, so drift
  // toward it would be meaningless — the drift check below skips it
  const ancestorOf = (c) => {
    for (let a = c.parent; a; a = a.parent) {
      if (a.kind === CONCEPT && infos.has(a)) return a;
    }
    return null;
  };
  const vacuous = new Set();
  for (const [c, info] of infos) {
    if (c === root) continue;
    const anc = ancestorOf(c);
    if (anc && setKey(info.intent) === setKey(infos.get(anc).intent)) vacuous.add(c);
  }

  // drift: an Example that satisfies a Concept's full intent but
  // sits elsewhere. Report only the most specific Concept(s) per
  // Example — matching a sub-Concept implies matching its ancestors.
  const driftByObject = new Map();
  for (const [c, info] of infos) {
    if (c === root || !info.intent.size || vacuous.has(c)) continue;
    for (const g of objects) {
      if (info.extent.includes(g)) continue;
      if (isSuperset(intents.get(g), info.intent)) {
        if (!driftByObject.has(g)) driftByObject.set(g, []);
        driftByObject.get(g).push(c);
      }
    }
  }
  for (const [g, cs] of driftByObject) {
    const maximal = cs.filter((c) => !cs.some((d) =>
      d !== c
      && infos.get(d).intent.size > infos.get(c).intent.size
      && isSuperset(infos.get(d).intent, infos.get(c).intent)));
    // Concepts with the same intent are one finding, not one each
    const byIntent = new Map();
    for (const c of maximal) {
      const k = setKey(infos.get(c).intent);
      if (!byIntent.has(k)) byIntent.set(k, []);
      byIntent.get(k).push(c);
    }
    for (const group of byIntent.values()) {
      const names = group.map((c) => `'${c.name}'`).join(" and ");
      const move = group.length === 1 ? `move it under ${names}` : `move it under one of them`;
      const differentia = group.length === 1 ? `give ${names} a differentia` : `give them a differentia`;
      findings.push({
        line: g.line,
        message: `drift: '- ${g.name}' carries every attribute the Examples of ${names} share, yet it is filed under '${g.parent.name}' — either ${move}, or ${differentia} that genuinely excludes it`,
      });
    }
  }

  // exhaustion: a parent's sub-Concepts must cover its Examples by
  // attributes, and be distinguishable from one another by data
  for (const p of [root, ...nodes].filter((n) => n.kind === CONCEPT)) {
    const pInfo = infos.get(p);
    if (!pInfo) continue;
    const subs = p.children.filter((c) => c.kind === CONCEPT && infos.has(c));
    if (subs.length < 2) continue;
    for (let i = 0; i < subs.length; i++) {
      for (let j = i + 1; j < subs.length; j++) {
        if (incomplete(subs[i]) || incomplete(subs[j])) continue;
        if (setKey(infos.get(subs[i]).intent) === setKey(infos.get(subs[j]).intent)) {
          findings.push({
            line: subs[j].line,
            message: `exhaustion: '${subs[i].name}' and '${subs[j].name}' under '${p.name}' read as different kinds, but their Examples carry identical attributes — give each a differentia the other lacks, or merge them`,
          });
        }
      }
    }
    if (incomplete(p)) continue;
    const leftovers = pInfo.extent.filter((g) =>
      !subs.some((s) => isSuperset(intents.get(g), infos.get(s).intent)));
    if (leftovers.length) {
      const covered = pInfo.extent.length - leftovers.length;
      const who = leftovers.map((g) => `'- ${g.name}' (line ${g.line})`).join(", ");
      findings.push({
        line: Math.max(p.line, 1),
        message: `exhaustion: '${p.name}' divides into { ${subs.map((s) => s.name).join(", ")} }, but only ${covered} of its ${pInfo.extent.length} Examples match a sub-Concept by attributes — ${who} match${leftovers.length === 1 ? "es" : ""} none: the division misses a kind, or the Example lacks the attributes of its kind`,
      });
    }
  }

  findings.sort((a, b) => a.line - b.line);
  return { objects: objects.length, columns: display.size, concepts: lattice.length, confirmed, findings };
}

module.exports = { suggest, buildContext, computeConcepts };
