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
// `@attr@Example` reads the named sibling Example's value. Numeric `@N`
// references are table-only and error here. A constraint's references
// resolve per value, against that value's own Example or row — so
// `total >=@price` holds each row's total to its own price.
//
// Pure: parse once (linter.js), audit or recompute over the shared tree.
// Used by the VS Code extension (extension.js). table.js provides the
// evaluator; requiring linter.js here is safe (linter never requires this).

const { KIND, INDENT } = require("./linter");
const {
  splitCell, evalFormula, formatValue, compareValues, longestMatch,
  satisfiesTypes, valueType, tablesOf, updateTable, describeBound,
  cells, referenceSpans,
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
  const tableOnly = (c) => {
    if (typeof c === "number") throw new Error("numeric @N references are table-only — use @attribute name");
    return c;
  };
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
    // line form has no grid, so no column carries a number: `@1` can only
    // name an Example, and tableOnly still rejects a number that names none
    hasColumn: () => false,
    matchColumn: (rest) => longestMatch(rest, nameCands),
    matchRow: (rest) => longestMatch(rest, rowCands),
    cell: (c) => {
      const v = valueOn(d.parent, tableOnly(c));
      return v === undefined ? "" : v;
    },
    cellAt: (c, ex) => {
      const v = valueOn(ex, tableOnly(c));
      return v === undefined ? "" : v;
    },
    column: (c) => {
      const id = tableOnly(c);
      return examples.filter((ex) => ex !== host)
        .map((ex) => valueOn(ex, id))
        .filter((v) => v !== undefined);
    },
    matchTable: registry ? (rest) => longestMatch(rest, registry.cands) : undefined,
    table: registry ? (id) => registry.scopes.get(id) : undefined,
  };
}

// A read-only evaluation scope over a line-form Concept: its Examples are
// the rows, and the attribute names beneath it — its own defaults and its
// Examples' — are the columns. Exactly the shape table.js's foreignScope
// gives a table's grid, so the evaluator needs no new case and
// `@Integer@35@is prime` reads the way `@Order@price@Acme` does: a Concept
// written line-form and one written as a table are the same idea, so they
// are referenced the same way.
//
// An Example that is silent on an attribute answers the Concept's own
// default — the inheritance the tree already means. A line-form Concept has
// no columns to number, so `hasColumn` is false throughout and a numeric
// part can only name an Example, which is what a Concept whose Examples are
// numbers (`- 1`, `- 35`) needs.
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
    hasColumn: () => false,
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

// The line-form Concepts one file offers to cross-Concept references: a Map
// from each Concept's name (lowercased) to a conceptScope over it, keyed the
// way table.js's tableRegistry keys a table. The first Concept wins a shared
// name.
//
// A Concept is worth registering when it has something to answer with, which
// is either of the two things a Concept can hold: **Examples** (the rows a
// reference reaches with `@Integer@35@is prime`) or **values of its own**
// (the defaults a reference reaches with `@Measurement@alias`). A Concept
// with neither — a bare name, or one holding only sub-Concepts — answers
// nothing, so it stays out.
//
// Merge it *beneath* the same file's tableRegistry (mergeRegistries — later
// wins): a Concept written as a table keeps the table's own scope, which is
// the sharper reading of the same rows.
const answersSomething = (n) => n.children.some((c) =>
  c.kind === KIND.INDIVIDUAL || (c.kind === KIND.DEFAULT && c.value));

function conceptRegistry(root, nodes) {
  const map = new Map();
  const add = (n) => {
    const key = n.name.toLowerCase();
    if (map.has(key) || !answersSomething(n)) return;
    map.set(key, conceptScope(n));
  };
  if (root) add(root);
  for (const n of nodes) if (n.kind === KIND.CONCEPT) add(n);
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
      if (c.kind !== KIND.ATTRIBUTE || (c.op === undefined && !c.types)) continue;
      if (keys.includes(c.name.toLowerCase()) || (c.alias && keys.includes(c.alias.toLowerCase()))) return c;
    }
  }
  return null;
}

