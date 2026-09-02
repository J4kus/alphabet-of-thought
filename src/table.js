// Org-style plain-text tables: the '|' row grammar, shared by the linter
// (which reads a table as Examples x attributes) and the VS Code extension's
// formatter (which re-aligns the columns as org-mode's TAB does).
//
//     name  |size|colour     <- header: each cell names an attribute
//     ------+----+------     <- separator: marks the row above as header
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
// A data row's first cell is the Example's name; an empty cell leaves that
// attribute unasserted. With no border to hold it open, an empty NAME cell
// is written by the divider that closes it standing first on the line —
// '|frag' — which is what a continuation row (and a row still being filled)
// looks like. Every row therefore has at least one pipe, and one pipe is
// all it takes to be a row.
//
// A row may nest under the row above it. The depth is written as leading
// spaces in front of the name — which, the border being gone, is the line's
// own indent, four spaces to the level, exactly as the rest of the language
// writes depth:
//
//     Otter     |size
//     ----------+----
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

// A separator row is dashes, pluses, colons, pipes and spaces with at least
// two characters and at least one dash: '---+---', '--', '--- | ---' all
// count. Two characters is the floor because a lone '-' is an Example whose
// name is still being typed, and the rule must not steal it.
const isSeparator = (text) => /^[\s\-+:|]*$/.test(text) && text.includes("-") && text.trim().length > 1;

// A line is a table row when it carries a '|': the divider between two
// cells is the only pipe a row has left, so one is all it takes. A
// separator rule counts too — it divides its columns with '+' and may
// carry no pipe at all.
const isRowText = (text) => {
  const t = String(text).trim();
  return !!t && (t.includes("|") || isSeparator(t));
};

// --- column alignment --------------------------------------------------------
// A separator cell may carry markdown's alignment colons, and the column is
// drawn that way:
//
//     |default|left align|right align|center align|
//     |-------+:---------+----------:+:----------:|
//     |1      |1         |          1|     1      |
//
// The colon is presentation, exactly as the width cookie and the numbering
// prefix are: every reader of a table trims its cells, so no crosslink,
// formula, CSV row or Gödel number can tell an aligned column from a plain
// one. It is written where the shape of the table is already written — the
// separator — rather than on the header, which names the attribute.
const ALIGNMENTS = ["left", "right", "center"];

// The alignment each separator cell declares: ':---' left, '---:' right,
// ':--:' centre, a plain rule none. A lone ':' reads as left, since it opens
// with one and never closes.
function alignmentsFrom(line) {
  // a rule divides its columns with '+' when this renderer drew it and with
  // '|' when a hand (or a markdown table) typed it — both are the same rule
  return cells(String(line).replace(/\+/g, "|")).map(({ text }) => {
    const opens = text.startsWith(":");
    const closes = text.length > 1 && text.endsWith(":");
    return opens && closes ? "center" : opens ? "left" : closes ? "right" : null;
  });
}

// The block's alignments: the first separator row that declares any. A table
// with several rules is one table, so the first one speaks for it.
function alignmentsOf(block) {
  for (const row of block.rows) {
    if (row.sep && row.align && row.align.some(Boolean)) return row.align;
  }
  return [];
}

// The narrowest a column can be drawn and still show its marker: ':-:' needs
// three characters, ':-' and '-:' two. Without this a one-character column
// would draw a rule wider than its cells and the grid would shear.
const alignMin = (how) => (how === "center" ? 3 : how ? 2 : 0);

// A cell padded to its column's width, on the side its alignment asks for.
// An over-long cell is never truncated — the column widens instead.
function padCell(text, width, how) {
  const gap = width - text.length;
  if (gap <= 0) return text;
  if (how === "right") return " ".repeat(gap) + text;
  if (how === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + text + " ".repeat(gap - left);
  }
  return text + " ".repeat(gap);
}

// One separator cell, drawn to the column's width with its marker kept.
function sepCell(width, how) {
  if (how === "center") return ":" + "-".repeat(Math.max(1, width - 2)) + ":";
  if (how === "left") return ":" + "-".repeat(Math.max(1, width - 1));
  if (how === "right") return "-".repeat(Math.max(1, width - 1)) + ":";
  return "-".repeat(width);
}

// Run fn over every separator row's alignment list, each first grown to the
// table's column count so a column operation can splice it beside the cells.
function eachSepAlign(block, columns, fn) {
  for (const row of block.rows) {
    if (!row.sep) continue;
    row.align = row.align || [];
    while (row.align.length < columns) row.align.push(null);
    fn(row.align);
  }
}

