// Derivations on line-form attribute values, and the constraints on the
// attributes — where they stand and what they reach, for the Python that
// computes and checks them (python.js):
//
//     Order
//         total: 30 =sum(r["price"] for r in @Order)   <- a line-form derivation
//         cap <=100                   <- bounds every 'cap' value beneath
//         - A
//             price: 10
//             vat: 2 =@price*0.2      <- @name is a sibling attribute
//             cap: 2                  <- held to 'cap <=100' when Python runs
//         - B
//             price: 20
//             copy: 10 =@price@A      <- @attr@Example reads the named sibling
//
// Reference semantics: `@attribute name` is the same owner's attribute
// (longest case-insensitive match, aliases included); `@attr@Example` reads
// the named sibling Example's value; a name that is a Concept reaches that
// Concept. References are name-only — a digits lead can name an Example
// ('- 35'), never a column position. A constraint's references resolve per
// value, against that value's own Example or row — so `total >=@price` holds
// each row's total to its own price.
//
// Pure: parse once (linter.js), read over the shared tree. Nothing here
// evaluates anything. Used by the VS Code extension and python.js; requiring
// linter.js here is safe (linter never requires this).

const { KIND, INDENT } = require("./linter");
const {
  splitCell, splitConstraint, longestMatch,
  tablesOf, updateTable, readValue, writtenValue, render, isRowText,
  numberless, columnTerm, defaultColon, parentHeader, parentsOf,
  parentColumnOf: headerParentColumn,
  blockAt, cells, colAt, cellStart, dividers,
} = require("./table");
const { typeDefaultOf } = require("./crosslinks");

// The `==` bound on an attribute declaration — the one that *defines* every
// value of the attribute rather than bounding it, when what it computes is
// one value. Answers the bound's source, or null when the declaration
// carries no `==`. Whether the bound names one value is only known once it
// runs (`==("draft", "sent")` answers a collection, which lists allowed
// values rather than naming one), so the run checks; this finds the clause.
function definitionOf(a) {
  const eq = a && a.constraints && a.constraints.find((c) => c.op === "==");
  return eq ? eq.formula : null;
}

// The line-form derivation hosts: DEFAULT nodes whose parsed value carried
// an operator (linter.js strips it onto node.formula / node.op).
const hostsOf = (nodes) =>
  nodes.filter((n) => n.kind === KIND.DEFAULT && !n.cell && n.formula !== undefined);

// The Examples a host's aggregates range over: the other Examples under
// the same parent when the host's owner is an Example; a Concept's own
// default ranges over the Concept's Examples.
function scopeOf(d) {
  if (d.parent && d.parent.kind === KIND.INDIVIDUAL) {
    const pool = d.parent.parent ? d.parent.parent.children : [];
    return { host: d.parent, examples: pool.filter((c) => c.kind === KIND.INDIVIDUAL) };
  }
  const pool = d.parent ? d.parent.children : [];
  return { host: null, examples: pool.filter((c) => c.kind === KIND.INDIVIDUAL) };
}

// The @-reference names available to a line-form value on `line` (1-based):
// the sibling attribute names (columns) and the sibling Example names
// (rows), for completion. null when the line is not a line-form attribute.
function referencesAt(nodes, line) {
  const d = nodes.find((n) => n.line === line && (n.kind === KIND.DEFAULT || n.kind === KIND.ATTRIBUTE) && !n.cell);
  if (!d || !d.parent) return null;
  const { examples } = scopeOf(d);
  const columns = new Set();
  const addAttrs = (owner) => owner.children.forEach((c) => {
    if ((c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE) && c.name && c !== d) columns.add(c.name);
  });
  addAttrs(d.parent);
  for (const ex of examples) addAttrs(ex);
  return { columns: [...columns], rows: examples.map((e) => e.name) };
}

// The kind an Example inherits from: the nearest node above it that is not
// itself an Example. An Example above it — the `- Parent` of a `- Child`, the
// row a nested row sits under — is the whole it is a part of, and a part
// inherits nothing from its whole.
function kindAbove(node) {
  let k = node ? node.parent : null;
  while (k && k.kind === KIND.INDIVIDUAL) k = k.parent;
  return k || null;
}

// The evaluation context for one host. `current` maps a DEFAULT node to
// its value-in-progress, so the recompute fixpoint sees fresh values.
// `registry` (optional) lets a line-form formula reach a foreign table's
// cell/column by name, exactly as a table cell can — `@Order@price@Acme`.
function makeCtx(d, current, registry) {
  const { host, examples } = scopeOf(d);
  // The Concept the Examples sit under. Its own values are the defaults an
  // Example silent on an attribute inherits, so a formula (or a `==`
  // definition) on a value under an Example may name them beside its own
  // siblings — `=@price*@tax rate` with `tax rate: 0.2` on the Concept.
  // This is the reading a grid cell already gets through its enclosing
  // scope (table.js's `outer`); the line form answers it the same way. A
  // sub-Example's kind is the Concept above the Examples it sits under,
  // never the Example it sits under (kindAbove).
  const owner = d.parent && d.parent.kind === KIND.INDIVIDUAL ? kindAbove(d.parent) : null;
  const names = new Map(); // lowercased key -> canonical attribute id
  const declFor = new Map(); // canonical id -> the nearest declaration, for its type
  const addName = (n) => {
    if (n.kind !== KIND.DEFAULT && n.kind !== KIND.ATTRIBUTE) return;
    const key = n.name.toLowerCase();
    if (!names.has(key)) names.set(key, key);
    if (!declFor.has(key)) declFor.set(key, n);
    if (n.alias) {
      const a = n.alias.toLowerCase();
      if (!names.has(a)) names.set(a, key);
    }
  };
  // The host Example's own sub-Examples are named too, after its siblings
  // (the first of equal names wins, so a sibling keeps a shared name): a
  // value on `- Parent` reads `@Child 1@age` from the Example beneath it.
  const kids = host ? host.children.filter((c) => c.kind === KIND.INDIVIDUAL && !examples.includes(c)) : [];
  (d.parent ? d.parent.children : []).forEach(addName);
  for (const ex of examples) ex.children.forEach(addName);
  if (owner) owner.children.forEach(addName);
  for (const kid of kids) kid.children.forEach(addName);
  const nameCands = [...names.entries()].map(([key, id]) => ({ key, id }));
  const rowCands = [...examples, ...kids].map((ex) => ({ key: ex.name.toLowerCase(), id: ex }));
  // an owner's value for the attribute; undefined when the owner never
  // asserts it, "" when it is declared but (not yet) valued
  const valueOn = (owner, id) => {
    const hit = owner.children.find((c) =>
      (c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE)
      && (c.name.toLowerCase() === id || (c.alias && c.alias.toLowerCase() === id)));
    if (!hit) return undefined;
    return hit.kind === KIND.DEFAULT ? current(hit) : "";
  };
  // the Concept's own value for the attribute — what a silent Example
  // inherits — else the default of the Concept that types the attribute
  const inherited = (id) => (owner ? valueOn(owner, id) : undefined);
  const typed = (id) => {
    const td = typeDefaultOf(declFor.get(id));
    return td ? td.value : undefined;
  };
  const read = (on, id) => {
    let v = valueOn(on, id);
    if (v === undefined || v === "") {
      const own = inherited(id);
      if (own !== undefined && own !== "") return own;
      const fromType = typed(id);
      if (fromType !== undefined) return fromType;
    }
    return v === undefined ? "" : v;
  };
  return {
    matchColumn: (rest) => longestMatch(rest, nameCands),
    matchRow: (rest) => longestMatch(rest, rowCands),
    cell: (c) => (d.parent ? read(d.parent, c) : ""),
    cellAt: (c, ex) => read(ex, c),
    column: (c) =>
      examples.filter((ex) => ex !== host)
        .map((ex) => valueOn(ex, c))
        .filter((v) => v !== undefined),
    // every Example in order, this one included and none dropped — the
    // whole column a lookup ranges over, read as a cell reference reads
    // (an Example silent on the attribute answering the Concept's default),
    // so two columns line up Example for Example
    columnAll: (c) => examples.map((ex) => read(ex, c)),
    matchTable: registry ? (rest) => longestMatch(rest, registry.cands) : undefined,
    table: registry ? (id) => registry.scopes.get(id) : undefined,
  };
}

