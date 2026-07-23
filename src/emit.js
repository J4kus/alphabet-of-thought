// The token-lean emit view behind `verify.js --emit`: the same model with
// every cosmetic token removed. The output is still valid Alpha — it parses
// to the identical tree — so a model can quote or extend it and the linter
// still referees. Three transforms, nothing else:
//
//   - trailing whitespace stripped from every line
//   - tables drawn compact: cells unpadded, separators reduced to '|-|',
//     and a data row's trailing empty cells dropped (an empty cell asserts
//     nothing; the header keeps its cell count — data rows answer to it)
//   - blank lines dropped, except a single one kept wherever pipe rows
//     stand on both sides — a blank line is one of the things that ends a
//     table, so exactly there it is load-bearing
//
// No value is recomputed, renamed or reordered: emit is a view, not an
// edit, so it never needs a formula registry and works even on a file that
// does not yet verify.

const table = require("./table");

function emit(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const block = table.blockAt(lines, i);
    // only real tables are redrawn — lone pipe Examples stay as written,
    // exactly as the formatter treats them
    if (block && block.rows.some((r) => r.sep)) {
      const was = table.setCompact(true);
      let rendered;
      try { rendered = table.render(block); } finally { table.setCompact(was); }
      rendered.forEach((line, k) => {
        const isHeader = block.rows[k + 1] && block.rows[k + 1].sep;
        out.push(isHeader || block.rows[k].sep ? line : line.replace(/\|{2,}$/, "|"));
      });
      i = block.end;
      continue;
    }
    out.push(lines[i]);
  }
  const kept = [];
  const isPipe = (l) => l.trim()[0] === "|";
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== "") { kept.push(out[i]); continue; }
    let j = i;
    while (j < out.length && out[j] === "") j++;
    const prev = kept.length ? kept[kept.length - 1] : "";
    if (j < out.length && isPipe(prev) && isPipe(out[j])) kept.push("");
    i = j - 1;
  }
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return kept.join("\n") + "\n";
}

module.exports = { emit };
