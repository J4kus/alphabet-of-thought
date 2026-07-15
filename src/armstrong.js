// Functional-dependency reasoning over a parsed .aot tree, after Armstrong
// (1974), whose axioms — Reflexivity, Augmentation, Transitivity, Union,
// Decomposition, Pseudotransitivity — are the inference rules for functional
// dependencies. This module makes them part of the linter in two ways:
//
//   1. INFERRED FDs (from the Example data, via Gödel numbers). Two Examples
//      that agree on attribute X agree on Y, for every Example carrying both?
//      Then X -> Y. The check is a projection of the Gödel number: group the
//      Examples by the exponent of X's prime and ask whether Y's exponent is
//      constant in each group. An attribute Y determined by another X is
//      derivable — a redundancy worth modelling once (3NF, the normalisation
//      reasoning the README ties to the Graph primitive). X <-> Y is the same
//      distinction written twice.
//
//   2. DECLARED dependencies (from the crosslinks). attribute-is-a-Concept,
//      concept-contains-Concept, a Concept's alias, and the value links
//      (default-is-a-Example / example-is-a-Example, read as "the owner
//      rests on the Concept whose Example the value names") are all edges
//      "C depends on D"; their transitive closure (Armstrong Transitivity)
//      answers --depends: what a Concept rests on directly and what it
//      inherits through a chain (Z depends on X through Y). Without the
//      value edges a link through a value would hide its dependency.
//
// Inferred-FD findings are advisory, like the FCA / Gödel-clash hints: surfaced
// only over a tree that verifies (V = 0), never counted in V. Pure: no I/O,
// depends only on ./linter, ./crosslinks and ./godel.

const { KIND } = require("./linter");
const { index, conceptType, individualsIndex, valueTarget, listedTarget, owningConcept } = require("./crosslinks");
const godel = require("./godel");

const { CONCEPT, INDIVIDUAL, ATTRIBUTE, DEFAULT, MAP } = KIND;

// A node is declared intentionally incomplete by an ellipsis among its
// children — either a `...` Map (the README's marker, which excuses the
// structural warnings) or a `- ...` Example. Examples under such a node are an
// admitted partial sample, so any FD read off them is provisional: still worth
// reporting on demand, but never confident enough for an editor squiggle.
const isEllipsis = (c) => c.kind === MAP || (c.kind === INDIVIDUAL && c.name === "...");
const isIncomplete = (node) => node.children.some(isEllipsis);

// An inferred FD needs a few Examples behind it; one or two coincidences are
// not a dependency.
const MIN_SUPPORT = 3;

// Confidence = the number of *confirming repeats* behind an FD: Examples that
// share an earlier Example's X-value and still agree on Y, i.e. support minus
// the count of distinct X-values. It is the evidence that Y collapses with X
// rather than merely lining up with it. Zero means a pure bijection (every
// Example distinct on both sides): the attributes covary one-to-one but no
// collapse is ever witnessed, so it could be coincidence. The editor flags
// only findings at or above this threshold; weaker ones stay on demand via
// `verify.js --fd`. At 2, a single confirming repeat is not enough — a
// 3-Example case (where a varying attribute can muster at most one repeat)
// never squiggles; it takes >= 4 Examples with a genuine repeat. Drop to 1 to
// flag any witnessed repeat, or 0 to flag bare one-to-one covariation too.
const MIN_CONFIDENCE = 2;

