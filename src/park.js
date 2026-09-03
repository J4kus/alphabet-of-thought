// Taking the formulas out of the data, and putting them back.
//
// A grid that computes is two things written in one place: the values, which
// are what you read, and the derivations, which are what you wrote once and
// mostly do not want to look at again. `20 =@price*@tax rate` in every cell
// of a column makes the column three times as wide as its data and buries
// the number under the arithmetic that produced it.
//
// Parking separates them. **The values are written first** — the recompute
// runs, so every derived value is materialised in the data — and only then
// are the derivations lifted out to a store beside the file. What is left in
// the `.aot` is a complete, self-contained set of values: the file still says
// exactly what it said, still verifies on its own terms, and the linter never
// reads the store. That is the whole point of doing it in that order. A
// parked file is not a file with holes in it; it is a file whose arithmetic
// has already been done.
//
// Each parked derivation is addressed with the '@' path the language already
// uses for references — `@Invoice@vat@INV-1` is the `vat` of the Example
// `INV-1` of the Concept `Invoice`, whichever way that Example is written:
// as a grid row or as a `- ` line. A table and a `- ` list are one idea in
// two spellings, so one address serves both.
//
// Bounds are not derivations and never park. `age >=18` is a rule about
// values, not a recipe for one; there is nothing to write in its place. A
// `==` definition on an attribute declaration does not park either — it is
// already written once, where the attribute is declared, which is where this
// module is trying to get everything else to.
//
// Pure: no I/O, no vscode. Shared by the extension and anything that wants to
// park from the command line.

const { KIND } = require("./linter");
const { cells, blockAt, isRowText, splitCell, widthCookie, cleanName, numberless } = require("./table");

const fold = (name) => numberless(String(name || "").trim()).toLowerCase();
const isRow = (text) => isRowText(text);

// The Example path from a node up to the Concept that owns it, outermost
// first, with the Concept itself. Start at a value's parent, or at a grid
// row's own Example — the walk is the same either way.
function ownerFrom(start, rootName) {
  const examples = [];
  let p = start;
  while (p && p.kind === KIND.INDIVIDUAL) {
    examples.unshift(p.name);
    p = p.parent;
  }
  while (p && p.kind !== KIND.CONCEPT) p = p.parent;
  return { concept: p && p.name ? p.name : rootName, examples };
}

const join = (concept, attr, examples) => ["", concept, attr, ...examples].join("@");

// `@Concept@attribute` for a value on a Concept, `@Concept@attribute@Example`
// for one on an Example — and one more segment per Example it is nested
// under, outermost first.
function addressOf(node, rootName) {
  const { concept, examples } = ownerFrom(node.parent, rootName);
  return join(concept, node.name, examples);
}

// The header cell's column name, minus its width cookie, its constraint and
// its (alias) — the attribute the column declares.
const columnName = (cell) => cleanName(widthCookie(cell || "").text);

// Every addressable data cell of every grid: address -> { line, col }.
//
// Grids are read from the text rather than from the tree because a cell
// holding **only** a formula sets no value, so the tree has no node for it —
// and those are exactly the cells worth parking. The row's Example *is* a
// node, though, so the Example path (and the Concept above it) still comes
// from the tree, which is what gets a table filed under an Example right.
function cellIndex(lines, nodes, rootName) {
  const index = new Map();
  const exampleAt = new Map();
  for (const node of nodes) {
    if (node.kind === KIND.INDIVIDUAL && !exampleAt.has(node.line)) exampleAt.set(node.line, node);
  }
  let at = 0;
  while (at < lines.length) {
    if (!isRow(lines[at])) { at++; continue; }
    const block = blockAt(lines, at);
    if (!block) { at++; continue; }
    // the header stands first; every row under it is an Example
    const headerAt = block.rows.findIndex((r) => !r.sep);
    if (headerAt !== -1) {
      const header = block.rows[headerAt].cells;
      for (let r = headerAt + 1; r < block.rows.length; r++) {
        const row = block.rows[r];
        if (row.sep) continue;
        const line = block.start + r + 1; // 1-based
        const example = exampleAt.get(line);
        if (!example) continue;
        const { concept, examples } = ownerFrom(example, rootName);
        for (let c = 1; c < header.length; c++) {
          const attr = columnName(header[c]);
          if (!attr) continue;
          index.set(join(concept, attr, examples), { line, col: c });
        }
      }
    }
    at = block.end + 1;
  }
  return index;
}

