// Org-style plain-text tables: the '|' row grammar, shared by the linter
// (which reads a table as Examples x attributes) and the VS Code extension's
// formatter (which re-aligns the columns as org-mode's TAB does).
//
//     name  |size|colour     <- header: the first row, each cell an attribute
//     Ollie |5   |brown      <- data row: one Example per row,
//     Pebble|3   |              one Attribute Value per cell
//
// The pipe is a DIVIDER, never a border: a row carries one between each
// pair of cells and none at either end (before 1.12 it carried both). So a
// table is exactly as wide as its widest content, and the first column
// stands where every other line of the language stands. Columns are padded
// to their widest cell so they align, but carry no gutter spaces around the
// pipes — a file's width is precious.
//
// One table has no pair of cells to divide: the table of a Concept with no
// attributes, one column of names and nothing else. A divider between
// nothing and nothing is no character at all, so such a table drawn by the
// rule above would come back as plain outline lines — it would stop being a
// table between one draw and the next. So a row of a table that has no
// attributes CLOSES with its pipe instead:
//
//     Org Structure|
//     Department A |
//         Team 1   |
//             Alice|
//
// which is the same pipe doing the only job it has left. It is drawn
// wherever such a table is drawn — folded back from a one-column CSV,
// flipped over from free text, typed by hand — and it is READ as the empty
// last cell it looks like, exactly as any other trailing pipe is, which is
// why drawing it again changes nothing: the padding of an empty last column
// is trailing whitespace, and what is left when that goes is the pipe.
//
// The HEADER is the first row, and that is all it takes to be one. Before
// 1.12 a '---+---' rule under it said so; the rule said nothing the order
// did not, drew a line no reader needed, and is now dropped wherever one is
// found. Columns line up without it, since every cell is padded to its
// column and every column padded to its widest cell.
//
// A data row's first cell is the Example's name; an empty cell leaves that
// attribute unasserted. With no border to hold it open, an empty NAME cell
// is written by the divider that closes it standing first on the line —
// '|frag' — which is what a row still being filled looks like. Every row
// therefore has at least one pipe, and one pipe is all it takes to be a
// row — unless a colon stands before it, which makes the line a
// 'name: value' line with a pipe in its value (isRowText).
//
// A row may nest under the row above it. The depth is written as leading
// spaces in front of the name — which, the border being gone, is the line's
// own indent, four spaces to the level, exactly as the rest of the language
// writes depth:
//
//     Otter     |size
//     Ollie     |5             <- an Example of Otter
//         Pup   |1             <- a sub-Example of Ollie
//
// The depth never travels as text: cells() trims the name and reports its
// true column, and the block carries the depth as a number on the row, so
// crosslinks, formulas, the CSV mirror and the Gödel numbers all read the
// bare name exactly as they always did.

// Four spaces to the level, the same INDENT linter.js declares — one number
// under two names, because linter.js requires this file and not the other
// way about. Change one and change the other.
const INDENT = 4;

const { readsAsExpression } = require("./pyshape");

// A rule row — '---+---' — is layout left over from before 1.12, when it
// was what marked the row above it as the header. Being first is what marks
// the header now, so a rule states nothing: it is still recognised, so an
// older file goes on parsing, and it is dropped the moment the table is
// drawn again. Dashes, pluses, colons, pipes and spaces with at least two
// characters and one dash; two is the floor because a lone '-' is an
// Example whose name is still being typed, and the rule must not steal it.
const isSeparator = (text) => /^[\s\-+:|]*$/.test(text) && text.includes("-") && text.trim().length > 1;

// A line is a table row when it carries a '|': the divider between two
// cells is the only pipe a row has, so one is all it takes. A leftover rule
// counts too — it divides its columns with '+' and may carry no pipe at all.
//
// Except behind a colon. A name never holds one (the line grammar splits
// on it), so a colon standing before the first pipe says the line is a
// 'name: value' line whose VALUE carries the pipe — `rule: a | b`,
// `- Ann: x|y` — and a value is the one place a pipe is only a character.
// A row's own colons stand after its first divider, in the cells: `|12:30`
// and `Ollie|http://…` are rows as they always were.
//
// A derivation before the first pipe is a Concept's own, and it decides by
// whether it is finished there. `Quarter =quarters()|units|revenue` is the
// header of the table that derivation wrote — the Concept and its Python in
// the first cell, which is where a table names its Concept — so its pipe
// divides. `Sales =df[df.a | df.b]` is a Concept line whose Python is still
// open at the pipe (a bracket, a string), so the pipe is the Python's. A
// colon inside a derivation (`=rows()[:1]`) is the Python's too: only one
// standing before the '=' makes a `name: value` line.
const isRowText = (text) => {
  const t = String(text).trim();
  if (!t) return false;
  if (isSeparator(t)) return true;
  const ds = dividers(t);
  if (!ds.length) return false;
  const head = t.slice(0, ds[0]);
  const d = splitCell(head);
  return !(d.eq > 0 ? head.slice(0, d.eq) : head).includes(":");
};

// Where a row's dividers stand. Every pipe divides — except inside the
// Python a Concept's derivation carries in the first cell, while that
// Python is still open, in a bracket or a string: in
// `Flag Row =[{"on": True | False}]|on` the first pipe is Python's `or`, and
// only the one after the closing bracket divides. A derivation that never
// closes before the line ends leaves no divider at all, so the line is the
// Concept's line, pipes and all.
//
// Every later cell reads the same way: once its derivation opens — the '='
// that splitCell finds, which always stands before any pipe of its cell,
// since a value holds none — a pipe inside the Python's open brackets or
// strings is the Python's, so `A|=len("a|b")|=@x` is three cells. A cell's
// Python that never closes before the line ends is read with every pipe a
// divider after all: a data row must stay a row, and a half-typed bracket is
// no reason to swallow the cells after it.
function dividers(text) {
  const t = String(text);
  const out = [];
  const pipe = t.indexOf("|");
  if (pipe === -1) return out;
  let from = 0;
  const head = t.slice(0, pipe);
  const lead = head.length - head.trimStart().length;
  const d = splitCell(head.trimStart());
  // a line that opens with its '=' names nothing before it: no header (a
  // table names its Concept first) and no row, but the bare derivation that
  // writes Concepts — every pipe on it is its Python's
  if (d.eq === 0) return out;
  if (d.eq > 0 && !head.trimStart().slice(0, d.eq).includes(":")) {
    const found = pythonPipe(t, lead + d.eq + 1).at;
    if (found === -1) return out;
    out.push(found);
    from = found + 1;
  }
  // the cells after the first, one at a time
  let at = from;
  while (at < t.length) {
    const next = t.indexOf("|", at);
    if (next === -1) break;
    const seg = t.slice(at, next);
    const segLead = seg.length - seg.trimStart().length;
    const cd = splitCell(seg.trimStart());
    if (cd.eq === -1) {
      out.push(next);
      at = next + 1;
      continue;
    }
    const scan = pythonPipe(t, at + segLead + cd.eq + 1);
    if (scan.at !== -1) {
      out.push(scan.at);
      at = scan.at + 1;
    } else if (scan.closed) {
      break; // the Python runs to the line's end, its pipes all its own
    } else {
      for (let k = next; k < t.length; k++) if (t[k] === "|") out.push(k);
      break;
    }
  }
  return out;
}

// From `start` inside a derivation: the first pipe standing outside the
// Python's brackets and strings ({ at }, -1 for none), and whether the
// Python is closed where the line ends.
function pythonPipe(t, start) {
  let depth = 0, quote = null;
  for (let k = start; k < t.length; k++) {
    const ch = t[k];
    if (quote) {
      if (ch === "\\") k++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === "\"" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "|" && depth <= 0) return { at: k, closed: true };
  }
  return { at: -1, closed: !quote && depth <= 0 };
}

