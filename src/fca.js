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
// Pure: no I/O, no dependencies.

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
// collected from the Example and every ancestor that is one of its kinds;
// for the value column the nearest declaration wins (an override shadows
// the inherited default). An Example above it — the `- Parent` of a
// `- Child`, the row a nested row sits under — is the whole it is a part
// of, and a part inherits nothing from its whole, so that Example's lines
// are passed over, exactly as godel.effFeatures passes them. Keys are
// lowercased; `display` keeps the original casing for reports.
//
// Crosslinks deepen the columns, because the rationales define
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
  // the Concept an attribute names, as in crosslinks.js: an alias is
  // exclusive (only it types the attribute when present), else the longest
  // trailing run of the name wins
  const conceptOf = (node) => {
    if (node.alias) {
      const target = concepts.get(node.alias.toLowerCase());
      return target && target !== node ? target : null;
    }
    for (const start of wordStarts(node.name)) {
      const target = concepts.get(node.name.slice(start).toLowerCase());
      if (target && target !== node) return target;
    }
    return null;
  };
  const objects = nodes.filter((n) => n.kind === INDIVIDUAL);
  const intents = new Map();
  const directs = new Map(); // columns the Example declares itself, not inherited
  const origins = new Map(); // per Example: column key -> nearest declaring node
  for (const g of objects) {
    const intent = new Set();
    const direct = new Set();
    const origin = new Map();
    const valued = new Set();
    const declared = new Map(); // name key -> its nearest declaration
    // a value's columns: the `attribute: value` pair and, when the value
    // names an Example, that Example's ancestry
    const putValue = (put, child, value, type) => {
      put(`${child.name}: ${value}`);
      // A value naming an Example contributes that Example's ancestry as
      // columns, so a deep value groups with the shallower kinds above it.
      // The Examples an attribute ranges over live in one of two places,
      // and both anchor the walk the same way: the attribute itself, when
      // it directly holds them (`operation` with `- Formula`, `- Observation`
      // beneath, so `operation: Ratio` yields `operation: Formula`), or the
      // Concept that types it (attribute-is-a-Concept, `shade colour` naming
      // the `Colour` Concept whose Examples are `- Red`, `- Crimson`, so
      // `shade colour: Crimson` yields `shade colour: Red`). The walk stops
      // at whichever anchor the Example sits under.
      const target = individuals.get(String(value).toLowerCase());
      const anchor =
        target && target !== child
          ? instantiates(target, child.name)
            ? child.name
            : type && instantiates(target, type.name)
              ? type.name
              : null
          : null;
      if (anchor) {
        const stop = anchor.toLowerCase();
        for (let a = target.parent; a && a !== root; a = a.parent) {
          if (a.name.toLowerCase() === stop) break;
          put(`${child.name}: ${a.name}`);
        }
      }
    };
    for (let n = g; n; n = n.parent) {
      if (n !== g && n.kind === INDIVIDUAL) continue;
      const put = (text) => {
        const k = keyOf(text);
        intent.add(k);
        if (n === g) direct.add(k);
        if (!origin.has(k)) origin.set(k, n);
      };
      for (const child of n.children) {
        if (child.kind !== ATTRIBUTE && child.kind !== DEFAULT) continue;
        put(child.name);
        const type = conceptOf(child);
        if (type) put(type.name);
        const nameKey = keyOf(child.name);
        if (!declared.has(nameKey)) declared.set(nameKey, child);
        if (child.kind !== DEFAULT) continue;
        if (valued.has(nameKey)) continue;
        valued.add(nameKey);
        putValue(put, child, child.value, type);
      }
    }
    // an attribute nothing valued reads its type's default (`Currency: EUR`
    // for a `currency`), as godel.effFeatures reads it — a column of the
    // Example's, though not one it declares itself
    for (const [nameKey, child] of declared) {
      if (valued.has(nameKey)) continue;
      const type = conceptOf(child);
      if (!type || type.value == null || String(type.value) === "") continue;
      const put = (text) => {
        const k = keyOf(text);
        intent.add(k);
        if (!origin.has(k)) origin.set(k, type);
      };
      putValue(put, child, type.value, type);
    }
    intents.set(g, intent);
    directs.set(g, direct);
    origins.set(g, origin);
  }
  return { objects, intents, directs, origins, display };
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
  const { objects, intents, origins, display } = buildContext(root, nodes);
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

  // a Concept that declares no attribute of its own has an implied `...`:
  // with nothing of its own yet to tell it apart its differentia is still to
  // come, exactly as a Map would declare — the same reading the differentia
  // check in linter.js and the clash check in godel.js both apply. An inline
  // Example (`Run Command: code ...`) is content, not an attribute, so it does
  // not count; inherited columns are the genus, shared by every sibling, never
  // a differentia. Such a Concept cannot be told from a sibling by attributes
  // because it asserts none, so the identical-intent comparison excuses it.
  const assertsOwnAttr = (n) =>
    n.children.some((c) => c.kind === ATTRIBUTE || c.kind === DEFAULT);

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

  // all genus: a Concept whose whole intent is declared above it —
  // every shared column originates on an ancestor, none on the Concept
  // itself or its Examples — asserts nothing of its own to drift toward:
  // an outside Example matching that intent matches the surroundings,
  // not the kind, so the drift check skips it. A column declared on the
  // Concept or beneath it (its subtree, by divisibility) is its own.
  const allInherited = (c, info) =>
    ![...info.intent].some((k) =>
      info.extent.some((g) => origins.get(g).get(k).chi % c.chi === 0n));

  // drift needs both sides of the fence to assert something. The guards
  // above hold the Concept drifted *toward* to at least one explicit
  // attribute; the Concept the Example is filed *under* must own one too —
  // declared on it or beneath it (its Examples included), never inherited.
  // A home that declares nothing states no differentia to hold or release
  // an Example by, so no drift is reported from it.
  const attrDecls = nodes.filter((n) => n.kind === ATTRIBUTE || n.kind === DEFAULT);
  const ownsAttr = (c) => attrDecls.some((n) => n.chi % c.chi === 0n);
  const homeOf = (g) => {
    for (let a = g.parent; a; a = a.parent) if (a.kind === CONCEPT) return a;
    return root;
  };

  // drift: an Example that satisfies a Concept's full intent but
  // sits elsewhere. Report only the most specific Concept(s) per
  // Example — matching a sub-Concept implies matching its ancestors.
  // A `...` on either side of the fence — a Map child, or the Example form
  // `- ...` as armstrong reads it — declares that side intentionally
  // incomplete, so drift over it is provisional and not reported: neither
  // toward an open Concept, nor away from an open home (and an ellipsis
  // Example itself never drifts).
  const open = (n) => incomplete(n)
    || n.children.some((c) => c.kind === INDIVIDUAL && c.name.trim() === "...");
  const driftByObject = new Map();
  for (const [c, info] of infos) {
    if (c === root || !info.intent.size || vacuous.has(c) || allInherited(c, info) || open(c)) continue;
    for (const g of objects) {
      if (info.extent.includes(g)) continue;
      if (g.name.trim() === "...") continue;
      if (!ownsAttr(homeOf(g)) || open(homeOf(g))) continue;
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
      const move = group.length === 1 ? `move it under ${names}` : `move it under one of ${names}`;
      const differentia = group.length === 1 ? `give ${names} a differentia` : `give them a differentia`;
      findings.push({
        line: g.line,
        message: `drift: ${move}, or ${differentia} that genuinely excludes it — '- ${g.name}' carries every attribute the Examples of ${names} share, yet it is filed under '${g.parent.name}'`,
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
        if (!assertsOwnAttr(subs[i]) || !assertsOwnAttr(subs[j])) continue;
        if (setKey(infos.get(subs[i]).intent) === setKey(infos.get(subs[j]).intent)) {
          findings.push({
            line: subs[j].line,
            message: `exhaustion: give each a differentia the other lacks, or merge them — '${subs[i].name}' and '${subs[j].name}' under '${p.name}' read as different kinds, but their Examples carry identical attributes`,
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
        message: `exhaustion: add the kind the division misses, or give the Example the attributes of its kind — '${p.name}' divides into { ${subs.map((s) => s.name).join(", ")} }, but only ${covered} of its ${pInfo.extent.length} Examples match a sub-Concept by attributes: ${who} match${leftovers.length === 1 ? "es" : ""} none`,
      });
    }
  }

  findings.sort((a, b) => a.line - b.line);
  return { objects: objects.length, columns: display.size, concepts: lattice.length, confirmed, findings };
}

module.exports = { suggest, buildContext, computeConcepts };