// A read-only evaluation scope over a Concept: its Examples are the rows —
// whether they arrived as '- ' lines or as a table's data rows, the parsed
// tree holds both the same way — and the attribute names beneath it (its
// own defaults and its Examples') are the columns. The one scope shape the
// registry serves, so `@Integer@35@is prime` reads the way
// `@Order@price@Acme` does: a Concept written line-form and one written as
// a table are the same idea, referenced the same way (unified in 1.6).
//
// An Example that is silent on an attribute answers the Concept's own
// default — the inheritance the tree already means. References are
// name-only, so a numeric part can only name an Example, which is what a
// Concept whose Examples are numbers (`- 1`, `- 35`) needs.
//
// The rows are every Example in the Concept's scope, sub-Examples included,
// depth-first — the rows the CSV mirror writes (scopeRowsOf) — so `@Thing`
// holds `- Child` as well as `- Parent`. Where they nest, the grid carries
// the tree in a `parent` column exactly as the mirror does, so a DataFrame
// and the CSV read the same.
function conceptScope(concept) {
  const examples = scopeRowsOf(concept);
  const names = new Map();   // lowercased name or alias -> canonical id
  const display = new Map(); // canonical id -> the name as written
  const addAttrs = (owner) => {
    for (const c of owner.children) {
      if (c.kind !== KIND.DEFAULT && c.kind !== KIND.ATTRIBUTE) continue;
      const key = c.name.toLowerCase();
      if (!names.has(key)) { names.set(key, key); display.set(key, c.name); }
      if (c.alias && !names.has(c.alias.toLowerCase())) names.set(c.alias.toLowerCase(), key);
    }
  };
  addAttrs(concept);
  for (const ex of examples) addAttrs(ex);
  const tree = parentColumnOf(concept, examples, names);
  // the `parent` column is a column like any other where the scope nests
  if (tree.addParent) names.set(PARENT_COLUMN, PARENT_COLUMN);
  const nameCands = [...names.entries()].map(([key, id]) => ({ key, id }));
  const rowCands = examples.map((ex, r) => ({ key: ex.name.toLowerCase(), id: r }));
  const valueOn = (owner, id) => {
    const hit = owner.children.find((c) =>
      (c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE)
      && (c.name.toLowerCase() === id || (c.alias && c.alias.toLowerCase() === id)));
    return hit && hit.kind === KIND.DEFAULT ? hit.value || "" : undefined;
  };
  // the default of the Concept that types an attribute, read off its first
  // declaration in the scope (`Currency: EUR` for a `currency`)
  const declOf = (id) => {
    for (const owner of [concept, ...examples]) {
      const hit = owner.children.find((c) => (c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE)
        && (c.name.toLowerCase() === id || (c.alias && c.alias.toLowerCase() === id)));
      if (hit) return hit;
    }
    return null;
  };
  const typeDefault = (id) => {
    if (id === PARENT_COLUMN) return undefined;
    const td = typeDefaultOf(declOf(id));
    return td ? td.value : undefined;
  };
  const valueAt = (r, id) => {
    const ex = examples[r];
    if (!ex) throw new Error(`there is no Example @${r} on '${concept.name}'`);
    const own = valueOn(ex, id);
    if (own !== undefined && (own !== "" || id !== PARENT_COLUMN)) return own;
    if (id === PARENT_COLUMN && (tree.addParent || tree.owned)) return tree.parentOf(ex);
    const inherited = valueOn(concept, id); // the Concept's default
    if (inherited !== undefined) return inherited;
    const fromType = typeDefault(id); // the type's
    return fromType === undefined ? "" : fromType;
  };
  return {
    name: concept.name, // original case, for the completion
    node: concept, // the defining node, for the rename that follows a reference
    examples,
    columns: [...display.values()],
    rows: examples.map((ex) => ex.name),
    matchColumn: (rest) => longestMatch(rest, nameCands),
    matchRow: (rest) => longestMatch(rest, rowCands),
    cellAt: (c, r) => valueAt(r, c),
    column: (c) => examples.map((_, r) => valueAt(r, c)),
    // a Concept's aggregates already range over every Example, so a lookup
    // reads the same column — named apart because the local scopes differ
    columnAll: (c) => examples.map((_, r) => valueAt(r, c)),
    // The Concept's *own* value for an attribute — the default it states on
    // its own line — or undefined where it states none. A grid has no such
    // reading (a table is rows and nothing else), which is why only a
    // Concept offers it: `@Measurement@alias` means the value Measurement
    // itself carries, the same one its Examples would inherit.
    self: (c) => valueOn(concept, c),
    // what an Example silent on the attribute reads when the Concept states
    // nothing either: the default of the Concept that types it — the reading
    // a grid's empty cell gets through table.tableCtx's `outer`
    typeDefault,
    // the same Examples as a grid — the first column is headed by the
    // Concept and names its Examples, as the CSV mirror writes a table's,
    // so a line-form Concept mirrors like any other
    grid: () => [
      [concept.name, ...(tree.addParent ? [PARENT_COLUMN] : []), ...display.values()],
      ...examples.map((ex, r) => [
        ex.name,
        ...(tree.addParent ? [tree.parentOf(ex)] : []),
        ...[...display.keys()].map((id) => valueAt(r, id)),
      ]),
    ],
  };
}

// How a scope carries its tree when it is written as a grid: a nested row
// names the row it sits under in a `parent` column — the one shape a CSV (or
// a DataFrame) can hold, since every reader trims the indent away. A row
// directly under the scope's own node is top-level. A scope that already
// states its own `parent` attribute keeps that one column (`owned`), since it
// is the same fact under the same name. { parentOf, nested, owned, addParent }
function parentColumnOf(scopeNode, rows, names) {
  const parentOf = (r) => (r.parent && r.parent !== scopeNode && r.parent.kind === KIND.INDIVIDUAL ? r.parent.name : "");
  const nested = rows.some((r) => parentOf(r) !== "");
  const owned = names.has(PARENT_COLUMN);
  return { parentOf, nested, owned, addParent: nested && !owned };
}

// The scopes one file offers to cross-Concept references: a Map from each
// name (lowercased) to a conceptScope over its node. The one registry both
// notations share — a Concept's Examples are its rows whether they arrived
// as '- ' lines or as a table's data rows, so the parsed tree answers for
// both and a table needs no registry of its own (unified in 1.6).
//
// A Concept is worth registering when it has something to answer with, which
// is either of the two things a Concept can hold: **Examples** (the rows a
// reference reaches with `@Integer@35@is prime`) or **values of its own**
// (the defaults a reference reaches with `@Measurement@alias`). A Concept
// with neither — a bare name, or one holding only sub-Concepts — answers
// nothing, so it stays out. A line of another kind that holds Examples — an
// Example or Attribute a table is filed under ('- test 1' with a grid
// beneath it) — registers too, so `@test 1@…` keeps resolving; a Concept
// wins a shared name.
const answersSomething = (n) => n.children.some((c) =>
  c.kind === KIND.INDIVIDUAL || (c.kind === KIND.DEFAULT && c.value));

function conceptRegistry(root, nodes) {
  const map = new Map();
  const add = (n) => {
    if (!n.name) return;
    const key = n.name.toLowerCase();
    if (map.has(key) || !answersSomething(n)) return;
    const scope = conceptScope(n);
    map.set(key, scope);
    // a numbering prefix (`1. Trip`) is presentation: `@Trip@…` still
    // resolves to the numbered Concept's scope
    const plain = numberless(n.name).toLowerCase();
    if (plain && !map.has(plain)) map.set(plain, scope);
  };
  if (root) add(root);
  for (const n of nodes) if (n.kind === KIND.CONCEPT) add(n);
  for (const n of nodes) {
    if (n.kind !== KIND.CONCEPT && n.children.some((c) => c.kind === KIND.INDIVIDUAL)) add(n);
  }
  return map;
}

// Locate a host's derivation on its raw line: the operator's column span,
// re-derived from the text so the squiggle sits exactly on it.
function spanOf(lines, node) {
  const raw = lines[node.line - 1] || "";
  const colon = raw.indexOf(":");
  if (colon === -1) return null;
  const region = raw.slice(colon + 1);
  const lead = region.length - region.trimStart().length;
  const text = region.trim();
  const split = splitCell(text);
  if (split.eq === -1) return null;
  return {
    raw, colon, lead,
    startCol: colon + 1 + lead + split.eq,
    endCol: colon + 1 + lead + text.length,
    op: split.op,
    formula: text.slice(split.eq + split.op.length).trim(),
    value: split.value,
  };
}

// The attribute declaration whose constraint governs a value: walk the
// value's ancestors and look among each one's children for an ATTRIBUTE
// of the same name (or alias) carrying a constraint — so a bound declared
// on a Concept holds for its Examples, its table's columns hold their
// cells, everything deeper inherits it, and a nearer declaration shadows
// an outer one.
//
// `parked` (optional) is park.parkedConstraints' Map of declaration ->
// [{ op, formula }]: a constraint taken off its declaration into the store
// still bounds the values, so a declaration it names counts as constrained.
// Answers { a, constraints } — the declaration and the chain that holds,
// written clauses first — or null.
function constraintOf(d, parked) {
  const keys = [d.name.toLowerCase()];
  if (d.alias) keys.push(d.alias.toLowerCase());
  for (let p = d.parent; p; p = p.parent) {
    for (const c of p.children) {
      if (c.kind !== KIND.ATTRIBUTE) continue;
      const hidden = parked && parked.get(c);
      if (!c.constraints && !hidden) continue;
      if (keys.includes(c.name.toLowerCase()) || (c.alias && keys.includes(c.alias.toLowerCase()))) {
        return { a: c, constraints: [...(c.constraints || []), ...(hidden || [])] };
      }
    }
  }
  return null;
}

// Where the k-th of an attribute's constraints sits on its declaring line:
// from its operator to the next chained bound, else to the end of the term
// (a header cell ends at its pipe, a bare line at its end).
function constraintSpanOf(lines, a, k) {
  const raw = lines[a.line - 1] || "";
  const startCol = a.constraints[k].opCol;
  let end = k + 1 < a.constraints.length ? a.constraints[k + 1].opCol
    : a.cell ? raw.indexOf("|", startCol) : -1;
  if (end === -1) end = raw.length;
  while (end > startCol && raw[end - 1] === " ") end--;
  return { startCol, endCol: end };
}

// Where a value sits on its raw line: a table cell knows its column, a
// 'name: value' line finds its value after the colon.
function valueSpanOf(lines, d) {
  if (d.valueCol !== undefined) return { startCol: d.valueCol, endCol: d.valueCol + d.value.length };
  const raw = lines[d.line - 1] || "";
  const colon = raw.indexOf(":");
  if (colon === -1) return null;
  const after = raw.slice(colon + 1);
  const start = colon + 1 + (after.length - after.trimStart().length);
  return { startCol: start, endCol: start + d.value.length };
}

// Where every line-form derivation and every constraint stands: a
// derivation's span from its '=' to its end, and each bound's span on its
// declaration — for the colouring, for keeping spelling out of code, and for
// the editor's notes on them. Nothing is evaluated here: a derivation and a
// bound are both Python, run only when asked (python.js).
function derivationSpans(root, nodes, lines) {
  const out = [];
  for (const d of hostsOf(nodes)) {
    const s = spanOf(lines, d);
    if (!s) continue;
    out.push({ line: d.line, startCol: s.startCol, endCol: s.endCol, op: s.op, formula: s.formula, value: s.value });
  }
  for (const a of nodes) {
    if (a.kind !== KIND.ATTRIBUTE || !a.constraints) continue;
    a.constraints.forEach((con, k) => {
      const s = constraintSpanOf(lines, a, k);
      out.push({ line: a.line, startCol: s.startCol, endCol: s.endCol, op: con.op, formula: con.formula, constraint: true });
    });
  }
  return out;
}