// A derivation written on a line that carries no value — `Sales =by_month(@raw)`
// — as { head, formula, eq }: the term before the '=', the source after it,
// and the '=''s index in `text`. null when the line carries none, and when a
// colon stands first: `Run Command: code =x` is a Concept with an inline
// Example whose text is the Example's business, and `total: 5 =sum(@x)` is a
// value's derivation, which splitCell reads off the value. A '- ' Example and
// a '...' Map carry no derivation. `text` is the line trimmed.
function lineDerivation(text) {
  const t = String(text || "");
  if (!t || t.startsWith("- ") || t.startsWith("...")) return null;
  const split = splitCell(t);
  if (split.eq <= 0) return null;
  const head = t.slice(0, split.eq);
  if (head.includes(":")) return null;
  return { head: head.trim(), formula: t.slice(split.eq + 1).trim(), eq: split.eq };
}

// The block's header: its first row. With the rule gone, standing first is
// what makes a row the header — the cells that name the Concept and its
// columns — and every row under it is an Example. -1 when the block is
// nothing but leftover rules.
const headerIndex = (block) => block.rows.findIndex((r) => !r.sep);

// A cell padded to its column's width. An over-long cell is never
// truncated — the column widens instead.
function padCell(text, width) {
  const gap = width - text.length;
  return gap <= 0 ? text : text + " ".repeat(gap);
}

// Split a row into its cells with their column offsets in the line. The
// pipe divides, so the line opens the first cell and ends the last: the
// content between two consecutive pipes is one cell, a LEADING pipe opens
// on an empty name cell, and a TRAILING one leaves an empty cell after it
// (which asserts nothing, exactly as any other empty cell does — and which
// is how the closing pipe of an attribute-less table reads back).
//
// `indent` is the cell's own leading spaces. On the name cell that is where
// a row's depth is written; everywhere else it is only padding. A cell with
// nothing in it indents nothing — an all-spaces cell is empty, not deep,
// which is what keeps a row whose name cell is still empty at the depth of
// the table it is being typed into.
function cells(line) {
  const text0 = String(line);
  if (!text0.trim()) return [];
  const out = [];
  let start = 0;
  // the dividers, not every pipe: a derivation in the first cell may hold one
  for (const i of [...dividers(text0), text0.length]) {
    const seg = text0.slice(start, i);
    const text = seg.trim();
    const indent = seg.length - seg.trimStart().length;
    out.push({ text, col: start + indent, indent: text ? indent : 0 });
    start = i + 1;
  }
  return out;
}

// The table block around one line: the unbroken run of rows around it.
// Rows carry their cell texts and their depth — the name's own indent, in
// levels, measured from the block's — while separator rows carry neither,
// only the columns' alignment. null when the line is not a row.
//
// The run is bounded by what is not a row: a blank line, or any line
// carrying no pipe. The block's own indent is its SHALLOWEST row's, since
// a nested row is written deeper than the table it belongs to — which is
// why two standalone tables need a blank line between them, exactly as the
// header of the second would otherwise read as more rows of the first.
function blockAt(lines, lineIdx) {
  const isRow = (i) => i >= 0 && i < lines.length && isRowText(lines[i]);
  if (!isRow(lineIdx)) return null;
  const indentOf = (i) => lines[i].match(/^ */)[0];
  let start = lineIdx, end = lineIdx;
  while (isRow(start - 1)) start--;
  while (isRow(end + 1)) end++;
  let indent = indentOf(start);
  for (let i = start + 1; i <= end; i++) {
    if (indentOf(i).length < indent.length) indent = indentOf(i);
  }
  // A table written in the pre-1.12 bordered form — every row of it opening
  // and closing with a '|' — is read without those borders, so drawing the
  // block again is what migrates the file. The test is the whole block's,
  // and every row must agree: a half-converted table is left to its errors
  // rather than guessed at, and a table whose every row genuinely had an
  // empty name cell would have nothing to name its Examples anyway.
  const bordered = (() => {
    for (let i = start; i <= end; i++) {
      const t = lines[i].trim();
      if (!t.startsWith("|") || !t.endsWith("|") || t.length < 2) return false;
    }
    return true;
  })();
  const unborder = (list) => (bordered ? list.slice(1, -1) : list);
  const rows = [];
  for (let i = start; i <= end; i++) {
    // a leftover rule is kept in the block so every row still answers to its
    // own line, and dropped when the block is drawn
    const sep = isSeparator(lines[i].trim());
    if (sep) {
      rows.push({ sep, cells: [] });
      continue;
    }
    const row = unborder(cells(lines[i]));
    // the name's leading spaces are the row's place in the tree: past the
    // table's own indent, or — in a bordered table being migrated — the
    // spaces the old border held them behind
    const lead = row.length ? row[0].indent - (bordered ? 0 : indent.length) : 0;
    rows.push({
      sep,
      cells: row.map((c) => c.text),
      depth: Math.floor(Math.max(0, lead) / INDENT),
    });
  }
  return { start, end, indent, rows };
}

// Does any row of the block sit under another? A flat table is drawn
// exactly as it always was; only a nesting one changes how its name column
// is measured and aligned.
const nests = (block) => block.rows.some((r) => !r.sep && r.depth);

// The name cell as it is drawn: the row's depth in leading spaces, then the
// name. Every other cell draws itself.
const nameCell = (row) => " ".repeat((row.depth || 0) * INDENT) + (row.cells[0] || "");

// A numbering prefix — `1. `, `2.3 `, `1.1.1 ` — is presentation, never
// part of a name's identity: `trip` types by the Concept `1. Trip` exactly
// as it would by `Trip`, so numbering a tree breaks no reference. Shared
// by every index that resolves names. A number must be followed by a dot
// (`3 Foo` carries no prefix; `- 35` stays the Example it always was).
const NUMBER_PREFIX = /^\d+\.(\d+(\.\d+)*)?\s+/;
const numberless = (name) => String(name || "").replace(NUMBER_PREFIX, "");

// --- column widths ----------------------------------------------------------
// A column is as wide as its widest cell and no wider, and a cell is never
// broken to fit. Between 1.8 and 1.12 a header cell could carry an
// org-style width cookie — `description <24>` — capping its column and
// wrapping longer cells onto continuation rows, data rows with an empty
// name cell each holding one fragment. It is gone: one row of a table is
// one line of the file again, an empty name cell is the error it was
// before the cookie made an exception of it, and `<24>` is now nothing but
// part of a column's name. A table that has a genuinely long value is one
// wide table, and every reader of it — the cursor, the CSV mirror, a
// formula's `len()` — reads the value where it stands.

// Each column's width: its widest cell across the rows.
function widthsOf(block) {
  const widths = [];
  block.rows.forEach((row) => {
    if (row.sep) return;
    row.cells.forEach((c, k) => {
      // the name column must hold the deepest row's indent as well as its name
      const w = k === 0 ? nameCell(row).length : c.length;
      widths[k] = Math.max(widths[k] || 0, w);
    });
  });
  // never narrower than one character: a zero-width column would leave
  // nowhere to put the cursor
  for (let k = 0; k < widths.length; k++) widths[k] = Math.max(widths[k], 1);
  return widths.length ? widths : [0];
}

// Draw the block aligned: every column padded to its widest cell. No gutter
// spaces around the pipes, and no rule row — a leftover one is dropped here,
// which is how a pre-1.12 file loses it. One row is one line: nothing here
// splits a cell across two.
function render(block) {
  const widths = widthsOf(block);
  const drawn = (row, k) => (k === 0 ? nameCell(row) : row.cells[k] || "");
  // The pipes divide, so a drawn row opens with its name and ends with its
  // last written cell: the padding past that is trailing whitespace, and no
  // line keeps that. A row with nothing in its name cell is padded to the
  // column like any other, so it opens with spaces — those are the empty
  // cell, never an indent, and every reader of a row knows it.
  //
  // One column and no more is the table that has no attributes to divide
  // off: there the row closes with its pipe, since a row drawn with no pipe
  // at all would read back as an outline line and the table would be gone.
  // (A block read from the file already carries that pipe as its empty last
  // cell, so this is the drawing that puts one there in the first place —
  // a one-column CSV folded back, free text flipped over, a row appended to
  // a table that has nothing in it yet.)
  const closes = widths.length === 1;
  const drawRow = (parts) => (closes
    ? block.indent + parts.join("|") + "|"
    : (block.indent + parts.join("|")).replace(/\s+$/, ""));
  return block.rows.filter((row) => !row.sep)
    .map((row) => drawRow(widths.map((w, k) => padCell(drawn(row, k), w))));
}

