// Formulas on line-form attribute values, and constraint validation — the
// table spreadsheet (table.js) generalised to `attribute: value =formula`
// lines, plus the schema check: a constraint lives on the ATTRIBUTE
// declaration and every value the attribute takes is held to it:
//
//     Order
//         total: 30 =sum(@price)      <- ranges over Order's Examples
//         cap <=100                   <- bounds every 'cap' value beneath
//         - A
//             price: 10
//             vat: 2 =@price*0.2      <- @name is a sibling attribute
//             cap: 2                  <- validated against 'cap <=100'
//         - B
//             price: 20
//             copy: 10 =@price@A      <- @Example reads the named sibling
//
// Reference semantics: `@attribute name` is the same owner's attribute
// (longest case-insensitive match, aliases included); aggregates and
// count() range over the *other* sibling Examples under the same parent;
// `@attr@Example` reads the named sibling Example's value. References are
// name-only — a digits lead can name an Example ('- 35'), never a column
// position (positional @N was removed in 1.6). A constraint's references
// resolve per value, against that value's own Example or row — so
// `total >=@price` holds each row's total to its own price.
//
// Pure: parse once (linter.js), audit or recompute over the shared tree.
// Used by the VS Code extension (extension.js). table.js provides the
// evaluator; requiring linter.js here is safe (linter never requires this).

const { KIND, INDENT } = require("./linter");
const {
  splitCell, splitConstraint, evalFormula, formatValue, compareValues, longestMatch,
  tablesOf, updateTable, describeBound, readValue, render,
  referenceSpans, widthCookie, numberless,
} = require("./table");

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

