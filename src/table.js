// Org-style plain-text tables: the '|' row grammar, shared by the linter
// (which reads a table as Examples x attributes) and the VS Code extension's
// formatter (which re-aligns the columns as org-mode's TAB does).
//
//     | name   | size | colour |     <- header: each cell names an attribute
//     |--------+------+--------|     <- separator: marks the row above as header
//     | Ollie  | 5    | brown  |     <- data row: one Example per row,
//     | Pebble | 3    |        |        one Attribute Value per cell
//
// A data row's first cell is the Example's name; an empty cell leaves that
// attribute unasserted. A pipe row with a single cell is a plain Example
// (the '- ' form written with '|'), so tables and lone rows coexist.

// A separator row is pipes, dashes, pluses, colons and spaces with at least
// one dash: '|---+---|', '|-', '| --- | --- |' all count.
const isSeparator = (text) => /^\|[\s\-+:|]*$/.test(text) && text.includes("-");

// Split a pipe row into its cells with their column offsets in the line.
// The content between consecutive pipes is one cell; a trailing pipe closes
// the last cell rather than opening an empty one.
function cells(line) {
  const first = line.indexOf("|");
  if (first === -1) return [];
  const out = [];
  let start = first + 1;
  for (let i = start; i <= line.length; i++) {
    if (i === line.length || line[i] === "|") {
      const seg = line.slice(start, i);
      out.push({ text: seg.trim(), col: start + (seg.length - seg.trimStart().length) });
      start = i + 1;
    }
  }
  if (out.length > 1 && out[out.length - 1].text === "" && line.trimEnd().endsWith("|")) out.pop();
  return out;
}

// The table block around one line: the unbroken run of pipe rows sharing
// its indent. Rows carry their cell texts; separator rows carry none.
// null when the line is not a pipe row.
function blockAt(lines, lineIdx) {
  const isRow = (i) => i >= 0 && i < lines.length && lines[i].trim()[0] === "|";
  if (!isRow(lineIdx)) return null;
  const indent = lines[lineIdx].match(/^ */)[0];
  const same = (i) => isRow(i) && lines[i].match(/^ */)[0] === indent;
  let start = lineIdx, end = lineIdx;
  while (same(start - 1)) start--;
  while (same(end + 1)) end++;
  const rows = [];
  for (let i = start; i <= end; i++) {
    // a dash typed anywhere in an otherwise empty row is only pipes, spaces
    // and dashes, so isSeparator already reads it as a separator being
    // typed — org's '|-' creation flow: the next redraw completes the rule
    const sep = isSeparator(lines[i].trim());
    rows.push({ sep, cells: sep ? [] : cells(lines[i]).map((c) => c.text) });
  }
  return { start, end, indent, rows };
}

// Each column's width: its widest cell across the data rows.
function widthsOf(block) {
  const widths = [];
  for (const row of block.rows) {
    if (row.sep) continue;
    row.cells.forEach((c, k) => { widths[k] = Math.max(widths[k] || 0, c.length); });
  }
  return widths.length ? widths : [0];
}

// Draw the block aligned: every column padded to its widest cell,
// separator rows redrawn to match.
function render(block) {
  const widths = widthsOf(block);
  return block.rows.map((row) => row.sep
    ? block.indent + "|" + widths.map((w) => "-".repeat(w + 2)).join("+") + "|"
    : block.indent + "| " + widths.map((w, k) => (row.cells[k] || "").padEnd(w)).join(" | ") + " |");
}

// Where a cell's text begins on an aligned line, so a command can land the
// cursor at the start of a field, as org does.
function cellStart(block, col) {
  const widths = widthsOf(block);
  let x = block.indent.length + 2;
  for (let k = 0; k < Math.min(col, widths.length); k++) x += widths[k] + 3;
  return x;
}

// The cell a character position falls in: one pipe opens each field.
function colAt(lineText, character) {
  let pipes = 0;
  for (let i = 0; i < Math.min(character, lineText.length); i++) {
    if (lineText[i] === "|") pipes++;
  }
  return Math.max(0, pipes - 1);
}

// Give every data row the block's full complement of cells, so the column
// operations can move and swap without falling off ragged rows.
function padRows(block) {
  const n = widthsOf(block).length;
  for (const row of block.rows) {
    if (row.sep) continue;
    while (row.cells.length < n) row.cells.push("");
  }
}

// The nearest data row from `from` in direction `dir`, skipping separator
// rows; -1 when there is none.
function dataRow(block, from, dir) {
  for (let i = from + dir; i >= 0 && i < block.rows.length; i += dir) {
    if (!block.rows[i].sep) return i;
  }
  return -1;
}

// --- the org table editor's operations -------------------------------------
// Each operation takes the block plus the cursor's block-relative row and
// column, mutates the block's rows, and returns { row, col } — the cell the
// cursor should land in once the block is redrawn — or null to leave the
// document untouched. The caller re-renders, so every operation re-aligns
// the table, exactly as org re-aligns on any table command.

// TAB: the next field, wrapping to the next data row; at the table's last
// field a new empty row is appended, as org does.
function nextCell(block, row, col) {
  const numCols = widthsOf(block).length;
  if (!block.rows[row].sep && col + 1 < numCols) return { row, col: col + 1 };
  const below = dataRow(block, row, 1);
  if (below !== -1) return { row: below, col: 0 };
  block.rows.push({ sep: false, cells: [] });
  return { row: block.rows.length - 1, col: 0 };
}