// Where a cell's text begins on an aligned line, so a command can land the
// cursor at the start of a field, as org does.
function cellStart(block, col) {
  const widths = widthsOf(block);
  let x = block.indent.length;
  for (let k = 0; k < Math.min(col, widths.length); k++) x += widths[k] + 1;
  return x;
}

// The cell a character position falls in: the line opens the first field
// and each pipe closes one, so the count of pipes behind the cursor is the
// column it stands in.
function colAt(lineText, character) {
  return dividers(lineText).filter((i) => i < Math.min(character, lineText.length)).length;
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
  const last = block.rows[block.rows.length - 1];
  block.rows.push({ sep: false, cells: [], depth: last && !last.sep ? last.depth || 0 : 0 });
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

// The first column is no attribute: its header cell names the Concept and
// each row's cell names that row's Example. So the column keys never move,
// delete or copy it, and a column inserted "where the cursor stands" on it
// goes in just after it — the names always stay first.

// M-left / M-right: carry the cursor's column left or right.
function moveColumn(block, row, col, dir) {
  const numCols = widthsOf(block).length;
  const other = col + dir;
  if (col < 1 || col >= numCols || other < 1 || other >= numCols) return null;
  padRows(block);
  for (const r of block.rows) {
    if (!r.sep) [r.cells[col], r.cells[other]] = [r.cells[other], r.cells[col]];
  }
  return { row, col: other };
}

// M-up / M-down: carry the cursor's row over the adjacent line, separator
// or not — a data row can hop an hline, as in org.
function moveRow(block, row, col, dir) {
  const here = block.rows[row];
  // a separator, or a flat table, still hops one line at a time as it did
  if (!here || here.sep || !nests(block)) {
    const other = row + dir;
    if (other < 0 || other >= block.rows.length) return null;
    [block.rows[row], block.rows[other]] = [block.rows[other], block.rows[row]];
    return { row: other, col };
  }
  const span = subtreeOf(block, row);
  const mine = block.rows.slice(row, row + span);
  if (dir < 0) {
    // up: over the sibling above, which carries its own children with it
    const above = prevSibling(block, row);
    if (above === -1) return null;
    block.rows.splice(row, span);
    block.rows.splice(above, 0, ...mine);
    return { row: above, col };
  }
  // down: over the next sibling and everything under it
  const next = row + span;
  const after = block.rows[next];
  if (!after || after.sep || (after.depth || 0) !== (here.depth || 0)) return null;
  const theirs = subtreeOf(block, next);
  block.rows.splice(row, span);
  block.rows.splice(row + theirs, 0, ...mine);
  return { row: row + theirs, col };
}

// M-S-right: a new empty column where the cursor stands, pushing it right.
function insertColumn(block, row, col) {
  const at = Math.max(1, col);
  padRows(block);
  for (const r of block.rows) {
    if (!r.sep) r.cells.splice(Math.min(at, r.cells.length), 0, "");
  }
  return { row, col: at };
}

// M-S-left: kill the cursor's column.
function deleteColumn(block, row, col) {
  const numCols = widthsOf(block).length;
  if (col < 1 || col >= numCols) return null;
  padRows(block);
  for (const r of block.rows) {
    if (!r.sep) r.cells.splice(col, 1);
  }
  return { row, col: Math.max(0, Math.min(col, numCols - 2)) };
}

// M-S-down: a new empty row above the cursor's.
function insertRow(block, row, col) {
  // the new row is a sibling of the one it pushes down, not a child of it
  const at = block.rows[row];
  block.rows.splice(row, 0, { sep: false, cells: [], depth: at && !at.sep ? at.depth || 0 : 0 });
  return { row, col: 0 };
}

// M-S-up: kill the cursor's row (or separator).
function deleteRow(block, row, col) {
  // a row's sub-Examples are written inside it, so they go with it — one
  // Ctrl+Z brings the whole branch back
  block.rows.splice(row, subtreeOf(block, row));
  if (!block.rows.length) return null;
  return { row: Math.min(row, block.rows.length - 1), col };
}

// C-c ^: sort the data rows around the cursor — the header standing first
// is what keeps it out of the run — by the cursor's column: numerically
// when every key reads as a number ($, % and thousands commas ignored),
// alphabetically otherwise.
function sortRows(block, row, col) {
  if (block.rows[row].sep) return null;
  const head = headerIndex(block);
  if (row <= head) return null;
  let a = row, b = row;
  while (a > head + 1 && !block.rows[a - 1].sep) a--;
  while (b < block.rows.length - 1 && !block.rows[b + 1].sep) b++;
  if (a === b) return null;
  const key = (r) => readValue(splitCell((r.cells[col] || "").trim()).value);
  const num = (r) => parseFloat(key(r).replace(/[$,%\s]/g, ""));
  const run = block.rows.slice(a, b + 1);
  // Sorting is per generation: siblings are ordered against each other and
  // each carries its own children along, so a sort re-orders the tree
  // without flattening it. A flat table is one generation, and sorts
  // exactly as it always did.
  const sortGeneration = (rows) => {
    const groups = [];
    for (let i = 0; i < rows.length;) {
      const depth = rows[i].depth || 0;
      let n = 1;
      while (i + n < rows.length && (rows[i + n].depth || 0) > depth) n++;
      groups.push({ head: rows[i], kids: rows.slice(i + 1, i + n) });
      i += n;
    }
    const numeric = groups.every((g) => key(g.head) !== "" && !isNaN(num(g.head)));
    groups.sort((x, y) => (numeric
      ? num(x.head) - num(y.head)
      : key(x.head).localeCompare(key(y.head))));
    return groups.flatMap((g) => [g.head, ...sortGeneration(g.kids)]);
  };
  block.rows.splice(a, run.length, ...sortGeneration(run));
  return { row, col };
}

// Tab / Shift+Tab at the very start of a name cell: file the row one level
// deeper (under the sibling above it) or one level shallower, its own
// children travelling with it so the branch keeps its shape.
//
// A row can only ever be one level under the row above it — there must be a
// row for it to sit beneath — so demoting the first of a generation does
// nothing, and promoting one already at the top does nothing either.
function shiftRowDepth(block, row, col, dir) {
  const here = block.rows[row];
  if (!here || here.sep || row === 0) return null;
  const depth = here.depth || 0;
  if (dir > 0 && prevSibling(block, row) === -1) return null; // no row to adopt it
  if (dir < 0 && depth === 0) return null;
  const span = subtreeOf(block, row);
  for (let i = row; i < row + span; i++) {
    block.rows[i].depth = (block.rows[i].depth || 0) + dir;
  }
  return { row, col };
}

const demoteRow = (block, row, col) => shiftRowDepth(block, row, col, 1);
const promoteRow = (block, row, col) => shiftRowDepth(block, row, col, -1);

// A cell's text as a copy carries it somewhere else: a derivation alone,
// without the value it computed where it stood — its value in the new place
// is the next run's to write, and until then it holds none.
function carried(text) {
  const t = text || "";
  const { eq } = splitCell(t);
  return eq === -1 ? t : t.slice(eq).trim();
}

// Copy the cursor cell's derivation onto every other data row's cell in the
// same column. A copy arrives without a value — the one there was not this
// derivation's — and computes when the derivations next run (Ctrl+Enter).
function copyFormulaDown(block, row, col) {
  const r = block.rows[row];
  if (!r || r.sep) return null;
  const anchor = r.cells[col] || "";
  if (splitCell(anchor).eq === -1) return null;
  const rows = dataRowsOf(block);
  if (!rows.includes(r)) return null;
  padRows(block);
  for (const other of rows) {
    if (other !== r) other.cells[col] = carried(anchor);
  }
  return { row, col };
}

// A calculated column. When every data row of a column carries the same
// derivation (or nothing yet), that derivation is not a fact about each row
// but the definition of the column — and the language has a place for it:
// `==` on the header cell, which a run writes into every value of the
// column that has no derivation of its own. Moving it there leaves each cell
// its value alone, so two formula columns side by side read as plain data.
//
// columnDefinition answers { source, name } for the column — the one source
// its derivations share and the column's name — or null when it has none,
// when two rows derive it differently, when the column already has a `==`,
// or for the name column.
function columnDefinition(block, col) {
  const head = headerIndex(block);
  if (col < 1 || head === -1) return null;
  const header = block.rows[head].cells[col];
  if (!header || splitConstraint(header).constraints.some((c) => c.op === "==")) return null;
  let source = null;
  for (const r of dataRowsOf(block)) {
    const text = r.cells[col] || "";
    const split = splitCell(text);
    if (split.eq === -1) {
      if (text.trim()) return null; // a value typed by hand is its own
      continue;
    }
    const own = text.slice(split.eq + 1).trim();
    if (source === null) source = own;
    else if (own !== source) return null;
  }
  return source ? { source, name: columnTerm(header) } : null;
}

// The edit: the shared derivation onto the header as `==`, each cell left
// holding its value. The values computed so far stay; the next run checks
// them against the definition and fills the empty ones.
function defineColumn(block, row, col) {
  const def = columnDefinition(block, col);
  if (!def) return null;
  const head = headerIndex(block);
  padRows(block);
  block.rows[head].cells[col] = `${block.rows[head].cells[col].trim()} ==${def.source}`;
  for (const r of dataRowsOf(block)) r.cells[col] = splitCell(r.cells[col] || "").value;
  return { row, col };
}

// Copy the cursor cell's derivation onto every other cell in the same ROW,
// each without a value until the next run. The name column (0) is left
// alone — it names the Example.
function copyFormulaAcross(block, row, col) {
  const r = block.rows[row];
  if (!r || r.sep) return null;
  const anchor = r.cells[col] || "";
  if (splitCell(anchor).eq === -1) return null;
  const n = widthsOf(block).length;
  padRows(block);
  for (let k = 1; k < n; k++) {
    if (k !== col) r.cells[k] = carried(anchor);
  }
  return { row, col };
}

// --- copying and cutting in a direction ------------------------------------
// The formula copies above move a *derivation* and keep each cell's own
// value. These four move the text itself, which is what building a table by
// hand actually needs: the next Example is usually the last one with two
// fields changed, and a value typed into the wrong column wants moving, not
// retyping. Each is a copy or a cut in one of the four directions, and each
// carries the cursor to what it just wrote, so holding the key fills a run.
//
// Nothing here is clever about content: a cell arrives exactly as it was
// written, formula and all. A copy that makes a duplicate Example name or a
// second column of one attribute is reported by the linter as it always is —
// refusing the movement would be the worse answer, since the copy is usually
// the fastest way *to* the row you meant.

// The cell one step from (row, col) in a direction, or null when the table
// has no such cell. Vertical steps skip separator rows, exactly as TAB and
// RET do; a step down past the last row appends one, since a column is
// usually filled downward into a table that is still growing. Horizontal
// steps never grow the table: a new column needs an attribute name of its
// own, so there is nothing sensible to widen into.
function neighbourCell(block, row, col, dRow, dCol) {
  if (dRow) {
    const other = dataRow(block, row, dRow);
    if (other !== -1) return { row: other, col };
    if (dRow < 0) return null;
    block.rows.push({ sep: false, cells: [] });
    return { row: block.rows.length - 1, col };
  }
  const other = col + dCol;
  if (other < 0 || other >= widthsOf(block).length) return null;
  return { row, col: other };
}

// Copy the cursor's cell into its neighbour, leaving this one as written.
function copyCell(block, row, col, dRow, dCol) {
  const here = block.rows[row];
  if (!here || here.sep) return null;
  const to = neighbourCell(block, row, col, dRow, dCol);
  if (!to) return null;
  padRows(block);
  block.rows[to.row].cells[to.col] = here.cells[col] || "";
  return to;
}

// Cut the cursor's cell into its neighbour: the same move, with this cell
// left empty behind it.
function moveCell(block, row, col, dRow, dCol) {
  const here = block.rows[row];
  if (!here || here.sep) return null;
  const to = neighbourCell(block, row, col, dRow, dCol);
  if (!to) return null;
  padRows(block);
  block.rows[to.row].cells[to.col] = here.cells[col] || "";
  here.cells[col] = "";
  return to;
}

// Duplicate the cursor's whole data row, above it or below it. The header is
// not a row to duplicate — a table has one — so the cursor must stand in the
// data; the copy takes the cursor with it.
function copyRow(block, row, col, dir) {
  const here = block.rows[row];
  if (!here || here.sep || !dataRowsOf(block).includes(here)) return null;
  padRows(block);
  const at = dir < 0 ? row : row + 1;
  block.rows.splice(at, 0, { sep: false, cells: here.cells.slice() });
  return { row: at, col };
}

// Duplicate the cursor's whole column, to its left or its right — the
// header and every value follow. The new column
// carries the old one's attribute name, which the linter will report as a
// repeat until you rename it: that rename is the point of the copy.
function copyColumn(block, row, col, dir) {
  const numCols = widthsOf(block).length;
  if (col < 1 || col >= numCols) return null;
  padRows(block);
  const at = dir < 0 ? col : col + 1;
  for (const r of block.rows) {
    if (!r.sep) r.cells.splice(at, 0, r.cells[col] || "");
  }
  return { row, col: at };
}

// --- the spreadsheet keys ----------------------------------------------------
// The keys a spreadsheet hand reaches for without looking. The jumps only
// answer where the cursor goes — the caller moves it and redraws nothing,
// since moving is not editing. The fills and the copies from above are
// table operations like every other, re-aligned by the caller.

// Does the cell hold anything? Padding is not content.
const filledAt = (block, row, col) => !!String(block.rows[row].cells[col] || "").trim();

// Ctrl+arrow: the spreadsheet's jump to the edge of the data. From a filled
// cell whose neighbour is filled too, the cursor runs to the last filled
// cell before a gap; from anywhere else, to the next filled cell; with none
// that way, to the table's edge. The header is a row like any other, as it
// is to Tab, and a leftover rule is stepped over.
function jumpCell(block, row, col, dRow, dCol) {
  const here = block.rows[row];
  if (!here || here.sep) return null;
  const numCols = widthsOf(block).length;
  const from = Math.min(col, numCols - 1);
  // the cells along the direction of travel, nearest first
  const path = [];
  if (dRow) {
    for (let i = dataRow(block, row, dRow); i !== -1; i = dataRow(block, i, dRow)) path.push({ row: i, col: from });
  } else {
    for (let k = from + dCol; k >= 0 && k < numCols; k += dCol) path.push({ row, col: k });
  }
  if (!path.length) return { row, col: from };
  const has = (c) => filledAt(block, c.row, c.col);
  if (filledAt(block, row, from) && has(path[0])) {
    let at = 0;
    while (at + 1 < path.length && has(path[at + 1])) at++;
    return path[at];
  }
  return path.find(has) || path[path.length - 1];
}

// Ctrl+Home / Ctrl+End: the table's first cell — the header's, which names
// the Concept — and its last, the last row's last column.
function cornerCell(block, which) {
  if (which === "home") {
    const head = headerIndex(block);
    return head === -1 ? null : { row: head, col: 0 };
  }
  const last = dataRow(block, block.rows.length, -1);
  return last === -1 ? null : { row: last, col: widthsOf(block).length - 1 };
}

// Ctrl+D / Ctrl+R: the spreadsheet's fill, down or right. `span` is the
// selection, { anchor: { row, col }, active: { row, col } } relative to the
// block, or absent for the cursor's cell alone.
//
// Down: over a run of selected rows, the first is copied into the rest;
// over one row (or none selected), the row above is copied into it. Right:
// the same across, the first selected column into the rest, or the column
// to the left into a lone one. Text arrives exactly as written; a
// derivation arrives alone, its value left for the next run to write in its
// new row (carried). The header and the name column are never
// a source — an attribute's name or an Example's is no value a cell means
// to hold — so a fill that would start from either does nothing.
function fill(block, row, col, span, axis) {
  const here = block.rows[row];
  if (!here || here.sep) return null;
  const head = headerIndex(block);
  const numCols = widthsOf(block).length;
  const isData = (i) => i > head && i < block.rows.length && !block.rows[i].sep;
  const sel = span || { anchor: { row, col }, active: { row, col } };
  const top = Math.max(Math.min(sel.anchor.row, sel.active.row), 0);
  const bottom = Math.min(Math.max(sel.anchor.row, sel.active.row), block.rows.length - 1);
  const left = Math.max(Math.min(sel.anchor.col, sel.active.col), 1);
  const right = Math.min(Math.max(sel.anchor.col, sel.active.col), numCols - 1);
  const rows = [];
  for (let i = top; i <= bottom; i++) if (isData(i)) rows.push(i);
  if (!rows.length || right < left) return null;
  padRows(block);
  if (axis === "down") {
    const source = rows.length > 1 ? rows[0] : dataRow(block, rows[0], -1);
    if (!isData(source)) return null;
    const targets = rows.length > 1 ? rows.slice(1) : rows;
    for (let k = left; k <= right; k++) {
      for (const t of targets) block.rows[t].cells[k] = carried(block.rows[source].cells[k]);
    }
  } else {
    const source = right > left ? left : left - 1;
    if (source < 1) return null;
    for (const t of rows) {
      for (let k = right > left ? left + 1 : left; k <= right; k++) block.rows[t].cells[k] = carried(block.rows[t].cells[source]);
    }
  }
  return span ? { row: sel.active.row, col: sel.active.col, anchor: sel.anchor } : { row, col };
}

const fillDown = (block, row, col, span) => fill(block, row, col, span, "down");
const fillRight = (block, row, col, span) => fill(block, row, col, span, "right");

// Ctrl+' / Ctrl+Shift+': the spreadsheet's copy from the cell above — the
// derivation alone (its value comes the next time it runs), or the value
// alone, its derivation left behind. The header stands
// above nothing, and a name is never copied.
function fromAbove(block, row, col, part) {
  const here = block.rows[row];
  const head = headerIndex(block);
  if (!here || here.sep || row <= head || col < 1 || col >= widthsOf(block).length) return null;
  const above = dataRow(block, row, -1);
  if (above <= head) return null;
  const text = block.rows[above].cells[col] || "";
  const split = splitCell(text);
  if (part === "formula" && split.eq === -1) return null;
  padRows(block);
  here.cells[col] = part === "formula" ? text.slice(split.eq).trim() : split.value;
  return { row, col };
}

const copyFormulaFromAbove = (block, row, col) => fromAbove(block, row, col, "formula");
const copyValueFromAbove = (block, row, col) => fromAbove(block, row, col, "value");

// A header cell's column name: the attribute it declares, its trailing
// constraint and (alias) set aside — the name a reference writes.
function columnTerm(cell) {
  let name = splitConstraint(cell || "").value;
  if (name.endsWith(")") && name.includes("(")) name = name.slice(0, name.lastIndexOf("(")).trim();
  return name;
}

// C-c |: turn plain delimited lines (tab-, comma- or multi-space-separated)
// into a table — first line the header, with the separator drawn beneath it.
// The header's first cell names the Concept (kept as written), the rest name
// attributes (lowercased, since a column is an attribute of that Concept).
function fromRegion(lines) {
  const delim = lines.some((l) => l.includes("\t")) ? "\t"
    : lines.some((l) => l.includes(",")) ? ","
    : /\s{2,}/;
  const rows = lines.filter((l) => l.trim()).map((l) => ({
    sep: false,
    cells: l.trim().split(delim).map((s) => s.trim()),
  }));
  if (!rows.length) return null;
  rows[0].cells = rows[0].cells.map((c, k) => (k === 0 ? c : c.toLowerCase()));
  const block = {
    indent: lines[0].match(/^ */)[0],
    rows,
  };
  return render(block);
}

// --- derivations and constraints --------------------------------------------
// A value may be derived: `20 =@price*0.2` keeps the value first and its
// derivation after it — Python, run only when asked (python.js). An attribute
// may be constrained — `age >=18` on a bare attribute line or a table header
// cell — and every value it takes is held to the bound, also Python, checked
// when the derivations run. Nothing here evaluates either: this is the
// grammar that finds them in the text.

// A value may hold a literal '=' by escaping it: `note: a \= b` is the
// value 'a = b', not a derivation of 'a'. splitCell needs no rule for it —
// the character before an escaped '=' is the backslash, never a space, so
// the scan below already walks past it — which leaves exactly one step:
// take the backslash off when a value is read *as data* (the model, the
// evaluator, a sort key) and leave it on in the text, which is what every
// rewrite path copies verbatim. readValue is that step; call it wherever a
// value becomes meaning rather than characters.
const readValue = (text) => String(text).replace(/\\=/g, "=");

// Split a cell (or line-form value) into its value and its '=' derivation:
// eq is the index of the '=' (the cell's start, or following a space), -1
// when the cell is a plain value. The scan is left-to-right and skips
// '==', so a comparison inside the Python ('=1 if @a == 3 else 0') never
// splits the cell. The value comes back as written — escapes and all — because
// most callers put it straight back on the line; read it with readValue.
// Values carry derivations only — constraints live on the attribute
// declaration (splitConstraint) and validate the values.
function splitCell(text) {
  if (!text) return { value: text || "", eq: -1, op: null };
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && text[i - 1] !== " ") continue;
    if (text[i] !== "=" || text[i + 1] === "=") continue;
    return { value: text.slice(0, i).trim(), eq: i, op: "=" };
  }
  return { value: text, eq: -1, op: null };
}

