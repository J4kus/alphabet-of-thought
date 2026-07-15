// Org-style plain-text tables: the '|' row grammar, shared by the linter
// (which reads a table as Examples x attributes) and the VS Code extension's
// formatter (which re-aligns the columns as org-mode's TAB does).
//
//     |name  |size|colour|     <- header: each cell names an attribute
//     |------+----+------|     <- separator: marks the row above as header
//     |Ollie |5   |brown |     <- data row: one Example per row,
//     |Pebble|3   |      |        one Attribute Value per cell
//
// Columns are padded to their widest cell so they align, but carry no
// gutter spaces around the pipes — a file's width is precious.
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
// separator rows redrawn to match. No gutter spaces around the pipes.
function render(block) {
  const widths = widthsOf(block);
  return block.rows.map((row) => row.sep
    ? block.indent + "|" + widths.map((w) => "-".repeat(w)).join("+") + "|"
    : block.indent + "|" + widths.map((w, k) => (row.cells[k] || "").padEnd(w)).join("|") + "|");
}

// Where a cell's text begins on an aligned line, so a command can land the
// cursor at the start of a field, as org does.
function cellStart(block, col) {
  const widths = widthsOf(block);
  let x = block.indent.length + 1;
  for (let k = 0; k < Math.min(col, widths.length); k++) x += widths[k] + 1;
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
  const key = (r) => splitCell((r.cells[col] || "").trim()).value;
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

// --- formulas ----------------------------------------------------------------
// A cell may derive its value, org's spreadsheet folded into the cell
// itself: `10 =$1+10` keeps the value first and the formula visible after
// it. Every table command, the formatter and the CSV mirror recompute.
// An attribute may instead be *constrained* — `age >=18` on a bare
// attribute line or a table header cell — and every value the attribute
// takes is validated against the bound (derive.js); values themselves
// carry formulas only, never constraints.
//
//   @N / @name                 the same row's column (1 = the name column),
//                              by number or by header name
//   @col@Example / @Example@col   the named Example's cell in that column —
//                              either order; a name that is both a column
//                              and an Example resolves as the longer match
//                              (a tie goes to the column)
//   sum avg min max count      over the table's other data rows: sum(@N),
//                              count(@price) — count tallies non-empty cells
//   round(x,n) abs(x)          numeric helpers
//   upper lower trim len       string helpers; left(x,n) right(x,n)
//   left right mid replace     mid(x,i,n) is 1-based, replace(x,a,b) is all
//   if(cond,a,b)               lazy: only the taken branch is evaluated
//   & and `literals`           & concatenates; backticks quote a string
//   == <= >= < >               comparisons yield 1 or 0
//   + - * / ( ) and plain numbers
//
// $ signs, thousands commas and % in referenced values are ignored, so a
// money column reads as its number. Arithmetic coerces its operands to
// numbers (a non-numeric operand is an error); & coerces to strings; a
// comparison is numeric when both sides read as numbers, else string.
// (References used to be '$'; since 1.3 they are '@'.)

// Split a cell (or line-form value) into its value and its '=' formula:
// eq is the index of the '=' (the cell's start, or following a space), -1
// when the cell is a plain value. The scan is left-to-right and skips
// '==' so an operator inside a formula ('=if($2 == 3,1,0)') never splits
// the cell. Values carry formulas only — constraints live on the
// attribute declaration (splitConstraint) and validate the values.
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

// The value types a `... is ...` clause may name.
const TYPE_WORDS = ["date", "number", "text"];

// Parse a ' is <type>[ or <type>]*' clause at position k (k points at the
// space before 'is'). Returns { types, end } (end past the last type word)
// or null when there is no such clause there.
function parseTypeClause(text, k) {
  if (text.slice(k, k + 4).toLowerCase() !== " is ") return null;
  let i = k + 4;
  const types = [];
  for (;;) {
    const m = /^[a-z]+/i.exec(text.slice(i));
    if (!m || !TYPE_WORDS.includes(m[0].toLowerCase())) break;
    types.push(m[0].toLowerCase());
    i += m[0].length;
    if (text.slice(i, i + 4).toLowerCase() === " or ") { i += 4; continue; }
    break;
  }
  return types.length ? { types, end: i } : null;
}

// Split an attribute declaration into its term and its constraint. A
// constraint is a **type clause**, a **comparison bound**, or both:
//   `age >=18`                 the value must be at least 18
//   `birth date is date`       the value must be a date
//   `field is number or date`  either type is allowed
//   `due is date >=`2025-01-01`  a date, and no earlier than that one
// Returns { value (the term), eq (index the clause starts, -1 for none),
// op, formula, types }. A bound is only believed when its right side looks
// like a formula, so a prose term such as 'speed > none noted' stays a
// plain name; a type clause needs a real type word, so 'car is red' does too.
function splitConstraint(text) {
  if (!text) return { value: text || "", eq: -1, op: null, formula: "", types: null };
  // a type clause, optionally followed by a bound
  for (let k = 1; k < text.length; k++) {
    if (text[k] !== " ") continue;
    const tc = parseTypeClause(text, k);
    if (!tc) continue;
    const term = text.slice(0, k).trim();
    if (!term) continue;
    let op = null, formula = "";
    let j = tc.end;
    while (text[j] === " ") j++;
    const bop = CONSTRAINT_OPS.find((o) => text.startsWith(o, j));
    if (bop) { op = bop; formula = text.slice(j + bop.length).trim(); }
    return { value: term, eq: k + 1, op, formula, types: tc.types };
  }
  // a bound only
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && text[i - 1] !== " ") continue;
    const op = CONSTRAINT_OPS.find((o) => text.startsWith(o, i));
    if (!op) continue;
    const rest = text.slice(i + op.length);
    if (rest.trim() && (rest.includes("@") || triesAsFormula(rest))) {
      return { value: text.slice(0, i).trim(), eq: i, op, formula: rest.trim(), types: null };
    }
    i += op.length - 1; // an unaccepted candidate is skipped whole
  }
  return { value: text, eq: -1, op: null, formula: "", types: null };
}