// The last line a node's subtree occupies, so an insertion lands after it.
function lastLineOf(node) {
  let last = node.line;
  for (const c of node.children) last = Math.max(last, lastLineOf(c));
  return last;
}

// Copy the derivation at lines[lineIdx] onto the same attribute of every
// sibling Example — replacing what the attribute held, adding an
// `attr: =formula` line where it is absent. A copy holds no value until the
// next run computes one for its own Example.
// Returns [{ type: "replace", line, text } | { type: "insert", afterLine,
// text }] (1-based lines), or null when there is nothing to copy to.
function copyToSiblings(root, nodes, lines, lineIdx) {
  const d = hostsOf(nodes).find((n) => n.line === lineIdx + 1);
  if (!d || !d.parent || d.parent.kind !== KIND.INDIVIDUAL) return null;
  const { host, examples } = scopeOf(d);
  const peers = examples.filter((ex) => ex !== host);
  if (!peers.length) return null;
  const id = d.name.toLowerCase();
  const ops = [];
  for (const peer of peers) {
    const hit = peer.children.find((c) => c.kind === KIND.DEFAULT && !c.cell
      && (c.name.toLowerCase() === id || (c.alias && c.alias.toLowerCase() === id)));
    if (hit) {
      if (hit.formula === d.formula && hit.op === d.op) continue;
      const raw = lines[hit.line - 1];
      const colon = raw.indexOf(":");
      if (colon === -1) continue;
      ops.push({ type: "replace", line: hit.line, text: raw.slice(0, colon + 1) + " " + d.op + d.formula });
    } else if (!peer.children.some((c) => c.name && c.name.toLowerCase() === id)) {
      ops.push({
        type: "insert", afterLine: lastLineOf(peer),
        text: " ".repeat(INDENT * (peer.depth + 1)) + `${d.name}: ${d.op}${d.formula}`,
      });
    }
  }
  return ops.length ? ops : null;
}

// The edit that lists `value` as an Example of `concept`: a row appended to
// the Concept's table when it has one, otherwise a `- value` line after its
// last Example. The Example lands in the shape the Concept is already
// written in, so the writer never has to translate between the two forms —
// the rest of a new row (and any attribute of a new `- Example`) is theirs
// to fill in.
//
// Returns { changed, from, to, block } — lines from..to (inclusive, 0-based)
// become `block`, and to < from is a pure insert before `from`: the shape
// table.updateTable already returns. null when no line defines the Concept.
function addExample(root, nodes, lines, concept, value, rootName, registry) {
  const grid = tablesOf(lines, rootName)
    .find((t) => t.name.toLowerCase() === concept.name.toLowerCase());
  if (grid) {
    const row = grid.header.map((_, k) => (k === 0 ? value : ""));
    return updateTable(lines, grid.name, grid.header, [...grid.rows, row], rootName, registry);
  }
  const examples = concept.children.filter((c) => c.kind === KIND.INDIVIDUAL);
  // after the last Example's whole subtree, so the new one is a sibling of
  // the others and not a child of the last one's deepest attribute
  const last = examples.length ? examples[examples.length - 1]
    : concept.children[concept.children.length - 1];
  const after = last ? lastLineOf(last) : concept.line;
  if (!after) return null;
  return {
    changed: true,
    from: after, to: after - 1, // a pure insert on the line below
    block: [" ".repeat(INDENT * (concept.depth + 1)) + `- ${value}`],
  };
}

// Fold a grid's rows into a Concept's line-form Examples, merging by name:
// an Example already there is updated attribute by attribute, one that is
// not is appended whole. The Concept keeps the form it was written in — a
// CSV arriving is data, and data is no reason to restructure somebody's
// tree into a table.
//
// The grid's first column names the Example and the rest are attribute
// names, exactly as the CSV mirror writes a table's. Two things the grid is
// never allowed to do: a blank cell says nothing (it does not erase — the
// CSV simply has no way to distinguish "empty" from "unsaid"), and a value
// that carries a formula is left to its formula, which owns it.
//
// Returns [{ type: "replace", line, text } | { type: "insert", afterLine,
// text }] with 1-based lines, [] when the grid changes nothing. Apply them
// in **descending line order**, so no edit shifts the lines under another.
// At most one op ever targets a given line, so that order is all a caller
// has to get right.
// A value as the file writes it: an `=` that would open a derivation
// doubled, `==` — the reader never sees the doubling (readValue).
const asWritten = (v) => writtenValue(v);
// Two written spellings of one value — escaped either way, a pipe or the
// broken bar the mirror bends one to — so a round trip through a CSV
// rewrites nothing. Both sides must be as the file writes them: reading is
// not idempotent (`a == b` reads 'a = b', which would read on as itself), so
// a value the model already read goes in through writtenValue.
const sameValue = (a, b) =>
  readValue(String(a == null ? "" : a)).replace(/¦/g, "|") === readValue(String(b == null ? "" : b)).replace(/¦/g, "|");

// What an Example silent on an attribute reads in the mirror: the nearest
// default stated by one of its kinds, up to the Concept whose scope it is in
// (an Example above it is a whole, which lends its parts nothing), else the
// default of the Concept that types the attribute. undefined when nothing
// is in force — the reading mirrorGrids writes into a silent row's cell.
function inheritedValue(ex, key, concept) {
  const match = (c) => isAttrKind(c) && !c.cell
    && (c.name.toLowerCase() === key || (c.alias && c.alias.toLowerCase() === key));
  let decl = ex.children.find((c) => isAttrKind(c) && (c.name.toLowerCase() === key || (c.alias && c.alias.toLowerCase() === key))) || null;
  for (let p = ex.parent; p; p = p.parent) {
    if (p.kind !== KIND.INDIVIDUAL) {
      const hit = p.children.find((c) => c.kind === KIND.DEFAULT && match(c));
      if (hit) return hit.value || "";
      if (!decl) decl = p.children.find(match) || null;
    }
    if (p === concept) break;
  }
  const td = typeDefaultOf(decl);
  return td ? String(td.value) : undefined;
}

function updateExamples(lines, concept, header, rows) {
  const attrs = header.slice(1);
  const levelOf = (depth) => " ".repeat(INDENT * Math.max(0, depth));
  // every Example written as lines in the Concept's scope, sub-Examples
  // too — a CSV row names one wherever it is filed (a table's rows are its
  // table's to update)
  const examples = scopeRowsOf(concept).filter((c) => c.nameCol === undefined);
  const byName = new Map();
  for (const e of examples) if (!byName.has(e.name.toLowerCase())) byName.set(e.name.toLowerCase(), e);
  // the mirror's `parent` column is the tree, not an attribute — unless the
  // scope states a `parent` of its own, whose column it then is
  const owned = [concept, ...examples].some((o) => o.children.some((c) => isAttrKind(c) && c.name.toLowerCase() === PARENT_COLUMN));
  const pk = owned ? -1 : attrs.findIndex((a) => String(a || "").trim().toLowerCase() === PARENT_COLUMN);
  const ops = [];
  // fresh Examples: { name, depth, under (the written Example they go
  // under, or null for the Concept's own), lines } in the order written
  const fresh = [];
  for (const row of rows) {
    const name = (row[0] || "").trim();
    if (!name) continue;
    const ex = byName.get(name.toLowerCase());
    if (!ex) {
      // a new Example goes under the one its parent cell names: written
      // here already, or arriving in the same CSV ahead of it
      const parentName = pk === -1 ? "" : (row[pk + 1] || "").trim().toLowerCase();
      const under = parentName ? byName.get(parentName) || null : null;
      const before = !under && parentName ? fresh.find((f) => f.name.toLowerCase() === parentName) : null;
      const depth = under ? under.depth + 1 : before ? before.depth + 1 : concept.depth + 1;
      const entry = { name, depth, under: under || (before ? before.under : null), lines: [levelOf(depth) + `- ${name}`] };
      attrs.forEach((a, k) => {
        if (k === pk) return;
        const v = (row[k + 1] || "").trim();
        if (v) entry.lines.push(levelOf(depth + 1) + `${a}: ${v}`);
      });
      if (before) {
        // after the fresh parent and everything already filed under it
        let at = fresh.indexOf(before) + 1;
        while (at < fresh.length && fresh[at].under === before.under && fresh[at].depth > before.depth) at++;
        fresh.splice(at, 0, entry);
      } else fresh.push(entry);
      continue;
    }
    const missing = [];
    const ownIndent = levelOf(ex.depth + 1);
    attrs.forEach((a, k) => {
      if (k === pk) return; // where it is filed is not a value of it
      const v = (row[k + 1] || "").trim();
      if (!v) return;
      const key = a.toLowerCase();
      const hit = ex.children.find((c) =>
        (c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE)
        && (c.name.toLowerCase() === key || (c.alias && c.alias.toLowerCase() === key)));
      // a value the Example already reads, from a default, is no news: the
      // mirror shows it, and writing it down would make it the Example's own
      const inherited = inheritedValue(ex, key, concept);
      if ((!hit || hit.kind === KIND.ATTRIBUTE) && inherited !== undefined && sameValue(writtenValue(inherited), v)) return;
      if (!hit) { missing.push(ownIndent + `${a}: ${v}`); return; }
      if (hit.formula !== undefined || sameValue(writtenValue(hit.value), v)) return;
      const raw = lines[hit.line - 1] || "";
      const colon = raw.indexOf(":");
      if (colon === -1) return;
      ops.push({ type: "replace", line: hit.line, text: raw.slice(0, colon + 1) + " " + v });
    });
    if (missing.length) ops.push({ type: "insert", afterLine: lastLineOf(ex), text: missing.join("\n") });
  }
  // the fresh ones under a written Example go after its whole subtree; the
  // rest after the last of the Concept's own Examples, so they are siblings
  // of the others and not children of the last one's deepest attribute
  const groups = new Map(); // the Example they go under (null: the Concept) -> lines
  for (const f of fresh) {
    if (!groups.has(f.under)) groups.set(f.under, []);
    groups.get(f.under).push(...f.lines);
  }
  for (const [under, text] of groups) {
    if (!under) continue;
    ops.push({ type: "insert", afterLine: lastLineOf(under), text: text.join("\n") });
  }
  if (groups.has(null)) {
    const own = concept.children.filter((c) => c.kind === KIND.INDIVIDUAL);
    const last = own.length ? own[own.length - 1] : concept.children[concept.children.length - 1];
    ops.push({ type: "insert", afterLine: last ? lastLineOf(last) : concept.line, text: groups.get(null).join("\n") });
  }
  // Two inserts after the same line would fight. It happens whenever the
  // *last* Example gains an attribute and a fresh Example is appended too:
  // both land after that Example's last line, and applied bottom-up they
  // arrive in the reverse of the order they were built — the attribute
  // meant for the last Example would end up under the fresh one. Merge them
  // into a single op instead, in build order, so no caller's sort can get
  // this wrong.
  const merged = [];
  const insertAt = new Map(); // afterLine -> the op collecting that line's text
  for (const op of ops) {
    if (op.type !== "insert") { merged.push(op); continue; }
    const collecting = insertAt.get(op.afterLine);
    if (collecting) { collecting.text += "\n" + op.text; continue; }
    const own = { ...op };
    insertAt.set(op.afterLine, own);
    merged.push(own);
  }
  return merged;
}

