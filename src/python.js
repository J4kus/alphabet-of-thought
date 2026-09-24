// Python written where a formula would be written, and run only when asked.
//
// `=` has one meaning — "this value is derived" — and two languages behind
// it. pyshape.js decides which from the text alone; this module is
// everything the Python half needs that is not the editor's business:
//
//   hostsOf         every Python derivation in a file: on a value, in a grid
//                   cell, or on a Concept line (where it writes the table)
//   scanReferences  the `@` references inside Python source, skipping its
//                   strings and comments, and never mistaking the matrix
//                   operator (`a @ b`) for one
//   resolve         each reference against the language's own names — the
//                   host's siblings, its Concept's defaults, any Concept in
//                   the repo — answered as a typed target the runtime can
//                   hand to Python: a live object, a value, a frame, a column
//   planRun         the order to run in (dependencies first, cycles
//                   reported), and for Ctrl+Enter the part of the file one
//                   run must bring up to date
//   Session         the persistent Python process: JSON lines over stdio,
//                   one pending request per id, timeouts that kill
//   resultEdits     what a result writes back into the file
//
// `@` is resolved here, before Python ever sees the source: each reference
// becomes `_aot_ref(k)`, an index into the targets sent with the request.
// Python never parses '@', so the same names mean the same things in both
// languages — `@Sales` is the Concept Sales in a formula and in Python alike
// (a DataFrame there, since that is what a Concept's Examples are).
//
// Pure apart from `crypto` for the run hashes. The spawn function is
// injected into Session, exactly as urls.js injects its request function,
// so every line of the protocol is tested without a Python on the machine.

const crypto = require("crypto");
const { KIND } = require("./linter");
const table = require("./table");
const derive = require("./derive");
const park = require("./park");
const { readsAsExpression } = require("./pyshape");

const PROTOCOL = 1;

// --- the hosts ---------------------------------------------------------------

// Where a line-form value's derivation stands on its line: the '=' column,
// the end of the line's text, and the value written before it.
function valueDerivation(raw) {
  const colon = raw.indexOf(":");
  if (colon === -1) return null;
  const region = raw.slice(colon + 1);
  const lead = region.length - region.trimStart().length;
  const text = region.trim();
  const split = table.splitCell(text);
  if (split.eq === -1) return null;
  return {
    startCol: colon + 1 + lead + split.eq,
    endCol: colon + 1 + lead + text.length,
    valueStart: colon + 1 + lead,
    value: split.value,
    source: text.slice(split.eq + 1).trim(),
  };
}

// Every derivation in a file — every one is Python — in document order:
// { kind: "value" | "cell" | "concept", address, source, line, startCol,
//   endCol, value, node?, cell? } — startCol..endCol is the derivation's own
// span, from its '=' to its end, which is where a failure is pinned.
function hostsOf(nodes, lines, rootName) {
  const out = [];
  for (const node of derive.hostsOf(nodes)) {
    const d = valueDerivation(lines[node.line - 1] || "");
    if (!d) continue;
    out.push({
      kind: "value", address: park.addressOf(node, rootName), source: d.source,
      line: node.line, startCol: d.startCol, endCol: d.endCol, value: d.value, node,
    });
  }
  for (const [address, where] of park.cellIndex(lines, nodes, rootName)) {
    const raw = lines[where.line - 1] || "";
    const cell = table.cells(raw)[where.col];
    if (!cell) continue;
    const split = table.splitCell(cell.text);
    if (split.eq === -1) continue;
    const source = cell.text.slice(split.eq + 1).trim();
    out.push({
      kind: "cell", address, source, line: where.line,
      startCol: cell.col + split.eq, endCol: cell.col + cell.text.length,
      value: split.value, cell: { line: where.line, col: where.col },
    });
  }
  // a Concept's own: on its line, or — once it has written its table — in
  // that table's first header cell; the parser says which span it holds
  for (const node of nodes) {
    if (node.kind !== KIND.CONCEPT || node.formula === undefined || node.formulaCol === undefined) continue;
    out.push({
      kind: "concept", address: park.conceptAddress(node), source: node.formula,
      line: node.line, startCol: node.formulaCol, endCol: node.formulaEnd, value: "", node,
    });
  }
  return out.sort((a, b) => (a.line - b.line) || (a.startCol - b.startCol));
}

// --- the constraints ---------------------------------------------------------
// A constraint's bound is Python too — `age >=18`, `cap <=@price*1.5`,
// `status ==("draft", "sent")` — checked when the derivations run, against
// each value it holds, its references resolved in that value's own row or
// Example. A `==` whose bound is one value *defines* the attribute: the run
// writes it into every value that carries no derivation of its own, the
// empty cells of a defined column included. An empty value asserts nothing
// and is never checked.

// A grid cell's value, as a host the resolver can place: its row and column.
function cellHostOf(lines, d) {
  const cs = table.cells(lines[d.line - 1] || "");
  const col = cs.findIndex((c) => c.col === d.valueCol);
  return col < 1 ? null : { kind: "cell", line: d.line, cell: { line: d.line, col }, node: d };
}