// The Concepts named inside a Concept's own name (concept-contains-Concept):
// each longest, non-overlapping run of words that names another Concept.
function containedConcepts(concept, concepts) {
  const out = [];
  const ws = [];
  for (const m of concept.name.matchAll(/\S+/g)) ws.push({ start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < ws.length; ) {
    let matched = false;
    for (let j = ws.length - 1; j >= i; j--) {
      if (i === 0 && j === ws.length - 1) continue; // the whole name is this Concept
      const target = concepts.get(concept.name.slice(ws[i].start, ws[j].end).toLowerCase());
      if (target && target !== concept) {
        out.push(target);
        i = j + 1;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return out;
}

// Infer single-attribute functional dependencies from the Example data. Returns
// { holds, label, lineOf, objects }: holds is [{ x, y, support }] for every
// X -> Y that the Examples bear out under the guards above.
function inferFDs(root, nodes) {
  const { attrPrime, naming } = godel.buildGodel(root, nodes);
  const objects = nodes.filter((n) => n.kind === INDIVIDUAL && n.godel !== undefined);
  const label = (k) => naming.get(k) || k;

  // a readable defining line per attribute key (first declaration)
  const lineOf = new Map();
  for (const n of [root, ...nodes]) {
    for (const child of n.children) {
      if (child.kind !== ATTRIBUTE && child.kind !== DEFAULT) continue;
      const k = child.name.trim().toLowerCase();
      if (!lineOf.has(k) || child.line < lineOf.get(k)) lineOf.set(k, child.line);
    }
  }

  // per attribute, the Examples that give it a value and the value code each
  // carries (exponent >= 2 means "valued")
  const valuedOn = new Map(); // attrKey -> Map(object -> code)
  for (const [aKey, p] of attrPrime) {
    const m = new Map();
    for (const o of objects) {
      const e = godel.valuation(o.godel, p);
      if (e >= 2n) m.set(o, e);
    }
    if (m.size) valuedOn.set(aKey, m);
  }
  const valuedAttrs = [...valuedOn.keys()];

  const holds = [];
  for (const x of valuedAttrs) {
    for (const y of valuedAttrs) {
      if (x === y) continue;
      const xm = valuedOn.get(x), ym = valuedOn.get(y);
      const both = objects.filter((o) => xm.has(o) && ym.has(o));
      if (both.length < MIN_SUPPORT) continue;
      // both sides must vary, else the "dependency" is a constant, not a rule
      const xVals = new Set(both.map((o) => xm.get(o)));
      const yVals = new Set(both.map((o) => ym.get(o)));
      if (xVals.size < 2 || yVals.size < 2) continue;
      // X -> Y holds iff Y is constant within every X-group
      const groups = new Map();
      let ok = true;
      for (const o of both) {
        const gx = xm.get(o);
        if (!groups.has(gx)) groups.set(gx, ym.get(o));
        else if (groups.get(gx) !== ym.get(o)) { ok = false; break; }
      }
      if (!ok) continue;
      // When X is distinct on every Example (a key), every X-group is a
      // singleton and X -> Y is vacuously true for *any* Y — no evidence. Keep
      // such a case only if Y is a key too, i.e. a genuine bijection (the "same
      // distinction written twice" pair), not a key implying an unrelated column.
      const xIsKey = xVals.size === both.length;
      if (xIsKey && yVals.size !== both.length) continue;
      // confirming repeats: Examples beyond the first in each X-group. Zero iff
      // X is distinct on every Example (a bijection) — covariation, not a
      // witnessed collapse. See MIN_CONFIDENCE.
      const confirms = both.length - xVals.size;
      // provisional if any witnessing Example sits under an ellipsis-marked
      // node: the sample is admittedly partial, so the FD never squiggles.
      const incomplete = both.some((o) => o.parent && isIncomplete(o.parent));
      holds.push({ x, y, support: both.length, confirms, incomplete });
    }
  }
  return { holds, label, lineOf, objects: objects.length };
}

// Advisory findings for the lint pass, each reported once and tagged with a
// 'kind' and a 'confidence' (see MIN_CONFIDENCE):
//   - 'covaries'  X <-> Y line up one-to-one but no value ever repeats, so the
//                 match is unconfirmed (confidence 0) — could be coincidence.
//   - 'derivable' Y is determined by X, confirmed by repeated X-values, either
//                 one-directional (X -> Y) or an equivalence (X <-> Y).
function findings(root, nodes) {
  const { holds, label, lineOf } = inferFDs(root, nodes);
  const byPair = new Map(holds.map((h) => [`${h.x} ${h.y}`, h]));
  const out = [];
  const reported = new Set();
  for (const h of holds) {
    const back = byPair.get(`${h.y} ${h.x}`);
    const key = back ? [h.x, h.y].sort().join(" ") : `${h.x} ${h.y}`;
    if (reported.has(key)) continue;
    reported.add(key);
    const lx = lineOf.get(h.x) || 1, ly = lineOf.get(h.y) || 1;
    // an ellipsis under either side's Examples makes the whole finding provisional
    const incomplete = back ? (h.incomplete || back.incomplete) : h.incomplete;
    if (back) {
      // equivalence: confidence is the collapse witnessed on either side.
      const confidence = Math.max(h.confirms, back.confirms);
      if (confidence === 0) {
        out.push({
          line: Math.max(lx, ly), kind: "covaries", confidence, incomplete,
          message: `dependency: '${label(h.x)}' and '${label(h.y)}' covary one-to-one across the Examples (${h.support} pairs, no value repeats) — they track each other, but with no Example repeating a value this could be coincidence rather than a real equivalence; if they are meant to be the same distinction, model it once (advisory: the file still verifies)`,
        });
      } else {
        out.push({
          line: Math.max(lx, ly), kind: "derivable", confidence, incomplete,
          message: `dependency: '${label(h.x)}' and '${label(h.y)}' are equivalent across the Examples (${h.support} agree, ${confidence} repeated value${confidence === 1 ? "" : "s"} confirm${confidence === 1 ? "s" : ""} it, none disagree) — they record the same distinction twice, so one is redundant; keep whichever reads clearer and derive the other (advisory: the file still verifies)`,
        });
      }
    } else {
      out.push({
        line: ly, kind: "derivable", confidence: h.confirms, incomplete,
        message: `dependency: '${label(h.y)}' looks derivable — across ${h.support} Examples, every one with the same '${label(h.x)}' also has the same '${label(h.y)}' (${h.confirms} repeated '${label(h.x)}' value${h.confirms === 1 ? "" : "s"} confirm${h.confirms === 1 ? "s" : ""} it), so '${label(h.x)}' determines '${label(h.y)}'; set '${label(h.y)}' once from '${label(h.x)}' instead of repeating it (advisory: the file still verifies)`,
      });
    }
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

// The declared Concept-dependency graph and its transitive closure. An edge
// "C depends on D" comes only from an **attribute** of C that names D — the
// attribute-is-a-Concept crosslink, or a value whose Example belongs to D.
// A Concept that merely contains or is-aliased-to another names a *kind*,
// not a dependency, so those crosslinks are excluded. Each edge keeps the
// attribute's name as its label 'via', and two attributes reaching the same
// Concept stay two edges, so a chain can say which slot carries it.
function dependencyGraph(root, nodes) {
  const { concepts } = index(root, nodes);
  const conceptNodes = [root, ...nodes].filter((n) => n.kind === CONCEPT);
  const edges = new Map(); // node -> [{ to, via }] direct dependencies
  const add = (from, to, via) => {
    if (from === to) return;
    if (!edges.has(from)) edges.set(from, []);
    const list = edges.get(from);
    if (!list.some((e) => e.to === to && e.via === via)) list.push({ to, via });
  };
  // A dependency is a Concept resting on another through an **attribute** —
  // a `human` slot makes a Concept depend on `Human`. A Concept whose name
  // merely contains another (`Recurring Tree`), or whose alias names another
  // (`Auto (Car)`), is a differentia of that kind, not a dependency on it:
  // those crosslinks still navigate, but they are not edges here.
  for (const c of conceptNodes) {
    for (const child of c.children) {
      if (child.kind !== ATTRIBUTE && child.kind !== DEFAULT) continue;
      const t = conceptType(child, concepts);
      if (t) add(c, t, child.name);
    }
  }
  // Value links declare dependencies too: a value (or listed Example) that
  // names an Example of another Concept makes its owner rest on that
  // Concept — `person: Socrates` with Socrates under Human is an edge
  // "owner depends on Human" via 'person'. Without these edges, linking
  // through a value would hide the dependency the link creates.
  const byName = individualsIndex(nodes);
  for (const d of nodes) {
    let target = null, via = null;
    if (d.kind === DEFAULT && d.value) {
      target = valueTarget(d, concepts, byName);
      via = d.name;
    } else if (d.kind === INDIVIDUAL) {
      target = listedTarget(d, concepts, byName);
      via = target && d.parent.name;
    }
    if (!target) continue;
    const from = owningConcept(d);
    const to = owningConcept(target);
    if (from && to) add(from, to, via);
  }
  return { edges, conceptNodes };
}

// What a Concept depends on, direct and transitive. Returns
// { direct: [node], transitive: [{ node, through: [node] }] } where 'through'
// is one witnessing path (Armstrong Transitivity / Pseudotransitivity).
function dependsOf(root, nodes, concept) {
  const { edges } = dependencyGraph(root, nodes);
  const direct = new Set((edges.get(concept) || []).map((e) => e.to));
  const pathTo = new Map(); // node -> path of intermediate nodes
  const queue = [...direct].map((d) => ({ node: d, path: [] }));
  const seen = new Set([concept, ...direct]);
  while (queue.length) {
    const { node, path } = queue.shift();
    for (const { to: next } of edges.get(node) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const through = [...path, node];
      pathTo.set(next, through);
      queue.push({ node: next, path: through });
    }
  }
  const transitive = [...pathTo].map(([node, through]) => ({ node, through }));
  return { direct: [...direct], transitive };
}

// keep a hover readable: a Concept rarely needs more chains than this shown
const MAX_CHAINS = 32;

// Every declared dependency chain out of a Concept, depth-first: follow the
// edges until a Concept with no dependencies ends the chain, or a hop that
// would revisit a Concept already on the path marks it a cycle and stops. A
// Concept with several crosslinked attributes has several chains — one per
// edge — and a chain grows by one Concept for every dependency the previous
// link declares. Returns [{ path: [node...], via: [label...], cycle }] with
// via[i] naming the crosslink that carries the hop path[i] -> path[i+1].
function chains(root, nodes, concept) {
  const { edges } = dependencyGraph(root, nodes);
  const out = [];
  const walk = (node, path, via) => {
    if (out.length >= MAX_CHAINS) return;
    const next = edges.get(node) || [];
    if (!next.length) {
      if (path.length > 1) out.push({ path, via, cycle: false });
      return;
    }
    for (const { to, via: label } of next) {
      if (path.includes(to)) {
        out.push({ path: [...path, to], via: [...via, label], cycle: true });
        continue;
      }
      walk(to, [...path, to], [...via, label]);
    }
  };
  walk(concept, [concept], []);
  return out;
}

module.exports = { inferFDs, findings, dependencyGraph, dependsOf, chains, MIN_CONFIDENCE };
