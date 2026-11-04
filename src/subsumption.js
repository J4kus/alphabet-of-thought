// Description-logic subsumption over a parsed .aot tree — the authority on
// the Concept hierarchy.
//
// The prime/divisibility numbering in linter.js records where each line was
// written; on its own it takes that placement on faith. This reasoner
// derives the hierarchy a second time from each Concept's declared facts and
// holds the written tree to it: a placement the definitions contradict is an
// error, so primes are now a cache the reasoner validates, not the last word.
//
// A Concept's conjunction-only definition is read, with no new syntax, from
// the features it already declares (after Description Logics' EL, where a
// definition is a conjunction of attributes and other Concepts):
//
//     intent(C)     the features C declares directly: its attribute and
//                   default children (name, and name: value), the Concepts
//                   it crosslinks to, and a value's own ancestry when the
//                   value names an Example (`operation: Ratio` also gives
//                   `operation: Formula`)
//     effIntent(C)  intent(C) plus everything C inherits from its ancestors,
//                   with overrides honoured: the nearest declaration of an
//                   attribute's value wins, so a child's `: hot` shadows an
//                   ancestor's `: cold`
//
//     C is-a D   D's whole definition is satisfied by C
//                <=>  intent(D) is a subset of effIntent(C)
//
// A definition is closed (necessary and sufficient, the kind ≡ its facts)
// unless the Concept carries a `...` Map child, which marks it open (its
// facts are merely necessary, ⊑, with more differentiae to come — the same
// "still incomplete" the differentia and child-count checks already read a
// `...` to mean). An open Concept is never an inferred genus (its facts are
// not sufficient to classify another), and is itself left unjudged (its
// definition is not yet complete enough to call misfiled or equivalent).
//
// Holding the tree to the derived order yields the errors:
//
//     misfiling      C's one most-specific genus is a Concept filed
//                    elsewhere — the Whale whose facts are a Mammal's but is
//                    filed under Fish
//     multiple kinds C satisfies two genera, neither under the other — a
//                    Concept must name one kind (the real single-inheritance
//                    check, replacing the tautological gcd one in linter.js)
//     equivalence    two Concepts share one definition, indistinguishable
//     cycle          a loop of mutual is-a, an inconsistent order
//
// A genus must rest on at least two declared attribute names: one shared
// word is coincidence, not a kind. Value pairs refine a name and never, on
// their own, make a kind. Shared by the linter, so findings surface as
// errors in the CLI and the VS Code extension. Pure: no I/O, no dependencies
// beyond ./linter and ./crosslinks.

const { KIND } = require("./linter");
const { index, wordStarts, instantiates } = require("./crosslinks");
const { CONCEPT, ATTRIBUTE, DEFAULT, MAP } = KIND;

function isSuperset(sup, sub) {
  for (const x of sub) if (!sup.has(x)) return false;
  return true;
}

const setKey = (s) => [...s].sort().join("\0");

