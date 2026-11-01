// Unit tests for the edit-burst hold (src/hold.js): which findings wait while
// you write, how the lines you edited are followed through further edits,
// what a finding is keyed by, and the family whose leaving ends the burst.
//
// Plain Node script, no framework — run with: node out/test-hold.js
const { keyOf, shiftLines, familyOf, partition } = require("../src/hold");
const { lint } = require("../src/linter");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const diag = (line, message, severity = 1) => ({ range: { start: { line } }, message, severity });

// ---------------------------------------------------------------------------
// keyOf: one finding, wherever its line references have moved
// ---------------------------------------------------------------------------
{
  check("keyOf: line references are not part of what a finding says",
    keyOf(diag(4, "Concept 'X' defined 2 times (lines 3, 7) — one name")) === keyOf(diag(9, "Concept 'X' defined 2 times (lines 8, 12) — one name")));
  check("keyOf: `line N` alone, and `lines N and M`, go too",
    keyOf(diag(0, "spelled '- a' here (line 4)")) === keyOf(diag(0, "spelled '- a' here (line 40)"))
    && keyOf(diag(0, "lines 3 and 5 agree")) === keyOf(diag(0, "lines 30 and 50 agree")));
  check("keyOf: severity tells two findings apart", keyOf(diag(0, "same", 0)) !== keyOf(diag(0, "same", 1)));
  check("keyOf: different words are different findings", keyOf(diag(0, "'A' is plural")) !== keyOf(diag(0, "'B' is plural")));
}

// ---------------------------------------------------------------------------
// shiftLines: the edited lines move with the text
// ---------------------------------------------------------------------------
{
  // a line typed after line 2 (Enter at its end: lines 2..2 become 2 lines)
  const after = shiftLines(new Set([2, 5]), { start: 2, end: 2, added: 2 });
  check("shiftLines: a new line is edited, the lines below move down",
    [...after].sort((a, b) => a - b).join(",") === "2,3,6");
  // two lines joined into one above an edited line
  const joined = shiftLines(new Set([7]), { start: 3, end: 4, added: 1 });
  check("shiftLines: lines removed above move an edited line up", [...joined].sort((a, b) => a - b).join(",") === "3,6");
  check("shiftLines: a line above the change stays where it is",
    shiftLines(new Set([1]), { start: 4, end: 4, added: 3 }).has(1));
  // Enter at the end of line 1 writes line 2 alone: line 1 — a parent's —
  // is not edited, so what is said of it can still wait
  check("shiftLines: a line break typed at a line's end edits only the new line",
    [...shiftLines(new Set(), { start: 1, end: 1, added: 2, from: 2 })].join(",") === "2");
}

// ---------------------------------------------------------------------------
// partition: only a new finding off the edited lines waits
// ---------------------------------------------------------------------------
{
  const lone = diag(1, "'Parent' has 1 sub-Concept, expected 0 or more than one");
  const plural = diag(0, "Concept 'Animals' appears plural");
  const childOwn = diag(2, "'Child' is misspelled", 3);
  const baseline = new Set([keyOf(plural)]);
  const { show, held } = partition([lone, plural, childOwn], baseline, new Set([2]));
  check("partition: a finding already on screen when the burst began keeps showing", show.includes(plural));
  check("partition: a finding on an edited line shows — your own lines speak", show.includes(childOwn));
  check("partition: a new finding elsewhere waits", held.length === 1 && held[0] === lone);
  check("partition: a finding that moved lines is still the one on screen",
    partition([diag(9, "Concept 'Animals' appears plural")], baseline, new Set()).show.length === 1);
  check("partition: with nothing to go by, every new finding waits",
    partition([lone], null, null).held.length === 1);
}

// ---------------------------------------------------------------------------
// familyOf: the lines the cursor may move about in
// ---------------------------------------------------------------------------
{
  const text = [
    "Animal",          // 1
    "    Parent",      // 2
    "        Child",   // 3
    "        Sibling", // 4
    "    Other",       // 5
    "Stone",           // 6
    "    - Pebble",    // 7
  ].join("\n");
  const { root, nodes } = lint(text, "Zoo");
  const fam = familyOf(root, nodes, 3); // typing 'Child'
  check("familyOf: a child's family is its parent's subtree, the parent's own line aside",
    fam && fam.name === "Parent" && fam.from === 3 && fam.to === 4);
  const sib = familyOf(root, nodes, 4);
  check("familyOf: a sibling typed next is in the same family, so the parent stays quiet",
    sib && sib.name === "Parent" && sib.from === 3 && sib.to === 4);
  const top = familyOf(root, nodes, 6);
  check("familyOf: at the top of the file, the node's own subtree",
    top && top.name === "Stone" && top.from === 6 && top.to === 7);
  check("familyOf: a blank line belongs to the node above it", familyOf(root, nodes, 3).name === familyOf(lint(text + "\n", "Zoo").root, lint(text + "\n", "Zoo").nodes, 3).name);
  check("familyOf: nothing above the first node", familyOf(root, nodes, 0) === null);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
