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
//      reasoning the README ties to the Graph rationale). X <-> Y is the same
//      distinction written twice.
//
//   2. DECLARED dependencies (from the crosslinks). attribute-is-a-Concept
//      and the value links (default-is-a-Example / example-is-a-Example,
//      read as "the owner rests on the Concept whose Example the value
//      names") are edges "C depends on D"; a Concept that merely contains
//      another in its name, or is aliased to one, names a kind, not a
//      dependency. The transitive closure (Armstrong Transitivity) answers
//      --depends: what a Concept rests on directly and what it inherits
//      through a chain (Z depends on X through Y). Without the value edges
//      a link through a value would hide its dependency. The same closure
//      polices the axioms (`axioms`): a chain that leads back to its start
//      is an error (a dependency must ground out; X -> X is Reflexivity,
//      trivially true, so the loop asserts nothing), and a direct edge a
//      chain already implies is a warning (Transitivity makes the
//      declaration redundant). A direct self-edge stays legal recursion.
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
  const { attrPrime, naming, primeKey } = godel.buildGodel(root, nodes);
  const objects = nodes.filter((n) => n.kind === INDIVIDUAL && n.gvec);
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
  // carries (exponent >= 2 means "valued") — read off each Example's own
  // factorisation, then laid out in the attributes' order
  const byKey = new Map(); // attrKey -> Map(object -> code)
  for (const o of objects) {
    for (let i = 0; i < o.gvec.p.length; i++) {
      if (o.gvec.e[i] < 2) continue;
      const aKey = primeKey.get(o.gvec.p[i]);
      if (!byKey.has(aKey)) byKey.set(aKey, new Map());
      byKey.get(aKey).set(o, o.gvec.e[i]);
    }
  }
  const valuedOn = new Map();
  for (const aKey of attrPrime.keys()) if (byKey.has(aKey)) valuedOn.set(aKey, byKey.get(aKey));
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
  // Transitivity's minimal cover over the inferred set: an X -> Z that
  // X -> Y and Y -> Z already give is implied, so the squiggle channel skips
  // it (verify.js --fd still prints it, tagged with its witnessing chain).
  // A member of an equivalence (the back pair holds too) is immune —
  // dropping one direction could cost the pair's consequences both ways.
  // Removal is iterative in a fixed order (a dropped FD covers nothing
  // afterwards), so the surviving statements are minimal regardless of the
  // order the pairs arrived in.
  const cover = new Map(); // x -> Map(y -> h), the FDs still standing
  for (const h of holds) {
    if (!cover.has(h.x)) cover.set(h.x, new Map());
    cover.get(h.x).set(h.y, h);
  }
  const reach = (from, to) => { // one BFS path [from .. to] in cover, or null
    const prev = new Map();
    const queue = [from];
    const seen = new Set([from]);
    while (queue.length) {
      const n = queue.shift();
      for (const next of (cover.get(n) || new Map()).keys()) {
        if (seen.has(next)) continue;
        seen.add(next);
        prev.set(next, n);
        if (next === to) {
          const path = [to];
          for (let at = to; at !== from; at = prev.get(at)) path.unshift(prev.get(at));
          return path;
        }
        queue.push(next);
      }
    }
    return null;
  };
  const candidates = holds
    .filter((h) => !byPair.has(`${h.y} ${h.x}`))
    .sort((a, b) => `${label(a.x)} ${label(a.y)}`.localeCompare(`${label(b.x)} ${label(b.y)}`));
  for (const h of candidates) {
    cover.get(h.x).delete(h.y);
    const path = reach(h.x, h.y);
    if (path) h.implied = path.map(label);
    else cover.get(h.x).set(h.y, h);
  }
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
          message: `dependency: if they are meant to be the same distinction, model it once — '${label(h.x)}' and '${label(h.y)}' covary one-to-one across the Examples (${h.support} pairs, no value repeats): they track each other, but with no Example repeating a value this could be coincidence rather than a real equivalence (advisory: the file still verifies)`,
        });
      } else {
        out.push({
          line: Math.max(lx, ly), kind: "derivable", confidence, incomplete,
          message: `dependency: keep whichever reads clearer and derive the other — '${label(h.x)}' and '${label(h.y)}' are equivalent across the Examples (${h.support} agree, ${confidence} repeated value${confidence === 1 ? "" : "s"} confirm${confidence === 1 ? "s" : ""} it, none disagree): they record the same distinction twice, so one is redundant (advisory: the file still verifies)`,
        });
      }
    } else {
      out.push({
        line: ly, kind: "derivable", confidence: h.confirms, incomplete, implied: h.implied,
        message: `dependency: set '${label(h.y)}' once from '${label(h.x)}' instead of repeating it — '${label(h.y)}' looks derivable: across ${h.support} Examples, every one with the same '${label(h.x)}' also has the same '${label(h.y)}' (${h.confirms} repeated '${label(h.x)}' value${h.confirms === 1 ? "" : "s"} confirm${h.confirms === 1 ? "s" : ""} it), so '${label(h.x)}' determines '${label(h.y)}' (advisory: the file still verifies)`,
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
// attribute's name as its label 'via' and its declaring line as 'line' (the
// first declaration wins), and two attributes reaching the same Concept stay
// two edges, so a chain can say which slot carries it.
function dependencyGraph(root, nodes) {
  const { concepts } = index(root, nodes);
  const conceptNodes = [root, ...nodes].filter((n) => n.kind === CONCEPT);
  const edges = new Map(); // node -> [{ to, via, line }] direct dependencies
  const add = (from, to, via, line) => {
    if (from === to) return;
    if (!edges.has(from)) edges.set(from, []);
    const list = edges.get(from);
    if (!list.some((e) => e.to === to && e.via === via)) list.push({ to, via, line });
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
      if (t) add(c, t, child.name, child.line);
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
    if (from && to) add(from, to, via, d.line);
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

// The axioms as lint rules over the declared graph, both faces of
// Transitivity. A chain that leads back to its start is an **error**: a
// dependency must ground out, and a loop derives only X -> X — Reflexivity,
// trivially true — so it asserts nothing while leaving every member defined
// through the others. A direct edge that a chain through some *other*
// Concept already implies is a **warning**: the declaration is redundant,
// though the slot may still carry its own data. Two attributes of the same
// type (parallel edges) never imply each other — the witness chain must pass
// through an intermediate Concept. Direct self-reference (an attribute of
// one's own kind) stays legitimate recursion: `dependencyGraph` drops
// self-edges, so neither rule ever sees one. Each finding is pinned to the
// attribute (or value) line that declares the offending edge. Single-file,
// like the subsumption pass.
function axioms(root, nodes) {
  const { edges } = dependencyGraph(root, nodes);
  // one shortest path start -> goal by BFS, skipping any banned edge object;
  // returns the hops [{ node, via }] (start excluded), or null
  const pathBetween = (start, goal, banned) => {
    const prev = new Map(); // node -> { node: predecessor, via }
    const queue = [start];
    const seen = new Set([start]);
    while (queue.length) {
      const n = queue.shift();
      for (const e of edges.get(n) || []) {
        if ((banned && banned.has(e)) || seen.has(e.to)) continue;
        seen.add(e.to);
        prev.set(e.to, { node: n, via: e.via });
        if (e.to === goal) {
          const hops = [];
          for (let at = goal; at !== start; at = prev.get(at).node) hops.unshift({ node: at, via: prev.get(at).via });
          return hops;
        }
        queue.push(e.to);
      }
    }
    return null;
  };
  // render a chain the way the hover does: A ─via→ B ─via→ C
  const chainText = (start, hops) => [start.name, ...hops.map((h) => `─${h.via}→ ${h.node.name}`)].join(" ");
  const errors = [];
  const warnings = [];
  // an edge whose target reaches back to its source lies on a cycle. One
  // error per such edge: each is declared by one line, and removing any one
  // of them breaks the loop.
  const onCycle = new Set();
  for (const [from, list] of edges) {
    for (const e of list) {
      const back = pathBetween(e.to, from, null);
      if (!back) continue;
      onCycle.add(e);
      const loop = chainText(from, [{ node: e.to, via: e.via }, ...back]);
      errors.push({
        line: e.line,
        message: `dependency cycle: remove or retype one of the attributes that carry the loop — '${from.name}' rests on itself (${loop}): a dependency chain must ground out, but this one leads back to where it began; the loop derives only '${from.name} -> ${from.name}' (Reflexivity, trivially true), so it asserts nothing and no member ever reaches solid ground`,
      });
    }
  }
  // a direct edge whose target is still reachable once every parallel
  // direct edge is banned is implied by the witnessing chain
  for (const [from, list] of edges) {
    const byTarget = new Map(); // to -> the parallel direct edges
    for (const e of list) {
      if (!byTarget.has(e.to)) byTarget.set(e.to, []);
      byTarget.get(e.to).push(e);
    }
    for (const [to, direct] of byTarget) {
      const witness = pathBetween(from, to, new Set(direct));
      if (!witness) continue;
      const chain = chainText(from, witness);
      for (const e of direct) {
        if (onCycle.has(e)) continue; // the cycle error already sits on this line
        warnings.push({
          line: e.line,
          message: `redundant dependency: drop '${e.via}', or drop an intermediate link if the direct dependency is the one you mean — '${e.via}' makes '${from.name}' rest on '${to.name}' directly, but the chain ${chain} already implies that (Transitivity), so the direct declaration adds nothing`,
        });
      }
    }
  }
  return { errors, warnings };
}

module.exports = { inferFDs, findings, dependencyGraph, dependsOf, chains, axioms, MIN_CONFIDENCE };
