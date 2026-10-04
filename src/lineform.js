// The table keys, in free text.
//
// A table is pure shorthand for the '- Example' lines it parses to (derive.js
// flipForm), so a Concept written as lines is a grid too — it only does not
// look like one. Its rows are its Examples, each a '- Name' line with the
// lines under it; its columns are its attributes; a cell is an Example's
// 'attribute: value' line, and a cell nobody wrote is a line nobody wrote.
// This module reads that grid off the parse and gives the table keys their
// meaning there: Alt+↑ moves an Example as it moves a row, Ctrl+D fills a
// value down from the Example above, Tab walks the Examples and their
// values.
//
// Flipping to a table, running the table's own operation and flipping back
// would be shorter, and it would rewrite the writer's text: a flip orders
// the value lines by column, declares every column, moves a '...' and bends
// a pipe into a broken bar. So every operation here edits the lines
// themselves, in place, and touches only the lines it is about.
//
// The grid at the cursor (gridAt):
//   rows     the Concept's '- ' Examples, depth-first — a sub-Example is the
//            row after its parent, as a nested table row is. An Example
//            written as a table row is the table keys' own, and an
//            attribute's allowed values ('- draft' under 'status') are no
//            rows at all.
//   columns  the attributes the Examples give values, in the order they
//            first appear — the order a reader sees them in — then any the
//            Concept declares on a bare line that no Example has used yet.
//   cell     column 0 is an Example's name, on its '- ' line; column k is
//            its value line for the k-th attribute, or no line at all.
//
// An operation takes the grid (and the selection, as { anchor, active } of
// { line, ch }, when there is one) and answers { edits, cursor, anchor? },
// or null to leave the document alone. `edits` are in the shape applyEdits
// takes, against the lines as they stand; the cursor and the anchor name a
// line as it stands ({ line }) or a line an edit inserts ({ mark }), with a
// column ({ ch }) or, by default, the start of the cell on that line.
// Moves answer a cursor and no edits. resolve() turns an answer into the
// new lines and the cursor's place in them.
//
// Pure: no vscode, no I/O. The caller parses, applies, and places the cursor.

const { KIND, INDENT } = require("./linter");
const { isRowText, splitCell, splitConstraint, readValue, numberless } = require("./table");
const { lastLineOf } = require("./derive");

const { INDIVIDUAL, DEFAULT, CONCEPT, ATTRIBUTE } = KIND;
const PAD = " ".repeat(INDENT);

// names resolve as every other name in the language does: case and a
// numbering prefix are presentation
const key = (name) => numberless(String(name || "").trim()).toLowerCase();
const indentOf = (text) => String(text || "").match(/^ */)[0];

// --- reading the grid --------------------------------------------------------

// An Example written as a '- ' line: not a table row, and not the inline
// Example riding on a Concept's own line ('Colour: red').
function isLineExample(n, lines) {
  if (!n || n.kind !== INDIVIDUAL || !(n.line >= 1)) return false;
  const text = lines[n.line - 1] || "";
  return !isRowText(text) && text.trim().startsWith("-");
}

// A value an Example states on a line of its own: a cell.
const isLineValue = (n, lines) => !!n && n.kind === DEFAULT && !n.cell && isLineExample(n.parent, lines);

const valuesOf = (r, lines) => r.children.filter((c) => isLineValue(c, lines));
const subRowsOf = (r, lines) => (r ? r.children.filter((c) => isLineExample(c, lines)) : []);

// A bare attribute line declares a column and nothing else; one with lines
// of its own (the values it may take) is no column.
const declarationsOf = (concept) =>
  concept.children.filter((c) => c.kind === ATTRIBUTE && !c.cell && c.line >= 1 && !c.children.length);

// A value line's value, as written; an Example line's name, as written.
function valueText(text) {
  const colon = String(text).indexOf(":");
  return colon === -1 ? "" : String(text).slice(colon + 1).trim();
}
const nameText = (text) => String(text).trim().replace(/^-\s?/, "");

// Where the cursor belongs on a cell's line: after '- ' on an Example, after
// 'name: ' on a value, else where the text starts.
function cellStart(text) {
  const t = String(text || "");
  const lead = indentOf(t).length;
  if (t[lead] === "-") return Math.min(t.length, lead + (t[lead + 1] === " " ? 2 : 1));
  const colon = t.indexOf(":");
  if (colon !== -1) {
    let i = colon + 1;
    while (t[i] === " ") i++;
    return i;
  }
  return lead;
}

