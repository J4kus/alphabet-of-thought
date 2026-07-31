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
// `@attr@Example` reads the named sibling Example's value; the lookups
// (xlookup, sumifs, countifs) range over *every* Example, this one
// included, as a spreadsheet range does. References are
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
  referenceSpans, widthCookie, numberless, Choice,
} = require("./table");

// The determinate `==` bound on an attribute declaration — the one that
// *defines* every value of the attribute rather than bounding it. Answers
// the formula, or null when the declaration carries no `==`. Whether the
// bound is determinate is only known once computed (an `==or(…)` answers a
// Choice, which lists allowed values rather than naming one), so the
// callers check the computed value; this just finds the clause.
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
  // scope (table.js's `outer`); the line form answers it the same way.
  const owner = d.parent && d.parent.kind === KIND.INDIVIDUAL ? d.parent.parent : null;
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
  if (owner) owner.children.forEach(addName);
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
  // the Concept's own value for the attribute — what a silent Example inherits
  const inherited = (id) => (owner ? valueOn(owner, id) : undefined);
  const read = (on, id) => {
    let v = valueOn(on, id);
    if (v === undefined || v === "") {
      const own = inherited(id);
      if (own !== undefined && own !== "") return own;
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
    // a Concept's aggregates already range over every Example, so a lookup
    // reads the same column — named apart because the local scopes differ
    columnAll: (c) => examples.map((_, r) => valueAt(r, c)),
    // The Concept's *own* value for an attribute — the default it states on
    // its own line — or undefined where it states none. A grid has no such
    // reading (a table is rows and nothing else), which is why only a
    // Concept offers it: `@Measurement@alias` means the value Measurement
    // itself carries, the same one its Examples would inherit.
    self: (c) => valueOn(concept, c),
    // the same Examples as a grid — the first column is headed by the
    // Concept and names its Examples, as the CSV mirror writes a table's,
    // so a line-form Concept mirrors like any other
    grid: () => [
      [concept.name, ...display.values()],
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
      // A determinate '==' *defines* the value rather than bounding it, so a
      // value that differs is stale, not in violation: it recomputes exactly
      // as an '=' formula does. (An '==or(…)' answers a Choice — a list of
      // allowed values, which names no single one — and stays a bound.)
      if (con.op === "==" && !(bound instanceof Choice) && d.formula === undefined) {
        let computed;
        try { computed = formatValue(bound, d.value); } catch { continue; }
        if (computed !== d.value) {
          violation(d, `value '${d.value}' does not match its definition '${a.name} ==${con.formula}' (= ${computed}, line ${a.line}) — it recomputes when the cursor leaves the line, or on save`);
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

// Recompute every derived line-form value, five fixpoint passes so one
// derivation may reference another's value. Two kinds: a value's own '='
// formula, and a value whose attribute declaration *defines* it with a
// determinate '==' (`vat ==@price*0.2`) — the declaration carries the
// derivation, so the value follows it without one of its own, exactly as a
// '==' column fills its cells. The other constraints are never rewritten.
// A defined value that cannot compute is left alone (the declaration's own
// error says why); only an '=' formula shows #ERR in its place.
// Returns whole-line replacements as { line, text } (1-based lines).
function recomputeValues(root, nodes, lines, registry) {
  const hosts = hostsOf(nodes).filter((n) => n.op === "=");
  // values a '==' declaration defines: line-form, carrying no formula of
  // their own (an explicit '=' on the value wins, being the nearer word)
  const defined = [];
  for (const d of nodes) {
    if (d.kind !== KIND.DEFAULT || d.cell || d.formula !== undefined) continue;
    const formula = definitionOf(constraintOf(d));
    if (formula) defined.push({ d, formula });
  }
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
    for (const { d, formula } of defined) {
      let out;
      try {
        const v = evalFormula(formula, makeCtx(d, current, registry));
        if (v instanceof Choice) continue; // allowed values, not a definition
        out = formatValue(v, current(d));
      } catch { continue; }
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
  // a defined value carries no formula, so its line is `name: value` whole
  for (const { d } of defined) {
    if (!values.has(d) || values.get(d) === (d.value || "")) continue;
    const raw = lines[d.line - 1] || "";
    const colon = raw.indexOf(":");
    if (colon === -1) continue;
    edits.push({ line: d.line, text: raw.slice(0, colon + 1) + " " + values.get(d) });
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
      // the first column is headed by the Concept (1.9) and names its
      // Examples, mirroring the table's own `|Concept|attr…|` header
      header: [concept.name, ...names.values()],
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
  lastLineOf, headerColName, renumberExamples, renumberConcepts,
};
