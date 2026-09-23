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
// The constraints go with them. A bound (`age >=18`) or a definition
// (`vat ==@price*0.2`) on an attribute declaration is written once, but it
// is written *on the name* — in a header cell it widens the column's title
// exactly as a formula widens its cells — so a file read for its data is
// clearer without it. Unlike a derivation, though, a bound computes nothing
// that could be written in its place: taking it out of the file would
// silently switch it off. So a parked constraint is **still enforced** — the
// editor and verify.js read it back out of the store (parkedConstraints) and
// hold every value to it exactly as when it stood on the declaration. A
// parked `==` definition keeps its values frozen, as a parked `=` does; a
// value it no longer matches is reported, and recomputes once it is home.
//
// A stored entry says which it is by how it opens: a derivation with one
// '=', a constraint with its operator — `==`, `<=`, `>=`, `<` or `>`.
//
// Pure: no I/O, no vscode. Shared by the extension and anything that wants to
// park from the command line.

const { KIND } = require("./linter");
const {
  cells, blockAt, isRowText, splitCell, splitConstraint, columnTerm, cleanName, numberless,
} = require("./table");

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

// The header cell's column name, minus its constraint and its (alias) —
// the attribute the column declares. The constraint must go: a column's
// constraint parks now, so an address that carried it would name a column
// that no longer exists by the time the derivation comes home.
const columnName = (cell) => columnTerm(cell || "");

// A stored entry that is a constraint rather than a derivation.
const isConstraintEntry = (formula) => /^(==|<=|>=|<|>)/.test(String(formula || "").trim());