// Whether a line is a cell of line-form Examples, from the text alone: a
// '- ' line, or a 'name: value' line standing directly under one. Cheap
// enough to decide on every cursor move which keys the table editor takes;
// the parse (gridAt) has the last word when a key is pressed.
function looksLikeCell(textOf, lineIdx) {
  const text = textOf(lineIdx);
  if (text === undefined || text === null || isRowText(text)) return false;
  const t = text.trim();
  if (t.startsWith("-")) return true;
  if (!/^[^A-Z\s\-][^:]*:/.test(t)) return false;
  const depth = indentOf(text).length;
  for (let i = lineIdx - 1; i >= 0; i--) {
    const above = textOf(i);
    if (!above || !above.trim()) continue;
    if (indentOf(above).length < depth) return above.trim().startsWith("-") && !isRowText(above);
  }
  return false;
}

// The column keys work from an attribute's declaration too — a bare `age`
// under the Concept is that column's header, the one line that names it for
// every Example — so Alt+Shift+← there deletes the column exactly as it does
// from a value. Only these keys: Tab on a declaration still indents it.
const COLUMN_OPS = new Set([
  "moveColumnLeft", "moveColumnRight", "insertColumn", "deleteColumn", "copyColumnLeft", "copyColumnRight",
]);

// Whether a line is a column's declaration, from the text alone, for the
// context the column keys are gated on: a bare lowercase term (no colon, no
// pipe) filed under a Concept's own line, which has a '- ' Example beside it.
// `textOf` answers undefined past either end of the document.
function looksLikeDeclaration(textOf, lineIdx) {
  const text = textOf(lineIdx);
  if (text === undefined || text === null || isRowText(text)) return false;
  if (!/^[^A-Z\s\-.:|][^:|]*$/.test(text.trim())) return false;
  const depth = indentOf(text).length;
  if (!depth) return false;
  let parent = -1;
  for (let i = lineIdx - 1; i >= 0; i--) {
    const above = textOf(i);
    if (above === undefined || above === null) break;
    if (!above.trim()) continue;
    if (indentOf(above).length < depth) { parent = i; break; }
  }
  if (parent === -1) return false;
  const head = textOf(parent);
  if (/^\s*(-|\.\.\.)/.test(head) || isRowText(head)) return false;
  for (let i = parent + 1; ; i++) {
    const t = textOf(i);
    if (t === undefined || t === null) return false;
    if (!t.trim()) continue;
    const d = indentOf(t).length;
    if (d < depth) return false;
    if (d === depth && t.trim().startsWith("- ") && !isRowText(t)) return true;
  }
}

// The grid the cursor's line is a cell of, or null when it is none. With
// `opts.header`, a column's declaration line answers too: its grid has no
// row (`row` null), and `header` is the declaration.
function gridAt(lines, nodes, lineIdx, opts) {
  const at = lineIdx + 1;
  const here = nodes.filter((n) => n.line === at);
  const example = here.find((n) => isLineExample(n, lines));
  const value = example ? null : here.find((n) => isLineValue(n, lines));
  const row = example || (value && value.parent);
  const header = row || !(opts && opts.header) ? null
    : here.find((n) => n.kind === ATTRIBUTE && !n.cell && n.line >= 1 && !n.children.length
      && n.parent && n.parent.kind === CONCEPT) || null;
  if (!row && !header) return null;
  let concept = header ? header.parent : row.parent;
  while (concept && concept.kind !== CONCEPT) concept = concept.parent;
  if (!concept) return null;
  const rows = [];
  const walk = (n) => {
    for (const c of subRowsOf(n, lines)) {
      rows.push(c);
      walk(c);
    }
  };
  walk(concept);
  if (row ? !rows.includes(row) : !rows.length) return null;
  const columns = [];
  const index = new Map(); // column key -> its 1-based column
  const claim = (name, label) => {
    const k = key(name);
    if (!k || index.has(k)) return;
    columns.push({ key: k, label: label || String(name).trim() });
    index.set(k, columns.length);
  };
  // The order the Examples write their values in is the order a reader
  // sees, so it is the columns' order — which is what lets a column move by
  // moving its lines. A declared attribute no Example has used yet comes
  // after, its label its term as written, less its constraint.
  for (const r of rows) {
    for (const v of valuesOf(r, lines)) {
      const text = lines[v.line - 1] || "";
      claim(v.name, text.slice(0, text.indexOf(":")).trim());
    }
  }
  for (const d of declarationsOf(concept)) claim(d.name, splitConstraint((lines[d.line - 1] || "").trim()).value);
  return {
    lines, concept, rows, columns, index, row: row || null, header,
    col: value ? index.get(key(value.name)) : header ? index.get(key(header.name)) : 0,
    at: lineIdx,
  };
}