// The constraint operators an attribute declaration may carry.
const CONSTRAINT_OPS = ["==", "<=", ">=", "<", ">"]; // longest first

// Split an attribute declaration into its term and its constraints —
// comparison bounds such as `age >=18`, `cap <=@price*1.5`, or several
// chained on the one declaration: `age >=18 <=65` bounds the attribute
// both ways. Returns { value (the term), eq (index the first clause
// starts, -1 for none), op, formula (the first bound, for the callers
// that only name the clause), constraints: [{ op, formula, eq }] }. A
// bound is Python, and only believed when its right side reads as an
// expression (pyshape.js), so a prose term such as 'speed > none noted'
// stays a plain name.
function splitConstraint(text) {
  if (!text) return { value: text || "", eq: -1, op: null, formula: "", constraints: [] };
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && text[i - 1] !== " ") continue;
    const op = CONSTRAINT_OPS.find((o) => text.startsWith(o, i));
    if (!op) continue;
    const constraints = chainOf(text, i);
    if (constraints) {
      return {
        value: text.slice(0, i).trim(), eq: i,
        op: constraints[0].op, formula: constraints[0].formula, constraints,
      };
    }
    i += op.length - 1; // an unaccepted candidate is skipped whole
  }
  return { value: text, eq: -1, op: null, formula: "", constraints: [] };
}