// Every addressable data cell of every grid: address -> { line, col }.
//
// Grids are read from the text rather than from the tree because a cell
// holding **only** a formula sets no value, so the tree has no node for it —
// and those are exactly the cells worth parking. The row's Example *is* a
// node, though, so the Example path (and the Concept above it) still comes
// from the tree, which is what gets a table filed under an Example right.
//
// `legacy` also answers the addresses a store written before constraints
// parked may hold — a constrained column's name with its constraint still
// on it — so such a store still comes home.
function cellIndex(lines, nodes, rootName, legacy) {
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
          const old = cleanName(header[c] || "");
          if (legacy && old && old !== attr) {
            const key = join(concept, old, examples);
            if (!index.has(key)) index.set(key, { line, col: c });
          }
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

// The attribute declaration an address names, or null — nodeAt's twin for a
// parked constraint, which belongs to the declaration rather than to a value.
function declAt(nodes, rootName, address) {
  const parts = String(address).split("@").slice(1).map((s) => s.trim());
  if (parts.length < 2) return null;
  const [concept, attr, ...examples] = parts;
  for (const node of nodes) {
    if (node.kind !== KIND.ATTRIBUTE || fold(node.name) !== fold(attr)) continue;
    const owner = ownerFrom(node.parent, rootName);
    if (fold(owner.concept) !== fold(concept)) continue;
    if (owner.examples.length !== examples.length) continue;
    if (owner.examples.every((n, i) => fold(n) === fold(examples[i]))) return node;
  }
  return null;
}

// Where a declaration's term stands on its line — the header cell's text,
// or a bare attribute line's term up to any constraint still written on it
// — as { k (the header cell's index, or -1), start, end }. null when the
// line no longer holds it.
function declSpan(text, node) {
  if (node.cell) {
    const cs = cells(text);
    const k = cs.findIndex((c) => c.col === node.nameCol);
    if (k < 1) return null;
    return { k, start: cs[k].col, end: cs[k].col + cs[k].text.length };
  }
  const start = text.length - text.trimStart().length;
  const con = splitConstraint(text.trim());
  const term = con.eq === -1 ? text.trim() : con.value;
  return term ? { k: -1, start, end: start + term.length } : null;
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

  // the constraints, on the declarations: a header line may carry several,
  // so it is rewritten once with all of its cells settled; a bare attribute
  // line carries its chain after the term. Header lines are never data rows,
  // so the grid pass above left them as they stood.
  const declsByLine = new Map();
  for (const node of nodes) {
    if (node.kind !== KIND.ATTRIBUTE || !node.constraints || !node.constraints.length) continue;
    const list = declsByLine.get(node.line) || [];
    list.push(node);
    declsByLine.set(node.line, list);
  }
  for (const line of [...declsByLine.keys()].sort((a, b) => a - b)) {
    const at = line - 1;
    const text = out[at];
    if (text === undefined) continue;
    const decls = declsByLine.get(line);
    if (isRow(text)) {
      const texts = cells(text).map((c) => c.text);
      let touched = false;
      for (const node of decls) {
        const where = node.cell ? declSpan(text, node) : null;
        if (!where) continue;
        const con = splitConstraint(texts[where.k]);
        if (con.eq === -1) continue;
        found.push({ line, address: addressOf(node, rootName), formula: texts[where.k].slice(con.eq).trim() });
        texts[where.k] = con.value;
        touched = true;
      }
      if (touched) out[at] = renderRow(text, texts);
      continue;
    }
    const node = decls.find((n) => !n.cell);
    if (!node) continue;
    const opCol = node.constraints[0].opCol;
    if (opCol === undefined || opCol >= text.length) continue;
    found.push({ line, address: addressOf(node, rootName), formula: text.slice(opCol).trim() });
    out[at] = text.slice(0, opCol).trimEnd();
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
  const index = cellIndex(lines, nodes, rootName, true);
  // resolve every address first — a grid cell by the grid, a line-form value
  // by its node — then rewrite line by line, so a row carrying two of them is
  // rebuilt once. A constraint goes back on its declaration, after the term:
  // a header line may take several, a bare attribute line its one chain.
  const byLine = new Map();
  const declsByLine = new Map();
  for (const entry of parked || []) {
    if (isConstraintEntry(entry.formula)) {
      const decl = declAt(nodes, rootName, entry.address);
      if (!decl) { missing.push(entry.address); continue; }
      const list = declsByLine.get(decl.line) || [];
      list.push({ node: decl, formula: entry.formula, address: entry.address });
      declsByLine.set(decl.line, list);
      continue;
    }
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
  for (const line of [...declsByLine.keys()].sort((a, b) => a - b)) {
    const at = line - 1;
    const text = out[at];
    if (text === undefined) continue;
    const group = declsByLine.get(line);
    if (isRow(text)) {
      const texts = cells(text).map((c) => c.text);
      let touched = false;
      for (const { node, formula, address } of group) {
        const where = node.cell ? declSpan(text, node) : null;
        if (!where) { missing.push(address); continue; }
        texts[where.k] = `${texts[where.k]} ${formula}`;
        touched = true;
      }
      if (touched) out[at] = renderRow(text, texts);
      continue;
    }
    out[at] = [text.trimEnd(), ...group.map((g) => g.formula)].join(" ");
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
// address, formula, constraint }], in document order. Columns are 0-based, as
// the editor counts them; the line is 1-based, as the parse counts them. A
// parked constraint marks its declaration's term instead — the name it was
// written on — and says so (constraint: true).
function parkedSpans(lines, nodes, rootName, parked) {
  const out = [];
  const index = cellIndex(lines, nodes, rootName, true);
  for (const entry of parked || []) {
    if (isConstraintEntry(entry.formula)) {
      const decl = declAt(nodes, rootName, entry.address);
      const text = decl ? lines[decl.line - 1] : undefined;
      const span = text === undefined ? null : declSpan(text, decl);
      if (!span || span.end <= span.start) continue;
      out.push({
        line: decl.line, startCol: span.start, endCol: span.end,
        address: entry.address, formula: entry.formula, constraint: true,
      });
      continue;
    }
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
// One line per derivation or constraint, written exactly as it reads in the
// file:
//
//     @Invoice@vat@INV-1: =@price*@tax rate
//     @Person@age: >=18 <=65
//
// The leading notice is not decoration. A file whose derivations are parked
// looks, to anything that does not know about this store, like a file of
// plain values — which is precisely what it is, and what makes parking safe.
// Whoever finds this file needs to be told where it belongs.

const NOTICE = [
  "// Derivations and constraints parked out of the data by AOT (Ctrl+Shift+`).",
  "// The values the derivations computed are already written in the .aot;",
  "// the constraints are still checked from here by the editor and verify.js.",
  "// Toggle again in the editor to put them back. Commit this beside the .aot.",
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

// The constraints the store holds, handed back to the declarations they
// were taken from: a Map of attribute node -> [{ op, formula }], the shape
// the linter gives a written chain — what still bounds a value while its
// constraint is parked (derive.auditValues). An entry that names nothing
// any more bounds nothing: unpark reports it, and this stays silent, as the
// marks do.
function parkedConstraints(nodes, rootName, parked) {
  const out = new Map();
  for (const entry of parked || []) {
    if (!isConstraintEntry(entry.formula)) continue;
    const decl = declAt(nodes, rootName, entry.address);
    if (!decl) continue;
    const chain = splitConstraint("_ " + entry.formula).constraints
      .map((c) => ({ op: c.op, formula: c.formula }));
    if (chain.length) out.set(decl, (out.get(decl) || []).concat(chain));
  }
  return out;
}

module.exports = {
  park, unpark, parkedSpans, parkedConstraints, addressOf, nodeAt, declAt, isConstraintEntry,
  serialise, parse, NOTICE,
};
