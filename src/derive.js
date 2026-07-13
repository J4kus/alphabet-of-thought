// Formulas on line-form attribute values, and constraint validation — the
// table spreadsheet (table.js) generalised to `attribute: value =formula`
// lines, plus the schema check: a constraint lives on the ATTRIBUTE
// declaration and every value the attribute takes is held to it:
//
//     Order
//         total: 30 =sum($price)      <- ranges over Order's Examples
//         cap <=100                   <- bounds every 'cap' value beneath
//         - A
//             price: 10
//             vat: 2 =$price*0.2      <- $name is a sibling attribute
//             cap: 2                  <- validated against 'cap <=100'
//         - B
//             price: 20
//             copy: 10 =$price@A      <- @Example reads the named sibling
//
// Reference semantics: `$attribute name` is the same owner's attribute
// (longest case-insensitive match, aliases included); aggregates and
// count() range over the *other* sibling Examples under the same parent;
// `$attr@Example` reads the named sibling Example's value. Numeric `$N`
// references are table-only and error here. A constraint's references
// resolve per value, against that value's own Example or row — so
// `total >=$price` holds each row's total to its own price.
//
// Pure: parse once (linter.js), audit or recompute over the shared tree.
// Used by the VS Code extension (extension.js). table.js provides the
// evaluator; requiring linter.js here is safe (linter never requires this).

const { KIND, INDENT } = require("./linter");
const { splitCell, evalFormula, formatValue, compareValues, longestMatch } = require("./table");

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

// The evaluation context for one host. `current` maps a DEFAULT node to
// its value-in-progress, so the recompute fixpoint sees fresh values.
function makeCtx(d, current) {
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
    if (typeof c === "number") throw new Error("numeric $N references are table-only — use $attribute name");
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
  };
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
      if (c.kind !== KIND.ATTRIBUTE || c.op === undefined) continue;
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
function auditValues(root, nodes, lines) {
  const out = [];
  const current = (n) => n.value || "";
  for (const d of hostsOf(nodes)) {
    const s = spanOf(lines, d);
    if (!s) continue;
    const span = { line: d.line, startCol: s.startCol, endCol: s.endCol, op: s.op, formula: s.formula };
    try {
      const computed = formatValue(evalFormula(s.formula, makeCtx(d, current)), s.value);
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
  // the constraints: one coloured span per declaration, one check per value
  const constrained = nodes.filter((n) => n.kind === KIND.ATTRIBUTE && n.op !== undefined);
  if (!constrained.length) return out;
  const declared = new Map(); // attribute node -> its pushed span
  for (const a of constrained) {
    const s = constraintSpanOf(lines, a);
    const span = { line: a.line, startCol: s.startCol, endCol: s.endCol, op: a.op, formula: a.formula };
    declared.set(a, span);
    out.push(span);
  }
  for (const d of nodes) {
    if (d.kind !== KIND.DEFAULT || !d.value) continue;
    const a = constraintOf(d);
    if (!a) continue;
    let bound;
    try {
      bound = evalFormula(a.formula, makeCtx(d, current));
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
      const at = valueSpanOf(lines, d) || { startCol: 0, endCol: (lines[d.line - 1] || "").length };
      out.push({
        line: d.line, startCol: at.startCol, endCol: at.endCol,
        paint: false, error: true,
        message: `value '${d.value}' violates '${a.name} ${a.op} ${typeof bound === "number" ? bound : `\`${bound}\``}' (line ${a.line}) — change the value, or the constraint`,
      });
    }
  }
  return out;
}

// Recompute every '=' line-form formula, five fixpoint passes so a formula
// may reference another formula's value; constraints are never rewritten.
// Returns whole-line replacements as { line, text } (1-based lines).
function recomputeValues(root, nodes, lines) {
  const hosts = hostsOf(nodes).filter((n) => n.op === "=");
  const values = new Map();
  const current = (n) => (values.has(n) ? values.get(n) : n.value || "");
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const d of hosts) {
      let out;
      try { out = formatValue(evalFormula(d.formula, makeCtx(d, current)), current(d)); }
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

module.exports = { auditValues, recomputeValues, copyToSiblings, hostsOf, constraintOf };
