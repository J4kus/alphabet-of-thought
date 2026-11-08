// A spreadsheet's cells, for the keys and the mouse.
//
// Excel has two states for the cell you are on. **Ready**: the cell is
// selected, so what you type replaces it, and the arrow keys travel between
// cells. **Edit**: a caret stands in the cell's text, and the keys move through
// that text. This module reads the same two states off the editor's selection,
// with no hidden mode: the whole of a cell's text selected (or the caret in a
// cell that holds nothing) is Ready, and anything else is Edit.
//
// What "the whole of a cell" is depends on the cell. An Example's name is its
// name. A value is its value — but when the cell carries a formula, the formula
// is the part a hand changes, so the formula alone is the cell's span and the
// value in front of it is left as it is. In a table a cell is the text between
// its dividers; in free text the Example's `- name` line is the name cell and an
// `attribute: value` line under it the value cell (src/lineform.js), so the same
// keys mean the same things in both.
//
// A rectangle of cells — Ctrl+Shift+arrow, Shift+arrow — is held as one
// selection per cell, so what is typed lands in every cell and no divider is
// ever selected. The active cell's selection comes first: it is the editor's
// primary selection, which the status bar and every other key read.
//
// The status bar's numbers (stats) and a column's profile (profile) are read
// here too, from the cells' text alone: nothing is calculated, nothing run.
//
// Pure: no vscode, no I/O.

const table = require("./table");
const lineform = require("./lineform");

// --- one cell -----------------------------------------------------------------

// A table row's cell `col` on its line: { start, end, kind } — kind "name" (the
// first column), "value", "formula" (the formula alone, the value in front of
// it left out) or "empty" (an empty span at the cell's start, where typing
// lands). null when the row stops short of the column.
function rowCellSpan(text, col) {
  const t = String(text || "");
  const ds = table.dividers(t);
  if (col < 0 || col > ds.length) return null;
  const segStart = col === 0 ? 0 : ds[col - 1] + 1;
  const segEnd = col < ds.length ? ds[col] : t.length;
  const seg = t.slice(segStart, segEnd);
  const body = seg.trim();
  if (!body) {
    // an empty name cell is padded to its column: the caret goes where the line
    // starts, as a row being filled starts there
    return { start: segStart, end: segStart, kind: "empty" };
  }
  const start = segStart + (seg.length - seg.trimStart().length);
  const end = start + body.length;
  if (col === 0) return { start, end, kind: "name" };
  const split = table.splitCell(body);
  if (split.eq !== -1) return { start: start + split.eq, end, kind: "formula" };
  return { start, end, kind: "value" };
}

// A free-text line's cell: an Example's name after its `- `, or what follows
// the colon of a value line — its formula alone when it has one. { start, end,
// kind, from } where `from` is the first column a click on the cell may stand
// at (the name's start, or just past the colon). null for any other line: a
// Concept's or an attribute's own line, a `...` line, a derivation that writes
// a table.
function lineCellSpan(text) {
  const t = String(text || "");
  const lead = t.length - t.trimStart().length;
  const body = t.trim();
  if (!body || body.startsWith("...") || body.startsWith("=")) return null;
  const end = t.trimEnd().length;
  if (body.startsWith("- ")) {
    const rest = t.slice(lead + 2);
    const start = lead + 2 + (rest.length - rest.trimStart().length);
    return start < end ? { start, end, kind: "name", from: lead } : { start, end: start, kind: "empty", from: lead };
  }
  if (table.lineDerivation(body)) return null; // `Sales =df[:3]` writes a table
  const colon = t.indexOf(":");
  if (colon === -1) return null;
  const after = t.slice(colon + 1);
  const start = colon + 1 + (after.length - after.trimStart().length);
  if (start >= end) return { start: colon + 1 < end ? end : colon + 1, end: colon + 1 < end ? end : colon + 1, kind: "empty", from: colon + 1 };
  const split = table.splitCell(t.slice(start, end));
  if (split.eq !== -1) return { start: start + split.eq, end, kind: "formula", from: colon + 1 };
  return { start, end, kind: "value", from: colon + 1 };
}

// Whether a selection is a cell's whole span — Ready — given as one line's
// { start, end } columns: the span selected exactly, either way round, or the
// caret in a cell with nothing to select.
function isWhole(span, selStart, selEnd) {
  if (!span) return false;
  const lo = Math.min(selStart, selEnd), hi = Math.max(selStart, selEnd);
  if (span.start === span.end) return lo === hi && lo === span.start;
  return lo === span.start && hi === span.end;
}