// Shift+TAB: the previous field, wrapping to the row above; never grows.
function prevCell(block, row, col) {
  if (!block.rows[row].sep && col > 0) return { row, col: col - 1 };
  const above = dataRow(block, row, -1);
  if (above === -1) return { row, col: 0 };
  return { row: above, col: widthsOf(block).length - 1 };
}

// RET: same column, next data row; a new row is appended at the bottom.
function nextRow(block, row, col) {
  const numCols = widthsOf(block).length;
  const target = Math.min(col, numCols - 1);
  const below = dataRow(block, row, 1);
  if (below !== -1) return { row: below, col: target };
  block.rows.push({ sep: false, cells: [] });
  return { row: block.rows.length - 1, col: target };
}

// M-left / M-right: carry the cursor's column left or right.
function moveColumn(block, row, col, dir) {
  const numCols = widthsOf(block).length;
  const other = col + dir;
  if (col >= numCols || other < 0 || other >= numCols) return null;
  padRows(block);
  for (const r of block.rows) {
    if (!r.sep) [r.cells[col], r.cells[other]] = [r.cells[other], r.cells[col]];
  }
  return { row, col: other };
}

// M-up / M-down: carry the cursor's row over the adjacent line, separator
// or not — a data row can hop an hline, as in org.
function moveRow(block, row, col, dir) {
  const other = row + dir;
  if (other < 0 || other >= block.rows.length) return null;
  [block.rows[row], block.rows[other]] = [block.rows[other], block.rows[row]];
  return { row: other, col };
}

// M-S-right: a new empty column where the cursor stands, pushing it right.
function insertColumn(block, row, col) {
  padRows(block);
  for (const r of block.rows) {
    if (!r.sep) r.cells.splice(Math.min(col, r.cells.length), 0, "");
  }
  return { row, col };
}

// M-S-left: kill the cursor's column.
function deleteColumn(block, row, col) {
  const numCols = widthsOf(block).length;
  if (col >= numCols) return null;
  padRows(block);
  for (const r of block.rows) {
    if (!r.sep) r.cells.splice(col, 1);
  }
  return { row, col: Math.max(0, Math.min(col, numCols - 2)) };
}

// M-S-down: a new empty row above the cursor's.
function insertRow(block, row, col) {
  block.rows.splice(row, 0, { sep: false, cells: [] });
  return { row, col: 0 };
}

// M-S-up: kill the cursor's row (or separator).
function deleteRow(block, row, col) {
  block.rows.splice(row, 1);
  if (!block.rows.length) return null;
  return { row: Math.min(row, block.rows.length - 1), col };
}

// C-c -: a separator line below the cursor's row.
function insertSeparator(block, row, col) {
  block.rows.splice(row + 1, 0, { sep: true, cells: [] });
  return { row, col };
}

// C-c ^: sort the run of data rows around the cursor (bounded by separator
// rows, so the header keeps its place) by the cursor's column — numerically
// when every key reads as a number ($, % and thousands commas ignored),
// alphabetically otherwise.
function sortRows(block, row, col) {
  if (block.rows[row].sep) return null;
  let a = row, b = row;
  while (a > 0 && !block.rows[a - 1].sep) a--;
  while (b < block.rows.length - 1 && !block.rows[b + 1].sep) b++;
  if (a === b) return null;
  const key = (r) => (r.cells[col] || "").trim();
  const num = (r) => parseFloat(key(r).replace(/[$,%\s]/g, ""));
  const run = block.rows.slice(a, b + 1);
  const numeric = run.every((r) => key(r) !== "" && !isNaN(num(r)));
  run.sort((x, y) => (numeric ? num(x) - num(y) : key(x).localeCompare(key(y))));
  block.rows.splice(a, run.length, ...run);
  return { row, col };
}

// C-c |: turn plain delimited lines (tab-, comma- or multi-space-separated)
// into a table — first line the header, lowercased since columns name
// attributes, with the separator drawn beneath it.
function fromRegion(lines) {
  const delim = lines.some((l) => l.includes("\t")) ? "\t"
    : lines.some((l) => l.includes(",")) ? ","
    : /\s{2,}/;
  const rows = lines.filter((l) => l.trim()).map((l) => ({
    sep: false,
    cells: l.trim().split(delim).map((s) => s.trim()),
  }));
  if (!rows.length) return null;
  rows[0].cells = rows[0].cells.map((c) => c.toLowerCase());
  const block = {
    indent: lines[0].match(/^ */)[0],
    rows: [rows[0], { sep: true, cells: [] }, ...rows.slice(1)],
  };
  return render(block);
}

// Re-align every table in the text so the pipes line up. A table is an
// unbroken run of pipe rows sharing one indent that contains a separator
// row — lone pipe Examples are left exactly as written.
// Returns the changed lines as { line, text } with 1-based line numbers.
function align(text) {
  const lines = text.split(/\r?\n/);
  const edits = [];
  for (let i = 0; i < lines.length; i++) {
    const block = blockAt(lines, i);
    if (!block) continue;
    i = block.end; // one visit per block
    if (!block.rows.some((r) => r.sep)) continue;
    render(block).forEach((aligned, k) => {
      if (aligned !== lines[block.start + k]) edits.push({ line: block.start + k + 1, text: aligned });
    });
  }
  return edits;
}

module.exports = {
  cells, isSeparator, align, blockAt, widthsOf, render, cellStart, colAt, padRows, dataRow,
  nextCell, prevCell, nextRow, moveColumn, moveRow, insertColumn, deleteColumn,
  insertRow, deleteRow, insertSeparator, sortRows, fromRegion,
};