const valueNode = (g, r, col) => (col < 1 || col > g.columns.length ? null
  : r.children.find((c) => isLineValue(c, g.lines) && key(c.name) === g.columns[col - 1].key) || null);
const colOf = (g, v) => g.index.get(key(v.name));

function cellText(g, r, col) {
  if (col === 0) return nameText(g.lines[r.line - 1] || "");
  const v = valueNode(g, r, col);
  return v ? valueText(g.lines[v.line - 1] || "") : "";
}

// An Example's lines: its own and every sub-Example's, first to last.
const blockOf = (r) => ({ from: r.line - 1, to: lastLineOf(r) - 1 });

// The outermost row a row is nested in — where a new row at the bottom of
// the grid goes after.
function topOf(g, r) {
  let t = r;
  while (isLineExample(t.parent, g.lines)) t = t.parent;
  return t;
}

// The cell to land on: the one asked for, or — a cell nobody wrote having no
// line to stand on — the nearest one before it in its row, the name at worst.
function cellTarget(g, r, col) {
  for (let k = Math.min(col, g.columns.length); k >= 1; k--) {
    const v = valueNode(g, r, k);
    if (v) return { line: v.line - 1 };
  }
  return { line: r.line - 1 };
}

// Rows whose lines the selection touches, in grid order.
function selectedRows(g, from, to) {
  const touches = (r) => {
    const own = [r.line - 1, ...valuesOf(r, g.lines).map((v) => v.line - 1)];
    return own.some((i) => i >= from && i <= to);
  };
  return g.rows.filter(touches);
}

// --- writing a cell ----------------------------------------------------------

// Write text into a cell: the name on its '- ' line, or a value on its line —
// rewritten where it stands, added (under the name, in column order) where
// it is missing, and taken away when the text is empty, since an empty cell
// asserts nothing. Pushes the edits; answers where the cell is afterwards.
function setCell(g, r, col, text, edits, mark) {
  const t = String(text || "").trim();
  const rowLine = g.lines[r.line - 1] || "";
  if (col === 0) {
    edits.push({ type: "replace", at: r.line - 1, text: `${indentOf(rowLine)}- ${t}` });
    return { line: r.line - 1 };
  }
  const v = valueNode(g, r, col);
  if (!t) {
    if (v) edits.push({ type: "delete", from: v.line - 1, to: v.line - 1 });
    return { line: r.line - 1 };
  }
  if (v) {
    const old = g.lines[v.line - 1];
    edits.push({ type: "replace", at: v.line - 1, text: `${old.slice(0, old.indexOf(":") + 1)} ${t}` });
    return { line: v.line - 1 };
  }
  const before = valuesOf(r, g.lines).filter((c) => colOf(g, c) < col);
  const after = before.length ? before[before.length - 1].line - 1 : r.line - 1;
  const m = mark || `cell${edits.length}`;
  edits.push({
    type: "insert", after,
    lines: [{ text: `${indentOf(rowLine)}${PAD}${g.columns[col - 1].label}: ${t}`, mark: m }],
  });
  return { mark: m };
}

// --- moving the cursor -------------------------------------------------------

// Every cell line — each Example's name and its values — in document order.
function cellLines(g) {
  const out = [];
  for (const r of g.rows) {
    out.push(r.line - 1);
    for (const v of valuesOf(r, g.lines)) out.push(v.line - 1);
  }
  return out.sort((a, b) => a - b);
}

// Tab: the next cell — an Example's name, or one of its values; past the
// last, a new Example at the bottom, as a table grows a row.
function nextCell(g) {
  const next = cellLines(g).find((i) => i > g.at);
  if (next !== undefined) return { cursor: { line: next } };
  const last = g.rows[g.rows.length - 1];
  return {
    edits: [{
      type: "insert", after: blockOf(topOf(g, last)).to,
      lines: [{ text: `${indentOf(g.lines[last.line - 1])}- `, mark: "cursor" }],
    }],
    cursor: { mark: "cursor" },
  };
}

