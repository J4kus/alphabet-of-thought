// A short grace on the nagging warnings: every squiggle appears as soon as
// the linter settles, EXCEPT the "'X' has 1 sub-Concept" and "'X' has 1
// sub-Example" warnings. Those fire on the *parent* the moment the first
// child is typed — before the second can exist — so they interrupt a
// thought mid-line. They wait until typing has stopped for a breath (the
// extension's grace timer), by which point the sibling either exists (no
// warning at all) or the writer has genuinely paused.
//
// Two pure halves, wired by the extension:
//   isDeferred(message)        is this one of the two lone-child warnings?
//   partition(diags, baseline) split freshly-computed findings into the
//                              ones to publish now and the deferred ones
//                              held back — a lone-child warning that was
//                              already on screen before the edit burst
//                              (baseline) keeps showing, so it never
//                              flickers; only a brand-new one waits.

// The lone sub-Concept / sub-Example warnings (linter.js), by their shared
// wording. Nothing else defers.
const DEFERRED = / has 1 sub-(Concept|Example), expected 0 or more than one/;

function isDeferred(message) {
  return DEFERRED.test(message);
}

// Split findings into { show, held }. A finding waits iff it is a lone-child
// warning that was not already published before the edit burst began.
function partition(diags, baseline) {
  const show = [], held = [];
  for (const d of diags) {
    if (isDeferred(d.message) && !(baseline && baseline.has(d.message))) held.push(d);
    else show.push(d);
  }
  return { show, held };
}

module.exports = { isDeferred, partition };