// A value's type: a date (ISO `YYYY-MM-DD`, optionally with a time) reads
// as a date, a `$`/comma/%-tolerant number reads as a number, anything
// else is text. Disjoint, so `is text` genuinely excludes numbers and dates.
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
const isDateValue = (v) => { const s = String(v).trim(); return DATE_RE.test(s) && !isNaN(Date.parse(s)); };
const isNumberValue = (v) => !isNaN(numericValue(v));
function valueType(v) {
  if (isDateValue(v)) return "date";
  if (isNumberValue(v)) return "number";
  return "text";
}
// Whether a value's type is among those a `is ...` clause allows.
const satisfiesTypes = (v, types) => types.includes(valueType(v));

// A dry run of the evaluator, used to tell a literal constraint formula
// ('>=18', '<=100*1.5') from prose. Reference-bearing formulas never get
// here — an '@' already vouches for them in splitConstraint.
const DRY_CTX = {
  matchColumn: () => null, matchRow: () => null,
  cell: () => "0", cellAt: () => "0", column: () => ["0"],
};
function triesAsFormula(src) {
  try { evalFormula(src.trim(), DRY_CTX); return true; } catch { return false; }
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

// One comparison, shared by the in-formula operators and the constraint
// audit: two dates compare chronologically, two numbers numerically, else
// as strings (exact case).
function compareValues(op, a, b) {
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
    if (dead) return 0;
    const n = numericValue(v);
    if (isNaN(n)) err(`'${v}' is not numeric${what ? ` (${what})` : ""}`);
    return n;
  };
  const toStr = (v) => (typeof v === "number" ? String(v) : v);

  // one part after an '@', resolved against `scope` (the current table, or
  // a foreign one once a table has been named): a number is always a
  // column; a name is resolved against the columns and the Examples, the
  // longer match winning and a tie going to the column. Returns { col, row }
  // with exactly one set.
  const refPart = (scope) => {
    if (/[0-9]/.test(src[i])) {
      let digits = "";
      while (/[0-9]/.test(src[i])) digits += src[i++];
      return { col: +digits, row: null };
    }
    const rest = src.slice(i);
    const colM = scope.matchColumn(rest);
    const rowM = scope.matchRow(rest);
    if (!colM && !rowM) err("unknown column or Example after '@'");
    const asCol = colM && (!rowM || colM.length >= rowM.length);
    const m = asCol ? colM : rowM;
    i += m.length;
    return asCol ? { col: m.id, row: null } : { col: null, row: m.id };
  };
  // The leading part of a reference: a current-table column/Example (as
  // ever), or — only when it names neither, so no formula that resolved
  // before changes meaning — a foreign TABLE, written as the Concept/
  // Example/Attribute it sits under, followed by another '@' to name its
  // column (`@Order@…`). Returns { scope, part }: when a table was named,
  // scope is that foreign table and part is null (the caller reads the
  // cell/column from it); otherwise scope is the current table and part is
  // the col/Example already read.
  const leadPart = () => {
    if (/[0-9]/.test(src[i])) return { scope: ctx, part: refPart(ctx) };
    const rest = src.slice(i);
    const colM = ctx.matchColumn(rest);
    const rowM = ctx.matchRow(rest);
    if (colM || rowM) {
      const asCol = colM && (!rowM || colM.length >= rowM.length);
      const m = asCol ? colM : rowM;
      i += m.length;
      return { scope: ctx, part: asCol ? { col: m.id, row: null } : { col: null, row: m.id } };
    }
    // neither a column nor an Example here: a foreign table, when the name
    // matches one and a '@' follows to name its column
    const tm = ctx.matchTable && ctx.matchTable(rest);
    if (tm && src[i + tm.length] === "@") {
      const foreign = ctx.table(tm.id);
      if (!foreign) err(`the table '${rest.slice(0, tm.length)}' has no data`);
      i += tm.length + 1; // the table name and its '@'
      return { scope: foreign, part: null };
    }
    err(tm
      ? "a foreign table reference names a cell — write @Table@column@Example"
      : "unknown column, Example or table after '@'");
  };
  // a cell reference: @col or @N for this row's cell; a column paired with
  // an Example (either order) for that Example's cell; or a foreign table's
  // cell, @Table@column@Example — the table first, then a column and an
  // Example in either order.
  const ref = () => {
    i++; // the '@'
    const { scope, part } = leadPart();
    if (part === null) {
      // a foreign table was named: its column and Example follow, in either order
      const b = refPart(scope);
      if (src[i] !== "@") err("a foreign table cell needs both a column and an Example — write @Table@column@Example");
      i++;
      const c = refPart(scope);
      let col, row;
      if (b.col != null && c.row != null) { col = b.col; row = c.row; }
      else if (b.row != null && c.col != null) { col = c.col; row = b.row; }
      else err("@Table pairs a column with an Example — one of each, in either order");
      return dead ? "" : scope.cellAt(col, row);
    }
    const a = part;
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
  // a bare column, for the aggregates: @N or @name of this table, or a
  // foreign column @Table@column; never an @Example cell. Returns { scope,
  // col } so the aggregate ranges over the right table's column.
  const colRef = () => {
    i++; // the '@'
    const { scope, part } = leadPart();
    if (part === null) {
      const b = refPart(scope);
      if (b.col == null) err("expected a column after the table, like @Order@price");
      return { scope, col: b.col };
    }
    if (part.col == null) err("expected a column here, like @2 or @price");
    return { scope: ctx, col: part.col };
  };

  const AGG = {
    sum: (a) => a.reduce((x, y) => x + y, 0),
    avg: (a) => a.reduce((x, y) => x + y, 0) / a.length,
    min: (a) => Math.min(...a),
    max: (a) => Math.max(...a),
  };

  function call(name, skip) {
    i += skip; // the name and its '('
    if (name in AGG || name === "count") {
      ws();
      if (src[i] !== "@") err(`${name}() takes a column reference like @2 or @price`);
      const { scope, col } = colRef();
      if (src[i] === "@") err(`${name}() ranges over a column, not one row's cell`);
      expect(")");
      if (dead) return 0;
      const raw = scope.column(col);
      if (name === "count") return raw.filter((v) => String(v).trim() !== "").length;
      const values = raw.map((v) => numericValue(v)).filter((n) => !isNaN(n));
      if (!values.length) err(`column @${col} has no numeric values`);
      return AGG[name](values);
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
      round: [1, 2], abs: [1, 1], upper: [1, 1], lower: [1, 1], trim: [1, 1],
      len: [1, 1], left: [2, 2], right: [2, 2], mid: [3, 3], replace: [3, 3],
    }[name];
    const argv = [cmp()];
    ws();
    while (src[i] === ",") { i++; argv.push(cmp()); ws(); }
    expect(")");
    if (argv.length < arity[0] || argv.length > arity[1]) {
      err(`${name}() takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]} to ${arity[1]}`} argument(s), got ${argv.length}`);
    }
    if (dead) return 0;
    const n = (k) => Math.trunc(toNum(argv[k], `${name}() argument ${k + 1}`));
    const s = (k) => toStr(argv[k]);
    switch (name) {
      case "round": { const f = 10 ** (argv.length > 1 ? n(1) : 0); return Math.round(toNum(argv[0], "round()") * f) / f; }
      case "abs": return Math.abs(toNum(argv[0], "abs()"));
      case "upper": return s(0).toUpperCase();
      case "lower": return s(0).toLowerCase();
      case "trim": return s(0).trim();
      case "len": return s(0).length;
      case "left": return s(0).slice(0, Math.max(0, n(1)));
      case "right": { const k = Math.max(0, n(1)); return k ? s(0).slice(-k) : ""; }
      case "mid": { const at = Math.max(1, n(1)) - 1; return s(0).slice(at, at + Math.max(0, n(2))); }
      case "replace": { const from = s(1); return from ? s(0).split(from).join(s(2)) : s(0); }
    }
  }

  function factor() {
    ws();
    if (src[i] === "-") { i++; return -toNum(factor(), "after unary '-'"); }
    if (src[i] === "(") { i++; const v = cmp(); expect(")"); return v; }
    if (src[i] === "@") return ref();
    if (src[i] === "$") err("references use '@', not '$' — write @price or @2 (changed in 1.3)");
    if (src[i] === "`") {
      const close = src.indexOf("`", i + 1);
      if (close === -1) err("unclosed '`' string");
      const v = src.slice(i + 1, close);
      i = close + 1;
      return v;
    }
    const fn = /^(sum|avg|min|max|count|round|abs|upper|lower|trim|len|left|right|mid|replace|if)\s*\(/i.exec(src.slice(i));
    if (fn) return call(fn[1].toLowerCase(), fn[0].length);
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { i += num[0].length; return +num[0]; }
    err(i >= src.length ? "the formula ends too soon" : `unexpected '${src[i]}'`);
  }
  function term() {
    let v = factor();
    for (;;) {
      ws();
      if (src[i] === "*") { i++; v = toNum(v, "left of '*'") * toNum(factor(), "right of '*'"); }
      else if (src[i] === "/") { i++; v = toNum(v, "left of '/'") / toNum(factor(), "right of '/'"); }
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
function headerNameCands(header) {
  const cands = [];
  (header || []).forEach((cell, k) => {
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
    let name = splitConstraint(cell).value;
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

// A read-only evaluation scope over a foreign table's grid — a table named
// by another formula through the registry. Like tableCtx but with no
// current row: `column` ranges over every data row (there is none to skip),
// and `matchRow`/`cellAt` address a row by its index. Also carries the
// `columns`/`rows` name lists so the completion can offer them.
function foreignScope(header, rows) {
  const names = headerNameCands(header);
  const rowCands = rows.map((cells, r) => ({ key: splitCell(cells[0] || "").value.toLowerCase(), id: r }));
  const numCols = Math.max(header ? header.length : 0, ...rows.map((r) => r.length), 0);
  const raw = (r, c) => {
    if (c < 1 || c > numCols) throw new Error(`there is no column @${c}`);
    return splitCell((rows[r] || [])[c - 1] || "").value;
  };
  const display = referenceNamesFrom(header, rows);
  return {
    columns: display.columns,
    rows: display.rows,
    matchColumn: (rest) => longestMatch(rest, names),
    matchRow: (rest) => longestMatch(rest, rowCands),
    cellAt: (c, r) => raw(r, c),
    column: (c) => rows.map((_, r) => raw(r, c)),
  };
}

// The tables one text offers to cross-table references: a Map from each
// table's parent name (lowercased — the Concept/Example/Attribute it sits
// under, as tablesOf files it) to a foreignScope over its grid. The first
// table wins a shared name. Pure; the I/O layer (extension.js, verify.js)
// builds one per file and merges them.
function tableRegistry(lines, rootName) {
  const map = new Map();
  for (const t of tablesOf(lines, rootName)) {
    const key = t.name.toLowerCase();
    if (map.has(key)) continue;
    const scope = foreignScope(t.header, t.rows);
    scope.name = t.name; // the parent name, original case, for completion
    map.set(key, scope);
  }
  return map;
}

// Merge per-file table maps into the registry the evaluator reads: later
// maps win a shared name (so the current file's own tables shadow the
// repo's), and the table-name candidates are precomputed once. Pass the
// result as the trailing `registry` argument to the recompute/audit calls.
function mergeRegistries(...maps) {
  const scopes = new Map();
  for (const m of maps) if (m) for (const [k, v] of m) scopes.set(k, v);
  return { scopes, cands: [...scopes.keys()].map((k) => ({ key: k, id: k })) };
}

// The table's evaluation context: header cells (and their aliases) resolve
// $name references, first-column values resolve @Row references, and every
// reference reads the raw value part of its cell. A header's trailing
// constraint (`qty >=1`) is not part of the column's name.
function tableCtx(rows, row, header, registry) {
  const names = headerNameCands(header);
  const rowNames = rows.map((r) => ({ key: splitCell(r.cells[0] || "").value.toLowerCase(), id: r }));
  const numCols = Math.max(header ? header.length : 0, ...rows.map((r) => r.cells.length));
  const raw = (r, c) => {
    if (c < 1 || c > numCols) throw new Error(`there is no column $${c}`);
    return splitCell(r.cells[c - 1] || "").value;
  };
  return {
    matchColumn: (rest) => longestMatch(rest, names),
    matchRow: (rest) => longestMatch(rest, rowNames),
    cell: (c) => raw(row, c),
    cellAt: (c, r) => raw(r, c),
    column: (c) => rows.filter((r) => r !== row).map((r) => raw(r, c)),
    matchTable: registry ? (rest) => longestMatch(rest, registry.cands) : undefined,
    table: registry ? (id) => registry.scopes.get(id) : undefined,
  };
}

// Evaluate one cell's '=' formula in its row and table. Returns the value
// it should carry; throws with a reason when it cannot compute.
function computeCell(rows, row, text, header, registry) {
  const { value, eq, op } = splitCell(text);
  const formula = text.slice(eq + op.length);
  return formatValue(evalFormula(formula.trim(), tableCtx(rows, row, header, registry)), value);
}

// Recompute every '=' formula cell in the block, top-down and
// left-to-right, so a formula may build on the column before it; extra
// passes let a reference to a later formula converge. A cell that cannot
// compute shows #ERR and keeps its formula. Constraint cells ('>=' and
// kin) are never rewritten — they are checked by the audit, not computed.
function recompute(block, registry) {
  const rows = dataRowsOf(block);
  const header = rows.length ? block.rows[0].cells : [];
  let changedAtAll = false;
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const row of rows) {
      row.cells.forEach((text, k) => {
        const { value, eq, op } = splitCell(text);
        if (eq === -1 || op !== "=") return;
        let out;
        try { out = computeCell(rows, row, text, header, registry); } catch { out = "#ERR"; }
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
function formulas(lines, registry) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const block = blockAt(lines, i);
    if (!block) continue;
    i = block.end;
    const rows = dataRowsOf(block);
    if (!rows.length) continue;
    const header = block.rows[0].cells;
    for (const row of rows) {
      const abs = block.start + block.rows.indexOf(row);
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
          const computed = computeCell(rows, row, cell.text, header, registry);
          if (computed !== value) {
            span.stale = true;
            span.message = value === ""
              ? `formula '=${span.formula}' is not yet computed (= ${computed}) — press Tab in the table, or run Format Document`
              : `value '${value}' does not match its formula (= ${computed}) — press Tab in the table, or run Format Document, to recompute`;
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
    let name = rootName;
    for (let j = block.start - 1; j >= 0; j--) {
      if (!lines[j].trim()) continue;
      if (lines[j].match(/^ */)[0].length < block.indent.length) {
        name = cleanName(lines[j].trim());
        break;
      }
    }
    if (!name) continue;
    const header = block.rows[0].cells;
    const rows = block.rows.slice(2).filter((r) => !r.sep)
      .map((r) => header.map((_, k) => r.cells[k] || ""));
    out.push({ name, start: block.start, end: block.end, indent: block.indent, header, rows });
  }
  return out;
}

// A grid as RFC 4180 CSV: cells holding a comma, quote or newline are
// quoted, quotes doubled; rows end in '\n'.
function toCsv(grid) {
  const cell = (c) => (/[",\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c);
  return grid.map((row) => row.map(cell).join(",")).join("\n") + "\n";
}

// CSV text back to a grid. Quoted cells may hold commas, doubled quotes
// and newlines; unquoted cells are trimmed. A pipe cannot survive inside a
// pipe table, so it is bent to a broken bar.
function fromCsv(text) {
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
    if (ch === ",") { row.push(cell.trim()); cell = ""; continue; }
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
  let conceptLine = -1, conceptIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t[0] === "|" || isSeparator(t)) continue;
    if (cleanName(t) === name) {
      conceptLine = i;
      conceptIndent = lines[i].match(/^ */)[0].length;
      break;
    }
  }
  if (conceptLine === -1 && name !== rootName) return null;
  const indent = " ".repeat(conceptLine === -1 ? 0 : conceptIndent + 4);
  // the Concept's scope: up to the first shallower-or-equal non-blank
  // line; its table is the first pipe block at exactly its child depth
  // (a sub-Concept's own table sits deeper and is not this one)
  let from = conceptLine + 1, to = from - 1;
  for (let i = conceptLine + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const ind = lines[i].match(/^ */)[0].length;
    if (conceptLine !== -1 && ind <= conceptIndent) break;
    if (t[0] === "|" && ind === indent.length) {
      const found = blockAt(lines, i);
      from = found.start;
      to = found.end;
      break;
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
// unbroken run of pipe rows sharing one indent that contains a separator
// row — lone pipe Examples are left exactly as written.
// Returns the changed lines as { line, text } with 1-based line numbers.
function align(text, registry) {
  const lines = text.split(/\r?\n/);
  const edits = [];
  for (let i = 0; i < lines.length; i++) {
    const block = blockAt(lines, i);
    if (!block) continue;
    i = block.end; // one visit per block
    if (!block.rows.some((r) => r.sep)) continue;
    recompute(block, registry); // formulas first, so the widths fit the fresh values
    render(block).forEach((aligned, k) => {
      if (aligned !== lines[block.start + k]) edits.push({ line: block.start + k + 1, text: aligned });
    });
  }
  return edits;
}

module.exports = {
  cells, isSeparator, align, blockAt, widthsOf, render, cellStart, colAt, padRows, dataRow,
  nextCell, prevCell, nextRow, moveColumn, moveRow, insertColumn, deleteColumn,
  insertRow, deleteRow, insertSeparator, sortRows, fromRegion, copyFormulaDown, copyFormulaAcross,
  cleanName, tablesOf, toCsv, fromCsv, updateTable,
  splitCell, splitConstraint, evalFormula, formatValue, recompute, formulas,
  compareValues, longestMatch, numericValue, tableCtx,
  valueType, satisfiesTypes, isDateValue, referenceNames, referenceNamesFrom, dataRowsOf,
  foreignScope, tableRegistry, mergeRegistries,
};