// Shift+Tab: the previous cell; never grows.
function prevCell(g) {
  const before = cellLines(g).filter((i) => i < g.at);
  return { cursor: { line: before.length ? before[before.length - 1] : g.at } };
}

// Ctrl+arrow: the spreadsheet's jump to the edge of the data (table.jumpCell)
// over the grid — down and up through the Examples, left and right through
// an Example's columns.
function jump(g, dRow, dCol) {
  const ri = g.rows.indexOf(g.row);
  const has = (p) => !!cellText(g, g.rows[p[0]], p[1]).trim();
  const path = [];
  if (dRow) {
    for (let r = ri + dRow; r >= 0 && r < g.rows.length; r += dRow) path.push([r, g.col]);
  } else {
    for (let c = g.col + dCol; c >= 0 && c <= g.columns.length; c += dCol) path.push([ri, c]);
  }
  if (!path.length) return { cursor: cellTarget(g, g.row, g.col) };
  let target;
  if (has([ri, g.col]) && has(path[0])) {
    let k = 0;
    while (k + 1 < path.length && has(path[k + 1])) k++;
    target = path[k];
  } else {
    target = path.find(has) || path[path.length - 1];
  }
  return { cursor: cellTarget(g, g.rows[target[0]], target[1]) };
}

// Ctrl+Home / Ctrl+End: the first Example's name; the last Example's last cell.
function corner(g, which) {
  if (which === "home") return { cursor: { line: g.rows[0].line - 1 } };
  return { cursor: cellTarget(g, g.rows[g.rows.length - 1], g.columns.length) };
}

// Ctrl+A: the Concept's lines, first to last — the table this grid is.
function conceptSpan(g) {
  if (!(g.concept.line >= 1)) return null;
  return { from: g.concept.line - 1, to: lastLineOf(g.concept) - 1 };
}

// --- moving and copying rows -------------------------------------------------

// Alt+↑ / Alt+↓: the Example, sub-Examples and all, over its neighbour and
// the neighbour's own sub-Examples. Whatever stands between the two (a
// blank line, say) stays between them.
function moveRow(g, dir) {
  const sibs = subRowsOf(g.row.parent, g.lines);
  const other = sibs[sibs.indexOf(g.row) + dir];
  if (!other) return null;
  const upper = blockOf(dir < 0 ? other : g.row);
  const lower = blockOf(dir < 0 ? g.row : other);
  const take = (from, to) => {
    const out = [];
    for (let i = from; i <= to; i++) out.push(i === g.at ? { text: g.lines[i], mark: "cursor" } : g.lines[i]);
    return out;
  };
  return {
    edits: [
      { type: "delete", from: upper.from, to: lower.to },
      {
        type: "insert", after: upper.from - 1,
        lines: [
          ...take(lower.from, lower.to),
          ...take(upper.to + 1, lower.from - 1),
          ...take(upper.from, upper.to),
        ],
      },
    ],
    cursor: { mark: "cursor" },
  };
}

// An Example's own lines — its name and whatever it states — without its
// sub-Examples.
function ownLines(g, r) {
  const { from, to } = blockOf(r);
  const skip = new Set();
  for (const s of subRowsOf(r, g.lines)) {
    const b = blockOf(s);
    for (let i = b.from; i <= b.to; i++) skip.add(i);
  }
  const out = [];
  for (let i = from; i <= to; i++) if (!skip.has(i)) out.push(i);
  return out;
}

// Ctrl+Alt+↑ / Ctrl+Alt+↓: a copy of the Example, above it or below it (and
// below its sub-Examples); the cursor goes with the copy.
function copyRow(g, dir) {
  const own = ownLines(g, g.row);
  const at = Math.max(0, own.indexOf(g.at));
  return {
    edits: [{
      type: "insert", after: dir < 0 ? g.row.line - 2 : blockOf(g.row).to,
      lines: own.map((i, k) => (k === at ? { text: g.lines[i], mark: "cursor" } : g.lines[i])),
    }],
    cursor: { mark: "cursor" },
  };
}