// Whether a segment stands whole on its own: its brackets and its strings
// close. Text cut off inside either is a fragment, whatever else it holds.
function standsWhole(text) {
  let depth = 0, quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === "\"") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if ((ch === ")" || ch === "]" || ch === "}") && --depth < 0) return false;
  }
  return depth === 0 && !quote;
}

// The bounds chained from `from` (which indexes an operator) to the end of
// the text: each further space-preceded operator whose preceding segment
// stands as an expression of its own starts a new bound — so 'age >=18 <=65'
// carries two, while an operator inside a bound's own Python (a string, a
// bracket) never splits it. Answers null when a segment fails to read as an
// expression; the caller then treats the text as prose.
function chainOf(text, from) {
  const constraints = [];
  let opAt = from;
  let op = CONSTRAINT_OPS.find((o) => text.startsWith(o, opAt));
  let segStart = opAt + op.length;
  for (let j = segStart; j <= text.length; j++) {
    let next = null;
    const boundary = j === text.length;
    if (!boundary) {
      if (text[j - 1] !== " ") continue;
      next = CONSTRAINT_OPS.find((o) => text.startsWith(o, j));
      if (!next) continue;
    }
    const seg = text.slice(segStart, boundary ? text.length : j).trim();
    // Mid-text, a cut inside a string or a bracket is the middle of the
    // bound already being read, never a new one, so '==("a > b",)' keeps its
    // quoted operator.
    if (!seg || !readsAsExpression(seg) || (!boundary && !standsWhole(seg))) {
      if (boundary) return null; // every bound must read as an expression
      continue;                  // an operator inside the bound, not a new one
    }
    constraints.push({ op, formula: seg, eq: opAt });
    if (boundary) return constraints;
    opAt = j;
    op = next;
    segStart = j + op.length;
    j = segStart - 1; // resume the scan right after the new operator
  }
  return null;
}