// Where a constraint sits on its declaring line: from the operator to the
// end of the term (a header cell ends at its pipe, a bare line at its end).
function constraintSpanOf(lines, a) {
  const raw = lines[a.line - 1] || "";
  let end = a.cell ? raw.indexOf("|", a.opCol) : -1;
  if (end === -1) end = raw.length;
  while (end > a.opCol && raw[end - 1] === " ") end--;
  return { startCol: a.opCol, endCol: end };
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

// Audit the line-form '=' formulas (the exact shape of table.formulas())
// and every attribute constraint: the declaration's span is returned for
// the colouring (and carries the error when its formula cannot compute);
// each value the attribute takes is validated in its own context, a
// violation pinned to the value itself (paint: false — a plain value is
// not derivation text).
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
  // the constraints: one coloured span per declaration (type clause and/or
  // bound), one check per value — types first, then the bound
  const constrained = nodes.filter((n) => n.kind === KIND.ATTRIBUTE && (n.op !== undefined || n.types));
  if (!constrained.length) return out;
  const declared = new Map(); // attribute node -> its pushed span
  for (const a of constrained) {
    const s = constraintSpanOf(lines, a);
    const span = { line: a.line, startCol: s.startCol, endCol: s.endCol, op: a.op || null, formula: a.formula };
    declared.set(a, span);
    out.push(span);
  }
  const violation = (d, message) => {
    const at = valueSpanOf(lines, d) || { startCol: 0, endCol: (lines[d.line - 1] || "").length };
    out.push({ line: d.line, startCol: at.startCol, endCol: at.endCol, paint: false, error: true, message });
  };
  for (const d of nodes) {
    if (d.kind !== KIND.DEFAULT || !d.value) continue;
    const a = constraintOf(d);
    if (!a) continue;
    // the type clause: the value must be one of the allowed types
    if (a.types && !satisfiesTypes(d.value, a.types)) {
      violation(d, `value '${d.value}' must be ${a.types.join(" or ")} ('${a.name} is ${a.types.join(" or ")}', line ${a.line}) — it reads as ${valueType(d.value)}`);
      continue;
    }
    // the bound: the value must satisfy the comparison
    if (!a.op) continue;
    let bound;
    try {
      bound = evalFormula(a.formula, makeCtx(d, current, registry));
    } catch (e) {
      // an uncomputable bound is the declaration's problem, reported once
      const span = declared.get(a);
      if (span && !span.error) {
        span.error = true;
        span.message = `constraint '${a.op}${a.formula}' on '${a.name}' does not compute — ${e.message}`;
      }
      continue;
    }
    if (!compareValues(a.op, d.value, bound)) {
      violation(d, `value '${d.value}' violates '${a.name} ${a.op} ${describeBound(bound)}' (line ${a.line}) — change the value, or the constraint`);
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
      } else if (rec.scope.node) { // a line-form Concept read as a table
        if (rec.kind === "column") { r.conceptNode = rec.scope.node; r.attrKey = rec.id; }
        else r.nodes = [rec.scope.examples[rec.id]].filter(Boolean);
      } else if (rec.scope.headerLine && rec.kind !== "table") { // a foreign grid
        const at = rec.kind === "column"
          ? { line: rec.scope.headerLine, cell: rec.id }
          : { line: (rec.scope.rowLines || [])[rec.id], cell: 1 };
        const c = at.line ? cells(lines[at.line - 1] || "")[at.cell - 1] : null;
        r.site = { line: at.line, col: c ? c.col : null };
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

module.exports = {
  auditValues, recomputeValues, copyToSiblings, hostsOf, constraintOf,
  referencesAt, conceptScope, conceptRegistry, addExample, updateExamples,
  formulaReferences,
};