// Alt+Shift+↓: a new, empty Example above the cursor's, for its name.
function insertRow(g) {
  return {
    edits: [{
      type: "insert", after: g.row.line - 2,
      lines: [{ text: `${indentOf(g.lines[g.row.line - 1])}- `, mark: "cursor" }],
    }],
    cursor: { mark: "cursor" },
  };
}

// Alt+Shift+↑: the Example goes, sub-Examples and all; one Ctrl+Z brings it
// back.
function deleteRow(g) {
  const { from, to } = blockOf(g.row);
  const sibs = subRowsOf(g.row.parent, g.lines);
  const i = sibs.indexOf(g.row);
  const next = sibs[i + 1] || sibs[i - 1];
  return {
    edits: [{ type: "delete", from, to }],
    cursor: next ? { line: next.line - 1 } : { line: Math.max(0, from - 1) },
  };
}

// Nest the Example under the one above it, or lift it out of its parent: its
// lines move a level, exactly as a nested row's name cell does.
function shiftDepth(g, dir) {
  const sibs = subRowsOf(g.row.parent, g.lines);
  if (dir > 0 && sibs.indexOf(g.row) < 1) return null; // no Example above to adopt it
  if (dir < 0 && !isLineExample(g.row.parent, g.lines)) return null; // already top-level
  const { from, to } = blockOf(g.row);
  const edits = [];
  for (let k = from; k <= to; k++) {
    const text = g.lines[k];
    if (!text.trim()) continue;
    edits.push({ type: "replace", at: k, text: dir > 0 ? PAD + text : text.slice(Math.min(INDENT, indentOf(text).length)) });
  }
  return { edits, cursor: { line: g.at } };
}

// Sort the Examples around the cursor by the cursor's column — numbers as
// numbers when every key reads as one — each carrying its sub-Examples.
// Lines standing between them keep their places.
function sortRows(g) {
  const sibs = subRowsOf(g.row.parent, g.lines);
  if (sibs.length < 2) return null;
  const sortKey = (r) => readValue(splitCell(cellText(g, r, g.col)).value);
  const num = (r) => parseFloat(sortKey(r).replace(/[$,%\s]/g, ""));
  const numeric = sibs.every((r) => sortKey(r) !== "" && !isNaN(num(r)));
  const sorted = sibs.slice().sort((x, y) => (numeric ? num(x) - num(y) : sortKey(x).localeCompare(sortKey(y))));
  const slots = sibs.map(blockOf);
  const first = slots[0].from, last = slots[slots.length - 1].to;
  const out = [];
  let k = first, slot = 0;
  while (k <= last) {
    if (slot < slots.length && k === slots[slot].from) {
      const b = blockOf(sorted[slot]);
      for (let i = b.from; i <= b.to; i++) out.push(i === g.at ? { text: g.lines[i], mark: "cursor" } : g.lines[i]);
      k = slots[slot].to + 1;
      slot++;
    } else {
      out.push(g.lines[k]);
      k++;
    }
  }
  return {
    edits: [{ type: "delete", from: first, to: last }, { type: "insert", after: first - 1, lines: out }],
    cursor: { mark: "cursor" },
  };
}

// --- moving and copying columns ----------------------------------------------

const declarationOf = (g, col) => declarationsOf(g.concept).find((d) => key(d.name) === g.columns[col - 1].key);

// Alt+← / Alt+→: the cursor's attribute trades places with its neighbour in
// every Example that states both, and in the Concept's declarations.
function moveColumn(g, dir) {
  const col = g.col, other = col + dir;
  if (col < 1 || other < 1 || other > g.columns.length) return null;
  const edits = [];
  let cursor = null;
  const swap = (x, y) => edits.push(
    { type: "replace", at: x.line - 1, text: g.lines[y.line - 1] },
    { type: "replace", at: y.line - 1, text: g.lines[x.line - 1] });
  for (const r of g.rows) {
    const x = valueNode(g, r, col), y = valueNode(g, r, other);
    if (!x || !y) continue;
    swap(x, y);
    if (r === g.row) cursor = { line: y.line - 1 };
  }
  const dx = declarationOf(g, col), dy = declarationOf(g, other);
  if (dx && dy) {
    swap(dx, dy);
    // pressed on the declaration, the cursor goes with it
    if (g.header) cursor = { line: dy.line - 1 };
  }
  return edits.length ? { edits, cursor: cursor || { line: g.at } } : null;
}