// Numbered Examples stay numbered in listed order: once any Example under a
// Concept starts `N. `, every sibling takes the sequential prefix — the
// first `1. <name>`, the second `2. <name>` — unnumbered names gaining a
// number and stale numbers corrected. Returns [{ node, newName }] for the
// names that change ([] when the numbering is already true), or null when
// no Example under the Concept is numbered: the first `N. ` a writer types
// is the opt-in, so unnumbered lists stay untouched.
function renumberExamples(concept) {
  const NUMBERED = /^\d+\.\s+/;
  const exs = concept.children.filter((c) => c.kind === KIND.INDIVIDUAL);
  if (!exs.length || !exs.some((c) => NUMBERED.test(c.name))) return null;
  const out = [];
  exs.forEach((ex, i) => {
    const newName = `${i + 1}. ${ex.name.replace(NUMBERED, "")}`;
    if (newName !== ex.name) out.push({ node: ex, newName });
  });
  return out;
}

// Concept numbering: the moment one Concept name starts `1. `, every
// Concept in its scope numbers sequentially in document order — the top
// Concepts `1. `, `2. `, a sub-Concept `1.1 `, its child `1.1.1 ` — and
// numbering descends only concept-to-concept (is-a). The scope is the
// numbered Concept's nearest non-Concept ancestor: the whole file
// normally, or just the Example/attribute the Concepts are filed under.
// The way in is one `1. ` typed anywhere in the scope; the way out is one
// number deleted — the rest of the scope's numbers (parents' included)
// then come off. A scope that is fully numbered keeps its numbers true to
// position, so moves re-number. Returns [{ node, newName }] ([] when
// nothing changes). Numbering is presentation: resolution strips it
// (numberless), so references never break.
function renumberConcepts(root, nodes) {
  const isNumbered = (n) => numberless(n.name) !== n.name;
  const isConcept = (n) => n.kind === KIND.CONCEPT;
  const scopeRootOf = (c) => {
    let p = c.parent;
    while (p && p.kind === KIND.CONCEPT && p.parent) p = p.parent;
    return p || root;
  };
  const numbered = new Set();
  const scopes = new Set();
  for (const n of nodes) {
    if (isConcept(n) && isNumbered(n)) {
      numbered.add(n);
      scopes.add(scopeRootOf(n));
    }
  }
  const out = [];
  for (const scope of scopes) {
    const expected = [];
    const collect = (parent) => {
      for (const c of parent.children) {
        if (!isConcept(c)) continue;
        expected.push(c);
        collect(c);
      }
    };
    collect(scope);
    if (!expected.length) continue;
    const have = expected.filter((c) => numbered.has(c));
    const bare = (c) => numberless(c.name);
    // fully numbered stays numbered (kept true to position); one fresh
    // `1. ` opts the scope in; anything else means a number was deleted,
    // and the whole scope's numbering comes off
    const optIn = have.length === expected.length
      || (have.length === 1 && /^1\.\s/.test(have[0].name));
    if (optIn) {
      const walk = (parent, path) => {
        let i = 0;
        for (const c of parent.children) {
          if (!isConcept(c)) continue;
          i++;
          const p = [...path, i];
          const newName = (p.length === 1 ? `${p[0]}. ` : `${p.join(".")} `) + bare(c);
          if (newName !== c.name) out.push({ node: c, newName });
          walk(c, p);
        }
      };
      walk(scope, []);
    } else {
      for (const c of have) out.push({ node: c, newName: bare(c) });
    }
  }
  return out;
}

// --- the union CSV mirror ---------------------------------------------------
// One CSV per Concept, both notations together: the grid a Concept mirrors
// holds every Example in its *scope* — the subtree above any deeper Concept,
// so a table filed under an Example ('- test 1') mirrors into the first
// Concept up the tree — and the union of every attribute those Examples and
// the Concept carry. A row silent on a column answers the nearest enclosing
// default, else empty; different Examples carrying different attributes all
// fit, blank where undefined.

const isAttrKind = (c) => c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE;

// The first Concept up the tree from a node (the root when none nearer).
function nearestConcept(n, root) {
  for (let p = n.parent; p; p = p.parent) if (p.kind === KIND.CONCEPT) return p;
  return root;
}

// A header cell's column name: the term minus its default, its constraint
// and its (alias) — table.columnTerm, the one reading every grid uses.
const headerColName = (cell) => columnTerm(cell);

// The Examples in a Concept's scope, document order: every INDIVIDUAL in
// its subtree that no deeper Concept claims — and that no attribute claims.
//
// An Example written under an attribute is an Example *of that attribute*:
// the values `status` is allowed to take, the operations a `measurement
// operation used` ranges over. It is not another Example of the Concept, so
// it is no row of the Concept's CSV — mirroring `Invoice` must not put
// 'draft' and 'sent' beside 'INV-1' as if they were invoices. The walk
// therefore stops at an attribute rather than descending through it, which
// also drops the Examples nested further under those (an allowed value's own
// refinements belong to the attribute too).
function scopeRowsOf(concept) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (c.kind === KIND.CONCEPT || isAttrKind(c)) continue;
      if (c.kind === KIND.INDIVIDUAL) out.push(c);
      walk(c);
    }
  };
  walk(concept);
  return out;
}

// One union grid per Concept: { name, node, header, rows }. Every Concept
// with Examples grids the same way — a table, a '- ' list, or both are one
// idea in two spellings, so the mirror never asks which one wrote the rows.
// The column a nested scope's CSV carries its shape in. Lowercase, like
// every column: it is an attribute of the Example, naming the Example it
// sits under.
const PARENT_COLUMN = "parent";

function mirrorGrids(root, nodes) {
  const out = [];
  for (const concept of [root, ...nodes].filter((n) => n && n.kind === KIND.CONCEPT)) {
    const scopeRows = scopeRowsOf(concept);
    const names = new Map(); // lowercased -> the name as first written
    const addNames = (owner) => {
      for (const c of owner.children) {
        if (!isAttrKind(c) || !c.name) continue;
        const k = c.name.toLowerCase();
        if (!names.has(k)) names.set(k, c.name);
      }
    };
    addNames(concept);
    for (const r of scopeRows) addNames(r);
    // a row silent on a column answers the nearest enclosing default — of
    // its kinds: an Example above it is the whole it is a part of, and a
    // part inherits nothing from its whole, written as lines or as a row. A
    // bare attribute on the row names no value, so the default still holds
    // there, as it does for the Gödel number, the FCA context and @Concept.
    const valueAt = (r, key) => {
      const match = (c) => isAttrKind(c)
        && (c.name.toLowerCase() === key || (c.alias && c.alias.toLowerCase() === key));
      const own = r.children.find((c) => c.kind === KIND.DEFAULT && match(c));
      if (own) return own.value || "";
      let decl = r.children.find(match) || null;
      for (let p = r.parent; p; p = p.parent) {
        if (p.kind !== KIND.INDIVIDUAL) {
          const hit = p.children.find((c) => c.kind === KIND.DEFAULT && !c.cell && match(c));
          if (hit) return hit.value || "";
          if (!decl) decl = p.children.find(match) || null;
        }
        if (p === concept) break;
      }
      // nothing in force states it: the default of the Concept that types it
      const td = key === PARENT_COLUMN ? null : typeDefaultOf(decl);
      return td ? String(td.value) : "";
    };
    // A nested Example is written as a row indented under its parent row,
    // and no CSV can hold that: every reader of a CSV trims its cells, so
    // the indent would not survive the trip out to a spreadsheet and back.
    // The shape travels as a column instead — `parent`, naming the row this
    // one sits under, empty for a top-level row — which a spreadsheet
    // cannot damage. A flat scope has no such rows and gains no column, so
    // its CSV is exactly the file it always was.
    // (a Concept that already states its own `parent` attribute keeps that
    // one column: it is the same fact under the same name, not a second)
    const { owned, addParent, parentOf } = parentColumnOf(concept, scopeRows, names);
    out.push({
      name: concept.name,
      node: concept,
      // the first column is headed by the Concept (1.9) and names its
      // Examples, mirroring the table's own `Concept|attr…` header
      header: [concept.name, ...(addParent ? [PARENT_COLUMN] : []), ...names.values()],
      rows: scopeRows.map((r) => [
        r.name,
        ...(addParent ? [parentOf(r)] : []),
        ...[...names.keys()].map((k) => (k === PARENT_COLUMN && owned && !valueAt(r, k)
          ? parentOf(r)
          : valueAt(r, k))),
      ]),
    });
  }
  return out;
}

