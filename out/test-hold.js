// Unit tests for the lone-sub grace (src/hold.js): which findings defer,
// and the publish/hold split against the pre-edit baseline.
//
// Plain Node script, no framework — run with: node out/test-hold.js
const { isDeferred, partition } = require("../src/hold");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const LONE_CONCEPT = "'Parent' has 1 sub-Concept, expected 0 or more than one — a single subtype divides nothing";
const LONE_EXAMPLE = "'Ada' has 1 sub-Example, expected 0 or more than one — a single sub-Example breaks nothing down";

// ---------------------------------------------------------------------------
// isDeferred: only the two lone-child warnings wait
// ---------------------------------------------------------------------------
{
  check("isDeferred: the lone sub-Concept warning defers", isDeferred(LONE_CONCEPT));
  check("isDeferred: the lone sub-Example warning defers", isDeferred(LONE_EXAMPLE));
  check("isDeferred: a plural warning shows at once", !isDeferred("Concept 'Animals' appears plural — use the singular"));
  check("isDeferred: an error shows at once", !isDeferred("tab character in the indentation — AOT indents with spaces"));
  check("isDeferred: the eight-sub warning is not deferred (it is a real over-count)",
    !isDeferred("'X' has 9 sub-Concepts, more than the eight a reader can take in"));
}

// ---------------------------------------------------------------------------
// partition: a fresh lone-child warning waits; anything else, or one already
// on screen before the burst, shows
// ---------------------------------------------------------------------------
{
  const diags = [
    { message: "Concept 'X' appears plural — use the singular" }, // never defers
    { message: LONE_CONCEPT + " (new this burst)" },             // fresh lone-child -> held
    { message: LONE_EXAMPLE + " (already shown)" },              // lone-child in baseline -> shows
  ];
  const baseline = new Set([LONE_EXAMPLE + " (already shown)"]);
  const { show, held } = partition(diags, baseline);
  check("partition: an unrelated finding always shows", show.some((d) => /plural/.test(d.message)));
  check("partition: a fresh lone-child warning is held",
    held.length === 1 && /new this burst/.test(held[0].message));
  check("partition: a lone-child warning already on screen keeps showing",
    show.some((d) => /already shown/.test(d.message)));
  check("partition: with no baseline, a lone-child warning still holds",
    partition([{ message: LONE_CONCEPT }], null).held.length === 1);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