// Alt+Shift+→: a new attribute for the Concept — an empty declaration line,
// before the cursor's column's own when it has one, for its name.
function insertColumn(g) {
  const c = g.concept;
  if (!(c.line >= 1) || c.cell) return null;
  const decls = declarationsOf(c);
  const here = g.col >= 1 ? declarationOf(g, g.col) : null;
  const after = here ? here.line - 2 : decls.length ? decls[decls.length - 1].line - 1 : c.line - 1;
  const indent = indentOf(g.lines[c.line - 1]) + PAD;
  return {
    edits: [{ type: "insert", after, lines: [{ text: indent, mark: "cursor" }] }],
    cursor: { mark: "cursor", ch: indent.length },
  };
}

// Alt+Shift+←: the cursor's attribute goes from every Example, and its
// declaration with it; the cursor stays in its Example.
function deleteColumn(g) {
  if (g.col < 1) return null;
  const edits = [];
  for (const r of g.rows) {
    const v = valueNode(g, r, g.col);
    if (v) edits.push({ type: "delete", from: v.line - 1, to: v.line - 1 });
  }
  const d = declarationOf(g, g.col);
  if (d) edits.push({ type: "delete", from: d.line - 1, to: d.line - 1 });
  // pressed on the declaration, the cursor takes the next line that stays
  if (!g.row) return { edits, cursor: { line: g.at } };
  let cursor = null;
  for (let k = g.col + 1; k <= g.columns.length && !cursor; k++) {
    const v = valueNode(g, g.row, k);
    if (v) cursor = { line: v.line - 1 };
  }
  for (let k = g.col - 1; k >= 1 && !cursor; k--) {
    const v = valueNode(g, g.row, k);
    if (v) cursor = { line: v.line - 1 };
  }
  return { edits, cursor: cursor || { line: g.row.line - 1 } };
}

// Ctrl+Alt+← / Ctrl+Alt+→: a second line of the cursor's attribute beside
// the first, in every Example that states it (and its declaration too). The
// copy repeats the attribute's name, which the linter reports until you
// rename it — that rename is the point of the copy.
function copyColumn(g, dir) {
  if (g.col < 1) return null;
  const edits = [];
  let cursor = null;
  const copy = (n, mark) => {
    const text = g.lines[n.line - 1];
    edits.push({ type: "insert", after: dir < 0 ? n.line - 2 : n.line - 1, lines: [mark ? { text, mark } : text] });
  };
  for (const r of g.rows) {
    const v = valueNode(g, r, g.col);
    if (!v) continue;
    copy(v, r === g.row ? "cursor" : null);
    if (r === g.row) cursor = { mark: "cursor" };
  }
  const d = declarationOf(g, g.col);
  if (d) {
    copy(d, g.header ? "cursor" : null);
    if (g.header) cursor = { mark: "cursor" };
  }
  return edits.length ? { edits, cursor: cursor || { line: g.at } } : null;
}

// --- copying cells -----------------------------------------------------------

// Ctrl+Alt+Shift+arrow: the cell's text into its neighbour — the same
// attribute of the Example above or below, the next attribute of the same
// Example — following it there. Down past the last Example grows a new one,
// as a table grows a row. With `cut`, the cell is left empty behind it.
function toNeighbour(g, dRow, dCol, cut) {
  const text = cellText(g, g.row, g.col);
  const edits = [];
  let cursor;
  if (dRow) {
    const ri = g.rows.indexOf(g.row) + dRow;
    if (ri < 0) return null;
    if (ri >= g.rows.length) {
      const last = g.rows[g.rows.length - 1];
      const indent = indentOf(g.lines[last.line - 1]);
      const lines = g.col === 0 || !text
        ? [{ text: `${indent}- ${g.col === 0 ? text : ""}`, mark: "cursor" }]
        : [`${indent}- `, { text: `${indent}${PAD}${g.columns[g.col - 1].label}: ${text}`, mark: "cursor" }];
      edits.push({ type: "insert", after: blockOf(topOf(g, last)).to, lines });
      cursor = { mark: "cursor" };
    } else {
      cursor = setCell(g, g.rows[ri], g.col, text, edits, "cursor");
    }
  } else {
    const c = g.col + dCol;
    if (c < 0 || c > g.columns.length) return null;
    cursor = setCell(g, g.row, c, text, edits, "cursor");
  }
  if (cut) setCell(g, g.row, g.col, "", edits);
  return { edits, cursor };
}