// Fold a union CSV grid back into a Concept's scope, merging by Example
// name wherever the Example lives: a table row updates cell by cell within
// its table's own columns (a column the table lacks is left alone — columns
// arrive when a table is created, never from the mirror), a line-form
// Example updates attribute by attribute (updateExamples), and a name the
// file does not hold yet is appended — as a row of the Concept's own table
// when it has one, else as a '- ' block. A blank cell says nothing; a value
// carrying a formula is left to its formula. `opts.erase` — [{ row, col }],
// the values a CSV emptied since the two copies last agreed (csvsync) —
// empties them: a cell, or an Example's own value line. Nothing else is ever
// deleted (deleteExamples does that, when asked).
// Returns ops in the updateExamples shape — plus { type: "block", from,
// to, block } (0-based inclusive lines) for a touched table, redrawn
// aligned exactly as updateTable redraws one, and { type: "delete", line }.
function updateScope(lines, root, nodes, concept, header, csvRows, rootName, opts = {}) {
  // the values to empty, by Example and column (case aside)
  const wipe = new Map();
  for (const e of opts.erase || []) {
    const row = String(e.row || "").trim().toLowerCase();
    if (!wipe.has(row)) wipe.set(row, new Set());
    wipe.get(row).add(String(e.col || "").trim().toLowerCase());
  }
  // a CSV is data, written by whoever edited it: nothing it carries becomes
  // code here, so an `=` that would open a derivation arrives escaped, `\=`
  const rows = csvRows.map((r) => r.map((c, k) => (k === 0 ? c : asWritten(c))));
  const csvIdx = new Map(); // lowercased column name -> index in a CSV row
  header.slice(1).forEach((h, k) => {
    const key = String(h || "").trim().toLowerCase();
    if (key && !csvIdx.has(key)) csvIdx.set(key, k + 1);
  });
  const byName = new Map();
  for (const r of rows) {
    const n = (r[0] || "").trim();
    if (n && !byName.has(n.toLowerCase())) byName.set(n.toLowerCase(), r);
  }
  // the tables in the Concept's scope: those whose first row's Example has
  // this Concept as its first Concept up the tree
  const inScope = tablesOf(lines, rootName).filter((t) => {
    if (!t.rowLines.length) return false;
    const rowNode = nodes.find((n) => n.kind === KIND.INDIVIDUAL && n.line === t.rowLines[0]);
    return rowNode ? nearestConcept(rowNode, root) === concept : false;
  });
  const direct = inScope.find((t) => t.name.toLowerCase() === concept.name.toLowerCase());
  const matched = new Set(); // names a table row already answered for
  const touched = []; // { t, header, rows, changed }
  // the mirror writes a nested scope's shape as a `parent` column, and a
  // table carries it in its own `parent (thing)` column: a row's parent
  // cell is set from the CSV's as any other cell is — the name it gives,
  // which a spreadsheet may reorder and reword rows around freely — and a
  // row the CSV files at the top has its cell emptied. A table nesting for
  // the first time gains the column.
  const parentAt = csvIdx.get(PARENT_COLUMN);
  for (const t of inScope) {
    let header = t.header;
    let rowsHere = t.rows;
    let pcol = t.parentCol === undefined ? -1 : t.parentCol;
    // a table stating a `parent` attribute of its own is mirrored by it, as
    // the same fact under the same name (mirrorGrids): its column is a column
    const structured = parentAt !== undefined
      && !header.some((h, k) => k > 0 && k !== pcol && headerColName(h).toLowerCase() === PARENT_COLUMN);
    const wants = (cellsRow) => {
      const rowName = splitCell(cellsRow[0] || "").value.trim();
      const csvRow = rowName && byName.get(rowName.toLowerCase());
      return csvRow ? (csvRow[parentAt] || "").trim() : "";
    };
    if (pcol === -1 && structured && rowsHere.some((r) => wants(r))) {
      header = [header[0], parentHeader(header), ...header.slice(1)];
      rowsHere = rowsHere.map((r) => [r[0], "", ...r.slice(1)]);
      pcol = 1;
    }
    const colNames = header.map(headerColName);
    let changed = header !== t.header;
    const nextRows = rowsHere.map((cellsRow, i) => {
      const next = cellsRow.slice();
      const rowName = splitCell(next[0] || "").value.trim();
      const rowNode = nodes.find((n) => n.kind === KIND.INDIVIDUAL && n.line === t.rowLines[i]);
      const csvRow = rowName && byName.get(rowName.toLowerCase());
      const wipes = rowName && wipe.get(rowName.toLowerCase());
      if ((!csvRow && !wipes) || matched.has(rowName.toLowerCase())) return next;
      matched.add(rowName.toLowerCase());
      for (let k = 1; k < header.length; k++) {
        if (k === pcol) {
          if (!structured || !csvRow) continue;
          const want = (csvRow[parentAt] || "").trim();
          if ((next[k] || "").trim().toLowerCase() !== want.toLowerCase()) { next[k] = want; changed = true; }
          continue;
        }
        // an emptied cell empties — unless a formula owns it
        if (wipes && colNames[k] && wipes.has(colNames[k].toLowerCase())) {
          const cur = splitCell(next[k] || "");
          if (cur.eq === -1 && cur.value.trim()) { next[k] = ""; changed = true; }
          continue;
        }
        if (!csvRow) continue;
        const at = colNames[k] && csvIdx.get(colNames[k].toLowerCase());
        if (!at) continue;
        // a pipe divides cells, so one in a value is the broken bar here
        const v = (csvRow[at] || "").trim().replace(/\|/g, "¦");
        if (!v) continue; // a blank cell says nothing
        const cur = splitCell(next[k] || "");
        if (cur.eq !== -1) continue; // a formula owns its value
        if (sameValue(cur.value.trim(), v)) continue;
        // an empty cell already reads the default the CSV shows: no news
        if (!cur.value.trim() && rowNode) {
          const inherited = inheritedValue(rowNode, colNames[k].toLowerCase(), concept);
          if (inherited !== undefined && sameValue(writtenValue(inherited), v)) continue;
        }
        next[k] = v;
        changed = true;
      }
      return next;
    });
    touched.push({ t, header, pcol, structured, rows: nextRows, changed });
  }
  // the rest: line-form Examples merge in place, fresh names land in the
  // Concept's own shape — its direct table when it has one, else '- ' form
  // every Example of the scope written as lines, sub-Examples among them
  const lineNames = new Set(scopeRowsOf(concept)
    .filter((c) => c.nameCol === undefined && !isRowText(lines[c.line - 1] || ""))
    .map((c) => c.name.toLowerCase()));
  const forLines = [], freshRows = [];
  for (const r of rows) {
    const n = (r[0] || "").trim().toLowerCase();
    if (!n || matched.has(n)) continue;
    if (lineNames.has(n) || !direct) forLines.push(r);
    else freshRows.push(r);
  }
  const ops = [];
  if (forLines.length) ops.push(...updateExamples(lines, concept, header, forLines));
  // an emptied value of an Example written as lines: its own value line
  // goes (an inherited one is no line of its own to empty), a formula's
  // value stays its formula's
  const lineExamples = scopeRowsOf(concept).filter((c) => c.nameCol === undefined);
  for (const [row, cols] of wipe) {
    if (matched.has(row)) continue;
    const ex = lineExamples.find((c) => c.name.toLowerCase() === row);
    if (!ex) continue;
    for (const c of ex.children) {
      if (c.kind !== KIND.DEFAULT || c.cell || c.formula !== undefined) continue;
      if (cols.has(c.name.toLowerCase()) || (c.alias && cols.has(c.alias.toLowerCase()))) {
        if (!c.children.length) ops.push({ type: "delete", line: c.line });
      }
    }
  }
  if (freshRows.length && direct) {
    const own = touched.find((x) => x.t === direct);
    // a new row nesting under another brings the parent column with it
    if (own.pcol === -1 && own.structured && freshRows.some((r) => (r[parentAt] || "").trim())) {
      own.header = [own.header[0], parentHeader(own.header), ...own.header.slice(1)];
      own.rows = own.rows.map((r) => [r[0], "", ...r.slice(1)]);
      own.pcol = 1;
    }
    for (const r of freshRows) {
      // the parent cell takes the CSV's `parent`, as the column of that name
      own.rows.push(own.header.map((cell, k) => {
        if (k === 0) return (r[0] || "").trim();
        if (k === own.pcol && !own.structured) return "";
        const at = csvIdx.get(headerColName(cell).toLowerCase());
        return at ? (r[at] || "").trim() : "";
      }));
    }
    own.changed = true;
  }
  // a touched table is redrawn whole, aligned, appended rows included, its
  // dividers where they stood
  for (const { t, header: drawnHeader, rows: nextRows, changed } of touched) {
    if (!changed) continue;
    const body = [];
    nextRows.forEach((cells, i) => {
      if ((t.breaks || []).includes(i)) body.push({ sep: true, cells: [] });
      body.push({ sep: false, cells });
    });
    if ((t.breaks || []).includes(t.rows.length) && nextRows.length === t.rows.length) body.push({ sep: true, cells: [] });
    const block = render({ indent: t.indent, rows: [{ sep: false, cells: drawnHeader }, ...body] });
    ops.push({ type: "block", from: t.start, to: t.end, block });
  }
  return ops;
}