// Every value a constraint holds, with the chain that holds it:
// [{ host, value, derived, a, chain: [{ op, formula, parked? }] }]. `parked`
// (optional) is park.parkedConstraints' Map — a parked bound still holds.
function constraintChecks(nodes, lines, parked) {
  const out = [];
  const seen = new Set();
  for (const d of nodes) {
    if (d.kind !== KIND.DEFAULT) continue;
    const held = derive.constraintOf(d, parked);
    if (!held) continue;
    const host = d.cell ? cellHostOf(lines, d) : { kind: "value", node: d, line: d.line };
    if (!host) continue;
    seen.add(`${d.line}:${host.cell ? host.cell.col : "v"}`);
    out.push({ host, value: d.value || "", derived: d.formula !== undefined, a: held.a, chain: held.constraints });
  }
  // a column a header defines with `==` fills its empty cells too: they are
  // no node, so they are found from the grid
  for (const a of nodes) {
    if (a.kind !== KIND.ATTRIBUTE || !a.cell) continue;
    const chain = [...(a.constraints || []), ...((parked && parked.get(a)) || [])];
    if (!chain.some((c) => c.op === "==")) continue;
    const block = table.blockAt(lines, a.line - 1);
    if (!block) continue;
    const col = table.cells(lines[a.line - 1] || "").findIndex((c) => c.col === a.nameCol);
    if (col < 1) continue;
    block.rows.forEach((row, k) => {
      const line = block.start + k + 1;
      if (row.sep || line === a.line || seen.has(`${line}:${col}`)) return;
      const text = row.cells[col] || "";
      const split = table.splitCell(text);
      out.push({
        host: { kind: "cell", line, cell: { line, col } }, value: split.value, derived: split.eq !== -1, a, chain,
        definesOnly: true,
      });
    });
  }
  return out;
}

// The requests a run sends for the checks: one per clause with something to
// say — an empty value is held to nothing, but a `==` may still define it —
// each bound resolved where its value stands, as a derivation there would be.
// [{ check, clause, k, errors, item: { code, targets, rel, value } | null }]:
// a bound whose references name nothing has no item, only its errors.
function checkItems(checks, ctx) {
  const out = [];
  for (const check of checks) {
    check.chain.forEach((clause, k) => {
      if (clause.op !== "==" && (check.definesOnly || !String(check.value).trim())) return;
      let r;
      try { r = resolveHost(Object.assign({}, check.host, { source: clause.formula }), ctx); }
      catch (e) { r = { errors: [e.message] }; }
      const errors = r.errors || [];
      out.push({
        check, clause, k, errors,
        item: errors.length ? null : { address: "constraint", code: r.code, targets: r.targets, rel: clause.op, value: check.value },
      });
    });
  }
  return out;
}

// --- the references ----------------------------------------------------------

const PY_KEYWORDS = new Set([
  "and", "or", "not", "in", "is", "if", "else", "elif", "for", "while", "lambda", "return",
  "yield", "await", "assert", "del", "import", "from", "as", "with", "print",
]);

// The `@` references in Python source, as { start } offsets of each '@' that
// opens one — strings, f-string text and comments skipped, and an '@' that
// follows an operand (a name, a number, a closing bracket) left alone as the
// matrix operator. Where each reference ends is the resolver's to say, since
// a name may hold spaces (`@basket size`).
function referenceStarts(src) {
  const out = [];
  let i = 0;
  let operand = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "#") break; // a comment runs to the end of the line
    // a string: its prefix letters were read as a name just before, so the
    // quote itself is what is recognised here
    if (ch === "'" || ch === "\"") {
      const triple = src.startsWith(ch.repeat(3), i);
      const close = triple ? ch.repeat(3) : ch;
      let j = i + close.length;
      while (j < src.length && !src.startsWith(close, j)) j += src[j] === "\\" ? 2 : 1;
      i = Math.min(src.length, j + close.length);
      operand = true;
      continue;
    }
    if (ch === "@") {
      if (!operand) out.push({ start: i });
      i++;
      operand = false;
      continue;
    }
    if (/[\p{L}_]/u.test(ch)) {
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_]/u.test(src[j])) j++;
      const word = src.slice(i, j);
      // a keyword expects an operand after it; a string prefix (f, r, b, rb…)
      // glued to a quote is part of the string that follows
      operand = !PY_KEYWORDS.has(word);
      if ((src[j] === "'" || src[j] === "\"") && /^[rbfuRBFU]{1,2}$/.test(word)) operand = false;
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9._a-zA-Z]/.test(src[j])) j++;
      i = j;
      operand = true;
      continue;
    }
    if (ch === " ") { i++; continue; }
    operand = ch === ")" || ch === "]" || ch === "}";
    i++;
  }
  return out;
}