// Ctrl+D / Ctrl+R: the spreadsheet's fill. With no selection, the same
// attribute of the Example above (down) or the attribute before this one
// (right) fills the cursor's cell. Over a selection of several Examples,
// fill down copies the first one's values into the rest — the values the
// selection covers, or all of the first one's when it covers only names;
// fill right copies, in each selected Example, the first selected value
// into the others. A name is never a source, and a derivation arrives
// alone: the value in front of it was computed where it stood.
const carried = (text) => {
  const { eq } = splitCell(text || "");
  return eq === -1 ? text || "" : text.slice(eq).trim();
};
function fill(g, span, axis) {
  const edits = [];
  if (!span || span.anchor.line === span.active.line) {
    if (axis === "down") {
      if (g.col < 1) return null;
      const ri = g.rows.indexOf(g.row);
      if (ri < 1) return null;
      return { edits, cursor: setCell(g, g.row, g.col, carried(cellText(g, g.rows[ri - 1], g.col)), edits, "cursor") };
    }
    if (g.col < 2) return null;
    return { edits, cursor: setCell(g, g.row, g.col, carried(cellText(g, g.row, g.col - 1)), edits, "cursor") };
  }
  const from = Math.min(span.anchor.line, span.active.line);
  const to = Math.max(span.anchor.line, span.active.line);
  const picked = selectedRows(g, from, to);
  const within = (v) => v.line - 1 >= from && v.line - 1 <= to;
  if (axis === "down") {
    if (picked.length < 2) return null;
    const [source, ...targets] = picked;
    let cols = [...new Set(picked.flatMap((r) => valuesOf(r, g.lines).filter(within).map((v) => colOf(g, v))))];
    if (!cols.length) cols = valuesOf(source, g.lines).map((v) => colOf(g, v));
    if (!cols.length) return null;
    cols.sort((a, b) => a - b);
    for (const t of targets) for (const c of cols) setCell(g, t, c, carried(cellText(g, source, c)), edits);
  } else {
    for (const r of picked) {
      const cols = valuesOf(r, g.lines).filter(within).map((v) => colOf(g, v)).sort((a, b) => a - b);
      if (cols.length < 2) continue;
      for (const c of cols.slice(1)) setCell(g, r, c, carried(cellText(g, r, cols[0])), edits);
    }
  }
  if (!edits.length) return null;
  return {
    edits,
    cursor: { line: span.active.line, ch: span.active.ch },
    anchor: { line: span.anchor.line, ch: span.anchor.ch },
  };
}

// Ctrl+' / Ctrl+Shift+': the formula alone, or the value alone, from the
// same attribute of the Example above.
function fromAbove(g, part) {
  if (g.col < 1) return null;
  const ri = g.rows.indexOf(g.row);
  if (ri < 1) return null;
  const text = cellText(g, g.rows[ri - 1], g.col);
  const split = splitCell(text);
  if (part === "formula" && split.eq === -1) return null;
  const edits = [];
  const written = part === "formula" ? text.slice(split.eq).trim() : split.value;
  return { edits, cursor: setCell(g, g.row, g.col, written, edits, "cursor") };
}

// The cell's derivation onto every other attribute of the same Example,
// each without a value until the next run.
function copyFormulaAcross(g) {
  if (g.col < 1) return null;
  const text = cellText(g, g.row, g.col);
  if (splitCell(text).eq === -1) return null;
  const edits = [];
  for (let k = 1; k <= g.columns.length; k++) {
    if (k !== g.col) setCell(g, g.row, k, carried(text), edits);
  }
  return edits.length ? { edits, cursor: { line: g.at } } : null;
}

// --- applying an answer ------------------------------------------------------