// The edit that deletes Examples a CSV stopped listing, once that has been
// asked: each one `names` holds (case aside) in the Concept's scope — a
// table's row, or a '- ' line with everything written under it. One with a
// sub-Example that is not going too is kept, since deleting it would take
// a row the CSV still lists. Answers { ops, kept: [name] }, the ops one
// { type: "delete", line } per line (1-based).
function deleteExamples(lines, root, nodes, concept, names) {
  const going = new Set(names.map((n) => String(n).trim().toLowerCase()));
  const ops = [], kept = [];
  const gone = new Set();
  const drop = (line) => { if (!gone.has(line)) { gone.add(line); ops.push({ type: "delete", line }); } };
  for (const ex of scopeRowsOf(concept)) {
    if (!going.has(ex.name.toLowerCase())) continue;
    if (scopeRowsOf(ex).some((s) => !going.has(s.name.toLowerCase()))) { kept.push(ex.name); continue; }
    // a row is its own line, its sub-rows lines of their own; a '- ' line
    // takes the lines written under it
    const last = ex.nameCol !== undefined ? ex.line : lastLineOf(ex);
    for (let l = ex.line; l <= last; l++) drop(l);
  }
  return { ops, kept };
}

// --- flipping a Concept between its two forms --------------------------------
// A table is pure shorthand: the tree it parses to is identical to writing
// each row as a '- Example' with 'attribute: value' children. So a Concept
// has two spellings of one idea, and which one reads better is a question
// about the data, not about the model — a wide grid of short values wants to
// be a table, a handful of long prose values wants to be lines. `flipForm`
// is the edit that writes the Concept out in the other spelling.
//
// No Example and no value is ever lost, in either direction, and a
// derivation moves exactly as typed (`10 =sum(@age)` travels whole), as do
// each attribute's (alias) and its constraints. What is presentation of a
// grid and has nowhere to live in line form — a column's width, its
// alignment colons — is dropped on the way out of a table, as its own kind
// of formatting.
//
// One reading does move, because a grid has no way to hold it: an attribute
// a single Example only *declares* (a bare `nickname` under `- Socrates`,
// no value) becomes a column of the Concept with that Example's cell left
// empty — a header is a table's only place for an attribute name, so the
// declaration widens from the one Example to all of them.
//
// One thing the flip never does is restructure what it did not convert: a
// Concept's own defaults, its '...' Maps, its sub-Concepts and any Example
// too deep to be a row (one with children of its own) are copied through
// verbatim and the grid joins them, which is the merge form the language
// already has.

// The complete table the Concept is written as, or null when it is written
// in line form. A grid belongs to the Concept when its header names it and
// it stands inside the Concept's own lines — the standalone form (the
// header *is* the Concept's line) and the merge form (a grid beneath it)
// both answer here.
function gridOfConcept(lines, concept, rootName) {
  if (!concept || !concept.name) return null;
  const end = lastLineOf(concept);
  const id = numberless(concept.name).toLowerCase();
  // a header with no rows yet is the table of a Concept with no Examples
  return tablesOf(lines, rootName, { headerOnly: true }).find((t) =>
    t.start + 1 >= concept.line && t.start + 1 <= end
    && numberless(t.name).toLowerCase() === id) || null;
}

// A value line's text exactly as typed, from the colon on: the value with
// its derivation, its escapes, its spacing. The model splits those apart
// (node.value, node.formula); the flip must not, because it is moving the
// writing rather than reading it.
function rawValueOf(lines, node) {
  const raw = lines[node.line - 1] || "";
  const colon = raw.indexOf(":");
  return colon === -1 ? "" : raw.slice(colon + 1).trim();
}

// The Concept's Examples that can be rows. A row is a name, a flat list of
// values, and a place in the tree: an Example whose children are attributes
// with no structure of their own is a row, and so is one whose further
// children are themselves rows — a sub-Example is a row naming its parent
// in the `parent (thing)` column. A Map or a sub-Concept still has nowhere
// to go in a grid, so an Example carrying one is no row.
const isRowable = (c) => c.kind === KIND.INDIVIDUAL
  && c.children.every((g) => (isAttrKind(g) && !g.children.length) || isRowable(g));

// Those Examples depth-first, each tagged with the depth it is written at —
// the order the grid draws them in; a row at depth 1 or more names its
// parent in the parent column.
function rowableExamples(concept) {
  const out = [];
  const walk = (n, depth) => {
    for (const c of n.children) {
      if (c.kind !== KIND.INDIVIDUAL || c.line === concept.line || !isRowable(c)) continue;
      out.push({ node: c, depth });
      walk(c, depth + 1);
    }
  };
  walk(concept, 0);
  return out;
}

// A bare attribute line under the Concept declares a column and nothing
// else, so the grid's header takes over from it — and so does a line giving
// the column its default (`tax rate: 0.2`), which a header cell states the
// same way. One with children of its own (an attribute listing the values it
// may take) is not a column: it stays a line. Nor is a default that is
// derived (a header states, it does not derive) or one whose attribute is
// also declared with a constraint (one cell cannot hold both).
const columnAttributes = (concept) => {
  const constrained = new Set(concept.children
    .filter((c) => c.kind === KIND.ATTRIBUTE && c.constraints && c.constraints.length)
    .map((c) => c.name.toLowerCase()));
  return concept.children.filter((c) => !c.children.length && !c.cell && !c.header
    && (c.kind === KIND.ATTRIBUTE
      || (c.kind === KIND.DEFAULT && c.formula === undefined && !constrained.has(c.name.toLowerCase()))));
};

// Write the Concept as a table. The header's first cell names the Concept
// (1.9) and the cells after it are its attributes: the bare attribute lines
// it declares, as written — (alias) and constraints and all — then any
// further attribute only its Examples carry. Every Example that can be a
// row becomes one; a sub-Example names the row it sits under in a
// `parent (thing)` column, written second, which the table gains only when
// something nests. A Concept with no Example yet is a header and nothing
// more — `Person|age|city`, or `Person|` with no attribute either.
//
// Everything else the Concept holds keeps its line: when that is nothing at
// all the table stands alone where the Concept's line stood, and when it is
// not the Concept keeps its line and the grid is filed beneath it, repeating
// its name in the first cell — the merge form, which is what lets a Map, a
// sub-Concept or an Example too deep to be a row survive the flip.
//
// A blank line straight above an Example's line becomes a divider above its
// row — above the first, one under the header — and the flip back writes
// it again. Blank lines anywhere else are presentation, and go.
//
// Returns { form: "table", from, to, block } with 0-based inclusive lines.
function toTableForm(lines, concept) {
  const examples = rowableExamples(concept);
  const declared = columnAttributes(concept);
  const columns = []; // { at, cell } — the header cell as it will be drawn
  // A column is identified by the attribute's **name** and nothing else,
  // exactly as the CSV mirror identifies one (mirrorGrids). An (alias) is a
  // crosslink to the Concept the attribute points at, not a second name for
  // the attribute — `father (person)`, `mother (person)` and `beneficiary
  // (person)` are three attributes that happen to point at one Concept, so
  // keying a column by its alias would fold all three into one and lose two
  // columns' worth of values.
  const seen = new Map(); // lowercased attribute name -> the column it names
  const claim = (node, cell) => {
    const key = node.name.toLowerCase();
    if (seen.has(key)) return;
    const fresh = { at: columns.length, cell };
    columns.push(fresh);
    seen.set(key, fresh);
  };
  // the declarations first, in the order they are written, so the columns
  // read left to right as the lines read top to bottom — a default line's
  // cell carrying its default (`tax rate: 0.2`), which says more than a bare
  // declaration of the same attribute beside it
  for (const attr of declared) {
    const text = (lines[attr.line - 1] || "").trim();
    const had = seen.get(attr.name.toLowerCase());
    if (had && attr.kind === KIND.DEFAULT) had.cell = text;
    else claim(attr, text);
  }
  // then any attribute only an Example carries. It has no declaration line
  // to copy, so its header cell is written from the node: the name and the
  // (alias) that crosslinks it, which is all such an attribute ever states.
  for (const { node: ex } of examples) {
    for (const child of ex.children) {
      // a sub-Example is a row of its own, never a column
      if (child.kind === KIND.INDIVIDUAL) continue;
      claim(child, child.name + (child.alias ? ` (${child.alias})` : ""));
    }
  }
  // a pipe cannot survive inside a pipe table, so it bends to a broken bar
  // exactly as an arriving CSV's does
  const cell = (text) => String(text).replace(/\|/g, "¦");
  const consumed = new Set([...declared, ...examples.map((e) => e.node)]);
  const kept = concept.children.filter((c) => !consumed.has(c) && c.line !== concept.line);
  const standalone = !kept.length && concept.line > 0;
  const indent = " ".repeat(INDENT * (concept.depth + (standalone ? 0 : 1)));
  // the Concept's own default as its line wrote it, escapes and all
  const ownDefault = concept.value != null && concept.value !== "" ? rawValueOf(lines, concept) : "";
  const first = standalone
    // the Concept's line becomes the header's first cell, so its name — the
    // (alias) that names the same idea, and the default it states — move
    // into the grid
    ? concept.name + (concept.alias ? ` (${concept.alias})` : "") + (ownDefault ? `: ${ownDefault}` : "")
    : concept.name;
  // the parent column, second, when any row sits under another
  const nested = examples.some((e) => e.depth > 0);
  const parentCells = nested ? [parentHeader([concept.name])] : [];
  // each value placed in the column its own name claimed, rather than each
  // column hunting for a value: one map decided both, so every value has a
  // column and no column can quietly take another's
  const rows = examples.map(({ node: ex, depth }) => {
    const cells = [cell(ex.name), ...columns.map(() => "")];
    for (const child of ex.children) {
      if (child.kind !== KIND.DEFAULT) continue; // a declaration states no value
      const col = seen.get(child.name.toLowerCase());
      if (col) cells[col.at + 1] = cell(rawValueOf(lines, child));
    }
    // where it sits: its parent's name, as the parent's own row writes it
    if (nested) cells.splice(1, 0, depth > 0 ? cell(ex.parent.name) : "");
    return cells;
  });
  const body = [];
  examples.forEach(({ node: ex }, i) => {
    const above = ex.line - 2;
    if (above >= concept.line && !String(lines[above] || "").trim()) body.push({ sep: true, cells: [] });
    body.push({ sep: false, cells: rows[i] });
  });
  const block = {
    indent,
    rows: [{ sep: false, cells: [cell(first), ...parentCells, ...columns.map((c) => cell(c.cell))] }, ...body],
  };
  // no recompute here: a flip is a re-spelling, not a recalculation, and
  // the grid is not in the document yet — a formula reading the Concept's
  // line-form default has no scope to read it from and would write #ERR
  // over a value that was right. The caller's own re-align computes them
  // where they land, with the whole file around them.
  const drawn = render(block);
  const from = concept.line - 1;
  const to = lastLineOf(concept) - 1;
  // A table touching a row of another table would read as more of its rows,
  // or they as more of its: a blank line keeps every two apart — the grid
  // and the tables either side of the flip, and two kept sub-Concepts
  // written as tables, which stood apart before they were gathered here.
  const touches = (i) => i >= 0 && i < lines.length && isRowText(lines[i]);
  const out = standalone && touches(from - 1) ? [""] : [];
  const put = (part) => {
    if (out.length && part.length && isRowText(out[out.length - 1]) && isRowText(part[0])) out.push("");
    out.push(...part);
  };
  // the lines that are kept travel whole — each with the subtree beneath it
  // — and the grid is filed last, after everything still written as lines
  if (!standalone) {
    put([lines[concept.line - 1]]);
    for (const c of kept) put(lines.slice(c.line - 1, lastLineOf(c)));
  }
  put(drawn);
  if (touches(to + 1)) out.push("");
  return { form: "table", from, to, block: out };
}