// The Concept a node's name (or exclusive alias) names, as in crosslinks.js
// (attribute-is-a-Concept): an alias, when present, is the only type.
const conceptOf = (node, concepts) => {
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

// The features a node declares through its attribute and default children,
// independent of what it inherits: { names, valuesByAttr }. names holds the
// attribute names and the Concepts those attributes crosslink to; for the
// override-aware merge in effIntent, value pairs are grouped by the name
// they refine. A default whose value names an Example contributes that
// Example's ancestry too (`operation: Ratio` -> `: Formula`, `: Arithmetic`),
// reusing crosslinks.instantiates exactly as fca.buildContext does.
function attrFeatures(node, concepts, individuals, root, keyOf) {
  const names = new Set();
  const valuesByAttr = new Map();
  for (const child of node.children) {
    if (child.kind !== ATTRIBUTE && child.kind !== DEFAULT) continue;
    const attrKey = keyOf(child.name);
    names.add(attrKey);
    const type = conceptOf(child, concepts);
    if (type) names.add(keyOf(type.name));
    if (child.kind !== DEFAULT) continue;
    const vals = valuesByAttr.get(attrKey) || new Set();
    vals.add(keyOf(`${child.name}: ${child.value}`));
    const target = individuals.get(child.value.toLowerCase());
    if (target && target !== child && instantiates(target, child.name)) {
      for (let a = target.parent; a && a !== root; a = a.parent) {
        if (a.name.toLowerCase() === child.name.toLowerCase()) break;
        vals.add(keyOf(`${child.name}: ${a.name}`));
      }
    }
    valuesByAttr.set(attrKey, vals);
  }
  return { names, valuesByAttr };
}

// The Concepts named inside a Concept's own name (concept-contains-Concept):
// each longest, non-overlapping run of words that names another Concept.
function containedConcepts(concept, concepts, keyOf) {
  const out = new Set();
  const ws = [];
  for (const m of concept.name.matchAll(/\S+/g)) ws.push({ start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < ws.length; ) {
    let matched = false;
    for (let j = ws.length - 1; j >= i; j--) {
      if (i === 0 && j === ws.length - 1) continue; // the whole name is this Concept
      const target = concepts.get(concept.name.slice(ws[i].start, ws[j].end).toLowerCase());
      if (target && target !== concept) {
        out.add(keyOf(target.name));
        i = j + 1;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return out;
}

// Derive subsumption from the Concepts' definitions and audit the written
// tree against it. Returns { findings, edges }: findings are { line, message }
// sorted by line (all errors), edges is the count of derived is-a links.
function subsume(root, nodes) {
  const { concepts, individuals } = index(root, nodes);
  const keyOf = (text) => text.trim().toLowerCase();
  const everyNode = [root, ...nodes];
  const all = everyNode.filter((n) => n.kind === CONCEPT);

  // Per-node declared features (any kind: a Concept can inherit from an
  // Example ancestor, e.g. `Mind` under `- Network`).
  const feat = new Map();
  for (const node of everyNode) feat.set(node, attrFeatures(node, concepts, individuals, root, keyOf));

  // Per-Concept own definition: declared names (incl. contained Concepts)
  // and the full intent (names plus every value pair).
  const names = new Map(); // names only, for the two-feature genus threshold
  const intent = new Map(); // full definition, for subset matching
  for (const c of all) {
    const f = feat.get(c);
    const nm = new Set(f.names);
    for (const k of containedConcepts(c, concepts, keyOf)) nm.add(k);
    names.set(c, nm);
    const full = new Set(nm);
    for (const vals of f.valuesByAttr.values()) for (const v of vals) full.add(v);
    intent.set(c, full);
  }

  // effIntent: own definition, then every ancestor's declared features, with
  // the nearest value for each attribute winning (overrides shadow defaults).
  const effIntent = new Map();
  for (const c of all) {
    const eff = new Set(names.get(c));
    const valued = new Set();
    for (const [attr, vals] of feat.get(c).valuesByAttr) {
      valued.add(attr);
      for (const v of vals) eff.add(v);
    }
    for (let a = c.parent; a; a = a.parent) {
      const f = feat.get(a);
      for (const n of f.names) eff.add(n);
      for (const [attr, vals] of f.valuesByAttr) {
        if (valued.has(attr)) continue; // a nearer declaration already won
        valued.add(attr);
        for (const v of vals) eff.add(v);
      }
    }
    effIntent.set(c, eff);
  }

  const isAncestor = (a, c) => {
    for (let p = c.parent; p; p = p.parent) if (p === a) return true;
    return false;
  };
  const related = (a, b) => a === b || isAncestor(a, b) || isAncestor(b, a);

  // A Concept whose definition equals its nearest Concept-ancestor's adds no
  // differentia of its own, so it is no one's genus.
  const ancestorConcept = (c) => {
    for (let a = c.parent; a; a = a.parent) if (a.kind === CONCEPT) return a;
    return null;
  };
  const vacuous = (c) => {
    const anc = ancestorConcept(c);
    return anc && setKey(intent.get(c)) === setKey(intent.get(anc));
  };

  // An open definition (a `...` Map child) is merely necessary, not
  // sufficient: more differentiae may come. Such a Concept never classifies
  // another (excluded as a genus) and is itself left unjudged below.
  const isOpen = (c) => c.children.some((ch) => ch.kind === MAP);

  // Every Concept whose whole definition C satisfies — ancestors included,
  // because the placement is correct only when C's genus is one of them. A
  // genus rests on two declared names; an equal definition is an equivalence,
  // not a genus, and is handled on its own below.
  const subsumers = (c) => {
    const ck = setKey(intent.get(c));
    return all.filter((d) =>
      d !== c && d !== root &&
      names.get(d).size >= 2 &&
      !vacuous(d) &&
      !isOpen(d) &&
      setKey(intent.get(d)) !== ck &&
      isSuperset(effIntent.get(c), intent.get(d)));
  };

  // The most-specific subsumers: C's genera. A subsumer another subsumer is
  // a kind of is left out.
  const generaOf = (c) => {
    const cands = subsumers(c);
    return cands.filter((d) =>
      !cands.some((e) => e !== d && intent.get(e).size > intent.get(d).size && isSuperset(intent.get(e), intent.get(d))));
  };
  const genera = new Map();
  for (const c of all) genera.set(c, generaOf(c));
  let edges = 0;
  for (const g of genera.values()) edges += g.length;

  const findings = [];

  // Cycle: a loop of mutual is-a in the derived order. Distinct definitions
  // that subsume one another (an equal definition is the equivalence case)
  // cannot be laid out as a hierarchy at all. Depth-first search for a back
  // edge; report each loop once, and leave its members out of the placement
  // checks, which assume an acyclic order.
  const color = new Map();
  const stack = [];
  const cycleMembers = new Set();
  const seenCycle = new Set();
  const walk = (u) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of genera.get(u)) {
      if (color.get(v) === 1) {
        const loop = stack.slice(stack.indexOf(v));
        const k = setKey(new Set(loop));
        if (!seenCycle.has(k)) {
          seenCycle.add(k);
          for (const n of loop) cycleMembers.add(n);
          findings.push({
            line: Math.max(...loop.map((n) => n.line)),
            message: `give one a differentia the others lack, to break the loop — ${loop.map((n) => `'${n.name}'`).join(" is a ")} is a '${loop[0].name}': the definitions form a loop of mutual is-a, which no hierarchy can hold`,
          });
        }
      } else if (!color.get(v)) {
        walk(v);
      }
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const c of all) if (!color.get(c)) walk(c);

  // Placement: each Concept's genera must be exactly the ancestor it is
  // written under. One genus elsewhere is a misfiling; two incomparable
  // genera are two kinds under one name (single-inheritance, for real).
  for (const c of all) {
    if (c === root || !intent.get(c).size || vacuous(c) || cycleMembers.has(c) || isOpen(c)) continue;
    const g = genera.get(c);
    if (!g.length) continue;
    const byIntent = new Map();
    for (const d of g) {
      const k = setKey(intent.get(d));
      if (!byIntent.has(k)) byIntent.set(k, []);
      byIntent.get(k).push(d);
    }
    const groups = [...byIntent.values()];
    if (groups.length >= 2) {
      const [a, b] = groups.map((grp) => grp[0]);
      findings.push({
        line: c.line,
        message: `place it under one and crosslink the other's attributes, or split '${c.name}' — '${c.name}' is a '${a.name}' and a '${b.name}', neither of which is the other: a Concept names one kind, but its facts satisfy two`,
      });
      continue;
    }
    const group = groups[0];
    if (group.some((d) => isAncestor(d, c))) continue; // genus is the written ancestor: consistent
    const who = group.map((d) => `'${d.name}'`).join(" or ");
    findings.push({
      line: c.line,
      message: `file it under ${who}, or give it a differentia they lack — '${c.name}' declares every attribute that defines ${who}, yet it is filed under '${c.parent.name}': by its definition '${c.name}' is a ${group.length === 1 ? group[0].name : "kind of one of them"}`,
    });
  }

  // Equivalence: two Concepts with one definition, filed neither above nor
  // below one another, cannot be told apart by their facts. Report once per
  // pair, on the later line.
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    if (c === root || names.get(c).size < 2 || vacuous(c) || isOpen(c)) continue;
    for (let j = i + 1; j < all.length; j++) {
      const d = all[j];
      if (d === root || vacuous(d) || isOpen(d) || related(c, d)) continue;
      if (setKey(intent.get(c)) === setKey(intent.get(d))) {
        const late = d.line >= c.line ? d : c;
        const other = late === d ? c : d;
        findings.push({
          line: late.line,
          message: `give one a differentia, or merge them — '${late.name}' and '${other.name}' carry the same definition: their declared attributes are identical, so the facts cannot tell the two kinds apart`,
        });
      }
    }
  }

  findings.sort((a, b) => a.line - b.line);
  return { findings, edges };
}

module.exports = { subsume, attrFeatures };