// A value's kind: a date (ISO `YYYY-MM-DD`, optionally with a time) reads
// as a date, a `$`/comma/%-tolerant number reads as a number, anything
// else is text. Disjoint; comparisons use it to compare dates
// chronologically, crosslinks to match value kinds.
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
const isDateValue = (v) => { const s = String(v).trim(); return DATE_RE.test(s) && !isNaN(Date.parse(s)); };
const isNumberValue = (v) => !isNaN(numericValue(v));
function valueType(v) {
  if (isDateValue(v)) return "date";
  if (isNumberValue(v)) return "number";
  return "text";
}

const numericValue = (text) => parseFloat(String(text).replace(/[$,%\s]/g, ""));

// The longest case-insensitive name match at the head of `rest`, over
// [{ key, id }] candidates (keys lowercased). The character after the
// match must not continue a word, so `@price2` never half-matches `price`;
// names may hold spaces, so `@basket size+1` matches 'basket size' whole.
function longestMatch(rest, candidates) {
  const low = rest.toLowerCase();
  let best = null;
  for (const { key, id } of candidates) {
    if (!key || !low.startsWith(key)) continue;
    if (rest.length > key.length && /[a-z0-9_]/i.test(rest[key.length])) continue;
    if (!best || key.length > best.length) best = { id, length: key.length };
  }
  return best;
}

// Render a computed result: a number is written with thousands separators
// and two decimals at most (`1,215.6`, `184,540`), keeping a leading $ the
// old value carried; a string is written as it is, with any '|' bent to a
// broken bar (a pipe cannot live inside a pipe table). Every computed number
// reads the same way, so a column of them lines up by
// eye; a value somebody typed is never passed through here, so a typed year
// or ID keeps the digits it was written with.
function formatValue(v, old) {
  if (typeof v === "string") return v.replace(/\|/g, "¦");
  if (!isFinite(v)) throw new Error("the result is not a number");
  const rounded = Math.round(v * 100) / 100;
  const s = (Object.is(rounded, -0) ? 0 : rounded).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (String(old || "").trim().startsWith("$") ? "$" : "") + s;
}

// The data rows of a table block: everything under the header.
// The extent of the row at `i`: itself and every row below it that sits
// deeper — its sub-Examples, and theirs. A separator ends the run, as does
// any row back at its own depth or shallower. Returns the count, so a row
// with no children is 1.
//
// Every operation that moves a row moves this instead: a parent that left
// its children behind would re-file them under whatever row it left them
// beside, which is not an edit anyone asked for.
function subtreeOf(block, i) {
  const start = block.rows[i];
  if (!start || start.sep) return 1;
  const depth = start.depth || 0;
  let n = 1;
  while (i + n < block.rows.length) {
    const r = block.rows[i + n];
    if (r.sep || (r.depth || 0) <= depth) break;
    n++;
  }
  return n;
}

// The row the one at `i` follows in its own generation — the nearest row
// above it at the same depth, without crossing a shallower row or a
// separator; -1 when it is the first of its siblings.
function prevSibling(block, i) {
  const depth = block.rows[i].depth || 0;
  for (let j = i - 1; j > 0; j--) {
    const r = block.rows[j];
    if (r.sep) return -1;
    const d = r.depth || 0;
    if (d < depth) return -1;
    if (d === depth) return j;
  }
  return -1;
}

function dataRowsOf(block) {
  return block.rows.filter((r) => !r.sep).slice(1);
}

// The name→column candidates a header offers, for longest-match reference
// resolution: each column's cleaned name and its `(alias)` both point at the
// column (1-based). A trailing constraint (`qty >=1`) is not part of the name.
// The first cell names the Concept the table describes, not an attribute
// (1.9), so it offers no column candidate — `@Person` inside Person's own
// grid is not a reference to its name column.
function headerNameCands(header) {
  const cands = [];
  (header || []).forEach((cell, k) => {
    if (k === 0) return;
    let name = splitConstraint(cell).value, alias = null;
    if (name.endsWith(")") && name.includes("(")) {
      const open = name.lastIndexOf("(");
      alias = name.slice(open + 1, -1).trim() || null;
      name = name.slice(0, open).trim();
    }
    if (name) cands.push({ key: name.toLowerCase(), id: k + 1 });
    if (alias) cands.push({ key: alias.toLowerCase(), id: k + 1 });
  });
  return cands;
}

// The reference names a grid offers for completion, from raw cell arrays:
// the header's column names (constraint/alias stripped, the name column
// aside) and each data row's Example name. Columns come first, the
// best-practice reference being @column.
function referenceNamesFrom(header, rows) {
  const columns = [];
  (header || []).slice(1).forEach((cell) => {
    const name = columnTerm(cell);
    if (name) columns.push(name);
  });
  const rowNames = rows.map((cells) => splitCell(cells[0] || "").value).filter((n) => n);
  return { columns, rows: rowNames };
}

// The @-reference names a table block offers, for completion. Returns
// { columns: [name], rows: [name] } — columns first.
function referenceNames(block) {
  const head = headerIndex(block);
  const header = head === -1 ? [] : block.rows[head].cells;
  return referenceNamesFrom(header, dataRowsOf(block).map((r) => r.cells));
}

// Merge per-file scope maps (derive.js's conceptRegistry — the one scope
// kind, built over the parsed tree, whether a Concept's Examples are rows
// in a grid or '- ' lines) into the registry the evaluator reads: later
// maps win a shared name (so the current file's own scopes shadow the
// repo's), and the name candidates are precomputed once. Pass the result
// as the trailing `registry` argument to the calls that resolve references.
function mergeRegistries(...maps) {
  const scopes = new Map();
  for (const m of maps) if (m) for (const [k, v] of m) scopes.set(k, v);
  return { scopes, cands: [...scopes.keys()].map((k) => ({ key: k, id: k })) };
}