// Write the Concept's table out as lines: the Concept, then a bare
// attribute line per column, then a '- Example' per row with a value line
// for each cell that says something. An empty cell asserts nothing, so it
// writes no line. A row naming its parent in the `parent (thing)` column is
// written under that parent's '- ' line, a level deeper, the rows of one
// parent in the order the table writes them; a divider is a blank line
// above the row it stood above. A row with no name keeps its values, under
// a '- ' that waits for one (an error until it has it), rather than losing
// them.
//
// A standalone grid is replaced by the Concept's line and its subtree; a
// merge-form grid is replaced in place, beneath the line it already has —
// and a column the Concept already declares as a line keeps that line
// rather than gaining a second one.
//
// Returns { form: "lines", from, to, block } with 0-based inclusive lines.
function toLineForm(lines, concept, grid) {
  const standalone = grid.start + 1 === concept.line;
  // a column the Concept declares outside the grid is declared already: its
  // line stays where it is and the flip does not repeat it. A default line
  // outside (`age: 18`) declares the bare name only — a column whose header
  // says more (`age >=0`, an alias) still writes its declaration, or the
  // bound would be lost. The header's own cells are the grid's, not outside.
  const outsideDecl = new Set(concept.children
    .filter((c) => c.kind === KIND.ATTRIBUTE && !c.cell && !c.header)
    .map((c) => c.name.toLowerCase()));
  const outsideValue = new Set(concept.children
    .filter((c) => c.kind === KIND.DEFAULT && !c.cell && !c.header)
    .map((c) => c.name.toLowerCase()));
  const outside = {
    keeps: (col) => outsideDecl.has(col.name.toLowerCase())
      || (outsideValue.has(col.name.toLowerCase()) && col.term.toLowerCase() === col.name.toLowerCase()),
  };
  const pcol = grid.parentCol === undefined ? headerParentColumn(grid.header) : grid.parentCol;
  const columns = grid.header.slice(1).map((cell, k) => {
    const bare = cell.trim();
    const colon = defaultColon(bare);
    return {
      at: k + 1,
      name: headerColName(cell),
      // the term exactly as the header wrote it — a default's cell comes
      // back as the line stating that default, `tax rate: 0.2`
      term: bare,
      // what a value line writes before its colon: the name with the
      // (alias) that crosslinks it, but never the constraint — a bound
      // belongs to the declaration, not to each value it governs — nor the
      // column's default
      label: (colon !== -1 ? bare.slice(0, colon).trim() : splitConstraint(bare).value.trim()) || bare,
    };
  // the parent column is where a row is filed, and the nesting writes it
  }).filter((c) => c.name && c.at !== pcol);
  const out = [];
  // a standalone grid stands where the Concept's line stands, so the flip
  // writes that line first and files everything a level under it; a merge
  // form already has its line above, and the grid's own indent is the level
  // its children belong at
  if (standalone) out.push(grid.indent + (grid.header[0] || "").trim());
  const declIndent = grid.indent + (standalone ? " ".repeat(INDENT) : "");
  for (const col of columns) {
    if (outside.keeps(col)) continue;
    out.push(declIndent + col.term);
  }
  // each row under the row its parent cell names, as the linter files it
  // (table.parentsOf, over the grid as a block); the rest are the Concept's
  const parents = parentsOf({ rows: [{ sep: false, cells: grid.header }, ...grid.rows.map((cells) => ({ sep: false, cells }))] });
  const kids = new Map(); // row index -> its sub-rows' indices, in table order
  const top = [];
  grid.rows.forEach((_, r) => {
    const p = parents.get(r + 1);
    if (p === undefined || p === -1) top.push(r);
    else {
      if (!kids.has(p - 1)) kids.set(p - 1, []);
      kids.get(p - 1).push(r);
    }
  });
  const breaks = new Set(grid.breaks || []);
  const write = (r, level) => {
    const row = grid.rows[r];
    const rowIndent = declIndent + " ".repeat(INDENT * level);
    if (breaks.has(r)) out.push("");
    out.push(rowIndent + "- " + (row[0] || "").trim());
    for (const col of columns) {
      const value = (row[col.at] || "").trim();
      if (value) out.push(rowIndent + " ".repeat(INDENT) + `${col.label}: ${value}`);
    }
    for (const k of kids.get(r) || []) write(k, level + 1);
  };
  for (const r of top) write(r, 0);
  return { form: "lines", from: grid.start, to: grid.end, block: out };
}

// The edit that writes the Concept out in its other form — a table where it
// is lines today, lines where it is a table. A Concept with no Examples
// flips too: its header alone is its table. Returns { form, from, to,
// block } with 0-based inclusive lines (lines from..to become `block`), or
// null for no Concept (the file's root has no line to flip).
function flipForm(lines, concept, rootName) {
  if (!concept || !concept.name || concept.line < 1) return null;
  const grid = gridOfConcept(lines, concept, rootName);
  if (grid) return toLineForm(lines, concept, grid);
  return toTableForm(lines, concept);
}

// --- where the cursor is, across a flip ----------------------------------------
// A flip rewrites the Concept's lines, so a cursor kept by line number lands
// on whatever took its place. It is kept by idea instead. Before the flip,
// ideaAt names the node under it by its path from the Concept — each step
// its kind, its name (numbering and case aside) and which of its same-named
// siblings it is — with the part the cursor is in (the name, or the value as
// written) and how far into it. After the flip, positionOf walks the same path
// through the file as it now reads. Both forms parse to one tree, so the path
// is the same in either: a header cell and a declaration line are one
// attribute, a row and a '- ' line one Example, a cell and a value line one
// value. An empty cell has no node, so it is remembered by its column: it is
// that cell again in a table, and the Example's name in line form, where an
// empty cell writes no line. Pure.

const stepKind = (n) => (isAttrKind(n) ? "attr" : n.kind);
const stepKey = (n) => numberless(n.name || "").trim().toLowerCase();

// The node's path from `concept`, or null when it is not under it.
function pathTo(concept, node) {
  const steps = [];
  for (let n = node; n !== concept; n = n.parent) {
    if (!n || !n.parent) return null;
    const same = n.parent.children.filter((c) => stepKind(c) === stepKind(n) && stepKey(c) === stepKey(n));
    steps.unshift({ kind: stepKind(n), key: stepKey(n), dup: Math.max(0, same.indexOf(n)) });
  }
  return steps;
}

// Where a node's name stands on its line: { start, end }.
function nameSpanOf(lines, node) {
  const raw = lines[node.line - 1] || "";
  let start = node.nameCol;
  if (start === undefined) {
    const lead = raw.length - raw.trimStart().length;
    if (node.kind === KIND.INDIVIDUAL) start = lead + 2;
    else if (node.kind === KIND.MAP) {
      const rest = raw.slice(lead + 3);
      start = lead + 3 + (rest.length - rest.trimStart().length);
    } else start = lead;
  }
  return { start, end: start + String(node.name || "").length };
}

// Where a value stands as written — its derivation and escapes included — on
// its line: a cell to its divider, a line to its end. null for no value.
function writtenValueSpan(lines, node) {
  if (node.value == null || node.value === "") return null;
  const raw = lines[node.line - 1] || "";
  let start = node.valueCol;
  if (start === undefined) {
    const colon = raw.indexOf(":", nameSpanOf(lines, node).start);
    if (colon === -1) return null;
    const after = raw.slice(colon + 1);
    start = colon + 1 + (after.length - after.trimStart().length);
  }
  let end = raw.length;
  if (isRowText(raw)) {
    const next = dividers(raw).find((d) => d >= start);
    if (next !== undefined) end = next;
  }
  while (end > start && raw[end - 1] === " ") end--;
  return { start, end };
}