// The evaluation context for one host. `current` maps a DEFAULT node to
// its value-in-progress, so the recompute fixpoint sees fresh values.
// `registry` (optional) lets a line-form formula reach a foreign table's
// cell/column by name, exactly as a table cell can — `@Order@price@Acme`.
function makeCtx(d, current, registry) {
  const { host, examples } = scopeOf(d);
  const names = new Map(); // lowercased key -> canonical attribute id
  const addName = (n) => {
    if (n.kind !== KIND.DEFAULT && n.kind !== KIND.ATTRIBUTE) return;
    const key = n.name.toLowerCase();
    if (!names.has(key)) names.set(key, key);
    if (n.alias) {
      const a = n.alias.toLowerCase();
      if (!names.has(a)) names.set(a, key);
    }
  };
  (d.parent ? d.parent.children : []).forEach(addName);
  for (const ex of examples) ex.children.forEach(addName);
  const nameCands = [...names.entries()].map(([key, id]) => ({ key, id }));
  const rowCands = examples.map((ex) => ({ key: ex.name.toLowerCase(), id: ex }));
  // an owner's value for the attribute; undefined when the owner never
  // asserts it, "" when it is declared but (not yet) valued
  const valueOn = (owner, id) => {
    const hit = owner.children.find((c) =>
      (c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE)
      && (c.name.toLowerCase() === id || (c.alias && c.alias.toLowerCase() === id)));
    if (!hit) return undefined;
    return hit.kind === KIND.DEFAULT ? current(hit) : "";
  };
  return {
    matchColumn: (rest) => longestMatch(rest, nameCands),
    matchRow: (rest) => longestMatch(rest, rowCands),
    cell: (c) => {
      const v = valueOn(d.parent, c);
      return v === undefined ? "" : v;
    },
    cellAt: (c, ex) => {
      const v = valueOn(ex, c);
      return v === undefined ? "" : v;
    },
    column: (c) =>
      examples.filter((ex) => ex !== host)
        .map((ex) => valueOn(ex, c))
        .filter((v) => v !== undefined),
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
function conceptScope(concept) {
  const examples = concept.children.filter((c) => c.kind === KIND.INDIVIDUAL);
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
  const nameCands = [...names.entries()].map(([key, id]) => ({ key, id }));
  const rowCands = examples.map((ex, r) => ({ key: ex.name.toLowerCase(), id: r }));
  const valueOn = (owner, id) => {
    const hit = owner.children.find((c) =>
      (c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE)
      && (c.name.toLowerCase() === id || (c.alias && c.alias.toLowerCase() === id)));
    return hit && hit.kind === KIND.DEFAULT ? hit.value || "" : undefined;
  };
  const valueAt = (r, id) => {
    const ex = examples[r];
    if (!ex) throw new Error(`there is no Example @${r} on '${concept.name}'`);
    const own = valueOn(ex, id);
    if (own !== undefined) return own;
    const inherited = valueOn(concept, id); // the Concept's default
    return inherited === undefined ? "" : inherited;
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
    // The Concept's *own* value for an attribute — the default it states on
    // its own line — or undefined where it states none. A grid has no such
    // reading (a table is rows and nothing else), which is why only a
    // Concept offers it: `@Measurement@alias` means the value Measurement
    // itself carries, the same one its Examples would inherit.
    self: (c) => valueOn(concept, c),
    // the same Examples as a grid — the first column names them, as the CSV
    // mirror writes a table's, so a line-form Concept mirrors like any other
    grid: () => [
      ["name", ...display.values()],
      ...examples.map((ex, r) => [ex.name, ...[...display.keys()].map((id) => valueAt(r, id))]),
    ],
  };
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
function constraintOf(d) {
  const keys = [d.name.toLowerCase()];
  if (d.alias) keys.push(d.alias.toLowerCase());
  for (let p = d.parent; p; p = p.parent) {
    for (const c of p.children) {
      if (c.kind !== KIND.ATTRIBUTE || !c.constraints) continue;
      if (keys.includes(c.name.toLowerCase()) || (c.alias && keys.includes(c.alias.toLowerCase()))) return c;
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
  if (d.valueCol !== undefined) {
    // a wrapped cell's value grows past its own line: valueSpan holds the
    // first fragment's on-line length
    return { startCol: d.valueCol, endCol: d.valueCol + (d.valueSpan !== undefined ? d.valueSpan : d.value.length) };
  }
  const raw = lines[d.line - 1] || "";
  const colon = raw.indexOf(":");
  if (colon === -1) return null;
  const after = raw.slice(colon + 1);
  const start = colon + 1 + (after.length - after.trimStart().length);
  return { startCol: start, endCol: start + d.value.length };
}

// Audit the line-form '=' formulas (the exact shape of table.formulas())
// and every attribute constraint: the declaration's span is returned for
// the colouring (and carries the error when its formula cannot compute);
// each value the attribute takes is validated in its own context, a
// violation pinned to the value itself as a **warning** — a breached
// constraint is worth knowing, not a broken file, so it never counts in V
// (paint: false — a plain value is not derivation text).
function auditValues(root, nodes, lines, registry) {
  const out = [];
  const current = (n) => n.value || "";
  for (const d of hostsOf(nodes)) {
    const s = spanOf(lines, d);
    if (!s) continue;
    const span = { line: d.line, startCol: s.startCol, endCol: s.endCol, op: s.op, formula: s.formula };
    try {
      const computed = formatValue(evalFormula(s.formula, makeCtx(d, current, registry)), s.value);
      if (computed !== s.value) {
        span.stale = true;
        span.message = s.value === ""
          ? `formula '=${s.formula}' is not yet computed (= ${computed}) — it fills in when the cursor leaves the line, or on save`
          : `value '${s.value}' does not match its formula (= ${computed}) — it recomputes when the cursor leaves the line, or on save`;
      }
    } catch (e) {
      span.error = true;
      span.message = `formula '=${s.formula}' does not compute — ${e.message}`;
    }
    out.push(span);
  }
  // the constraints: one coloured span per bound (a declaration may chain
  // several), one check per value per bound
  const constrained = nodes.filter((n) => n.kind === KIND.ATTRIBUTE && n.constraints);
  if (!constrained.length) return out;
  const declared = new Map(); // constraint -> its pushed span
  for (const a of constrained) {
    a.constraints.forEach((con, k) => {
      const s = constraintSpanOf(lines, a, k);
      const span = { line: a.line, startCol: s.startCol, endCol: s.endCol, op: con.op, formula: con.formula };
      declared.set(con, span);
      out.push(span);
    });
  }
  const violation = (d, message) => {
    const at = valueSpanOf(lines, d) || { startCol: 0, endCol: (lines[d.line - 1] || "").length };
    out.push({ line: d.line, startCol: at.startCol, endCol: at.endCol, paint: false, warning: true, message });
  };
  for (const d of nodes) {
    if (d.kind !== KIND.DEFAULT || !d.value) continue;
    const a = constraintOf(d);
    if (!a) continue;
    for (const con of a.constraints) {
      // the bound: the value must satisfy each comparison in the chain
      let bound;
      try {
        bound = evalFormula(con.formula, makeCtx(d, current, registry));
      } catch (e) {
        // an uncomputable bound is the declaration's problem, reported once
        const span = declared.get(con);
        if (span && !span.error) {
          span.error = true;
          span.message = `constraint '${con.op}${con.formula}' on '${a.name}' does not compute — ${e.message}`;
        }
        continue;
      }
      if (!compareValues(con.op, d.value, bound)) {
        violation(d, `value '${d.value}' violates '${a.name} ${con.op} ${describeBound(bound)}' (line ${a.line}) — change the value, or the constraint`);
      }
    }
  }
  return out;
}

// Every name reference in every line-form '=' formula, resolved as
// evaluation resolves it and pinned to the document — the line-form half
// of table.js's formulaReferences, one record shape between them: local
// attribute and Example names answer their declaring `nodes`, a foreign
// grid answers a `site`, a line-form Concept its `conceptNode`/`attrKey`.
// For the rename that follows a declaration.
function formulaReferences(root, nodes, lines, registry) {
  const out = [];
  const current = (n) => n.value || "";
  const isAttr = (n) => n.kind === KIND.DEFAULT || n.kind === KIND.ATTRIBUTE;
  for (const d of hostsOf(nodes)) {
    const s = spanOf(lines, d);
    if (!s) continue;
    const ctx = makeCtx(d, current, registry);
    const { examples } = scopeOf(d);
    const owners = [...new Set([d.parent, ...examples])].filter(Boolean);
    const from = s.startCol + s.op.length;
    const src = s.raw.slice(from, s.endCol);
    for (const rec of referenceSpans(src, ctx)) {
      const r = {
        line: d.line, startCol: from + rec.start, endCol: from + rec.start + rec.length,
        text: rec.text, kind: rec.kind, id: rec.id,
      };
      if (rec.kind === "table") {
        // resolved through the registry by the caller
      } else if (rec.scope === ctx) { // a sibling attribute or Example of this line
        r.nodes = rec.kind === "column"
          ? owners.flatMap((o) => o.children.filter((c) => isAttr(c) && c.name.toLowerCase() === rec.id))
          : [rec.id];
      } else if (rec.scope.node) { // a registry scope, read as a table
        if (rec.kind === "column") { r.conceptNode = rec.scope.node; r.attrKey = rec.id; }
        else r.nodes = [rec.scope.examples[rec.id]].filter(Boolean);
      }
      out.push(r);
    }
  }
  return out;
}

// Recompute every '=' line-form formula, five fixpoint passes so a formula
// may reference another formula's value; constraints are never rewritten.
// Returns whole-line replacements as { line, text } (1-based lines).
function recomputeValues(root, nodes, lines, registry) {
  const hosts = hostsOf(nodes).filter((n) => n.op === "=");
  const values = new Map();
  const current = (n) => (values.has(n) ? values.get(n) : n.value || "");
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const d of hosts) {
      let out;
      try { out = formatValue(evalFormula(d.formula, makeCtx(d, current, registry)), current(d)); }
      catch { out = "#ERR"; }
      if (out !== current(d)) { values.set(d, out); changed = true; }
    }
    if (!changed) break;
  }
  const edits = [];
  for (const d of hosts) {
    if (!values.has(d) || values.get(d) === (d.value || "")) continue;
    const s = spanOf(lines, d);
    if (!s) continue;
    const text = s.raw.slice(0, s.colon + 1 + s.lead) + values.get(d) + " =" + s.formula;
    edits.push({ line: d.line, text });
  }
  return edits;
}

// The last line a node's subtree occupies, so an insertion lands after it.
function lastLineOf(node) {
  let last = node.line;
  for (const c of node.children) last = Math.max(last, lastLineOf(c));
  return last;
}

// Copy the derivation at lines[lineIdx] onto the same attribute of every
// sibling Example — replacing an existing derivation, keeping each peer's
// own value, adding an `attr: =formula` line where the attribute is absent.
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
      const value = hit.value || "";
      ops.push({
        type: "replace", line: hit.line,
        text: raw.slice(0, colon + 1) + " " + (value ? value + " " : "") + d.op + d.formula,
      });
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
function updateExamples(lines, concept, header, rows) {
  const attrs = header.slice(1);
  const indent = " ".repeat(INDENT * (concept.depth + 1));
  const childIndent = " ".repeat(INDENT * (concept.depth + 2));
  const examples = concept.children.filter((c) => c.kind === KIND.INDIVIDUAL);
  const byName = new Map(examples.map((e) => [e.name.toLowerCase(), e]));
  const ops = [];
  const fresh = [];
  for (const row of rows) {
    const name = (row[0] || "").trim();
    if (!name) continue;
    const ex = byName.get(name.toLowerCase());
    if (!ex) {
      fresh.push(indent + `- ${name}`);
      attrs.forEach((a, k) => {
        const v = (row[k + 1] || "").trim();
        if (v) fresh.push(childIndent + `${a}: ${v}`);
      });
      continue;
    }
    const missing = [];
    attrs.forEach((a, k) => {
      const v = (row[k + 1] || "").trim();
      if (!v) return;
      const key = a.toLowerCase();
      const hit = ex.children.find((c) =>
        (c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE)
        && (c.name.toLowerCase() === key || (c.alias && c.alias.toLowerCase() === key)));
      if (!hit) { missing.push(childIndent + `${a}: ${v}`); return; }
      if (hit.formula !== undefined || hit.value === v) return;
      const raw = lines[hit.line - 1] || "";
      const colon = raw.indexOf(":");
      if (colon === -1) return;
      ops.push({ type: "replace", line: hit.line, text: raw.slice(0, colon + 1) + " " + v });
    });
    if (missing.length) ops.push({ type: "insert", afterLine: lastLineOf(ex), text: missing.join("\n") });
  }
  if (fresh.length) {
    // after the last Example's whole subtree, so the new ones are siblings
    // of the others and not children of the last one's deepest attribute
    const last = examples.length ? examples[examples.length - 1]
      : concept.children[concept.children.length - 1];
    ops.push({ type: "insert", afterLine: last ? lastLineOf(last) : concept.line, text: fresh.join("\n") });
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

// How two same-named Concept definitions differ: where each is filed (its
// nearest named parent, null at top level), the attributes and Examples only
// one of them carries, and the default values they set differently. All
// comparison is case-insensitive, as references resolve. `identical` says the
// two assert the same content (parentage aside). Feeds the duplicate-Concept
// warning's "how they differ" clause and the reconcile merge: what `b` has
// that `a` lacks is exactly what a merge into `a` must add.
function diffConcepts(a, b) {
  const byName = (n, want) => {
    const m = new Map();
    for (const c of n.children) {
      if (!want.includes(c.kind)) continue;
      if (!m.has(c.name.toLowerCase())) m.set(c.name.toLowerCase(), c);
    }
    return m;
  };
  const attrsA = byName(a, [KIND.ATTRIBUTE, KIND.DEFAULT]);
  const attrsB = byName(b, [KIND.ATTRIBUTE, KIND.DEFAULT]);
  const exA = byName(a, [KIND.INDIVIDUAL]);
  const exB = byName(b, [KIND.INDIVIDUAL]);
  const only = (mine, theirs) => [...mine.values()].filter((c) => !theirs.has(c.name.toLowerCase()));
  const valuesDiffer = [];
  for (const [k, ca] of attrsA) {
    const cb = attrsB.get(k);
    if (!cb || ca.kind !== KIND.DEFAULT || cb.kind !== KIND.DEFAULT) continue;
    const va = String(ca.value), vb = String(cb.value);
    if (va.toLowerCase() !== vb.toLowerCase()) valuesDiffer.push({ name: ca.name, a: va, b: vb });
  }
  // the root is the file, not a filing place — a top-level Concept's home is null
  const home = (n) => (n.parent && n.parent.parent ? n.parent.name : null);
  const parentA = home(a), parentB = home(b);
  const d = {
    parentA, parentB,
    sameParent: String(parentA).toLowerCase() === String(parentB).toLowerCase(),
    attrsOnlyA: only(attrsA, attrsB),
    attrsOnlyB: only(attrsB, attrsA),
    examplesOnlyA: only(exA, exB),
    examplesOnlyB: only(exB, exA),
    valuesDiffer,
  };
  d.identical = !d.attrsOnlyA.length && !d.attrsOnlyB.length
    && !d.examplesOnlyA.length && !d.examplesOnlyB.length && !d.valuesDiffer.length;
  return d;
}

// The diff as one readable clause for the duplicate-Concept warning:
// `here` is the current file's definition, `there` the other file's.
function conceptDiffClause(here, there) {
  const d = diffConcepts(here, there);
  const list = (ns) => ns.slice(0, 3).map((c) => `'${c.name}'`).join(", ") + (ns.length > 3 ? ", …" : "");
  const bits = [];
  if (!d.sameParent) {
    const at = (p) => (p ? `under '${p}'` : "at top level");
    bits.push(`filed ${at(d.parentA)} here vs ${at(d.parentB)} there`);
  }
  if (d.attrsOnlyA.length) bits.push(`attributes only here: ${list(d.attrsOnlyA)}`);
  if (d.attrsOnlyB.length) bits.push(`attributes only there: ${list(d.attrsOnlyB)}`);
  if (d.valuesDiffer.length) {
    bits.push(`values differ: ${d.valuesDiffer.slice(0, 3).map((v) => `${v.name} ('${v.a}' vs '${v.b}')`).join(", ")}${d.valuesDiffer.length > 3 ? ", …" : ""}`);
  }
  if (d.examplesOnlyA.length) bits.push(`Examples only here: ${list(d.examplesOnlyA)}`);
  if (d.examplesOnlyB.length) bits.push(`Examples only there: ${list(d.examplesOnlyB)}`);
  return bits.length ? ` Differs: ${bits.join("; ")}.` : " The two carry identical content.";
}

// The one-file half of "reconcile": everything `other` (the same-named
// Concept in another file, parsed from that file's tree) asserts that `kept`
// does not — attributes, default values, Examples with their subtrees —
// becomes edits on kept's file (`lines`). Raw lines are copied from
// `otherLines` re-indented, so aliases, constraints and formulas survive;
// table-row children, which have no line of their own to copy, are
// synthesised from the node. Examples land in the shape kept is already
// written in — rows on its table, else '- name' lines. Where both set the
// same attribute differently, kept's value stands (it is the definition
// being kept). Returns ops in the updateExamples shape ({ type: "replace" |
// "insert" | "block" }, apply in descending line order), or null when
// `other` has sub-Concepts — merging a subtree is a different operation.
function mergeConceptOps(lines, otherLines, kept, other, rootName, registry) {
  if (other.children.some((c) => c.kind === KIND.CONCEPT)) return null;
  const d = diffConcepts(kept, other);
  const ops = [];
  const indent = " ".repeat(INDENT * (kept.depth + 1));
  const childIndent = " ".repeat(INDENT * (kept.depth + 2));

  // a child of `other` as lines for kept's file: the raw subtree re-indented,
  // or synthesised when the node lives in a table row (no line of its own)
  const subtreeLines = (node) => {
    if (node.cell) {
      if (node.kind === KIND.INDIVIDUAL) {
        const out = [indent + `- ${node.name}`];
        for (const c of node.children) {
          if (c.kind === KIND.DEFAULT && c.value != null && String(c.value) !== "") {
            out.push(childIndent + `${c.name}: ${c.value}`);
          }
        }
        return out;
      }
      return [indent + node.name + (node.alias ? ` (${node.alias})` : "")];
    }
    const from = node.line - 1, to = lastLineOf(node) - 1;
    const src = otherLines.slice(from, to + 1);
    const srcIndent = (src[0].match(/^ */) || [""])[0].length;
    const delta = indent.length - srcIndent;
    return src.map((l) => {
      const lead = (l.match(/^ */) || [""])[0].length;
      return " ".repeat(Math.max(0, lead + delta)) + l.trimStart();
    });
  };

  // attributes and defaults `other` alone declares, directly under kept's
  // own line-form declarations (or its line when it has none)
  const attrLines = [];
  for (const c of d.attrsOnlyB) attrLines.push(...subtreeLines(c));
  if (attrLines.length) {
    const own = kept.children.filter((c) => c.kind !== KIND.INDIVIDUAL && !c.cell);
    const after = own.length ? lastLineOf(own[own.length - 1]) : kept.line;
    ops.push({ type: "insert", afterLine: after, text: attrLines.join("\n") });
  }

  // Examples `other` alone lists: rows when kept has a grid and the Example
  // is flat (only attribute values), '- name' subtrees otherwise
  const grid = tablesOf(lines, rootName).find((t) => t.name.toLowerCase() === kept.name.toLowerCase());
  const flat = (ex) => ex.children.every((c) => c.kind === KIND.DEFAULT);
  const asRows = grid ? d.examplesOnlyB.filter(flat) : [];
  const asLines = grid ? d.examplesOnlyB.filter((ex) => !flat(ex)) : d.examplesOnlyB;
  if (asRows.length) {
    const rows = asRows.map((ex) => grid.header.map((h, k) => {
      if (k === 0) return ex.name;
      const key = headerColName(h).toLowerCase();
      const hit = ex.children.find((c) => c.kind === KIND.DEFAULT
        && (c.name.toLowerCase() === key || (c.alias && c.alias.toLowerCase() === key)));
      return hit && hit.value != null ? String(hit.value) : "";
    }));
    const u = updateTable(lines, grid.name, grid.header, [...grid.rows, ...rows], rootName, registry);
    if (u && u.changed) ops.push({ type: "block", from: u.from, to: u.to, block: u.block });
  }
  if (asLines.length) {
    const exLines = [];
    for (const ex of asLines) exLines.push(...subtreeLines(ex));
    // after the last Example's whole subtree, so the merged ones are siblings
    const exs = kept.children.filter((c) => c.kind === KIND.INDIVIDUAL && !c.cell);
    const last = exs.length ? exs[exs.length - 1] : kept.children[kept.children.length - 1];
    ops.push({ type: "insert", afterLine: last ? lastLineOf(last) : kept.line, text: exLines.join("\n") });
  }
  return ops;
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

// A header cell's column name: the term minus its width cookie, its
// constraint and its (alias).
function headerColName(cell) {
  let name = splitConstraint(widthCookie(cell).text).value;
  if (name.endsWith(")") && name.includes("(")) name = name.slice(0, name.lastIndexOf("(")).trim();
  return name;
}

// The Examples in a Concept's scope, document order: every INDIVIDUAL in
// its subtree that no deeper Concept claims.
function scopeRowsOf(concept) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (c.kind === KIND.CONCEPT) continue;
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
    // a row silent on a column answers the nearest enclosing default
    const valueAt = (r, key) => {
      const match = (c) => isAttrKind(c)
        && (c.name.toLowerCase() === key || (c.alias && c.alias.toLowerCase() === key));
      const own = r.children.find(match);
      if (own) return own.kind === KIND.DEFAULT ? own.value || "" : "";
      for (let p = r.parent; p; p = p.parent) {
        const hit = p.children.find((c) => c.kind === KIND.DEFAULT && !c.cell && match(c));
        if (hit) return hit.value || "";
        if (p === concept) break;
      }
      return "";
    };
    out.push({
      name: concept.name,
      node: concept,
      header: ["name", ...names.values()],
      rows: scopeRows.map((r) => [r.name, ...[...names.keys()].map((k) => valueAt(r, k))]),
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
// when it has one, else as a '- ' block. Nothing is ever deleted; a blank
// cell says nothing; a value carrying a formula is left to its formula.
// Returns ops in the updateExamples shape — plus { type: "block", from,
// to, block } (0-based inclusive lines) for a touched table, redrawn
// aligned exactly as updateTable redraws one.
function updateScope(lines, root, nodes, concept, header, rows, rootName) {
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
  const touched = []; // { t, rows: updated cell arrays, changed }
  for (const t of inScope) {
    const colNames = t.header.map(headerColName);
    let changed = false;
    const nextRows = t.rows.map((cellsRow) => {
      const next = cellsRow.slice();
      const rowName = splitCell(next[0] || "").value.trim();
      const csvRow = rowName && byName.get(rowName.toLowerCase());
      if (!csvRow || matched.has(rowName.toLowerCase())) return next;
      matched.add(rowName.toLowerCase());
      for (let k = 1; k < t.header.length; k++) {
        const at = colNames[k] && csvIdx.get(colNames[k].toLowerCase());
        if (!at) continue;
        const v = (csvRow[at] || "").trim();
        if (!v) continue; // a blank cell says nothing
        const cur = splitCell(next[k] || "");
        if (cur.eq !== -1) continue; // a formula owns its value
        if (readValue(cur.value.trim()) === v) continue;
        next[k] = v;
        changed = true;
      }
      return next;
    });
    touched.push({ t, rows: nextRows, changed });
  }
  // the rest: line-form Examples merge in place, fresh names land in the
  // Concept's own shape — its direct table when it has one, else '- ' form
  const lineNames = new Set(concept.children
    .filter((c) => c.kind === KIND.INDIVIDUAL && !(lines[c.line - 1] || "").trim().startsWith("|"))
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
  if (freshRows.length && direct) {
    const own = touched.find((x) => x.t === direct);
    for (const r of freshRows) {
      own.rows.push(direct.header.map((cell, k) => {
        if (k === 0) return (r[0] || "").trim();
        const at = csvIdx.get(headerColName(cell).toLowerCase());
        return at ? (r[at] || "").trim() : "";
      }));
    }
    own.changed = true;
  }
  // a touched table is redrawn whole, aligned, appended rows included
  for (const { t, rows: nextRows, changed } of touched) {
    if (!changed) continue;
    const block = render({
      indent: t.indent,
      rows: [
        { sep: false, cells: t.header },
        { sep: true, cells: [] },
        ...nextRows.map((cells) => ({ sep: false, cells })),
      ],
    });
    ops.push({ type: "block", from: t.start, to: t.end, block });
  }
  return ops;
}

module.exports = {
  auditValues, recomputeValues, copyToSiblings, hostsOf, constraintOf,
  referencesAt, conceptScope, conceptRegistry, addExample, updateExamples,
  formulaReferences, mirrorGrids, updateScope,
  diffConcepts, conceptDiffClause, mergeConceptOps, lastLineOf, renumberExamples, renumberConcepts,
};
