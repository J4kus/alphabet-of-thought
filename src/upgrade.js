// A file written for 1.12, respelled for 1.13. Three spellings changed, and
// nothing they mean:
//
//   - a literal '=' in a value was escaped `\=`; it is now doubled, `==`
//     (table.readValue). So `note: a \= b` becomes `note: a == b`, and a value
//     that held a literal `==` after a space — which 1.12 read as written —
//     gains one more, `===`, so it still reads `==`;
//   - an attribute's definition was `==` (`vat ==@price*0.2`,
//     `status ==("draft", "sent")`); it is now `=`, which reads the same;
//   - a table row nested under the row above it by indenting its name; it
//     now names that row in the table's `parent (thing)` column
//     (table.flatten), which files it under the same row.
//
// Only the value part of a value moves — never a derivation's Python, where
// `==` is Python's own — and only a declaration's operator. A file that shows
// no sign of the old spelling (no `\=` in a value, no `==` on a declaration)
// keeps its values exactly as they are: a run of '=' in them is then the new
// escape already, and lengthening it would change what it says. A table
// nested by indent is the old spelling wherever it stands, so it is always
// rewritten — and no other table is touched.
//
// Pure: text in, text out. The editor's AOT: Upgrade Files to 1.13 Syntax and
// `verify.js --workspace --upgrade` both call it.

const { lint, KIND } = require("./linter");
const { cells, splitCell, isRowText, blockAt, nests, render } = require("./table");

// The value part of a value written by 1.12, as 1.13 must write it.
const valueFrom112 = (v) => v
  .replace(/(^|\s)(={2,})/g, (m, lead, run) => lead + run + "=")
  .replace(/\\=/g, "==");

// The edits a 1.12 file needs: [{ line (0-based), from, to, text }], or [] when
// it shows no sign of the old spelling. A line a nested table's redraw
// touches is replaced whole, with whatever its values needed already in it.
function upgradeEdits(text, rootName) {
  const lines = String(text).split(/\r?\n/);
  const spelled = spellingEdits(text, rootName, lines);
  const after = apply(lines, spelled);
  const drawn = flattenTables(after);
  const redrawn = new Set();
  drawn.forEach((l, i) => { if (l !== after[i]) redrawn.add(i); });
  return [
    ...spelled.filter((e) => !redrawn.has(e.line)),
    ...[...redrawn].map((i) => ({ line: i, from: 0, to: lines[i].length, text: drawn[i] })),
  ];
}

// Every table that still nests by indent, drawn with its parent column; the
// rest of the lines as they are. A redraw keeps every row on its own line.
function flattenTables(lines) {
  const out = lines.slice();
  for (let i = 0; i < out.length; i++) {
    const block = blockAt(out, i);
    if (!block) continue;
    i = block.end;
    if (!nests(block)) continue;
    const drawn = render(block);
    if (drawn.length === block.end - block.start + 1) out.splice(block.start, drawn.length, ...drawn);
  }
  return out;
}

// Edits applied to the lines they name (same-line edits right to left).
function apply(lines, edits) {
  const out = lines.slice();
  const byLine = new Map();
  for (const e of edits) {
    if (!byLine.has(e.line)) byLine.set(e.line, []);
    byLine.get(e.line).push(e);
  }
  for (const [line, list] of byLine) {
    let s = out[line];
    for (const e of list.sort((a, b) => b.from - a.from)) s = s.slice(0, e.from) + e.text + s.slice(e.to);
    out[line] = s;
  }
  return out;
}

// The value and declaration respellings, or none without a sign of 1.12.
function spellingEdits(text, rootName, lines) {
  let parsed;
  try { parsed = lint(text, rootName); } catch { return []; }
  const valueEdits = [];
  const declEdits = [];
  let sign = false;
  for (const node of parsed.nodes) {
    if (node.kind === KIND.ATTRIBUTE && node.constraints) {
      for (const c of node.constraints) {
        if (c.opText !== "==" || c.opCol === undefined) continue;
        sign = true;
        declEdits.push({ line: node.line - 1, from: c.opCol, to: c.opCol + 2, text: "=" });
      }
      continue;
    }
    if (node.kind !== KIND.DEFAULT) continue;
    const raw = lines[node.line - 1] || "";
    // where the value's written text stands: a cell from its column, a
    // line-form value after its colon
    let start, region;
    if (node.cell) {
      const cell = isRowText(raw) ? cells(raw).find((c) => c.col === node.valueCol) : null;
      if (!cell) continue;
      start = cell.col;
      region = cell.text;
    } else if (node.header) {
      // a header cell's default: from its value to the cell's divider
      start = node.valueCol;
      region = raw.slice(start).split("|")[0].trimEnd();
    } else {
      const colon = raw.indexOf(":");
      if (colon === -1) continue;
      const after = raw.slice(colon + 1);
      start = colon + 1 + (after.length - after.trimStart().length);
      region = raw.slice(start);
    }
    const value = splitCell(region).value;
    if (!value) continue;
    if (/\\=/.test(value)) sign = true;
    const next = valueFrom112(value);
    if (next !== value) valueEdits.push({ line: node.line - 1, from: start, to: start + value.length, text: next });
  }
  return sign ? [...valueEdits, ...declEdits] : [];
}

// The text a 1.12 file becomes, or the text itself when there is nothing to do.
function upgradeText(text, rootName) {
  const edits = upgradeEdits(text, rootName);
  if (!edits.length) return text;
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  return apply(String(text).split(/\r?\n/), edits).join(eol);
}

module.exports = { upgradeEdits, upgradeText };