// The value node an address names, or null. Names resolve case-insensitively
// and numbering prefixes are presentation, exactly as every other reference
// in the language resolves them.
function nodeAt(nodes, rootName, address) {
  const parts = String(address).split("@").slice(1).map((s) => s.trim());
  if (parts.length < 2) return null;
  const [concept, attr, ...examples] = parts;
  for (const node of nodes) {
    if (node.kind !== KIND.DEFAULT || fold(node.name) !== fold(attr)) continue;
    const owner = ownerFrom(node.parent, rootName);
    if (fold(owner.concept) !== fold(concept)) continue;
    if (owner.examples.length !== examples.length) continue;
    if (owner.examples.every((n, i) => fold(n) === fold(examples[i]))) return node;
  }
  return null;
}

// A row rebuilt from its cell texts, keeping whatever stands to the left of
// its first cell — the table's indent, or the padding that IS an empty name
// cell. Widths are not this module's business: the caller re-aligns,
// exactly as every table operation does.
const renderRow = (text, texts) =>
  text.match(/^ */)[0] + texts.join("|");

// The value text on a line-form line: everything after the first colon. The
// colon cannot appear in a name (classify splits on it), so the first one is
// always the right one.
const valueSpan = (text) => {
  const colon = text.indexOf(":");
  return colon === -1 ? null : { colon, value: text.slice(colon + 1).trim() };
};

// Take every '=' derivation out of the values and hand it back addressed.
// Returns { lines, parked: [{ address, formula }] } with lines a fresh array;
// an empty `parked` means there was nothing to take and the caller should
// leave the document alone.
function park(lines, nodes, rootName) {
  const out = lines.slice();
  const found = []; // { line, address, formula } — sorted to document order below

  // the grids: several cells of one row may each carry a formula, so a line
  // is rewritten once with all of its cells settled
  const byLine = new Map();
  for (const [address, where] of cellIndex(lines, nodes, rootName)) {
    const list = byLine.get(where.line) || [];
    list.push({ address, col: where.col });
    byLine.set(where.line, list);
  }
  for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
    const at = line - 1;
    const text = out[at];
    if (text === undefined || !isRow(text)) continue;
    const texts = cells(text).map((c) => c.text);
    let touched = false;
    for (const { address, col } of byLine.get(line).sort((a, b) => a.col - b.col)) {
      if (texts[col] === undefined) continue;
      const split = splitCell(texts[col]);
      if (split.eq === -1) continue;
      found.push({ line, address, formula: texts[col].slice(split.eq).trim() });
      texts[col] = split.value;
      touched = true;
    }
    if (touched) out[at] = renderRow(text, texts);
  }

  // the line form: one value per line, so its node says everything
  for (const node of nodes) {
    if (node.kind !== KIND.DEFAULT || !node.name || node.cell) continue;
    const at = node.line - 1;
    const text = out[at];
    if (text === undefined || isRow(text)) continue;
    const span = valueSpan(text);
    if (!span) continue;
    const split = splitCell(span.value);
    if (split.eq === -1) continue;
    found.push({ line: node.line, address: addressOf(node, rootName), formula: span.value.slice(split.eq).trim() });
    out[at] = text.slice(0, span.colon + 1) + (split.value ? " " + split.value : "");
  }

  // the store reads like the file it came from
  found.sort((a, b) => a.line - b.line);
  return { lines: out, parked: found.map(({ address, formula }) => ({ address, formula })) };
}

// Put them back where they came from. Returns { lines, missing } — missing
// names the addresses that no longer resolve, because the row was renamed or
// deleted while the derivations were parked. Nothing is invented for those:
// they are handed back so the caller can say so and keep them.
function unpark(lines, nodes, rootName, parked) {
  const out = lines.slice();
  const missing = [];
  const index = cellIndex(lines, nodes, rootName);
  // resolve every address first — a grid cell by the grid, a line-form value
  // by its node — then rewrite line by line, so a row carrying two of them is
  // rebuilt once
  const byLine = new Map();
  for (const entry of parked || []) {
    const cell = index.get(entry.address);
    const node = cell ? null : nodeAt(nodes, rootName, entry.address);
    if (!cell && !node) { missing.push(entry.address); continue; }
    const line = cell ? cell.line : node.line;
    const list = byLine.get(line) || [];
    list.push({ col: cell ? cell.col : undefined, formula: entry.formula });
    byLine.set(line, list);
  }
  for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
    const at = line - 1;
    const text = out[at];
    if (text === undefined) continue;
    const group = byLine.get(line);
    if (isRow(text)) {
      const texts = cells(text).map((c) => c.text);
      let touched = false;
      for (const { col, formula } of group) {
        if (col === undefined || texts[col] === undefined) continue;
        const value = splitCell(texts[col]).value;
        texts[col] = (value ? value + " " : "") + formula;
        touched = true;
      }
      if (touched) out[at] = renderRow(text, texts);
      continue;
    }
    const { col, formula } = group[0];
    if (col !== undefined) continue;
    const span = valueSpan(text);
    if (!span) continue;
    const value = splitCell(span.value).value;
    out[at] = text.slice(0, span.colon + 1) + " " + (value ? value + " " : "") + formula;
  }
  return { lines: out, missing };
}