// --- a grid of cells ------------------------------------------------------------
// The keys work on a grid: rows by columns, with a way to say whether a cell
// holds anything and where it stands. A table's grid has its header as row 0;
// free text's has no header (its columns are declared on lines of their own).
//
//   { kind, header, rows, cols, lineOf(r), filled(r, c), text(r, c),
//     span(r, c) -> { line, start, end, kind } | null, at(line, ch) -> { r, c } | null }

// A table block's grid. The header is row 0; divider and `...` lines hold no
// cells, and every key steps over them — as over the rows a filter hides,
// when `skip` (a Set of 0-based lines) names them.
function tableGrid(lines, block, skip) {
  const idx = [];
  block.rows.forEach((r, i) => { if (!r.sep && !(skip && skip.has(block.start + i))) idx.push(i); });
  const cols = Math.max(1, ...block.rows.filter((r) => !r.sep).map((r) => r.cells.length));
  const cellOf = (r, c) => String((block.rows[idx[r]] || { cells: [] }).cells[c] || "");
  return {
    kind: "table",
    header: true,
    rows: idx.length,
    cols,
    block,
    lineOf: (r) => block.start + idx[r],
    text: cellOf,
    filled: (r, c) => !!cellOf(r, c).trim(),
    span: (r, c) => {
      if (r < 0 || r >= idx.length) return null;
      const line = block.start + idx[r];
      const s = rowCellSpan(lines[line], c);
      return s && { line, ...s };
    },
    at: (line, ch) => {
      const r = idx.indexOf(line - block.start);
      return r === -1 ? null : { r, c: table.colAt(lines[line] || "", ch) };
    },
  };
}

// A Concept written as lines (lineform.gridAt's grid), as a grid: its Examples
// the rows, its attributes the columns after the name. A value nobody wrote
// has no line, so no place to stand.
function lineGrid(g) {
  const cols = g.columns.length + 1;
  const lineOfCell = (r, c) => (c === 0 ? g.rows[r].line - 1 : lineform.valueLineOf(g, g.rows[r], c));
  return {
    kind: "lines",
    header: false,
    rows: g.rows.length,
    cols,
    grid: g,
    lineOf: (r) => g.rows[r].line - 1,
    text: (r, c) => lineform.cellText(g, g.rows[r], c),
    filled: (r, c) => !!lineform.cellText(g, g.rows[r], c).trim(),
    span: (r, c) => {
      if (r < 0 || r >= g.rows.length || c < 0 || c >= cols) return null;
      const line = lineOfCell(r, c);
      if (line === -1) return null;
      const s = lineCellSpan(g.lines[line]);
      return s && { line, start: s.start, end: s.end, kind: s.kind };
    },
    at: (line) => {
      for (let r = 0; r < g.rows.length; r++) {
        if (g.rows[r].line - 1 === line) return { r, c: 0 };
        for (let c = 1; c < cols; c++) if (lineOfCell(r, c) === line) return { r, c };
      }
      return null;
    },
  };
}

const sameCell = (a, b) => !!a && !!b && a.r === b.r && a.c === b.c;
const rectOf = (a, b) => ({ top: Math.min(a.r, b.r), bottom: Math.max(a.r, b.r), left: Math.min(a.c, b.c), right: Math.max(a.c, b.c) });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Ctrl+arrow over a grid, as table.jumpCell does over a table: from a filled
// cell whose neighbour is filled too, to the last filled cell before a gap;
// from anywhere else, to the next filled cell; with none that way, the edge.
function edge(grid, r, c, dr, dc) {
  const path = [];
  for (let rr = r + dr, cc = c + dc; rr >= 0 && rr < grid.rows && cc >= 0 && cc < grid.cols; rr += dr, cc += dc) path.push({ r: rr, c: cc });
  if (!path.length) return { r, c };
  const has = (p) => grid.filled(p.r, p.c);
  if (grid.filled(r, c) && has(path[0])) {
    let at = 0;
    while (at + 1 < path.length && has(path[at + 1])) at++;
    return path[at];
  }
  return path.find(has) || path[path.length - 1];
}

// The selection after Shift+arrow (one cell) or Ctrl+Shift+arrow (to the edge
// of the data), from { anchor, active } (cells as { r, c }). Started on a
// table's header or on a name, the edge keys select the values below it or
// beside it: the header and the name are left out, since what is selected is
// usually typed over, filled or added up.
function extend(grid, state, dr, dc, toEdge) {
  let { anchor, active } = state;
  if (toEdge && sameCell(anchor, active)) {
    if (dr > 0 && grid.header && anchor.r === 0 && grid.rows > 1) anchor = { r: 1, c: anchor.c };
    if (dc > 0 && anchor.c === 0 && grid.cols > 1) anchor = { r: anchor.r, c: 1 };
  }
  const next = toEdge
    ? edge(grid, active.r, active.c, dr, dc)
    : { r: clamp(active.r + dr, 0, grid.rows - 1), c: clamp(active.c + dc, 0, grid.cols - 1) };
  // an edge key that reached no further than the cell it left off from (the
  // header, the name) still selects the values it was asked for
  if (toEdge && dr > 0 && anchor.r > next.r) return { anchor, active: { r: anchor.r, c: next.c } };
  if (toEdge && dc > 0 && anchor.c > next.c) return { anchor, active: { r: next.r, c: anchor.c } };
  return { anchor, active: next };
}

