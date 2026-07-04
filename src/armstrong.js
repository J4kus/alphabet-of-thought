// Functional-dependency reasoning over a parsed .aot tree, after Armstrong
// (1974), whose axioms — Reflexivity, Augmentation, Transitivity, Union,
// Decomposition, Pseudotransitivity — are the inference rules for functional
// dependencies. This module does NOT apply those rules: it works with
// single-attribute dependencies only, where the composite-set rules
// (Augmentation, Union, Decomposition, Pseudotransitivity) never arise and
// Reflexivity is vacuous. What it does is INFER FDs from the Example data,
// via Gödel numbers: two Examples that agree on attribute X agree on Y, for
// every Example carrying both? Then X -> Y. The check is a projection of the
// Gödel number: group the Examples by the exponent of X's prime and ask
// whether Y's exponent is constant in each group. An attribute Y determined
// by another X is derivable — a redundancy worth modelling once (3NF, the
// normalisation reasoning the README ties to the Graph primitive). X <-> Y is
// the same distinction written twice.
//
// Transitivity was the one axiom ever mechanized here — the transitive
// closure of DECLARED dependencies (attribute-is-a-Concept and
// concept-contains-Concept edges), which answered the CLI's --depends. That
// code (dependsOf, dependencyGraph, containedConcepts, conceptOf) was removed
// with verify.js; see the restore item in TODO.md.
//
// Inferred-FD findings are advisory, like the FCA / Gödel-clash hints: surfaced
// only over a tree that verifies (V = 0), never counted in V. Pure: no I/O,
// depends only on ./linter, ./crosslinks and ./godel.

const { KIND } = require("./linter");
const godel = require("./godel");

const { INDIVIDUAL, ATTRIBUTE, DEFAULT, MAP } = KIND;

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
// only findings at or above this threshold; weaker ones are not surfaced.
// At 2, a single confirming repeat is not enough — a
// 3-Example case (where a varying attribute can muster at most one repeat)
// never squiggles; it takes >= 4 Examples with a genuine repeat. Drop to 1 to
// flag any witnessed repeat, or 0 to flag bare one-to-one covariation too.
const MIN_CONFIDENCE = 2;

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

module.exports = { inferFDs, findings, MIN_CONFIDENCE };