// --- saying which values are not yours to type over --------------------------
// A parked file reads as plain values. That is the point of it, and also the
// one risk it carries: a number a formula owns looks exactly like a number
// somebody typed, so it invites being typed over — and the edit stands only
// until the derivations come home and overwrite it. So the spans those values
// occupy are handed out, and the editor marks them.
//
// The resolution is unpark's, exactly: a grid cell by the grid, a line-form
// value by its node. An address that no longer names anything simply has no
// span — the same silence unpark keeps, for the same reason.

// The value's own columns inside a grid cell. A cell whose derivation
// computed nothing is marked across its whole interior instead: an empty
// cell that is empty *by formula* is the one most worth pointing at.
function cellSpan(text, col) {
  const cell = cells(text)[col];
  if (!cell) return null;
  if (cell.text) return { start: cell.col, end: cell.col + cell.text.length };
  // the pipes divide, so cell k runs from the pipe before it to the pipe
  // after it — the line's own start opening the first, its end closing the
  // last
  const pipes = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "|") pipes.push(i);
  const start = col === 0 ? text.match(/^ */)[0].length : pipes[col - 1] + 1;
  const end = col < pipes.length ? pipes[col] : text.length;
  return end > start ? { start, end } : null;
}

// The value's own columns on a line-form line. With no value written the
// colon stands in for it: something is computed here, and it is not here yet.
function lineSpan(text) {
  const span = valueSpan(text);
  if (!span) return null;
  if (!span.value) return { start: span.colon, end: span.colon + 1 };
  const start = text.indexOf(span.value, span.colon + 1);
  return start === -1 ? null : { start, end: start + span.value.length };
}

// Where each parked derivation's value sits now: [{ line, startCol, endCol,
// address, formula }], in document order. Columns are 0-based, as the editor
// counts them; the line is 1-based, as the parse counts them.
function parkedSpans(lines, nodes, rootName, parked) {
  const out = [];
  const index = cellIndex(lines, nodes, rootName);
  for (const entry of parked || []) {
    const cell = index.get(entry.address);
    const node = cell ? null : nodeAt(nodes, rootName, entry.address);
    if (!cell && !node) continue;
    const line = cell ? cell.line : node.line;
    const text = lines[line - 1];
    if (text === undefined) continue;
    const span = cell ? cellSpan(text, cell.col) : lineSpan(text);
    if (!span || span.end <= span.start) continue;
    out.push({ line, startCol: span.start, endCol: span.end, address: entry.address, formula: entry.formula });
  }
  return out.sort((a, b) => (a.line - b.line) || (a.startCol - b.startCol));
}

// --- the store ---------------------------------------------------------------
// One line per derivation, written exactly as it reads in the file:
//
//     @Invoice@vat@INV-1: =@price*@tax rate
//
// The leading notice is not decoration. A file whose derivations are parked
// looks, to anything that does not know about this store, like a file of
// plain values — which is precisely what it is, and what makes parking safe.
// Whoever finds this file needs to be told where it belongs.

const NOTICE = [
  "// Derivations parked out of the data by AOT (Ctrl+`).",
  "// The values they computed are already written in the .aot, which still",
  "// verifies on its own; nothing here is read by the linter. Toggle again",
  "// in the editor to put them back. Commit this beside the .aot.",
  "",
];

const serialise = (parked) =>
  NOTICE.concat((parked || []).map((p) => `${p.address}: ${p.formula}`)).join("\n") + "\n";

function parse(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || !line.startsWith("@")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const address = line.slice(0, colon).trim();
    const formula = line.slice(colon + 1).trim();
    if (address.length > 1 && formula) out.push({ address, formula });
  }
  return out;
}

module.exports = { park, unpark, parkedSpans, addressOf, nodeAt, serialise, parse, NOTICE };