// The table's evaluation context: header cells (and their aliases) resolve
// @name references, first-column values resolve @Row references, and every
// reference reads the raw value part of its cell. A header's trailing
// constraint (`qty >=1`) is not part of the column's name.
//
// `outer` (optional) is the scope of the line the table is filed under —
// the Concept (or Example) whose line-form attributes ride along with the
// grid, so tables and free text work as one: a cell's derivation may
// reference the parent's own `tax rate: 0.2` by name, an empty cell
// inherits the parent's default, a column also ranges over the parent's
// line-form Examples, and a line-form sibling Example can be named in a
// cell's reference.
// The grid always wins a shared name (the local reading first, as ever).
function tableCtx(rows, row, header, registry, outer) {
  const names = headerNameCands(header);
  const rowNames = rows.map((r) => ({ key: splitCell(r.cells[0] || "").value.toLowerCase(), id: r }));
  const numCols = Math.max(header ? header.length : 0, ...rows.map((r) => r.cells.length));
  const raw = (r, c) => {
    if (c < 1 || c > numCols) throw new Error(`there is no column @${c}`);
    return readValue(splitCell(r.cells[c - 1] || "").value);
  };
  const gridName = (r) => splitCell((r.cells && r.cells[0]) || "").value;
  // the outer key of a grid column (else a key passed through), null when
  // the parent does not know the name
  const outerCol = (c) => {
    if (typeof c === "string") return c;
    if (!outer) return null;
    let name = splitConstraint((header || [])[c - 1] || "").value;
    if (name.endsWith(")") && name.includes("(")) name = name.slice(0, name.lastIndexOf("(")).trim();
    const m = name ? outer.matchColumn(name) : null;
    return m && m.length === name.length ? m.id : null;
  };
  // the parent's row index of an Example name, exact matches only
  const outerRowOf = (name) => {
    const m = outer && name ? outer.matchRow(name) : null;
    return m && m.length === name.length ? m.id : null;
  };
  // read through the parent: the Example's own value, else the parent's
  // stated default, else empty
  const throughOuter = (key, exampleName) => {
    const at = outerRowOf(exampleName);
    if (at !== null) return outer.cellAt(key, at);
    const own = outer.self ? outer.self(key) : undefined;
    return own === undefined ? "" : own;
  };
  // a grid cell, an empty one inheriting the parent's default (exactly what
  // an Example silent on an attribute means in the line form)
  const read = (r, c) => {
    const v = raw(r, c);
    if (String(v).trim() !== "" || !outer) return v;
    const key = outerCol(c);
    const own = key !== null && outer.self ? outer.self(key) : undefined;
    return own === undefined ? v : own;
  };
  return {
    matchColumn: (rest) => longestMatch(rest, names) || (outer ? outer.matchColumn(rest) : null),
    matchRow: (rest) => {
      const local = longestMatch(rest, rowNames);
      if (local || !outer) return local;
      const m = outer.matchRow(rest);
      return m ? { id: { outerRow: m.id }, length: m.length } : null;
    },
    cell: (c) => (typeof c === "number" ? read(row, c) : throughOuter(c, gridName(row))),
    cellAt: (c, r) => {
      const gridRow = Boolean(r && r.cells !== undefined);
      if (typeof c === "number" && gridRow) return read(r, c);
      const key = outerCol(c);
      if (key === null) throw new Error("unknown column or Example after '@'");
      return gridRow ? throughOuter(key, gridName(r)) : outer.cellAt(key, r.outerRow);
    },
    column: (c) => {
      const grid = typeof c === "number" ? rows.filter((r) => r !== row).map((r) => read(r, c)) : null;
      const key = outer ? outerCol(c) : null;
      if (key === null) {
        if (grid) return grid;
        throw new Error("unknown column or Example after '@'");
      }
      if (!grid) {
        // an outer-only name: the parent's other Examples carry it
        const mine = outerRowOf(gridName(row));
        return (outer.rows || []).map((_, k) => k).filter((k) => k !== mine)
          .map((k) => outer.cellAt(key, k));
      }
      // the parent's line-form Examples ride along with the grid's rows
      const held = new Set(rows.map((r) => gridName(r).toLowerCase()));
      const extras = (outer.rows || [])
        .map((name, k) => ({ name: String(name).toLowerCase(), k }))
        .filter((e) => !held.has(e.name))
        .map((e) => outer.cellAt(key, e.k));
      return [...grid, ...extras];
    },
    // Every row's value in row order, this row included — what a lookup
    // ranges over, where column() answers the other rows the aggregates
    // mean. The parent's line-form Examples ride along exactly as they do
    // there, and a column the parent does not know contributes an empty
    // value for them rather than dropping out, so any two columns of the
    // one table line up row for row.
    columnAll: (c) => {
      const numbered = typeof c === "number";
      const grid = rows.map((r) => (numbered ? read(r, c) : throughOuter(c, gridName(r))));
      if (!outer) return grid;
      const key = numbered ? outerCol(c) : c;
      const held = new Set(rows.map((r) => gridName(r).toLowerCase()));
      const extras = (outer.rows || [])
        .map((name, k) => ({ name: String(name).toLowerCase(), k }))
        .filter((e) => !held.has(e.name))
        .map((e) => (key === null ? "" : outer.cellAt(key, e.k)));
      return [...grid, ...extras];
    },
    matchTable: registry ? (rest) => longestMatch(rest, registry.cands) : undefined,
    table: registry ? (id) => registry.scopes.get(id) : undefined,
  };
}

// The Concept a table block itself names: its header's first cell, minus
// its (alias) — "" when the block has no header or the cell is empty. This is the name the table declares (or fills in) since 1.9.
function ownName(block) {
  const head = headerIndex(block);
  if (head === -1) return "";
  return cleanName(block.rows[head].cells[0] || "");
}

// The registry scope of the Concept the table describes: the one its first
// header cell names — the same node whether the table declared it or fills
// in a same-named line above (the merge form), so line-form defaults and
// '- ' Examples ride along either way. When the first cell resolves to
// nothing (an old-format 'name' label, a header still being typed), the
// nearest shallower non-blank line answers as it always did — the root
// name at top level. This is the `outer` scope tableCtx reads the
// Concept's line-form attributes and defaults through.
function enclosingScope(lines, block, registry, rootName) {
  if (!registry) return undefined;
  const own = ownName(block);
  if (own) {
    const scope = registry.scopes.get(numberless(own).toLowerCase())
      || registry.scopes.get(own.toLowerCase());
    if (scope) return scope;
  }
  let name = rootName;
  for (let j = block.start - 1; j >= 0; j--) {
    if (!lines[j].trim()) continue;
    if (lines[j].match(/^ */)[0].length < block.indent.length) {
      name = cleanName(lines[j].trim());
      break;
    }
  }
  return name ? registry.scopes.get(String(name).toLowerCase()) : undefined;
}

// --- the CSV mirror ---------------------------------------------------------
// Every table is mirrored to a CSV file named after its parent Concept and
// kept in sync both ways. The functions here are the pure halves: find the
// tables in a text, serialise a grid to CSV and back, and work out the
// exact line edit that folds a CSV grid back into its .aot table.

// The name a table is filed under: its parent line's term, stripped of an
// Example marker, a derivation (`Sales =by_month(@raw)` files as `Sales`),
// an inline value and a parenthetical alias.
const cleanName = (t) => {
  const d = lineDerivation(String(t).trim());
  const term = d ? d.head : t;
  return term.replace(/^[-|]\s+/, "").split(":")[0].replace(/\([^)]*\)\s*$/, "").trim();
};