// Split a row into its cells with their column offsets in the line. The
// pipe divides, so the line opens the first cell and ends the last: the
// content between two consecutive pipes is one cell, a LEADING pipe opens
// on an empty name cell, and a TRAILING one leaves an empty cell after it
// (which asserts nothing, exactly as any other empty cell does).
//
// `indent` is the cell's own leading spaces. On the name cell that is where
// a row's depth is written; everywhere else it is only padding. A cell with
// nothing in it indents nothing — an all-spaces cell is empty, not deep,
// which is what keeps a continuation row (an empty name cell) at the depth
// of the row it continues.
function cells(line) {
  const text0 = String(line);
  if (!text0.trim()) return [];
  const out = [];
  let start = 0;
  for (let i = 0; i <= text0.length; i++) {
    if (i === text0.length || text0[i] === "|") {
      const seg = text0.slice(start, i);
      const text = seg.trim();
      const indent = seg.length - seg.trimStart().length;
      out.push({ text, col: start + indent, indent: text ? indent : 0 });
      start = i + 1;
    }
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
    // a dash typed anywhere in an otherwise empty row is only pipes, spaces
    // and dashes, so isSeparator already reads it as a separator being
    // typed — org's '|-' creation flow: the next redraw completes the rule
    const sep = isSeparator(lines[i].trim());
    // a separator carries no cells, but it does carry the columns' alignment
    if (sep) {
      rows.push({ sep, cells: [], align: unborder(alignmentsFrom(lines[i])) });
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

// --- column width cookies and cell wrapping ---------------------------------
// A header cell may end in an org-style width cookie: `|description <24>|`
// caps that column at 24 characters, and longer plain cells wrap onto
// continuation rows — data rows whose first (name) cell is empty, each
// fragment a cell of its own — so the table stays narrow. Continuation
// rows are recognised ONLY when the header carries at least one cookie:
// the cookie is the per-table opt-in, so cookie-less files keep their
// meaning exactly (an empty name cell there stays the error it always
// was). Never wrapped: the name column (it is the Example's identity),
// header cells, and formula cells (the formula owns its text) — such a
// cell may exceed its cookie, and the column then pads to it. A wrapped
// value reads back as its fragments joined with single spaces.

const WIDTH_COOKIE = /\s*<(\d+)>\s*$/;

// A cell's text with its width cookie stripped: { text, width } — width
// null when the cell carries none. The cookie comes off before constraints
// and (alias) are read: it is layout, never part of the name.
function widthCookie(cell) {
  const m = WIDTH_COOKIE.exec(cell || "");
  return m
    ? { text: cell.slice(0, m.index).trim(), width: Math.max(1, +m[1]) }
    : { text: cell || "", width: null };
}

// The per-column cookies of a block's header row, or null when the block
// has no header or no cookie at all (it then behaves as it always did).
function headerWidths(block) {
  if (block.rows.length < 2 || block.rows[0].sep || !block.rows[1].sep) return null;
  const widths = block.rows[0].cells.map((c) => widthCookie(c).width);
  return widths.some((w) => w !== null) ? widths : null;
}

// Is block.rows[i] a continuation row — a data row continuing the one
// above? Only in a cookie-carrying block, below the separator, with an
// empty first cell, something in a later cell, and a data row above.
function isContinuation(block, i) {
  if (!headerWidths(block)) return false;
  const r = block.rows[i];
  if (!r || r.sep || i < 3) return false;
  if ((r.cells[0] || "") !== "" || !r.cells.some((c, k) => k > 0 && (c || "") !== "")) return false;
  for (let j = i - 1; j >= 2; j--) {
    if (block.rows[j].sep) return false;
    if ((block.rows[j].cells[0] || "") !== "") return true;
  }
  return false;
}

// Collapse the block's continuation rows into their logical rows, joining
// each column's fragments with a single space. Mutates block.rows and
// returns an array mapping each ORIGINAL row index to its logical row
// index — null when the block has no cookies (then nothing changes). The
// ops and the renderer both work on logical rows; render() wraps them out.
function unwrapWithMap(block) {
  if (!headerWidths(block)) return null;
  const map = [], out = [];
  for (let i = 0; i < block.rows.length; i++) {
    const r = block.rows[i];
    const prev = out[out.length - 1];
    const continues = !r.sep && out.length >= 3 && prev && !prev.sep
      && (r.cells[0] || "") === "" && r.cells.some((c, k) => k > 0 && (c || "") !== "");
    if (continues) {
      r.cells.forEach((c, k) => {
        if (k === 0 || !c) return;
        prev.cells[k] = ((prev.cells[k] || "") + " " + c).trim();
      });
      map.push(out.length - 1);
      continue;
    }
    map.push(out.length);
    out.push(r);
  }
  block.rows.length = 0;
  block.rows.push(...out);
  return map;
}
const unwrap = (block) => { unwrapWithMap(block); return block; };

// Break a cell's text into fragments no wider than `width`, at spaces
// where possible; a single word longer than the width is hard-split.
function wrapText(text, width) {
  const out = [];
  let rest = text.trim();
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut <= 0) cut = width;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

// Each column's width: its widest cell across the rows — a plain data cell
// in a cookie-capped column counting no more than its cookie (it wraps),
// while the header, the name column and formula cells count whole (they
// never wrap, so a long one widens the column past its cookie).
function widthsOf(block) {
  const caps = headerWidths(block);
  const widths = [];
  block.rows.forEach((row, i) => {
    if (row.sep) return;
    const isHeader = i === 0 && block.rows.length > 1 && block.rows[1].sep;
    row.cells.forEach((c, k) => {
      // the name column must hold the deepest row's indent as well as its name
      let w = k === 0 ? nameCell(row).length : c.length;
      const cap = caps && !isHeader && k > 0 ? caps[k] : null;
      if (cap !== null && cap !== undefined && w > cap && splitCell(c).eq === -1) w = cap;
      widths[k] = Math.max(widths[k] || 0, w);
    });
  });
  // a column that declares an alignment is never drawn narrower than its own
  // marker: ':-:' would otherwise overhang a one-character column and shear
  // the grid line by line
  // and never narrower than one character: a zero-width column could draw
  // no rule of its own and leave nowhere to put the cursor
  const aligns = alignmentsOf(block);
  for (let k = 0; k < widths.length; k++) {
    widths[k] = Math.max(widths[k], 1, alignMin(aligns[k]));
  }
  return widths.length ? widths : [0];
}

// Draw the block aligned: every column padded to its widest cell,
// separator rows redrawn to match. No gutter spaces around the pipes.
// With width cookies, continuation rows first collapse into their logical
// rows, then over-wide plain cells wrap back out at the final column
// widths; block.physStart maps each logical row to its first drawn line.
function render(block) {
  const caps = headerWidths(block);
  const aligns = alignmentsOf(block);
  const rule = (widths) => block.indent + widths.map((w, k) => sepCell(w, aligns[k])).join("+");
  // a nested name carries its depth in front of it, and its column is then
  // drawn left however it is marked — centring an indented name shears the
  // very tree the indent is there to show. The marker itself is left alone:
  // it is the writer's text, not ours to erase.
  const deep = nests(block);
  const drawn = (row, k) => (k === 0 ? nameCell(row) : row.cells[k] || "");
  const align = (k) => (k === 0 && deep ? "left" : aligns[k]);
  // The pipes divide, so a drawn row opens with its name and ends with its
  // last written cell: the padding past that is trailing whitespace, and no
  // line keeps that. A row with nothing in its name cell is padded to the
  // column like any other, so it opens with spaces — those are the empty
  // cell, never an indent, and every reader of a row knows it.
  const drawRow = (parts) => (block.indent + parts.join("|")).replace(/\s+$/, "");
  if (!caps) {
    const widths = widthsOf(block);
    return block.rows.map((row) => row.sep
      ? rule(widths)
      : drawRow(widths.map((w, k) => padCell(drawn(row, k), w, align(k)))));
  }
  unwrap(block);
  const widths = widthsOf(block);
  const out = [];
  const physStart = [];
  block.rows.forEach((row, i) => {
    physStart[i] = out.length;
    if (row.sep) {
      out.push(rule(widths));
      return;
    }
    const isHeader = i === 0 && block.rows[1] && block.rows[1].sep;
    const frags = widths.map((w, k) => {
      const cell = drawn(row, k);
      if (isHeader || k === 0 || cell.length <= w || splitCell(cell).eq !== -1) return [cell];
      return wrapText(cell, w);
    });
    const tall = Math.max(1, ...frags.map((f) => f.length));
    for (let d = 0; d < tall; d++) {
      out.push(drawRow(widths.map((w, k) => padCell(frags[k][d] || "", w, align(k)))));
    }
  });
  block.physStart = physStart;
  return out;
}

// Where a cell's text begins on an aligned line, so a command can land the
// cursor at the start of a field, as org does.
function cellStart(block, col, rowIdx) {
  const widths = widthsOf(block);
  let x = block.indent.length;
  for (let k = 0; k < Math.min(col, widths.length); k++) x += widths[k] + 1;
  // a right- or centre-aligned cell carries its padding in front of the
  // text, so without the row we would land the cursor in the gap and any
  // typing would go before the value rather than into it
  const aligns = alignmentsOf(block);
  const row = rowIdx === undefined ? null : block.rows[rowIdx];
  if (row && !row.sep && col < widths.length && aligns[col] && aligns[col] !== "left") {
    const gap = Math.max(0, widths[col] - (row.cells[col] || "").length);
    x += aligns[col] === "right" ? gap : Math.floor(gap / 2);
  }
  return x;
}

// The cell a character position falls in: the line opens the first field
// and each pipe closes one, so the count of pipes behind the cursor is the
// column it stands in.
function colAt(lineText, character) {
  let pipes = 0;
  for (let i = 0; i < Math.min(character, lineText.length); i++) {
    if (lineText[i] === "|") pipes++;
  }
  return pipes;
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
  // the alignment is the column's, so it travels with it
  eachSepAlign(block, numCols, (a) => { [a[col], a[other]] = [a[other], a[col]]; });
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
  const numCols = widthsOf(block).length;
  padRows(block);
  for (const r of block.rows) {
    if (!r.sep) r.cells.splice(Math.min(col, r.cells.length), 0, "");
  }
  eachSepAlign(block, numCols, (a) => a.splice(Math.min(col, a.length), 0, null));
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
  eachSepAlign(block, numCols, (a) => a.splice(col, 1));
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
  const key = (r) => readValue(splitCell((r.cells[col] || "").trim()).value);
  const num = (r) => parseFloat(key(r).replace(/[$,%\s]/g, ""));
  const run = block.rows.slice(a, b + 1);
  const numeric = run.every((r) => key(r) !== "" && !isNaN(num(r)));
  run.sort((x, y) => (numeric ? num(x) - num(y) : key(x).localeCompare(key(y))));
  block.rows.splice(a, run.length, ...run);
  return { row, col };
}

// Copy the cursor cell's derivation (formula or constraint) onto every
// other data row's cell in the same column, keeping each row's own value
// part; the caller's recompute then fills the '=' copies in.
function copyFormulaDown(block, row, col) {
  const r = block.rows[row];
  if (!r || r.sep) return null;
  const anchor = r.cells[col] || "";
  const { eq, op } = splitCell(anchor);
  if (eq === -1) return null;
  const formula = anchor.slice(eq + op.length).trim();
  const rows = dataRowsOf(block);
  if (!rows.includes(r)) return null;
  padRows(block);
  for (const other of rows) {
    if (other === r) continue;
    const { value } = splitCell(other.cells[col] || "");
    other.cells[col] = (value ? value + " " : "") + op + formula;
  }
  return { row, col };
}

// Copy the cursor cell's derivation onto every other cell in the same ROW,
// keeping each cell's own value part; the caller's recompute fills the
// '=' copies. The name column (0) is left alone — it names the Example.
function copyFormulaAcross(block, row, col) {
  const r = block.rows[row];
  if (!r || r.sep) return null;
  const anchor = r.cells[col] || "";
  const { eq, op } = splitCell(anchor);
  if (eq === -1) return null;
  const formula = anchor.slice(eq + op.length).trim();
  const n = widthsOf(block).length;
  padRows(block);
  for (let k = 1; k < n; k++) {
    if (k === col) continue;
    const { value } = splitCell(r.cells[k] || "");
    r.cells[k] = (value ? value + " " : "") + op + formula;
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

// Duplicate the cursor's whole column, to its left or its right — header,
// every value, and the separator's own width all follow. The new column
// carries the old one's attribute name, which the linter will report as a
// repeat until you rename it: that rename is the point of the copy.
function copyColumn(block, row, col, dir) {
  const numCols = widthsOf(block).length;
  if (col >= numCols) return null;
  padRows(block);
  const at = dir < 0 ? col : col + 1;
  for (const r of block.rows) {
    if (!r.sep) r.cells.splice(at, 0, r.cells[col] || "");
  }
  eachSepAlign(block, numCols, (a) => a.splice(at, 0, a[col] || null));
  return { row, col: at };
}

// Set (or clear, with null) the cursor column's alignment, writing the
// colons into every separator the table has. A table with no separator is
// not yet a table — its shape is still being typed — so there is nowhere to
// declare an alignment and nothing happens.
function alignColumn(block, row, col, how) {
  const numCols = widthsOf(block).length;
  if (col >= numCols || !block.rows.some((r) => r.sep)) return null;
  if (how !== null && !ALIGNMENTS.includes(how)) return null;
  eachSepAlign(block, numCols, (a) => { a[col] = how; });
  return { row, col };
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
    rows: [rows[0], { sep: true, cells: [] }, ...rows.slice(1)],
  };
  return render(block);
}

// --- formulas ----------------------------------------------------------------
// A cell may derive its value, org's spreadsheet folded into the cell
// itself: `10 =$1+10` keeps the value first and the formula visible after
// it. Every table command, the formatter and the CSV mirror recompute.
// An attribute may instead be *constrained* — `age >=18` on a bare
// attribute line or a table header cell — and every value the attribute
// takes is validated against the bound (derive.js); values themselves
// carry formulas only, never constraints.
//
//   @name                      the same row's column, by header name —
//                              references are name-only (positional @N was
//                              removed in 1.6)
//   @col@Example / @Example@col   the named Example's cell in that column —
//                              either order; a name that is both a column
//                              and an Example resolves as the longer match
//                              (a tie goes to the column)
//   sum avg min max count      over the table's other data rows: sum(@price),
//                              count(@price) — count tallies non-empty cells
//   xlookup(v,@key,@answer)    the answer column's cell on the first row
//                              whose key cell is v; a fourth argument says
//                              what to answer when nothing matches
//   sumifs(@add,@c,crit,…)     add up / tally the rows meeting every test:
//   countifs(@c,crit,…)        sumifs(@price,@country,`FR`). Unlike the
//                              aggregates these range over ALL the rows,
//                              this one included, as a spreadsheet range
//                              does — and every column must line up
//   a criterion                a plain value matches by equality; a string
//                              opening with a comparison operator compares
//                              (`>=10`, `<>paid`); an or() list matches any
//   round(x,n) abs(x) ln(x)    numeric helpers; ln() wants a positive number
//   upper lower trim len       string helpers; left(x,n) right(x,n)
//   left right mid replace     mid(x,i,n) is 1-based, replace(x,a,b) is all
//   if(cond,a,b)               lazy: only the taken branch is evaluated
//   & and `literals`           & concatenates; backticks quote a string
//   == <= >= < >               comparisons yield 1 or 0
//   + - * / ^ ( ) and plain numbers — '^' is power, right-associative
//
// $ signs, thousands commas and % in referenced values are ignored, so a
// money column reads as its number. Arithmetic coerces its operands to
// numbers (a non-numeric operand is an error); & coerces to strings; a
// comparison is numeric when both sides read as numbers, else string.
// (References used to be '$'; since 1.3 they are '@'.)

// A value may hold a literal '=' by escaping it: `note: a \= b` is the
// value 'a = b', not a derivation of 'a'. splitCell needs no rule for it —
// the character before an escaped '=' is the backslash, never a space, so
// the scan below already walks past it — which leaves exactly one step:
// take the backslash off when a value is read *as data* (the model, the
// evaluator, a sort key) and leave it on in the text, which is what every
// rewrite path copies verbatim. readValue is that step; call it wherever a
// value becomes meaning rather than characters.
const readValue = (text) => String(text).replace(/\\=/g, "=");

// Split a cell (or line-form value) into its value and its '=' formula:
// eq is the index of the '=' (the cell's start, or following a space), -1
// when the cell is a plain value. The scan is left-to-right and skips
// '==' so an operator inside a formula ('=if($2 == 3,1,0)') never splits
// the cell. The value comes back as written — escapes and all — because
// most callers put it straight back on the line; read it with readValue.
// Values carry formulas only — constraints live on the attribute
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
// bound is only believed when its right side reads as a formula, so a
// prose term such as 'speed > none noted' stays a plain name.
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

// Whether a segment could be a formula on its own: its brackets and its
// backticks close. Text cut off inside either is a fragment, whatever else
// it holds.
function standsWhole(text) {
  let depth = 0, quoted = false;
  for (const ch of text) {
    if (ch === "`") { quoted = !quoted; continue; }
    if (quoted) continue;
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0 && !quoted;
}

// The bounds chained from `from` (which indexes an operator) to the end of
// the text: each further space-preceded operator whose preceding segment
// stands as a formula of its own starts a new bound — so 'age >=18 <=65'
// carries two, while an operator inside a bound's own formula (a backtick
// string, an or() list) never splits it. Answers null when a segment fails
// to read as a formula; the caller then treats the text as prose.
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
    // An '@' vouches for a segment the dry run cannot evaluate — but only
    // where the segment stands whole. Mid-text, a cut inside a string or a
    // bracket is the middle of the bound already being read, never a new
    // one, so '==countifs(@note, `a > b`)' keeps its quoted operator.
    if (!seg || !(seg.includes("@") || triesAsFormula(seg)) || (!boundary && !standsWhole(seg))) {
      if (boundary) return null; // every bound must read as a formula
      continue;                  // an in-formula operator, not a new bound
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

// A dry run of the evaluator, used to tell a literal constraint formula
// ('>=18', '<=100*1.5') from prose. Reference-bearing formulas never get
// here — an '@' already vouches for them in splitConstraint.
const DRY_CTX = {
  matchColumn: () => null, matchRow: () => null,
  cell: () => "0", cellAt: () => "0", column: () => ["0"], columnAll: () => ["0"],
};
function triesAsFormula(src) {
  try { evalFormula(src.trim(), DRY_CTX); return true; } catch { return false; }
}

const numericValue = (text) => parseFloat(String(text).replace(/[$,%\s]/g, ""));

// The value `or()` answers with: its alternatives, kept together rather than
// collapsed to a truth on the spot. It then reads as whichever the place
// wants —
//
//   as a truth (a formula, an if() condition, arithmetic): true when any
//     alternative is true, which is exactly what logical OR means;
//   as a set (a constraint's bound, where `==` compares against it): the
//     value must equal one of the alternatives, which is what listing the
//     allowed values means — `status ==or(`draft`,`sent`,`paid`)`.
//
// One object read in the two places a value can be read, so `or` needs no
// second meaning and no context rule: `=if(or(@a,@b),…)` and the constraint
// above are the same function. and/not/xor have only the truth reading, so
// they answer 1 or 0 outright.
class Choice {
  constructor(values) { this.values = values; }
  toString() { return this.values.map((v) => (typeof v === "number" ? v : `\`${v}\``)).join(" or "); }
}

// Whether a value counts as true: a number is true when it is not zero; the
// truth words read as themselves; an empty value is false; any other text is
// true — a filled-in value is something. A Choice is true when any of its
// alternatives is.
function truthOf(v) {
  if (v instanceof Choice) return v.values.some(truthOf);
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (s === "") return false;
  if (s === "yes" || s === "true") return true;
  if (s === "no" || s === "false") return false;
  const n = numericValue(s);
  return isNaN(n) ? true : n !== 0;
}

// A bound as a constraint's message should show it: a Choice as its
// alternatives, a number bare, anything else quoted.
const describeBound = (v) =>
  v instanceof Choice ? String(v) : typeof v === "number" ? String(v) : `\`${v}\``;

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

// One comparison, shared by the in-formula operators and the constraint
// audit: two dates compare chronologically, two numbers numerically, else
// as strings (exact case).
function compareValues(op, a, b) {
  // against a Choice the comparison is 'or' distributed over its
  // alternatives — holding when it holds against any one of them. `==` is
  // then membership, which is what a constraint listing allowed values asks.
  if (b instanceof Choice) return b.values.some((v) => compareValues(op, a, v));
  let x, y;
  if (isDateValue(a) && isDateValue(b)) {
    x = Date.parse(String(a).trim()); y = Date.parse(String(b).trim());
  } else {
    const na = typeof a === "number" ? a : numericValue(a);
    const nb = typeof b === "number" ? b : numericValue(b);
    const both = !isNaN(na) && !isNaN(nb);
    x = both ? na : String(a); y = both ? nb : String(b);
  }
  if (op === "==") return x === y;
  if (op === "<=") return x <= y;
  if (op === ">=") return x >= y;
  if (op === "<") return x < y;
  return x > y;
}

// A criterion, the way a spreadsheet writes one: a plain value matches by
// equality, while a string opening with a comparison operator compares —
// `>=10`, `<>paid`, `<2026-01-01`. `<>` and `!=` both say 'not'. Answers
// the test a cell's value is put to. An or() list needs no rule of its
// own: compareValues already distributes over its alternatives, so
// `or(`sent`,`paid`)` matches either.
const CRITERION_OPS = [">=", "<=", "<>", "!=", "==", ">", "<", "="]; // longest first
function criterionTest(crit) {
  if (typeof crit === "string") {
    const op = CRITERION_OPS.find((o) => crit.startsWith(o));
    if (op) {
      const rhs = crit.slice(op.length).trim();
      const negated = op === "<>" || op === "!=";
      const cmp = negated || op === "=" ? "==" : op;
      return (v) => compareValues(cmp, v, rhs) !== negated;
    }
  }
  return (v) => compareValues("==", v, crit);
}

// Evaluate a formula against ctx (computeCell builds the table's ctx):
// matchColumn/matchRow resolve names, cell/cellAt/column return raw value
// strings. Values flow as numbers or strings; arithmetic coerces to
// numbers and throws on a non-numeric operand, & coerces to strings.
// Throws on bad syntax.
function evalFormula(src, ctx) {
  let i = 0;
  let dead = 0; // inside an untaken if() branch: parse fully, evaluate nothing
  const err = (m) => { throw new Error(m); };
  const ws = () => { while (src[i] === " ") i++; };
  const expect = (ch, m) => { ws(); if (src[i] !== ch) err(m || `missing '${ch}'`); i++; };
  const toNum = (v, what) => {
    if (typeof v === "number") return v;
    // a Choice asked for a number is being asked for its truth
    if (v instanceof Choice) return truthOf(v) ? 1 : 0;
    if (dead) return 0;
    const n = numericValue(v);
    if (isNaN(n)) err(`'${v}' is not numeric${what ? ` (${what})` : ""}`);
    return n;
  };
  const toStr = (v) => {
    if (typeof v === "number") return String(v);
    if (v instanceof Choice) return String(truthOf(v) ? 1 : 0);
    return v;
  };

  // one part after an '@', resolved by name against `scope` (the current
  // table, or a foreign one once a table has been named): the columns and
  // the Examples are both candidates, the longer match winning and a tie
  // going to the column. A digits-only lead can name an Example ('- 35');
  // it never numbers a column — references are name-only, in tables and
  // free text alike. Returns { col, row } with exactly one set.
  const refPart = (scope) => {
    const rest = src.slice(i);
    const colM = scope.matchColumn(rest);
    const rowM = scope.matchRow(rest);
    if (!colM && !rowM) {
      if (/^\d/.test(rest)) err("unknown column or Example after '@' — positional column numbers were removed (changed in 1.6), reference the column by its attribute name");
      err("unknown column or Example after '@'");
    }
    const asCol = colM && (!rowM || colM.length >= rowM.length);
    const m = asCol ? colM : rowM;
    i += m.length;
    return asCol ? { col: m.id, row: null } : { col: null, row: m.id };
  };
  // Try a reading from the cursor; on failure rewind and answer FAIL, so an
  // alternative reading can be tried in its place. The readings only look
  // values up, so an abandoned attempt leaves nothing behind but the cursor.
  const FAIL = Symbol("no reading");
  const attempt = (read) => {
    const save = i;
    try { return read(); } catch { i = save; return FAIL; }
  };
  // A foreign TABLE named at the cursor — written as the Concept/Example/
  // Attribute it sits under — followed by the '@' that names its column
  // (`@Order@…`). Answers its scope, cursor past that '@', or null with the
  // cursor untouched when no table is named here.
  const tableAt = () => {
    const rest = src.slice(i);
    const tm = ctx.matchTable && ctx.matchTable(rest);
    if (!tm || src[i + tm.length] !== "@") return null;
    const foreign = ctx.table(tm.id);
    if (!foreign) err(`the table '${rest.slice(0, tm.length)}' has no data`);
    i += tm.length + 1; // the table name and its '@'
    return foreign;
  };
  // The local reading of a cell reference, the '@' already consumed: @col
  // for this row's cell, or a column paired with an Example in either
  // order for that Example's cell.
  const localRef = () => {
    const a = refPart(ctx);
    if (src[i] === "@") {
      i++;
      const b = refPart(ctx);
      let col, row;
      if (a.col != null && b.row != null) { col = a.col; row = b.row; }
      else if (a.row != null && b.col != null) { col = b.col; row = a.row; }
      else err("@ pairs a column with an Example — one of each, in either order");
      return dead ? "" : ctx.cellAt(col, row);
    }
    if (a.col == null) err("@ names a column; pair a lone Example as @column@Example");
    return dead ? "" : ctx.cell(a.col);
  };
  // The foreign reading of a cell reference, the table's scope already read:
  // its column and Example follow, in either order — or, on a Concept, an
  // attribute alone, which reads the value the Concept states on its own
  // line (`@Measurement@alias`). A grid has no such value, so a table still
  // needs its Example named.
  const foreignRef = (scope) => {
    const b = refPart(scope);
    if (src[i] !== "@") {
      if (b.col != null && scope.self) {
        const own = scope.self(b.col);
        if (own !== undefined) return dead ? "" : own;
        err(`'${scope.name}' states no value of its own here — name one of its Examples too, like @${scope.name}@…@${scope.rows[0] || "Example"}`);
      }
      err("a foreign table cell needs both a column and an Example — write @Table@column@Example");
    }
    i++;
    const c = refPart(scope);
    let col, row;
    if (b.col != null && c.row != null) { col = b.col; row = c.row; }
    else if (b.row != null && c.col != null) { col = c.col; row = b.row; }
    else err("@Table pairs a column with an Example — one of each, in either order");
    return dead ? "" : scope.cellAt(col, row);
  };
  // a cell reference: this table's, or a foreign table's
  // @Table@column@Example. The local reading is tried first, so no formula
  // that resolved before changes meaning; the table gets its turn when the
  // local reading cannot be completed — an owner with its own `person`
  // attribute must not swallow the lead of `@Person@alias@Socrates` — and,
  // as ever, when the lead names nothing local at all.
  const ref = () => {
    i++; // the '@'
    const local = attempt(localRef);
    if (local !== FAIL) return local;
    const scope = tableAt();
    if (scope) return foreignRef(scope);
    if (ctx.matchTable && ctx.matchTable(src.slice(i)))
      err("a foreign table reference names a cell — write @Table@column@Example");
    return localRef(); // nothing foreign here: raise the local reading's error
  };
  // a bare column, for the aggregates: @name of this table, or a
  // foreign column @Table@column; never an @Example cell. Returns { scope,
  // col } so the aggregate ranges over the right table's column. Local first
  // and then the table, exactly as `ref` reads a cell.
  const localCol = (name) => {
    const part = refPart(ctx);
    if (part.col == null) err("expected a column here, like @price");
    // an aggregate ranges over a whole column, so an Example paired here
    // means the lead named a foreign table rather than this table's column
    if (src[i] === "@") err(`${name}() ranges over a column, not one row's cell`);
    return { scope: ctx, col: part.col };
  };
  const foreignCol = (scope) => {
    const b = refPart(scope);
    if (b.col == null) err("expected a column after the table, like @Order@price");
    return { scope, col: b.col };
  };
  const colRef = (name) => {
    i++; // the '@'
    const local = attempt(() => localCol(name));
    if (local !== FAIL) return local;
    const scope = tableAt();
    if (scope) return foreignCol(scope);
    return localCol(name); // raise the local reading's own error
  };

  const AGG = {
    sum: (a) => a.reduce((x, y) => x + y, 0),
    avg: (a) => a.reduce((x, y) => x + y, 0) / a.length,
    min: (a) => Math.min(...a),
    max: (a) => Math.max(...a),
  };

  // One column argument of a lookup — the same reading colRef gives an
  // aggregate, with the same refusal of a paired Example, since a column is
  // what these range over too.
  const columnArg = (name) => {
    ws();
    if (src[i] !== "@") err(`${name}() takes a column reference like @price`);
    const c = colRef(name);
    if (src[i] === "@") err(`${name}() ranges over a column, not one row's cell`);
    return c;
  };
  // The whole of a column — every row in order, this row included. The
  // aggregates deliberately range over the OTHER rows (org's reading: a
  // total sits in a row of its own), but a lookup asks a spreadsheet
  // question, where a range is every row and two columns line up row for
  // row. A scope written before columnAll existed still answers with its
  // aggregate reading rather than failing.
  const wholeColumn = ({ scope, col }) =>
    (scope.columnAll ? scope.columnAll(col) : scope.column(col));
  const aligned = (name, a, b) => {
    if (a.length !== b.length) {
      err(`${name}() ranges over columns of different lengths (${a.length} and ${b.length}) — its columns must be rows of the same table`);
    }
  };

  function call(name, skip) {
    i += skip; // the name and its '('
    if (name in AGG || name === "count") {
      ws();
      if (src[i] !== "@") err(`${name}() takes a column reference like @price`);
      const { scope, col } = colRef(name);
      if (src[i] === "@") err(`${name}() ranges over a column, not one row's cell`);
      expect(")");
      if (dead) return 0;
      const raw = scope.column(col);
      if (name === "count") return raw.filter((v) => String(v).trim() !== "").length;
      const values = raw.map((v) => numericValue(v)).filter((n) => !isNaN(n));
      if (!values.length) err(`column @${col} has no numeric values`);
      return AGG[name](values);
    }
    // xlookup(value, @key column, @answer column [, when there is no match]):
    // the answer column's cell on the FIRST row whose key cell equals the
    // value — a Concept looked up in another Concept's grid, which is what
    // a foreign key is. Without a fourth argument a miss is an error (the
    // cell shows #ERR), since a lookup that found nothing has no value to
    // stand in for; with one, that argument is the answer.
    if (name === "xlookup") {
      const wants = "xlookup() takes a value, the column to search and the column to answer from";
      const needle = cmp();
      expect(",", wants);
      const search = columnArg(name);
      expect(",", wants);
      const answer = columnArg(name);
      let fallback, hasFallback = false;
      ws();
      if (src[i] === ",") { i++; fallback = cmp(); hasFallback = true; }
      expect(")");
      if (dead) return 0;
      const keys = wholeColumn(search), values = wholeColumn(answer);
      aligned(name, keys, values);
      const at = keys.findIndex((v) => compareValues("==", v, needle));
      if (at !== -1) return values[at];
      if (hasFallback) return fallback;
      err(`xlookup() found no '${toStr(needle)}' in the column it searched — a fourth argument says what to answer when there is no match`);
    }
    // sumifs(@column to add, @column, criterion, …) and countifs(@column,
    // criterion, …): every row meeting EVERY test, added up or tallied.
    // Both range over the whole column, this row included — a conditional
    // total is about the data, not about the other rows — so a row may
    // total its own group: sumifs(@price, @country, @country).
    if (name === "sumifs" || name === "countifs") {
      const adds = name === "sumifs" ? columnArg(name) : null;
      if (adds) expect(",", "sumifs() takes the column to add, then a column and a criterion for each test");
      const tests = [];
      for (;;) {
        const col = columnArg(name);
        expect(",", `${name}() takes a criterion after each column, like ${name}(…, @status, \`paid\`)`);
        tests.push({ col, crit: cmp() });
        ws();
        if (src[i] !== ",") break;
        i++;
      }
      expect(")");
      if (dead) return 0;
      const columns = tests.map((t) => wholeColumn(t.col));
      const over = adds ? wholeColumn(adds) : columns[0];
      for (const c of columns) aligned(name, over, c);
      const holds = tests.map((t) => criterionTest(t.crit));
      let total = 0, tally = 0;
      for (let r = 0; r < over.length; r++) {
        if (!columns.every((c, k) => holds[k](c[r]))) continue;
        tally++;
        const v = numericValue(over[r]);
        if (!isNaN(v)) total += v;
      }
      return adds ? total : tally;
    }
    if (name === "if") {
      // lazy: the untaken branch is parsed (syntax still checked) with its
      // references and aggregates evaluating to placeholders, so
      // if(count($2)>0, avg($2), 0) works over an empty column
      const cond = toNum(cmp(), "if() condition") !== 0;
      expect(",", "if() takes three arguments: if(cond, then, else)");
      if (!cond) dead++;
      const then = cmp();
      if (!cond) dead--;
      expect(",", "if() takes three arguments: if(cond, then, else)");
      if (cond) dead++;
      const other = cmp();
      if (cond) dead--;
      expect(")");
      return cond ? then : other;
    }
    const arity = {
      round: [1, 2], abs: [1, 1], ln: [1, 1], upper: [1, 1], lower: [1, 1], trim: [1, 1],
      len: [1, 1], left: [2, 2], right: [2, 2], mid: [3, 3], replace: [3, 3],
      and: [2, Infinity], or: [2, Infinity], xor: [2, Infinity], not: [1, 1],
      concat: [1, Infinity], substitute: [3, 4], find: [2, 3], contains: [2, 2],
      starts: [2, 2], ends: [2, 2], proper: [1, 1], repeat: [2, 2], pad: [2, 3],
      split: [2, 3], text: [1, 1], value: [1, 1],
    }[name];
    const argv = [cmp()];
    ws();
    while (src[i] === ",") { i++; argv.push(cmp()); ws(); }
    expect(")");
    if (argv.length < arity[0] || argv.length > arity[1]) {
      const wants = arity[1] === Infinity ? `${arity[0]} or more`
        : arity[0] === arity[1] ? `${arity[0]}` : `${arity[0]} to ${arity[1]}`;
      err(`${name}() takes ${wants} argument(s), got ${argv.length}`);
    }
    if (dead) return 0;
    const n = (k) => Math.trunc(toNum(argv[k], `${name}() argument ${k + 1}`));
    const s = (k) => toStr(argv[k]);
    switch (name) {
      case "round": { const f = 10 ** (argv.length > 1 ? n(1) : 0); return Math.round(toNum(argv[0], "round()") * f) / f; }
      case "abs": return Math.abs(toNum(argv[0], "abs()"));
      case "ln": {
        const x = toNum(argv[0], "ln()");
        if (x <= 0) err(`ln() takes a positive number, got ${x}`);
        return Math.log(x);
      }
      case "upper": return s(0).toUpperCase();
      case "lower": return s(0).toLowerCase();
      case "trim": return s(0).trim();
      case "len": return s(0).length;
      case "left": return s(0).slice(0, Math.max(0, n(1)));
      case "right": { const k = Math.max(0, n(1)); return k ? s(0).slice(-k) : ""; }
      case "mid": { const at = Math.max(1, n(1)) - 1; return s(0).slice(at, at + Math.max(0, n(2))); }
      case "replace": { const from = s(1); return from ? s(0).split(from).join(s(2)) : s(0); }
      case "and": return argv.every(truthOf) ? 1 : 0;
      case "or": return new Choice(argv);
      case "xor": return argv.filter(truthOf).length % 2 === 1 ? 1 : 0;
      case "not": return truthOf(argv[0]) ? 0 : 1;
      // concat() is '&' with a name, for joining more than a pair readably
      case "concat": return argv.map(toStr).join("");
      // substitute() replaces one occurrence (the nth, 1-based) where
      // replace() replaces them all — the pair Excel splits the same way
      case "substitute": {
        const from = s(1);
        if (!from) return s(0);
        if (argv.length < 4) return s(0).split(from).join(s(2));
        const nth = n(3);
        let seen = 0, at = -1;
        for (let k = s(0).indexOf(from); k !== -1; k = s(0).indexOf(from, k + 1)) {
          if (++seen === nth) { at = k; break; }
        }
        return at === -1 ? s(0) : s(0).slice(0, at) + s(2) + s(0).slice(at + from.length);
      }
      // find() answers a 1-based position, 0 when absent — so it reads as a
      // truth too: if(find(@note,`urgent`), …) is 'when the note says urgent'
      case "find": {
        const from = argv.length > 2 ? Math.max(1, n(2)) - 1 : 0;
        return s(0).indexOf(s(1), from) + 1;
      }
      case "contains": return s(0).includes(s(1)) ? 1 : 0;
      case "starts": return s(0).startsWith(s(1)) ? 1 : 0;
      case "ends": return s(0).endsWith(s(1)) ? 1 : 0;
      case "proper": return s(0).replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      case "repeat": return s(0).repeat(Math.max(0, n(1)));
      // pad() to a width, on the right by default; a third argument pads left
      case "pad": {
        const width = Math.max(0, n(1));
        const side = argv.length > 2 ? s(2).trim().toLowerCase() : "right";
        if (s(0).length >= width) return s(0);
        const fill = " ".repeat(width - s(0).length);
        return side === "left" ? fill + s(0) : s(0) + fill;
      }
      // split() takes the nth field (1-based, default the first) — the way
      // to reach into a value that packs several, `Doe, Jane`
      case "split": {
        const parts = s(0).split(s(1));
        const k = argv.length > 2 ? n(2) : 1;
        return parts[(k < 0 ? parts.length + k : k - 1)] ?? "";
      }
      // text() and value() cross the number/text line on purpose, for the
      // times coercion should be said out loud rather than inferred
      case "text": return toStr(argv[0]);
      case "value": return toNum(argv[0], "value()");
    }
  }

  function factor() {
    ws();
    if (src[i] === "-") { i++; return -toNum(factor(), "after unary '-'"); }
    if (src[i] === "(") { i++; const v = cmp(); expect(")"); return v; }
    if (src[i] === "@") return ref();
    if (src[i] === "$") err("references use '@', not '$' — write @price (changed in 1.3)");
    if (src[i] === "`") {
      const close = src.indexOf("`", i + 1);
      if (close === -1) err("unclosed '`' string");
      const v = src.slice(i + 1, close);
      i = close + 1;
      return v;
    }
    const fn = /^(xlookup|sumifs|countifs|sum|avg|min|max|count|round|abs|ln|upper|lower|trim|len|left|right|mid|replace|if|and|or|xor|not|concat|substitute|find|contains|starts|ends|proper|repeat|pad|split|text|value)\s*\(/i.exec(src.slice(i));
    if (fn) return call(fn[1].toLowerCase(), fn[0].length);
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { i += num[0].length; return +num[0]; }
    err(i >= src.length ? "the formula ends too soon" : `unexpected '${src[i]}'`);
  }
  // '^' binds tighter than '*' and associates to the right, as in maths:
  // 2^3^2 is 2^(3^2) = 512. Unary minus lives in factor, so -2^2 is (-2)^2.
  function power() {
    const v = factor();
    ws();
    if (src[i] !== "^") return v;
    i++;
    return toNum(v, "left of '^'") ** toNum(power(), "right of '^'");
  }
  function term() {
    let v = power();
    for (;;) {
      ws();
      if (src[i] === "*") { i++; v = toNum(v, "left of '*'") * toNum(power(), "right of '*'"); }
      else if (src[i] === "/") { i++; v = toNum(v, "left of '/'") / toNum(power(), "right of '/'"); }
      else return v;
    }
  }
  function additive() {
    let v = term();
    for (;;) {
      ws();
      if (src[i] === "+") { i++; v = toNum(v, "left of '+'") + toNum(term(), "right of '+'"); }
      else if (src[i] === "-") { i++; v = toNum(v, "left of '-'") - toNum(term(), "right of '-'"); }
      else return v;
    }
  }
  function concat() {
    let v = additive();
    for (;;) {
      ws();
      if (src[i] === "&") { i++; v = toStr(v) + toStr(additive()); }
      else return v;
    }
  }
  // one optional comparison, lowest precedence, yielding 1 or 0; equality
  // inside a formula is '==' — a single '=' is the cell operator alone
  function cmp() {
    const v = concat();
    ws();
    const op = ["==", "<=", ">=", "<", ">"].find((o) => src.startsWith(o, i));
    if (!op) return v;
    i += op.length;
    return compareValues(op, v, concat()) ? 1 : 0;
  }

  const v = cmp();
  ws();
  if (i < src.length) err(`unexpected '${src[i]}'`);
  return v;
}

// Render a computed result the way the old value was written: a number
// keeps a leading $ and thousands commas, two decimals at most; a string
// is written as it is, with any '|' bent to a broken bar (a pipe cannot
// live inside a pipe table).
function formatValue(v, old) {
  // a Choice written into a value is being read as a truth, not as a set
  if (v instanceof Choice) v = truthOf(v) ? 1 : 0;
  if (typeof v === "string") return v.replace(/\|/g, "¦");
  if (!isFinite(v)) throw new Error("the result is not a number");
  const rounded = Math.round(v * 100) / 100;
  const s = old.includes(",")
    ? rounded.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : String(rounded);
  return (old.trim().startsWith("$") ? "$" : "") + s;
}

// The data rows of a complete table block (header and separators aside).
function dataRowsOf(block) {
  const rows = block.rows.filter((r) => !r.sep);
  return block.rows.length >= 2 && !block.rows[0].sep && block.rows[1].sep ? rows.slice(1) : [];
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
    let name = splitConstraint(widthCookie(cell).text).value, alias = null;
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
    let name = splitConstraint(widthCookie(cell).text).value;
    if (name.endsWith(")") && name.includes("(")) name = name.slice(0, name.lastIndexOf("(")).trim();
    if (name) columns.push(name);
  });
  const rowNames = rows.map((cells) => splitCell(cells[0] || "").value).filter((n) => n);
  return { columns, rows: rowNames };
}

// The @-reference names a table block offers, for completion. Returns
// { columns: [name], rows: [name] } — columns first.
function referenceNames(block) {
  const header = block.rows.length && !block.rows[0].sep ? block.rows[0].cells : [];
  return referenceNamesFrom(header, dataRowsOf(block).map((r) => r.cells));
}

// Merge per-file scope maps (derive.js's conceptRegistry — the one scope
// kind, built over the parsed tree, whether a Concept's Examples are rows
// in a grid or '- ' lines) into the registry the evaluator reads: later
// maps win a shared name (so the current file's own scopes shadow the
// repo's), and the name candidates are precomputed once. Pass the result
// as the trailing `registry` argument to the recompute/audit calls.
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
// grid, so tables and free text work as one: a cell formula may reference
// the parent's own `tax rate: 0.2` by name, an empty cell inherits the
// parent's default, an aggregate also ranges over the parent's line-form
// Examples, and a line-form sibling Example can be named in a cell ref.
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
    let name = splitConstraint(widthCookie((header || [])[c - 1] || "").text).value;
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
// width cookie and (alias) — "" when the block has no header or the cell
// is empty. This is the name the table declares (or fills in) since 1.9.
function ownName(block) {
  if (!block.rows.length || block.rows[0].sep) return "";
  return cleanName(widthCookie(block.rows[0].cells[0] || "").text);
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

// Evaluate one cell's '=' formula in its row and table. Returns the value
// it should carry; throws with a reason when it cannot compute.
function computeCell(rows, row, text, header, registry, outer) {
  const { value, eq, op } = splitCell(text);
  const formula = text.slice(eq + op.length);
  return formatValue(evalFormula(formula.trim(), tableCtx(rows, row, header, registry, outer)), value);
}

// The per-column definitions a header declares. An attribute carrying a
// determinate `==` bound *defines* its column: `vat ==@price*@tax rate`
// says every vat IS that, computed in its own row, so no cell need repeat
// the formula — the derivation is written once, where the attribute is
// declared. `==or(`draft`,`sent`)` is NOT a definition: a Choice lists the
// allowed values rather than naming one, so it stays a bound the audit
// checks. Determinacy is decided by the computed value, per row.
// Indexed by cell position; null where the column defines nothing.
function columnDefinitions(header) {
  return (header || []).map((cell, k) => {
    if (k === 0) return null; // the first cell names the Concept, not a column
    const con = splitConstraint(widthCookie(cell).text);
    const eq = con.constraints.find((c) => c.op === "==");
    return eq ? eq.formula : null;
  });
}

// Recompute every derived cell in the block, top-down and left-to-right,
// so a formula may build on the column before it; extra passes let a
// reference to a later formula converge. Two kinds of derivation:
// a cell's own '=' formula (which cannot compute shows #ERR and keeps its
// formula), and a column defined by a determinate '==' on its header,
// which fills every cell that carries no formula of its own — an empty one
// included, since the definition says what the value IS. A '==' that
// cannot compute leaves its cells alone: an uncomputable bound is the
// declaration's problem, reported once against the header by the audit.
// The other constraints ('>=' and kin) are never rewritten — they are
// checked by the audit, not computed.
function recompute(block, registry, outer) {
  const rows = dataRowsOf(block);
  const header = rows.length ? block.rows[0].cells : [];
  const defs = columnDefinitions(header);
  let changedAtAll = false;
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const row of rows) {
      defs.forEach((formula, k) => {
        if (!formula) return;
        const text = row.cells[k] || "";
        if (splitCell(text).eq !== -1) return; // an explicit cell formula wins
        let out;
        try {
          const v = evalFormula(formula, tableCtx(rows, row, header, registry, outer));
          if (v instanceof Choice) return; // allowed values, not a definition
          out = formatValue(v, text);
        } catch { return; }
        if (out !== text) {
          for (let j = row.cells.length; j < k; j++) row.cells[j] = "";
          row.cells[k] = out;
          changed = true;
        }
      });
      row.cells.forEach((text, k) => {
        const { value, eq, op } = splitCell(text);
        if (eq === -1 || op !== "=") return;
        let out;
        try { out = computeCell(rows, row, text, header, registry, outer); } catch { out = "#ERR"; }
        if (out !== value) {
          row.cells[k] = out + " =" + text.slice(eq + 1).trim();
          changed = true;
        }
      });
    }
    changedAtAll = changedAtAll || changed;
    if (!changed) break;
  }
  return changedAtAll;
}

// Audit every '=' formula in the text for the linter and the colouring:
// its exact span (from the '=' to the cell's end) plus what is wrong with
// it — an error that cannot compute, or a stale value the next recompute
// fixes. Fresh spans are still returned so the colouring covers them.
// (Constraints live on attribute declarations and are audited by
// derive.js against the parsed tree.)
function formulas(lines, registry, rootName) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const block = blockAt(lines, i);
    if (!block) continue;
    i = block.end;
    // continuation rows collapse so the evaluator ranges over logical rows;
    // formula cells never wrap, so every span still sits whole on its
    // host's own physical line, remembered per row before the collapse
    const physIdx = new Map(block.rows.map((r, idx) => [r, idx]));
    unwrap(block);
    const rows = dataRowsOf(block);
    if (!rows.length) continue;
    const header = block.rows[0].cells;
    const outer = enclosingScope(lines, block, registry, rootName);
    for (const row of rows) {
      const abs = block.start + physIdx.get(row);
      const cs = cells(lines[abs]);
      cs.forEach((cell) => {
        const { value, eq, op } = splitCell(cell.text);
        if (eq === -1) return;
        const span = {
          line: abs + 1,
          startCol: cell.col + eq,
          endCol: cell.col + cell.text.length,
          op,
          formula: cell.text.slice(eq + op.length).trim(),
        };
        try {
          const computed = computeCell(rows, row, cell.text, header, registry, outer);
          if (computed !== value) {
            span.stale = true;
            span.message = value === ""
              ? `formula '=${span.formula}' is not yet computed (= ${computed}) — it fills in when the cursor leaves the line, or on save`
              : `value '${value}' does not match its formula (= ${computed}) — it recomputes when the cursor leaves the line, or on save`;
          }
        } catch (e) {
          span.error = true;
          span.message = `formula '=${span.formula}' does not compute — ${e.message}`;
        }
        out.push(span);
      });
    }
  }
  return out;
}

// Run one formula through the evaluator itself and answer the exact span
// of every name an '@' resolved — a column, an Example or a table — as
// { start, length, text, kind, scope, id }, offsets within `src`. The
// scope is the object the name resolved against: the ctx for a local
// name, the registry's scope for a foreign one. A reading the evaluator
// abandons (a local attempt giving way to a foreign table) re-reads the
// same characters, so a later record replaces any earlier one it
// overlaps: what survives is the parse that won. A formula that cannot
// compute still answers the spans it resolved before failing.
function referenceSpans(src, ctx) {
  const out = [];
  const record = (r) => {
    for (let k = out.length - 1; k >= 0; k--) {
      if (out[k].start < r.start + r.length && r.start < out[k].start + out[k].length) out.splice(k, 1);
    }
    out.push(r);
  };
  const wrapMatch = (fn, kind, scope) => fn && ((rest) => {
    const m = fn(rest);
    if (m) record({ start: src.length - rest.length, length: m.length, text: rest.slice(0, m.length), kind, scope, id: m.id });
    return m;
  });
  const wrapScope = (scope) => scope && ({
    ...scope,
    matchColumn: wrapMatch(scope.matchColumn, "column", scope),
    matchRow: wrapMatch(scope.matchRow, "row", scope),
  });
  const proxy = {
    ...ctx,
    matchColumn: wrapMatch(ctx.matchColumn, "column", ctx),
    matchRow: wrapMatch(ctx.matchRow, "row", ctx),
    matchTable: wrapMatch(ctx.matchTable, "table", ctx),
    table: ctx.table && ((id) => wrapScope(ctx.table(id))),
  };
  try { evalFormula(src, proxy); } catch { /* partial spans still answer */ }
  return out;
}

// Every name reference in every table formula of the text, resolved as
// evaluation resolves it and pinned to the document: { line, startCol,
// endCol, text, kind, id } plus where the name is declared — `site`
// { line, col } for a grid name (col null when unknowable), `conceptNode`/
// `attrKey` for an attribute of a registry scope, `nodes` for its
// Example. A cross-file scope's node points into the other file and
// simply matches nothing here. For the rename that follows a declaration.
function formulaReferences(lines, registry, rootName) {
  const out = [];
  const colSite = (headerLine, k) => {
    const c = headerLine ? cells(lines[headerLine - 1] || "")[k - 1] : null;
    return { line: headerLine, col: c ? c.col : null };
  };
  const rowSite = (rowLine) => {
    const c = rowLine ? cells(lines[rowLine - 1] || "")[0] : null;
    return { line: rowLine, col: c ? c.col : null };
  };
  const place = (r, rec) => {
    const s = rec.scope;
    if (s.node) { // a registry scope, its declarations tree nodes
      if (rec.kind === "column") { r.conceptNode = s.node; r.attrKey = rec.id; }
      else r.nodes = [s.examples[rec.id]].filter(Boolean);
    }
    return r;
  };
  for (let i = 0; i < lines.length; i++) {
    const block = blockAt(lines, i);
    if (!block) continue;
    i = block.end;
    // as in formulas(): logical rows for evaluation, physical lines for spans
    const physIdx = new Map(block.rows.map((r, idx) => [r, idx]));
    unwrap(block);
    const rows = dataRowsOf(block);
    if (!rows.length) continue;
    const header = block.rows[0].cells;
    const outer = enclosingScope(lines, block, registry, rootName);
    for (const row of rows) {
      const abs = block.start + physIdx.get(row);
      cells(lines[abs]).forEach((cell) => {
        const { eq, op } = splitCell(cell.text);
        if (eq === -1) return;
        const from = cell.col + eq + op.length;
        const src = cell.text.slice(eq + op.length);
        const ctx = tableCtx(rows, row, header, registry, outer);
        for (const rec of referenceSpans(src, ctx)) {
          const r = {
            line: abs + 1, startCol: from + rec.start, endCol: from + rec.start + rec.length,
            text: rec.text, kind: rec.kind, id: rec.id,
          };
          if (rec.kind === "table") {
            // resolved through the registry by the caller
          } else if (rec.scope === ctx) { // this table's own name
            if (rec.kind === "column" && typeof rec.id === "number") {
              r.site = colSite(block.start + 1, rec.id);
            } else if (rec.kind === "row" && block.rows.includes(rec.id)) {
              r.site = rowSite(block.start + physIdx.get(rec.id) + 1);
            } else if (outer && outer.node) {
              // a name answered through the enclosing scope: its tree node
              if (rec.kind === "column") { r.conceptNode = outer.node; r.attrKey = rec.id; }
              else if (rec.id && rec.id.outerRow !== undefined) {
                r.nodes = [outer.examples[rec.id.outerRow]].filter(Boolean);
              }
            }
          } else place(r, rec);
          out.push(r);
        }
      });
    }
  }
  return out;
}

// --- the CSV mirror ---------------------------------------------------------
// Every table is mirrored to a CSV file named after its parent Concept and
// kept in sync both ways. The functions here are the pure halves: find the
// tables in a text, serialise a grid to CSV and back, and work out the
// exact line edit that folds a CSV grid back into its .aot table.

// The name a table is filed under: its parent line's term, stripped of an
// Example marker, an inline value and a parenthetical alias.
const cleanName = (t) => t.replace(/^[-|]\s+/, "").split(":")[0].replace(/\([^)]*\)\s*$/, "").trim();

// Every complete table in the text (header + separator + rows): its parent
// name — the nearest shallower line, or the root name — with its grid and
// location. Assumed lone headers are skipped: they are still being typed.
function tablesOf(lines, rootName) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const block = blockAt(lines, i);
    if (!block) continue;
    i = block.end;
    if (block.rows.length < 2 || block.rows[0].sep || !block.rows[1].sep) continue;
    // the table names the Concept it describes in its first header cell
    // (1.9); an older table (a 'name' label, or a cell that reads as no
    // Concept) still takes its name from the nearest shallower line.
    let name, nameLine;
    const own = cleanName(widthCookie(block.rows[0].cells[0] || "").text);
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
    // continuation rows collapse: a grid's rows are logical rows, each
    // pinned to its first physical line
    const physIdx = new Map(block.rows.map((r, idx) => [r, idx]));
    unwrap(block);
    const header = block.rows[0].cells;
    // each data row with its 1-based line and its depth in the table's tree
    const rows = [], rowLines = [], rowDepths = [];
    block.rows.forEach((r, j) => {
      if (j < 2 || r.sep) return;
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
    if (b.rows[0].sep) continue;
    const cell0 = cleanName(widthCookie(b.rows[0].cells[0] || "").text);
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
      { sep: true, cells: [] },
      ...rows.map((cells) => ({ sep: false, cells })),
    ],
  };
  recompute(tableBlock, registry); // formulas arriving from the CSV compute too
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
    if (!block.rows.some((r) => r.sep) || !block.rows.some((r) => !r.sep)) continue;
    const extent = block.end - block.start + 1;
    unwrap(block); // wrapped rows collapse, so formulas range over logical rows
    // formulas first, so the widths fit the fresh values
    recompute(block, registry, enclosingScope(lines, block, registry, rootName));
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

// Recompute every '=' formula in the text's tables, touching nothing else:
// a block whose values changed is redrawn whole (as Tab draws it), a block
// whose values are already fresh is left exactly as typed — so the
// automatic fill never re-aligns a table the writer is still shaping.
// Returns the changed lines as { line, text } with 1-based line numbers.
function recomputeAll(text, registry, rootName) {
  const lines = text.split(/\r?\n/);
  const edits = [];
  for (let i = 0; i < lines.length; i++) {
    const block = blockAt(lines, i);
    if (!block) continue;
    i = block.end; // one visit per block
    // a rule with no rows around it is not a table to draw
    if (!block.rows.some((r) => r.sep) || !block.rows.some((r) => !r.sep)) continue;
    const extent = block.end - block.start + 1;
    unwrap(block); // wrapped rows collapse, so formulas range over logical rows
    // fresh values — leave the lines alone
    if (!recompute(block, registry, enclosingScope(lines, block, registry, rootName))) continue;
    const drawn = render(block);
    if (drawn.length !== extent) {
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
  cells, isSeparator, isRowText, align, blockAt, widthsOf, render, cellStart, colAt, padRows, dataRow,
  nextCell, prevCell, nextRow, moveColumn, moveRow, insertColumn, deleteColumn,
  insertRow, deleteRow, insertSeparator, sortRows, fromRegion, copyFormulaDown, copyFormulaAcross,
  copyCell, moveCell, copyRow, copyColumn,
  alignColumn, alignmentsOf, alignmentsFrom, padCell, sepCell, ALIGNMENTS,
  cleanName, tablesOf, toCsv, fromCsv, updateTable,
  splitCell, splitConstraint, evalFormula, formatValue, recompute, recomputeAll, formulas,
  referenceSpans, formulaReferences,
  compareValues, criterionTest, longestMatch, numericValue, tableCtx,
  readValue, Choice, truthOf, describeBound,
  valueType, isDateValue, referenceNames, referenceNamesFrom, dataRowsOf,
  mergeRegistries, enclosingScope,
  widthCookie, headerWidths, isContinuation, unwrap, unwrapWithMap,
  numberless, columnDefinitions,
};