// The functions a derivation calls by name — `load()`, `finance.revenue(…)`,
// `aot.use("tools/x.py").total(…)` — each as { start, length, module, name,
// used }: start..length is the callee as written, which the editor underlines
// and Ctrl+click opens once it finds the file defining it; `module` is the
// dotted path before the name ("" for a bare call), `used` the path an
// aot.use names. A method called on a reference (`@Sales.amount.sum()`) or
// on a result (`load().head()`) belongs to that object and is none of these;
// strings and comments are skipped.
function callSites(src) {
  const out = [];
  const name = /^[\p{L}_][\p{L}\p{N}_]*(?:\s*\.\s*[\p{L}_][\p{L}\p{N}_]*)*/u;
  let i = 0;
  let afterDot = false; // the last thing read was a '.': what follows is a member
  while (i < src.length) {
    const ch = src[i];
    if (ch === "#") break;
    if (ch === "'" || ch === "\"") {
      const triple = src.startsWith(ch.repeat(3), i);
      const close = triple ? ch.repeat(3) : ch;
      let j = i + close.length;
      while (j < src.length && !src.startsWith(close, j)) j += src[j] === "\\" ? 2 : 1;
      i = Math.min(src.length, j + close.length);
      afterDot = false;
      continue;
    }
    if (ch === "@") {
      // the reference and whatever is read off it: names, spaces within a
      // name, dots — up to the first thing that is none of those, or a word
      // of Python's own
      let j = i + 1;
      while (j < src.length) {
        if (/[\p{L}\p{N}_.@]/u.test(src[j])) { j++; continue; }
        if (src[j] !== " ") break;
        const next = /^ +([\p{L}_][\p{L}\p{N}_]*)(?![\p{L}\p{N}_])/u.exec(src.slice(j));
        if (!next || PY_KEYWORDS.has(next[1])) break;
        j++;
      }
      i = j;
      afterDot = false;
      continue;
    }
    if (/[\p{L}_]/u.test(ch)) {
      const used = /^aot\s*\.\s*use\(\s*(["'])(.*?)\1\s*\)\s*\.\s*([A-Za-z_]\w*)(?=\s*\()/.exec(src.slice(i));
      if (used && !afterDot) {
        out.push({ start: i, length: used[0].length, module: "", name: used[3], used: used[2] });
        i += used[0].length;
        continue;
      }
      const m = name.exec(src.slice(i));
      const end = i + m[0].length;
      let k = end;
      while (src[k] === " ") k++;
      if (src[k] === "(" && !afterDot) {
        const parts = m[0].split(".").map((s) => s.trim());
        if (!(parts.length === 1 && PY_KEYWORDS.has(parts[0]))) {
          out.push({ start: i, length: m[0].length, module: parts.slice(0, -1).join("."), name: parts[parts.length - 1], used: null });
        }
      }
      // a string prefix glued to its quote is the string's
      i = end;
      afterDot = false;
      continue;
    }
    if (ch !== " ") afterDot = ch === ".";
    i++;
  }
  return out;
}

// A reference's target, the shape the runtime turns into a Python value:
//   { kind: "object", address, column?, row? }   a Python derivation's live
//                                                result (a column or cell of
//                                                it when the reference goes on)
//   { kind: "value", text }                      one value, typed on arrival
//   { kind: "frame", name, header, rows }        a Concept, as a DataFrame
//   { kind: "column", name, values }             a Concept's column, a Series
//   { kind: "record", name, fields }             an Example, as a dict
// resolveAt answers { length, target } for the text after one '@', or null.

const fold = (s) => table.numberless(String(s || "").trim()).toLowerCase();

// The Python derivations of a file by what they are hosted on, so a
// reference to one resolves to its live object rather than its written value.
function hostIndex(hosts) {
  const byNode = new Map();
  const byConcept = new Map();
  const byCell = new Map();
  for (const h of hosts) {
    if (h.kind === "value") byNode.set(h.node, h);
    else if (h.kind === "concept") byConcept.set(fold(h.node.name), h);
    else byCell.set(`${h.cell.line}:${h.cell.col}`, h);
  }
  return { byNode, byConcept, byCell };
}

// A Concept carrying its own derivation, named at the head of `rest`:
// { length, host } or null. Longest name wins, as every reference resolves.
function derivedConcept(rest, index) {
  const m = table.longestMatch(rest, [...index.byConcept.keys()].map((key) => ({ key, id: key })));
  return m ? { length: m.length, host: index.byConcept.get(m.id) } : null;
}

// After a Concept is named, the rest of a cross-Concept reference: a column,
// an Example, or both in either order — `@Sales@units@Q1` and `@Sales@Q1@units`.
function conceptTail(src, at, scope, index) {
  const derived = index.byConcept.get(fold(scope.name));
  let i = at;
  let column = null, row = null;
  const names = [];
  for (let step = 0; step < 2 && src[i] === "@"; step++) {
    const rest = src.slice(i + 1);
    const c = column === null ? scope.matchColumn(rest) : null;
    const r = row === null ? scope.matchRow(rest) : null;
    if (!c && !r) break;
    const asCol = c && (!r || c.length >= r.length);
    if (asCol) {
      column = c.id;
      names.push({ offset: i + 1, length: c.length, kind: "column", conceptNode: scope.node, attrKey: c.id });
    } else {
      row = r.id;
      names.push({ offset: i + 1, length: r.length, kind: "row", nodes: [scope.examples[r.id]].filter(Boolean) });
    }
    i += 1 + (asCol ? c.length : r.length);
  }
  const display = (id) => {
    const k = scope.columns.findIndex((n) => n.toLowerCase() === id);
    return k === -1 ? id : scope.columns[k];
  };
  let target;
  if (derived) {
    // the live frame the Concept's own Python made: the reference reads it
    target = { kind: "object", address: derived.address };
    if (column !== null) target.column = display(column);
    if (row !== null) target.row = scope.rows[row];
  } else if (column !== null && row !== null) {
    target = { kind: "value", text: scope.cellAt(column, row) };
  } else if (column !== null) {
    target = { kind: "column", name: display(column), values: scope.column(column), index: scope.rows };
  } else if (row !== null) {
    const ex = scope.examples[row];
    target = recordOf(ex, scope);
  } else {
    const grid = scope.grid();
    target = { kind: "frame", name: scope.name, header: grid[0], rows: grid.slice(1) };
  }
  return { length: i - at, target, names };
}

// An Example as a dict of its attributes, the Concept's defaults filling in
// what it is silent on.
function recordOf(ex, scope) {
  const fields = {};
  if (scope) {
    for (const col of scope.columns) {
      const r = scope.examples.indexOf(ex);
      fields[col] = r === -1 ? "" : scope.cellAt(col.toLowerCase(), r);
    }
  } else {
    for (const c of ex.children) {
      if (c.kind === KIND.DEFAULT) fields[c.name] = c.value || "";
    }
  }
  return { kind: "record", name: ex.name, fields };
}

// The resolver for a line-form value or a Concept line: the host's own
// siblings and its Concept's defaults first (the local reading a formula
// gets), then any Concept in the registry.
function lineResolver(host, registry, index) {
  // a Concept line reads what a value on its parent would read
  const anchor = host.kind === "concept"
    ? { kind: KIND.DEFAULT, name: "", parent: host.node.parent, children: [] }
    : host.node;
  const ctx = derive.makeCtx(anchor, (n) => n.value || "", registry);
  const owner = anchor.parent && anchor.parent.kind === KIND.INDIVIDUAL ? anchor.parent.parent : null;
  // the attribute node a local name reads — the host's own owner first, then
  // the Concept whose default an Example inherits
  const nodeFor = (id) => {
    for (const where of [anchor.parent, owner]) {
      if (!where) continue;
      const hit = where.children.find((c) => c.kind === KIND.DEFAULT
        && (c.name.toLowerCase() === id || (c.alias && c.alias.toLowerCase() === id)));
      if (hit) return hit;
    }
    return null;
  };
  // every declaration a local attribute name means — on the owner, its
  // sibling Examples and the Concept above — for a rename to follow
  const { examples } = derive.scopeOf(anchor);
  const owners = [...new Set([anchor.parent, owner, ...examples])].filter(Boolean);
  const attrsNamed = (id) => owners.flatMap((o) => o.children.filter((c) =>
    (c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE) && c.name.toLowerCase() === id));
  return (src, at) => {
    const rest = src.slice(at + 1);
    const col = ctx.matchColumn(rest);
    const row = ctx.matchRow(rest);
    const tab = ctx.matchTable ? ctx.matchTable(rest) : null;
    const der = derivedConcept(rest, index);
    const best = Math.max(col ? col.length : 0, row ? row.length : 0, tab ? tab.length : 0, der ? der.length : 0);
    if (!best) return null;
    // a Concept's name that reads further than any local one — `@Integer@is
    // prime`, where `integer` is also a local alias but only the Concept
    // Integer has an `is prime` — is the Concept: the local reading would
    // leave `@is prime` behind as Python's matrix operator
    if (tab) {
      const scope = ctx.table(tab.id);
      const tail = scope ? conceptTail(src, at + 1 + tab.length, scope, index) : null;
      if (tail && tail.length) {
        const after = (n) => at + 1 + n;
        const colReach = col ? after(col.length) + (src[after(col.length)] === "@" && ctx.matchRow(src.slice(after(col.length) + 1))
          ? 1 + ctx.matchRow(src.slice(after(col.length) + 1)).length : 0) : 0;
        const rowReach = row ? after(row.length) + (src[after(row.length)] === "@" && ctx.matchColumn(src.slice(after(row.length) + 1))
          ? 1 + ctx.matchColumn(src.slice(after(row.length) + 1)).length : 0) : 0;
        const tabReach = after(tab.length) + tail.length;
        if (tabReach > colReach && tabReach > rowReach) {
          const names = [{ offset: at + 1, length: tab.length, kind: "table", id: tab.id }, ...tail.names];
          return { length: tabReach - at, target: tail.target, names };
        }
      }
    }
    // a Concept whose own Python has not written its rows yet is in no
    // registry — it has nothing to answer with — but it is still the frame
    // its derivation will make
    if (der && der.length === best && !(col && col.length === best) && !(row && row.length === best) && !(tab && tab.length === best)) {
      const names = [{ offset: at + 1, length: der.length, kind: "table", nodes: [der.host.node] }];
      return { length: 1 + der.length, target: { kind: "object", address: der.host.address }, names };
    }
    if (col && col.length === best) {
      let end = at + 1 + col.length;
      const names = [{ offset: at + 1, length: col.length, kind: "column", nodes: attrsNamed(col.id) }];
      // `@price@Acme`: the named sibling Example's value
      if (src[end] === "@") {
        const r = ctx.matchRow(src.slice(end + 1));
        if (r) {
          names.push({ offset: end + 1, length: r.length, kind: "row", nodes: [r.id] });
          end += 1 + r.length;
          return { length: end - at, target: { kind: "value", text: ctx.cellAt(col.id, r.id) }, names };
        }
      }
      const node = nodeFor(col.id);
      const derived = node && index.byNode.get(node);
      if (derived && derived !== host) return { length: end - at, target: { kind: "object", address: derived.address }, names };
      return { length: end - at, target: { kind: "value", text: ctx.cell(col.id) }, names };
    }
    if (row && row.length === best) {
      let end = at + 1 + row.length;
      const names = [{ offset: at + 1, length: row.length, kind: "row", nodes: [row.id] }];
      if (src[end] === "@") {
        const c = ctx.matchColumn(src.slice(end + 1));
        if (c) {
          names.push({ offset: end + 1, length: c.length, kind: "column", nodes: attrsNamed(c.id) });
          end += 1 + c.length;
          return { length: end - at, target: { kind: "value", text: ctx.cellAt(c.id, row.id) }, names };
        }
      }
      return { length: end - at, target: recordOf(row.id), names };
    }
    const scope = ctx.table(tab.id);
    if (!scope) return null;
    const tail = conceptTail(src, at + 1 + tab.length, scope, index);
    const names = [{ offset: at + 1, length: tab.length, kind: "table", id: tab.id }, ...tail.names];
    return { length: 1 + tab.length + tail.length, target: tail.target, names };
  };
}

// The resolver for a grid cell: the same row's columns, then any Concept.
function cellResolver(host, lines, registry, rootName, index) {
  const at0 = host.line - 1;
  const block = table.blockAt(lines, at0);
  const rows = table.dataRowsOf(block);
  const row = rows.find((r) => block.start + block.rows.indexOf(r) === at0);
  const header = block.rows[table.headerIndex(block)].cells;
  const outer = table.enclosingScope(lines, block, registry, rootName);
  const ctx = table.tableCtx(rows, row, header, registry, outer);
  const headerLine = block.start + table.headerIndex(block) + 1;
  const headerCells = table.cells(lines[headerLine - 1] || "");
  return (src, at) => {
    const rest = src.slice(at + 1);
    const col = ctx.matchColumn(rest);
    const tab = ctx.matchTable ? ctx.matchTable(rest) : null;
    const der = derivedConcept(rest, index);
    if (der && (!col || der.length > col.length) && (!tab || der.length > tab.length)) {
      const names = [{ offset: at + 1, length: der.length, kind: "table", nodes: [der.host.node] }];
      return { length: 1 + der.length, target: { kind: "object", address: der.host.address }, names };
    }
    // a Concept reading further than the column's name is the Concept (as
    // lineResolver says)
    let tail = null;
    if (tab) {
      const scope = ctx.table(tab.id);
      tail = scope ? conceptTail(src, at + 1 + tab.length, scope, index) : null;
    }
    const tabFurther = tail && tail.length && (!col || tab.length + tail.length > col.length);
    if (col && !tabFurther && (!tab || col.length >= tab.length)) {
      const end = at + 1 + col.length;
      const names = [typeof col.id === "number"
        ? { offset: at + 1, length: col.length, kind: "column", site: { line: headerLine, col: (headerCells[col.id - 1] || {}).col } }
        : { offset: at + 1, length: col.length, kind: "column", conceptNode: outer && outer.node, attrKey: col.id }];
      if (typeof col.id === "number") {
        const derived = index.byCell.get(`${host.line}:${col.id - 1}`);
        if (derived && derived !== host) return { length: end - at, target: { kind: "object", address: derived.address }, names };
      }
      return { length: end - at, target: { kind: "value", text: ctx.cell(col.id) }, names };
    }
    if (!tail) return null;
    const names = [{ offset: at + 1, length: tab.length, kind: "table", id: tab.id }, ...tail.names];
    return { length: 1 + tab.length + tail.length, target: tail.target, names };
  };
}

// Resolve every reference in a host's source. Answers { code, targets, deps,
// errors, spans }: the source with each reference as `_aot_ref(k)`, the
// targets they stand for, the addresses of the Python derivations it reads
// (its dependencies), one message per reference that names nothing, where
// each resolved reference stands in the source ({ start, length, text }), and
// each name inside one with the declaration it means ({ start, length, text,
// kind, nodes | conceptNode+attrKey | site | id }) — what F2's rename follows.
function resolveHost(host, ctx) {
  const index = ctx.index;
  const resolveAt = host.kind === "cell"
    ? cellResolver(host, ctx.lines, ctx.registry, ctx.rootName, index)
    : lineResolver(host, ctx.registry, index);
  const src = host.source;
  const targets = [];
  const deps = new Set();
  const errors = [];
  const spans = [];
  const names = []; // each name a reference holds, and what it resolved to
  let code = "";
  let last = 0;
  for (const { start } of referenceStarts(src)) {
    if (start < last) continue;
    let hit = null;
    try { hit = resolveAt(src, start); } catch (e) { errors.push(e.message); }
    if (!hit) {
      const name = (/^@[\p{L}\p{N}_ ]*/u.exec(src.slice(start)) || ["@"])[0].trim();
      errors.push(`${name} names nothing here — no attribute, Example or Concept is called that`);
      continue;
    }
    code += src.slice(last, start) + `_aot_ref(${targets.length})`;
    targets.push(hit.target);
    spans.push({ start, length: hit.length, text: src.slice(start, start + hit.length) });
    for (const n of hit.names || []) names.push(Object.assign({ start: n.offset, text: src.slice(n.offset, n.offset + n.length) }, n));
    if (hit.target.kind === "object") deps.add(hit.target.address);
    last = start + hit.length;
  }
  code += src.slice(last);
  return { code, targets, deps: [...deps], errors, spans, names };
}

// --- the repository's own Python ---------------------------------------------
// A derivation can name any module — `=finance.revenue(@Sales)` — and the
// runtime finds it: the standard library or an installed package first, then
// `aot.files/finance.py`, `finance.py` at the repository's root, the one
// `finance.py` anywhere else, or a dotted path from the root (`tools.finance`).
// The editor resolves the same way, from the same list of files, to know which
// files a derivation's value depends on — so a change to one makes stale
// exactly the derivations that use it.

const pathLib = require("path");

// The files a module name reaches, by the runtime's own order: [] when it
// names none of the repository's (a package is every file beneath it).
function moduleFiles(name, index, root, aotFiles) {
  const key = (p) => pathLib.resolve(p).toLowerCase();
  const byKey = new Map(index.map((f) => [key(f), f]));
  const under = (dir) => index.filter((f) => key(f).startsWith(key(dir) + pathLib.sep));
  for (const base of [aotFiles, root]) {
    if (!base) continue;
    const file = byKey.get(key(pathLib.join(base, name + ".py")));
    if (file) return [file];
    const inside = under(pathLib.join(base, name));
    if (inside.length) return inside;
  }
  return index.filter((f) => pathLib.basename(f, ".py") === name);
}

// The modules a derivation's source names — each name followed by a '.',
// outside a string, and not itself an attribute — and the paths it loads with
// aot.use("…").
function referencedModules(source) {
  const names = new Set();
  const paths = [];
  const src = String(source || "");
  for (const m of src.matchAll(/aot\.use\(\s*(["'])(.*?)\1\s*\)/g)) paths.push(m[2]);
  // strings blanked out, so a name inside one is never taken for a module
  const bare = src.replace(/(["'])(?:\\.|(?!\1).)*\1/g, (s) => " ".repeat(s.length));
  for (const m of bare.matchAll(/(?<![\w.@])([A-Za-z_]\w*)\s*\./g)) {
    if (m[1] !== "aot") names.add(m[1]);
  }
  return { names: [...names], paths };
}

// --- the plan ----------------------------------------------------------------

// Dependencies first. Answers { order, cycles }: every address in an order
// that runs each derivation after the ones it reads, and the members of each
// cycle (which never run — a derivation that reads itself has no first value).
function orderDerivations(hosts, depsOf) {
  const byAddress = new Map(hosts.map((h) => [h.address, h]));
  const state = new Map(); // address -> 1 visiting, 2 done
  const order = [];
  const cycles = [];
  const inCycle = new Set();
  const visit = (a, stack) => {
    if (state.get(a) === 2) return;
    if (state.get(a) === 1) {
      const loop = stack.slice(stack.indexOf(a));
      cycles.push(loop);
      loop.forEach((x) => inCycle.add(x));
      return;
    }
    state.set(a, 1);
    for (const d of depsOf(a) || []) if (byAddress.has(d)) visit(d, [...stack, a]);
    state.set(a, 2);
    order.push(a);
  };
  for (const h of hosts) visit(h.address, []);
  return { order: order.filter((a) => !inCycle.has(a)), cycles };
}

// What Ctrl+Enter on one derivation must run: the derivation itself, every
// derivation downstream of it (so nothing that reads it is left stale), and
// whatever upstream `needs` says cannot be read as it stands — stale, or
// never computed in this session.
function affected(hosts, depsOf, address, needs) {
  const readers = new Map();
  for (const h of hosts) {
    for (const d of depsOf(h.address) || []) {
      if (!readers.has(d)) readers.set(d, []);
      readers.get(d).push(h.address);
    }
  }
  const out = new Set([address]);
  const down = [address];
  while (down.length) {
    for (const r of readers.get(down.pop()) || []) {
      if (!out.has(r)) { out.add(r); down.push(r); }
    }
  }
  const up = [...out];
  while (up.length) {
    for (const d of depsOf(up.pop()) || []) {
      if (!out.has(d) && needs(d)) { out.add(d); up.push(d); }
    }
  }
  return out;
}

// A derivation's run hash: its source, what its references read, and the
// sidecar it may call. Equal hashes mean a run would see exactly what the
// last one saw — the derivation is fresh. A live object's hash is its own
// run's, so a change upstream reaches everything reading it.
function runHash(source, targets, sidecarHash, upstream) {
  const h = crypto.createHash("sha1");
  h.update(JSON.stringify([source, targets.map((t) => (t.kind === "object" ? [t.address, t.column, t.row] : t)), sidecarHash || "", upstream || []]));
  return h.digest("hex").slice(0, 16);
}

// Just the source: whether a derivation was edited since it last ran.
const sourceHash = (source) => crypto.createHash("sha1").update(String(source)).digest("hex").slice(0, 16);

// --- the session -------------------------------------------------------------
// One Python process per document, alive between runs so a DataFrame made by
// one derivation is still there when the next reads it. JSON lines: one
// request per line on stdin, one response per line on stdout, matched by id.

class Session {
  // spawnFn(command, args, options) → a child process: { stdin, stdout,
  // stderr, on(event, fn), kill() }
  constructor(spawnFn, options) {
    this.spawnFn = spawnFn;
    this.options = options || {};
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.stderr = "";
    this.alive = false;
    this.proc = null;
    this.onExit = null;
  }

  start() {
    const o = this.options;
    const args = ["-B", "-E", "-u", "-X", "utf8", o.runtime];
    const env = Object.assign({}, o.env || process.env, {
      PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8", MPLBACKEND: "Agg",
    });
    let proc;
    try {
      proc = this.spawnFn(o.python || "python", args, { cwd: o.cwd, env, windowsHide: true });
    } catch (e) {
      throw new Error(spawnMessage(e, o.python));
    }
    this.proc = proc;
    this.alive = true;
    // decoded at the stream, so a character split across two chunks arrives whole
    if (proc.stdout.setEncoding) proc.stdout.setEncoding("utf8");
    if (proc.stderr && proc.stderr.setEncoding) proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => this.receive(chunk));
    if (proc.stderr) proc.stderr.on("data", (chunk) => { this.stderr = (this.stderr + chunk).slice(-4000); });
    proc.on("error", (e) => this.die(spawnMessage(e, o.python)));
    proc.on("exit", (code) => this.die(`Python exited (code ${code})${this.stderr ? ` — ${lastLine(this.stderr)}` : ""}`));
    return this;
  }

  receive(chunk) {
    this.buffer += String(chunk);
    const max = this.options.maxResultBytes || 8e6;
    if (this.buffer.length > max && this.buffer.indexOf("\n") === -1) {
      return this.die(`a result larger than ${Math.round(max / 1e6)} MB (aot.python.maxResultBytes) — return less, or write it to a file`);
    }
    let nl;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch {
        // a frame that is not JSON: reject the request it names, if any
        const m = /"id"\s*:\s*(\d+)/.exec(line);
        const p = m && this.pending.get(+m[1]);
        if (p) this.settle(+m[1], null, "the runtime answered with something that is not JSON");
        continue;
      }
      if (msg && this.pending.has(msg.id)) this.settle(msg.id, msg);
    }
  }

  settle(id, msg, error) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(new Error(error));
    // a failure carries where it happened, and — for a repository file not
    // yet allowed to run — the question to ask
    else if (!msg.ok) {
      p.reject(Object.assign(new Error(msg.error || "the request failed"),
        { traceback: msg.traceback, line: msg.line, file: msg.file, consent: msg.consent }));
    }
    else p.resolve(msg);
  }

  request(msg, timeoutMs) {
    if (!this.alive) return Promise.reject(new Error("the Python session is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const ms = timeoutMs || this.options.timeoutMs || 15000;
      const timer = setTimeout(() => {
        // a hung expression holds the interpreter: the only way to stop it is
        // to stop the process, and every request in flight goes with it
        this.pending.delete(id);
        reject(new Error(`timed out after ${Math.round(ms / 1000)} s (aot.python.timeoutMs) — the session was stopped`));
        this.kill("timed out");
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(JSON.stringify(Object.assign({ id }, msg)) + "\n");
      } catch (e) {
        this.settle(id, null, `could not reach Python — ${e.message}`);
      }
    });
  }

  die(reason) {
    if (!this.alive && !this.pending.size) return;
    this.alive = false;
    for (const id of [...this.pending.keys()]) this.settle(id, null, reason);
    if (this.onExit) this.onExit(reason);
  }

  kill(reason) {
    const proc = this.proc;
    this.die(reason || "the session was stopped");
    try { if (proc) proc.kill(); } catch { /* already gone */ }
  }
}

const lastLine = (s) => String(s).trim().split(/\r?\n/).pop();

function spawnMessage(e, python) {
  if (e && e.code === "ENOENT") {
    return `'${python || "python"}' was not found — install Python 3.10 or later, or set aot.python.path to its executable`;
  }
  return `could not start Python — ${e && e.message ? e.message : e}`;
}

// --- results -----------------------------------------------------------------

// The file a result writes into aot.files: the address with each '@' a '.',
// reduced to characters every file system takes. Never a path of Python's
// choosing, so nothing a derivation returns can write outside aot.files.
function outputStem(address) {
  const stem = String(address).replace(/^@/, "").replace(/@/g, ".")
    .replace(/[^A-Za-z0-9 ._-]/g, "_").replace(/\.{2,}/g, ".").replace(/^[. ]+|[. ]+$/g, "");
  return (stem || "output").slice(0, 120);
}

// A number as the language writes a computed one.
const formatNumber = (n, old) => table.formatValue(n, old || "");

// A grid cell as the runtime sends it: numbers as JSON numbers (formatted
// here, so a formula's and Python's numbers read alike), everything else
// already text.
function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    try { return formatNumber(v, ""); } catch { return String(v); }
  }
  return String(v).replace(/\r?\n/g, " ").replace(/\|/g, "¦");
}

// An Example name: never thousands-separated (`2026` names a year, not a sum)
const nameText = (v) => (v === null || v === undefined ? "" : String(v).replace(/\r?\n/g, " ").replace(/\|/g, "¦").trim());

// The table a Concept derivation writes: header [Concept, ...columns], rows
// [[Example, ...cells]]. Its rows are numbered 1, 2, 3 — unless a column
// carries the Concept's own name (`quarter` under Quarter): then that
// column's values name the Examples, and it is no column of its own. Not
// when they would name two Examples alike or leave one unnamed: the rows are
// numbered then, and the column stays. A grid Python named row by row
// (aot.grid) keeps its names.
function gridOf(result, conceptName) {
  let columns = (result.columns || []).map((c) => String(c));
  let rows = (result.rows || []).map((r) => [nameText(r[0]), ...r.slice(1).map(cellText)]);
  const own = result.named ? -1 : columns.findIndex((c) => fold(c) === fold(conceptName));
  if (own !== -1) {
    const names = (result.rows || []).map((r) => nameText(r[own + 1]));
    const keys = names.map(fold);
    if (names.every(Boolean) && new Set(keys).size === keys.length) {
      columns = columns.filter((_, j) => j !== own);
      rows = rows.map((r, i) => [names[i], ...r.slice(1).filter((_, j) => j !== own)]);
    }
  }
  return { header: [conceptName, ...columns], rows };
}

// Write the table a Concept's derivation returned. Python owns the Concept's
// rows outright: its `- ` Examples and any grid it had go, whole.
//
// The table IS the Concept. Its first header cell is the Concept as it is
// written, derivation and all — `Quarter =quarters()|units|revenue` — and it
// stands where the Concept's line stood, its rows at the same indent: the
// standalone form, the one that names its Concept in its first cell. A `...`
// Map under the Concept stays, under the table, as a table's own Map does.
//
// A derivation holding a pipe heads its table like any other — a pipe
// inside Python still open is the Python's, never a divider (table.dividers).
// One Concept cannot be written so, and keeps its line with the table
// beneath it repeating its name (the merge form): one carrying attributes or
// sub-Concepts of its own, which a table has no line to hold. Returns fresh
// lines.
function writeGrid(lines, concept, grid) {
  const out = lines.slice();
  const at = concept.line - 1;
  const raw = out[at] || "";
  const isHeader = table.isRowText(raw);
  const head = isHeader ? ((table.cells(raw)[0] || {}).text || concept.name) : raw.trim();
  const ownLines = concept.children.some((c) => c.kind !== KIND.INDIVIDUAL && c.kind !== KIND.MAP && !c.cell);
  // a pipe the table would read as a divider cannot stand in the header: a
  // derivation that is closed and still holds one outside its brackets
  const headerSafe = table.cells(`${head}|x`).length === 2;
  if (!isHeader && (ownLines || !headerSafe)) return writeMergeGrid(out, concept, grid);
  const indent = raw.match(/^ */)[0];
  const last = derive.lastLineOf(concept) - 1;
  // its Maps stay, one level under the table
  const maps = [];
  for (const c of concept.children) {
    if (c.kind !== KIND.MAP) continue;
    for (let i = c.line - 1; i <= derive.lastLineOf(c) - 1; i++) maps.push(out[i]);
  }
  const drawn = table.render({
    indent,
    rows: [{ sep: false, cells: [head, ...grid.header.slice(1)] }, ...grid.rows.map((cells) => ({ sep: false, cells }))],
  });
  // a table must not run into a neighbouring one: two blocks of rows with no
  // line between them read as one
  const before = at > 0 && table.isRowText(out[at - 1]) ? [""] : [];
  const after = last + 1 < out.length && table.isRowText(out[last + 1]) ? [""] : [];
  out.splice(at, last - at + 1, ...before, ...drawn, ...maps, ...after);
  return out;
}

// The merge form: the Concept keeps its line, and its table stands beneath
// it, the header repeating its name.
function writeMergeGrid(lines, concept, grid) {
  const out = lines.slice();
  const conceptAt = concept.line - 1;
  const indent = (out[conceptAt] || "").match(/^ */)[0] + " ".repeat(4);
  const removals = []; // [from, to] 0-based inclusive
  // the Concept's own grid: a table block under it whose header names it
  let gridBlock = null;
  for (let i = conceptAt + 1; i < out.length; i++) {
    const t = out[i];
    if (!t.trim()) continue;
    const ind = t.match(/^ */)[0].length;
    if (ind <= indent.length - 4) break; // left the Concept
    if (ind === indent.length && table.isRowText(t)) {
      const b = table.blockAt(out, i);
      const head = table.headerIndex(b);
      if (head !== -1 && fold(table.cleanName(b.rows[head].cells[0] || "")) === fold(concept.name)) {
        gridBlock = b;
        break;
      }
      i = b.end;
    }
  }
  // the line-form Examples: each one's whole subtree
  for (const c of concept.children) {
    if (c.kind !== KIND.INDIVIDUAL || c.line === concept.line) continue;
    if (table.isRowText(out[c.line - 1] || "")) continue; // a grid row goes with its block
    removals.push([c.line - 1, derive.lastLineOf(c) - 1]);
  }
  const drawn = table.render({
    indent,
    rows: [{ sep: false, cells: grid.header }, ...grid.rows.map((cells) => ({ sep: false, cells }))],
  });
  // apply from the bottom so earlier indices hold
  const edits = removals.map(([from, to]) => ({ from, to, text: [] }));
  if (gridBlock) edits.push({ from: gridBlock.start, to: gridBlock.end, text: drawn });
  else edits.push({ from: conceptAt + 1, to: conceptAt, text: drawn }); // an insert under the line
  edits.sort((a, b) => b.from - a.from);
  for (const e of edits) out.splice(e.from, e.to - e.from + 1, ...e.text);
  return out;
}

// A value host's line with a new value in front of its derivation.
function writeValue(lines, host, text) {
  const out = lines.slice();
  const at = host.line - 1;
  const raw = out[at];
  if (raw === undefined) return out;
  if (host.kind === "cell") {
    const cs = table.cells(raw);
    const cell = cs[host.cell.col];
    if (!cell) return out;
    const split = table.splitCell(cell.text);
    // a derivation stays after the value; a plain cell (one a `==` column
    // definition fills) is the value alone
    const formula = split.eq === -1 ? "" : cell.text.slice(split.eq).trim();
    const fresh = [text, formula].filter(Boolean).join(" ");
    out[at] = raw.slice(0, cell.col) + fresh + raw.slice(cell.col + cell.text.length);
    return out;
  }
  const d = valueDerivation(raw);
  if (d) {
    out[at] = raw.slice(0, d.valueStart) + (text ? text + " " : "") + raw.slice(d.startCol);
    return out;
  }
  // a plain value, filled by its attribute's `==` definition
  const colon = raw.indexOf(":");
  if (colon !== -1) out[at] = raw.slice(0, colon + 1) + (text ? " " + text : "");
  return out;
}

// What one result says to write, before any file is touched:
// { text } for a value, { file, bytes | body, text } for an image or long
// text (the value becomes the file's path), { grid } for a Concept's table.
// `old` is the value as it stands, whose `$` a number keeps.
function resultOf(host, result, maxInlineText) {
  const r = result || {};
  if (host.kind === "concept") {
    if (r.kind !== "frame") {
      throw new Error(`a Concept's derivation must produce a table (a DataFrame, a list of dicts, or aot.grid(header, rows)) — this one produced ${r.summary || r.kind || "nothing"}`);
    }
    return { grid: gridOf(r, host.node.name), count: (r.rows || []).length };
  }
  switch (r.kind) {
    case "number": return { text: formatNumber(r.value, host.value) };
    case "text": {
      const s = String(r.text || "");
      if (s.length > (maxInlineText || 120) || /\r|\n/.test(s)) {
        const stem = outputStem(host.address);
        return { file: stem + ".md", body: s.endsWith("\n") ? s : s + "\n" };
      }
      return { text: s.replace(/\|/g, "¦") };
    }
    case "image": return { file: outputStem(host.address) + "." + (r.ext || "png"), bytes: Buffer.from(r.base64 || "", "base64") };
    case "frame": return { text: r.summary || `<DataFrame ${(r.rows || []).length} rows>` };
    default: return { text: String(r.summary || r.text || "").replace(/\|/g, "¦") };
  }
}

module.exports = {
  PROTOCOL, readsAsExpression,
  hostsOf, hostIndex, constraintChecks, checkItems, referenceStarts, callSites, resolveHost, valueDerivation, moduleFiles, referencedModules,
  orderDerivations, affected, runHash, sourceHash,
  Session, spawnMessage, outputStem, resultOf, gridOf, writeGrid, writeValue, cellText,
};