// The idea under `pos` ({ line 0-based, character }) in the Concept being
// flipped: { concept, path, part: "name" | "value" | "cell", offset, column? },
// or null when the cursor is outside the Concept.
function ideaAt(lines, nodes, concept, pos) {
  const lineNo = pos.line + 1;
  const raw = lines[pos.line] || "";
  const ch = pos.character;
  const here = nodes.filter((n) => n.line === lineNo);
  const idea = (node, part, offset, column) => {
    const path = pathTo(concept, node);
    return path ? { concept: stepKey(concept), path, part, offset: Math.max(0, offset), column } : null;
  };
  const inValue = (n) => { const v = writtenValueSpan(lines, n); return v && ch >= v.start && ch <= v.end ? v : null; };
  const named = (n) => { const s = nameSpanOf(lines, n); return idea(n, "name", Math.min(ch - s.start, s.end - s.start)); };
  if (isRowText(raw)) {
    const block = blockAt(lines, pos.line);
    if (!block) return null;
    const head = block.rows.findIndex((r) => !r.sep);
    const rowAt = pos.line - block.start;
    const row = block.rows[rowAt];
    // a divider: the row above it, or the table's Concept
    if (!row || row.sep) {
      for (let i = rowAt - 1; i > head; i--) {
        const ex = nodes.find((n) => n.line === block.start + i + 1 && n.kind === KIND.INDIVIDUAL && n.nameCol !== undefined);
        if (ex) return idea(ex, "name", 0);
      }
      return idea(concept, "name", 0);
    }
    const col = colAt(raw, ch);
    const cellCol = (cells(raw)[col] || {}).col;
    if (rowAt === head) {
      // the header: the Concept's own cell, or a column's attribute
      if (col === 0) {
        const own = here.find((n) => n === concept);
        if (own && inValue(own)) return idea(own, "value", ch - inValue(own).start);
        return own ? named(own) : idea(concept, "name", 0);
      }
      const attr = here.find((n) => isAttrKind(n) && n.nameCol === cellCol);
      if (!attr) return idea(concept, "name", 0); // the parent column, an empty cell
      if (attr.kind === KIND.DEFAULT && inValue(attr)) return idea(attr, "value", ch - inValue(attr).start);
      return named(attr);
    }
    const ex = here.find((n) => n.kind === KIND.INDIVIDUAL && n.nameCol !== undefined);
    if (!ex) return idea(concept, "name", 0);
    if (col === 0) return named(ex);
    const value = here.find((n) => n.kind === KIND.DEFAULT && n.cell && n.valueCol === cellCol);
    if (value) {
      const v = writtenValueSpan(lines, value);
      return idea(value, "value", v ? Math.min(ch - v.start, v.end - v.start) : 0);
    }
    // an empty cell, remembered by its column — the parent column is none
    const header = block.rows[head].cells;
    const pcol = headerParentColumn(header);
    const key = col !== pcol && header[col] ? headerColName(header[col]).toLowerCase() : "";
    return key ? idea(ex, "cell", 0, key) : idea(ex, "name", 0);
  }
  // a line: its node, by the part the cursor stands in
  const node = here.find((n) => n.kind !== KIND.DEFAULT || !n.cell);
  if (node) {
    const v = inValue(node);
    if (v) return idea(node, "value", ch - v.start);
    return named(node);
  }
  // a blank line: the next idea below it inside the Concept, else the Concept
  const end = lastLineOf(concept);
  const below = nodes.filter((n) => n.line > lineNo && n.line <= end && (n.kind !== KIND.DEFAULT || !n.cell))
    .sort((a, b) => a.line - b.line)[0];
  return below ? idea(below, "name", 0) : (lineNo >= concept.line && lineNo <= end ? idea(concept, "name", 0) : null);
}

// Where `idea` (from ideaAt) stands in the file as it now reads: { line
// (0-based), character }, or null when its Concept is gone. `near` (0-based)
// picks among same-named Concepts — the flip's first line. A path that no
// longer reaches all the way lands on the last node it does reach.
function positionOf(lines, root, nodes, idea, near) {
  if (!idea) return null;
  const candidates = [root, ...nodes].filter((n) => n && n.kind === KIND.CONCEPT && n.line > 0 && stepKey(n) === idea.concept);
  if (!candidates.length) return null;
  const distance = (n) => Math.abs(n.line - 1 - (near || 0));
  let node = candidates.reduce((a, b) => (distance(b) < distance(a) ? b : a));
  let reached = 0;
  for (const step of idea.path) {
    const same = node.children.filter((c) => stepKind(c) === step.kind && stepKey(c) === step.key);
    const next = same[step.dup] || same[same.length - 1];
    if (!next || !(next.line > 0)) break;
    node = next;
    reached++;
  }
  const whole = reached === idea.path.length;
  if (whole && idea.part === "value") {
    const v = writtenValueSpan(lines, node);
    if (v) return { line: node.line - 1, character: Math.min(v.start + idea.offset, v.end) };
  }
  if (whole && idea.part === "cell" && idea.column && node.nameCol !== undefined) {
    // back in a table: the same empty cell of the row
    const block = blockAt(lines, node.line - 1);
    const head = block ? block.rows.findIndex((r) => !r.sep) : -1;
    const k = head === -1 ? -1 : block.rows[head].cells.findIndex((h, j) => j > 0 && headerColName(h).toLowerCase() === idea.column);
    if (k > 0) return { line: node.line - 1, character: cellStart(block, k) };
  }
  // a cell's attribute is named in the header, so a value line's name lands
  // on the value's own cell — the row's, not the column's
  if (node.kind === KIND.DEFAULT && node.cell && node.valueCol !== undefined) {
    return { line: node.line - 1, character: node.valueCol };
  }
  const s = nameSpanOf(lines, node);
  const offset = whole && idea.part === "name" ? Math.min(idea.offset, s.end - s.start) : 0;
  return { line: node.line - 1, character: s.start + offset };
}

// --- stating a fact once -----------------------------------------------------
// The quick fixes for godel.hoists. `mode` "hoist": 'attr: value' goes onto
// the parent, written once, and comes off every child that sets it for
// itself — a line-form declaration is deleted, a table column holding it in
// every row is dropped (a standalone table taking the merge form, since a
// table has no line for the Concept's own attributes). A parent that says
// the attribute already (the dead default the children agree against) has
// that line rewritten rather than a second one added. `mode` "bare": the
// parent's dead default keeps just its attribute, the value no child kept
// taken off. Answers ops in repo.applyOps' shape, or null when the parent
// or the attribute is not found.
function hoistOps(lines, root, nodes, parentLine, attr, value, rootName, registry, mode) {
  const parent = parentLine === 0 ? root : [root, ...nodes].find((n) => n.line === parentLine
    && (n.kind === KIND.CONCEPT || n.kind === KIND.INDIVIDUAL));
  if (!parent) return null;
  const key = String(attr).toLowerCase();
  const matches = (c) => isAttrKind(c) && c.name.toLowerCase() === key;
  const own = parent.children.find((c) => c.kind === KIND.DEFAULT && !c.cell && matches(c));
  if (mode === "bare") {
    if (!own) return null;
    const raw = lines[own.line - 1] || "";
    const colon = raw.indexOf(":");
    return colon === -1 ? null : [{ type: "replace", line: own.line, text: raw.slice(0, colon).trimEnd() }];
  }
  const ops = [];
  const indentOf = (n) => (lines[n.line - 1] || "").match(/^ */)[0];
  // every child's own line-form declaration goes
  const kids = parent.children.filter((c) => c.kind === KIND.CONCEPT || c.kind === KIND.INDIVIDUAL);
  for (const kid of kids) {
    for (const c of kid.children) {
      if (c.kind === KIND.DEFAULT && !c.cell && matches(c)) ops.push({ type: "delete", line: c.line });
    }
  }
  // a table of the parent's that states it in a column: the column goes
  const grid = gridOfConcept(lines, parent, rootName);
  const col = grid ? grid.header.findIndex((h, k) => k > 0 && headerColName(h).toLowerCase() === key) : -1;
  const standalone = grid && grid.start + 1 === parent.line;
  const dropped = col > 0 ? {
    header: grid.header.filter((_, k) => k !== col),
    rows: grid.rows.map((r) => r.filter((_, k) => k !== col)),
  } : null;
  // `value` is the value as the model reads it, so it is written back the
  // way the file must hold it: an `=` it holds would otherwise open a
  // derivation where the fact lands
  const written = writtenValue(value);
  const fact = `${attr}: ${written}`;
  if (standalone) {
    // the table stood where the Concept's line stands: the Concept takes a
    // line of its own, the fact under it, and the grid files beneath
    const indent = grid.indent;
    const inner = indent + " ".repeat(INDENT);
    const shape = dropped || { header: grid.header, rows: grid.rows };
    // the rows as they stand — their parent cells with them — and the
    // dividers where they stood
    const breaks = new Set(grid.breaks || []);
    const body = [];
    shape.rows.forEach((cells, i) => {
      if (breaks.has(i)) body.push({ sep: true, cells: [] });
      body.push({ sep: false, cells });
    });
    const drawn = render({ indent: inner, rows: [{ sep: false, cells: shape.header }, ...body] });
    const head = grid.header[0].trim();
    ops.push({ type: "block", from: grid.start, to: grid.end, block: [indent + head, inner + fact, ...drawn] });
    return ops;
  }
  if (dropped) {
    const u = updateTable(lines, grid.name, dropped.header, dropped.rows, rootName, registry);
    if (u && u.changed) ops.push({ type: "block", from: u.from, to: u.to, block: u.block });
  }
  if (own) {
    const raw = lines[own.line - 1] || "";
    ops.push({ type: "replace", line: own.line, text: raw.slice(0, raw.indexOf(":") + 1) + " " + written });
  } else {
    const decls = parent.children.filter((c) => isAttrKind(c) && !c.cell && c.line > parent.line);
    const after = decls.length ? lastLineOf(decls[decls.length - 1]) : parent.line;
    const indent = parent.line > 0 ? indentOf(parent) + " ".repeat(INDENT) : "";
    ops.push({ type: "insert", afterLine: after, text: indent + fact });
  }
  return ops;
}

module.exports = {
  hoistOps,
  derivationSpans, copyToSiblings, hostsOf, constraintOf, definitionOf, valueSpanOf, makeCtx, scopeOf, kindAbove,
  referencesAt, conceptScope, conceptRegistry, addExample, updateExamples,
  mirrorGrids, updateScope, deleteExamples,
  lastLineOf, headerColName, renumberExamples, renumberConcepts,
  flipForm, gridOfConcept, toTableForm, toLineForm, ideaAt, positionOf,
};