// Apply edits against the lines as they stand: { type: "replace", at, text },
// { type: "delete", from, to } (inclusive) and { type: "insert", after,
// lines } (after -1 is the top; an inserted line may be { text, mark }).
// Answers the new lines, where each old line went (-1 when deleted), and
// where each mark landed.
function applyEdits(lines, edits) {
  const gone = new Set();
  const replaced = new Map();
  const inserted = new Map();
  for (const e of edits || []) {
    if (e.type === "delete") for (let i = e.from; i <= e.to; i++) gone.add(i);
    else if (e.type === "replace") replaced.set(e.at, e.text);
    else if (e.type === "insert") inserted.set(e.after, [...(inserted.get(e.after) || []), ...e.lines]);
  }
  const out = [];
  const at = new Array(lines.length).fill(-1);
  const marks = {};
  const emit = (k) => {
    for (const item of inserted.get(k) || []) {
      if (item && typeof item === "object") {
        if (item.mark !== undefined && item.mark !== null) marks[item.mark] = out.length;
        out.push(item.text);
      } else {
        out.push(item);
      }
    }
  };
  emit(-1);
  for (let i = 0; i < lines.length; i++) {
    if (!gone.has(i)) {
      at[i] = out.length;
      out.push(replaced.has(i) ? replaced.get(i) : lines[i]);
    }
    emit(i);
  }
  return { lines: out, at, marks };
}

// An answer applied: the new lines, and the cursor (and anchor) as
// { line, ch } in them. A line the edits took away hands its place to the
// next line that stayed.
function resolve(lines, result) {
  const done = applyEdits(lines, result.edits);
  const place = (t) => {
    if (!t) return null;
    let line;
    if (t.mark !== undefined) line = done.marks[t.mark];
    else {
      for (let i = Math.max(0, t.line); i < lines.length; i++) {
        if (done.at[i] !== -1) { line = done.at[i]; break; }
      }
    }
    if (line === undefined) line = Math.max(0, done.lines.length - 1);
    const text = done.lines[line] || "";
    return { line, ch: t.ch !== undefined ? Math.min(t.ch, text.length) : cellStart(text) };
  };
  return { lines: done.lines, cursor: place(result.cursor), anchor: place(result.anchor) };
}

// The one run of lines two versions differ in: old lines from..to
// (inclusive; to is from - 1 for a pure insertion) become `lines`. null
// when nothing differs.
function changedLines(before, after) {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p
    && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const lines = after.slice(p, after.length - s);
  const to = before.length - 1 - s;
  if (to < p && !lines.length) return null;
  return { from: p, to, lines };
}

// The operations, by the table command each one answers to.
const ops = {
  nextCell: (g) => nextCell(g),
  prevCell: (g) => prevCell(g),
  moveRowUp: (g) => moveRow(g, -1),
  moveRowDown: (g) => moveRow(g, 1),
  moveColumnLeft: (g) => moveColumn(g, -1),
  moveColumnRight: (g) => moveColumn(g, 1),
  insertColumn: (g) => insertColumn(g),
  deleteColumn: (g) => deleteColumn(g),
  insertRow: (g) => insertRow(g),
  deleteRow: (g) => deleteRow(g),
  demoteRow: (g) => shiftDepth(g, 1),
  promoteRow: (g) => shiftDepth(g, -1),
  sortRows: (g) => sortRows(g),
  copyFormulaAcross: (g) => copyFormulaAcross(g),
  copyCellDown: (g) => toNeighbour(g, 1, 0, false),
  copyCellUp: (g) => toNeighbour(g, -1, 0, false),
  copyCellLeft: (g) => toNeighbour(g, 0, -1, false),
  copyCellRight: (g) => toNeighbour(g, 0, 1, false),
  moveCellDown: (g) => toNeighbour(g, 1, 0, true),
  moveCellUp: (g) => toNeighbour(g, -1, 0, true),
  moveCellLeft: (g) => toNeighbour(g, 0, -1, true),
  moveCellRight: (g) => toNeighbour(g, 0, 1, true),
  copyRowDown: (g) => copyRow(g, 1),
  copyRowUp: (g) => copyRow(g, -1),
  copyColumnLeft: (g) => copyColumn(g, -1),
  copyColumnRight: (g) => copyColumn(g, 1),
  fillDown: (g, span) => fill(g, span, "down"),
  fillRight: (g, span) => fill(g, span, "right"),
  copyFormulaFromAbove: (g) => fromAbove(g, "formula"),
  copyValueFromAbove: (g) => fromAbove(g, "value"),
};

module.exports = {
  gridAt, looksLikeCell, looksLikeDeclaration, COLUMN_OPS, cellStart, cellText, ops, jump, corner, conceptSpan,
  applyEdits, resolve, changedLines,
};