// The selections a rectangle is held as: one per cell, the active cell's first
// — [{ line, start, end, r, c }]. A cell with nowhere to stand holds none.
function rectSelections(grid, state) {
  const rect = rectOf(state.anchor, state.active);
  const out = [];
  const add = (r, c) => {
    const s = grid.span(r, c);
    if (s) out.push({ line: s.line, start: s.start, end: s.end, r, c });
  };
  add(state.active.r, state.active.c);
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) if (!(r === state.active.r && c === state.active.c)) add(r, c);
  }
  return out;
}

// Where a list of selections (as { line, start, end }) stands on a grid: the
// rectangle they cover, in cells, or null when one of them stands in no cell.
function boundsOf(grid, sels) {
  let top = Infinity, bottom = -1, left = Infinity, right = -1;
  for (const s of sels) {
    for (const ch of [s.start, s.end]) {
      const at = grid.at(s.line, ch);
      if (!at) return null;
      top = Math.min(top, at.r); bottom = Math.max(bottom, at.r);
      left = Math.min(left, at.c); right = Math.max(right, at.c);
    }
  }
  return bottom === -1 ? null : { top, bottom, left, right };
}

// The cells of a rectangle, row by row: their text, for a copy, the status
// bar's numbers and the column profile.
function rectTexts(grid, rect) {
  const out = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const row = [];
    for (let c = rect.left; c <= rect.right; c++) row.push(grid.text(r, c));
    out.push(row);
  }
  return out;
}

// --- numbers -------------------------------------------------------------------

// A cell's value as the status bar reads it: its value, never its formula.
const valueOf = (text) => table.readValue(table.splitCell(String(text == null ? "" : text).trim()).value).trim();

// A number back in the shape the cells wrote it in: their unit, their brackets.
function shown(n, sample) {
  if (!isFinite(n)) return String(n);
  const digits = Number(n.toPrecision(15)).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  let written;
  try { written = table.formatNumberText(digits, sample || ""); } catch { written = digits; }
  return table.shortNumber(written) || written;
}

// What a spreadsheet's status bar says of a selection. Count is every cell that
// holds something; Sum, Average, Min and Max are over the numbers, in their unit
// when they share one. Numbers in two units are counted and not added up:
// `$100 + €200` is no sum, here as in a formula. A date is not a number.
function stats(texts) {
  const filled = texts.map(valueOf).filter(Boolean);
  const nums = [];
  const units = new Set();
  let sample = "";
  for (const t of filled) {
    const form = table.writtenForm(t);
    if (!form.number) continue;
    const n = table.numericValue(t);
    if (isNaN(n)) continue;
    nums.push(n);
    units.add(form.unit);
    if (!sample) sample = t;
  }
  const out = { count: filled.length, numbers: nums.length, mixed: units.size > 1 };
  if (nums.length && !out.mixed) {
    const sum = nums.reduce((a, b) => a + b, 0);
    Object.assign(out, {
      sum, average: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums),
      shown: {
        sum: shown(sum, sample), average: shown(sum / nums.length, sample),
        min: shown(Math.min(...nums), sample), max: shown(Math.max(...nums), sample),
      },
    });
  }
  return out;
}

// The status bar's words for those numbers: `Sum $1,200 · Average $400 · Count 3`.
function statsText(s) {
  if (!s || !s.count) return "";
  if (s.mixed) return `Count ${s.count} · mixed units`;
  if (!s.numbers) return `Count ${s.count}`;
  return `Sum ${s.shown.sum} · Average ${s.shown.average} · Count ${s.count}`;
}

// A column at a glance, for its header's hover: how many cells, how many blank,
// how many different values and the commonest, and the numbers' summary.
function profile(texts) {
  const vals = texts.map(valueOf);
  const freq = new Map();
  for (const v of vals) if (v) freq.set(v, (freq.get(v) || 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  return { cells: vals.length, blanks: vals.filter((v) => !v).length, distinct: freq.size, top, ...stats(vals) };
}

module.exports = {
  rowCellSpan, lineCellSpan, isWhole,
  tableGrid, lineGrid, edge, extend, rectOf, rectSelections, boundsOf, rectTexts, sameCell,
  stats, statsText, profile, valueOf,
};