// Every complete table in the text (header + separator + rows): its parent
// name — the nearest shallower line, or the root name — with its grid and
// location. Assumed lone headers are skipped: they are still being typed.
function tablesOf(lines, rootName) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const block = blockAt(lines, i);
    if (!block) continue;
    i = block.end;
    if (headerIndex(block) === -1 || !dataRowsOf(block).length) continue;
    // the table names the Concept it describes in its first header cell
    // (1.9); an older table (a 'name' label, or a cell that reads as no
    // Concept) still takes its name from the nearest shallower line.
    let name, nameLine;
    const own = cleanName(block.rows[0].cells[0] || "");
    if (own && /^[A-Z]/.test(own)) {
      name = own;
      nameLine = block.start + 1;
    } else {
      name = rootName; nameLine = null;
      for (let j = block.start - 1; j >= 0; j--) {
        if (!lines[j].trim()) continue;
        if (lines[j].match(/^ */)[0].length < block.indent.length) {
          name = cleanName(lines[j].trim());
          nameLine = j + 1;
          break;
        }
      }
    }
    if (!name) continue;
    // each row is pinned to its own line
    const physIdx = new Map(block.rows.map((r, idx) => [r, idx]));
    const head = headerIndex(block);
    const header = block.rows[head].cells;
    // each data row with its 1-based line and its depth in the table's tree
    const rows = [], rowLines = [], rowDepths = [];
    block.rows.forEach((r, j) => {
      if (j <= head || r.sep) return;
      rows.push(header.map((_, k) => r.cells[k] || ""));
      rowLines.push(block.start + physIdx.get(r) + 1);
      rowDepths.push(r.depth || 0);
    });
    out.push({ name, nameLine, start: block.start, end: block.end, indent: block.indent, header, rows, rowLines, rowDepths });
  }
  return out;
}

// A grid as RFC 4180 CSV: cells holding a comma, quote or newline are
// quoted, quotes doubled; rows end in '\n'.
function toCsv(grid) {
  const cell = (c) => (/[",\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c);
  return grid.map((row) => row.map(cell).join(",")).join("\n") + "\n";
}

// The character separating the cells of a CSV. The mirror always writes
// commas, but Excel writes the list separator of its locale, which is a
// semicolon wherever the comma is the decimal mark — a file the mirror can
// still be handed back. The test is deliberately narrow, so a comma file
// whose cells merely hold semicolons is never misread: only a first line
// with no comma at all and at least one semicolon is semicolon-delimited.
function delimiterOf(text) {
  const first = String(text).split(/\r?\n/, 1)[0] || "";
  return !first.includes(",") && first.includes(";") ? ";" : ",";
}

// CSV text back to a grid. Quoted cells may hold commas, doubled quotes
// and newlines; unquoted cells are trimmed. A pipe cannot survive inside a
// pipe table, so it is bent to a broken bar. A leading byte-order mark is
// dropped: Excel's 'CSV UTF-8' writes one, and it would otherwise ride into
// the header's first cell — the very cell that names the Concept.
function fromCsv(text) {
  text = String(text).replace(/^\uFEFF/, "");
  const sep = delimiterOf(text);
  const grid = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else if (ch !== undefined) cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") { quoted = true; cell = ""; continue; }
    if (ch === sep) { row.push(cell.trim()); cell = ""; continue; }
    if (ch === "\n" || ch === "\r" || ch === undefined) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (cell !== "" || row.length) { row.push(cell.trim()); grid.push(row); }
      row = []; cell = "";
      continue;
    }
    cell += ch;
  }
  return grid.map((r) => r.map((c) => c.replace(/\|/g, "¦")));
}

// The line edit that folds a CSV grid back into its table: replace the
// Concept's existing table block, or insert one directly beneath the
// Concept when it has none yet. Returns { changed, from, to, block } —
// lines from..to (inclusive) become the block; to < from is a pure insert
// before `from`. null when no line defines the named Concept.
function updateTable(lines, name, header, rows, rootName, registry) {
  const low = name.toLowerCase();
  let from, to, indent;
  // 1) a table the Concept names in its own first header cell (1.9) —
  //    standalone, or merged beneath a same-named line, and including an
  //    assumed lone header still being typed (no separator yet), which this
  //    completes. Its block is replaced where it stands.
  let selfBlock = null;
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] || "").trim();
    if (!isRowText(t) || isSeparator(t)) continue;
    const b = blockAt(lines, i);
    i = b.end;
    if (headerIndex(b) === -1) continue;
    const cell0 = cleanName(b.rows[headerIndex(b)].cells[0] || "");
    if (cell0 && cell0.toLowerCase() === low) { selfBlock = b; break; }
  }
  if (selfBlock) {
    from = selfBlock.start;
    to = selfBlock.end;
    indent = selfBlock.indent;
  } else {
    // 2) the Concept's own line and the table beneath it (an older grid, or
    //    a line-form Concept gaining its first grid — inserted under its
    //    line as a merge-form table that repeats the Concept's name).
    let conceptLine = -1, conceptIndent = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || isRowText(t)) continue;
      if (cleanName(t).toLowerCase() === low) {
        conceptLine = i;
        conceptIndent = lines[i].match(/^ */)[0].length;
        break;
      }
    }
    if (conceptLine === -1 && name !== rootName) return null;
    indent = " ".repeat(conceptLine === -1 ? 0 : conceptIndent + 4);
    from = conceptLine + 1;
    to = from - 1;
    for (let i = conceptLine + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      const ind = lines[i].match(/^ */)[0].length;
      if (conceptLine !== -1 && ind <= conceptIndent) break;
      if (isRowText(t) && ind === indent.length) {
        const found = blockAt(lines, i);
        from = found.start;
        to = found.end;
        break;
      }
    }
  }
  const tableBlock = {
    indent,
    rows: [
      { sep: false, cells: header },
      ...rows.map((cells) => ({ sep: false, cells })),
    ],
  };
  const block = render(tableBlock);
  const changed = lines.slice(from, to + 1).join("\n") !== block.join("\n");
  return { changed, from, to, block };
}

// Re-align every table in the text so the pipes line up. A table is an
// unbroken run of rows containing a separator row; a rule with no rows
// around it is not one, and is left exactly as written.
// Returns the changed lines as { line, text } with 1-based line numbers.
function align(text, registry, rootName) {
  const lines = text.split(/\r?\n/);
  const edits = [];
  for (let i = 0; i < lines.length; i++) {
    const block = blockAt(lines, i);
    if (!block) continue;
    i = block.end; // one visit per block
    // a rule with no rows around it is not a table to draw
    if (headerIndex(block) === -1) continue; // a leftover rule alone is no table
    const extent = block.end - block.start + 1;
    const drawn = render(block);
    if (drawn.length !== extent) {
      // wrapping changed the block's line count: one whole-block edit
      // ({ line, to } inclusive, text the block's lines joined with '\n')
      edits.push({ line: block.start + 1, to: block.start + extent, text: drawn.join("\n") });
      continue;
    }
    drawn.forEach((aligned, k) => {
      if (aligned !== lines[block.start + k]) edits.push({ line: block.start + k + 1, text: aligned });
    });
  }
  return edits;
}

module.exports = {
  cells, dividers, isSeparator, isRowText, align, blockAt, widthsOf, render, cellStart, colAt, padRows, dataRow,
  nextCell, prevCell, nextRow, moveColumn, moveRow, insertColumn, deleteColumn,
  insertRow, deleteRow, sortRows, fromRegion, copyFormulaDown, copyFormulaAcross, columnDefinition, defineColumn,
  subtreeOf, prevSibling, demoteRow, promoteRow,
  copyCell, moveCell, copyRow, copyColumn,
  jumpCell, cornerCell, fill, fillDown, fillRight, copyFormulaFromAbove, copyValueFromAbove,
  columnTerm,
  padCell, headerIndex,
  cleanName, tablesOf, toCsv, fromCsv, updateTable,
  splitCell, splitConstraint, formatValue,
  longestMatch, numericValue, tableCtx,
  readValue,
  valueType, isDateValue, referenceNames, referenceNamesFrom, dataRowsOf,
  mergeRegistries, enclosingScope,
  numberless, lineDerivation,
};
