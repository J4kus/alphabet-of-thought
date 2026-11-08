// Python written where a formula would be written, run when the file calculates.
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
//                   reported), and the part of the file one pass must bring
//                   up to date
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
const { KIND, lint } = require("./linter");
const table = require("./table");
const derive = require("./derive");
const park = require("./park");
const { readsAsExpression } = require("./pyshape");
const { unitOf } = require("./crosslinks");
const units = require("./units");

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
      unit: unitOf(node),
    });
  }
  const unitAt = cellUnits(nodes, lines);
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
      unit: unitAt(where.line, where.col),
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
  // a bare `=` line, which writes Concepts: addressed by its place among
  // the file's bare lines, `@=1`, `@=2`, since it has no name of its own
  (nodes.generators || []).forEach((gen, k) => {
    if (!gen.formula) return; // an empty one is the linter's error, not a run's
    out.push({
      kind: "generator", address: generatorAddress(k), source: gen.formula, ordinal: k,
      line: gen.line, startCol: gen.col, endCol: gen.end, value: "", node: null, gen,
    });
  });
  return out.sort((a, b) => (a.line - b.line) || (a.startCol - b.startCol));
}

// A bare `=` line's address: its place among the file's bare lines.
const generatorAddress = (k) => `@=${k + 1}`;

// The unit of a grid cell, by its line (1-based) and column: its header's alias,
// else what the Concept above declares for that name. Null where there is none.
function cellUnits(nodes, lines) {
  const blocks = blockFinder(lines);
  let exampleAt = null;
  return (line, col) => {
    if (!exampleAt) {
      exampleAt = new Map();
      for (const n of nodes) if (n.kind === KIND.INDIVIDUAL && !exampleAt.has(n.line)) exampleAt.set(n.line, n);
    }
    const block = blocks(line - 1);
    const head = block ? table.headerIndex(block) : -1;
    const example = exampleAt.get(line);
    if (head === -1 || !example) return null;
    const cell = block.rows[head].cells[col] || "";
    return unitOf({ name: table.columnTerm(cell), alias: table.columnAlias(cell), parent: example });
  };
}

// Every calculation in a file: its derivations, and one for each value a
// column's or an attribute's definition computes (`price =@qty*2`). A definition
// is a formula like any other, so it takes its turn among them, and what reads
// its column reads what it computes. A value's own derivation is the nearer word.
function calcHosts(nodes, lines, rootName, parked) {
  const hosts = hostsOf(nodes, lines, rootName);
  const addressAt = new Map();
  for (const [address, where] of park.cellIndex(lines, nodes, rootName)) addressAt.set(`${where.line}:${where.col}`, address);
  const taken = new Set(hosts.map((h) => h.address));
  for (const check of constraintChecks(nodes, lines, parked)) {
    if (check.derived) continue;
    const clause = check.chain.find((c) => c.op === "==");
    if (!clause) continue;
    const raw = lines[check.host.line - 1] || "";
    const defined = { defined: true, source: clause.formula, line: check.host.line, value: check.value, unit: check.unit };
    if (check.host.kind === "cell") {
      const address = addressAt.get(`${check.host.cell.line}:${check.host.cell.col}`);
      const cell = table.cells(raw)[check.host.cell.col];
      if (!address || !cell || taken.has(address)) continue;
      taken.add(address);
      hosts.push(Object.assign(defined, {
        kind: "cell", address, cell: check.host.cell, startCol: cell.col, endCol: cell.col + cell.text.length,
      }));
    } else {
      const address = park.addressOf(check.host.node, rootName);
      if (taken.has(address)) continue;
      taken.add(address);
      const colon = raw.indexOf(":");
      hosts.push(Object.assign(defined, {
        kind: "value", address, node: check.host.node, startCol: colon === -1 ? 0 : colon + 1, endCol: raw.length,
      }));
    }
  }
  return hosts.sort((a, b) => (a.line - b.line) || (a.startCol - b.startCol));
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
    // a cell's own derivation is marked `derived` (a line's carries `formula`):
    // either way it is the nearer word, and a `==` definition never writes over it
    out.push({ host, value: d.value || "", derived: d.formula !== undefined || !!d.derived, a: held.a, chain: held.constraints, unit: unitOf(d) || unitOf(held.a) });
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
        definesOnly: true, unit: unitOf(a),
      });
    });
  }
  return out;
}

// A bound that is a number written straight: on a column with a unit, it is in
// that unit, `distance (km) <=500`. One that computes anything says its own.
const BARE_NUMBER = /^\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*$/;

// The requests a run sends for the checks: one per clause with something to
// say — an empty value is held to nothing, but a `==` may still define it —
// each bound resolved where its value stands, as a derivation there would be.
// [{ check, clause, k, errors, item: { code, targets, rel, value } | null }]:
// a bound whose references name nothing has no item, only its errors.
function checkItems(checks, ctx) {
  const out = [];
  for (const check of checks) {
    check.chain.forEach((clause, k) => {
      // an empty value is held to nothing; what a definition writes into it is
      // the calculation's (calcHosts)
      if (check.definesOnly || !String(check.value).trim()) return;
      let r;
      try { r = resolveHost(Object.assign({}, check.host, { source: clause.formula }), ctx); }
      catch (e) { r = { errors: [e.message] }; }
      const errors = r.errors || [];
      out.push({
        check, clause, k, errors,
        item: errors.length ? null : {
          address: "constraint", code: r.code, targets: r.targets, rel: clause.op,
          value: table.withUnit(check.value, check.unit),
          ...(check.unit && BARE_NUMBER.test(clause.formula) ? { unit: check.unit } : {}),
        },
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

// The numbers with units written in a formula, each as { start, length }: `5 km`,
// `$5,000`, `R500`, `$5/kg`, `30%`, `1,000 km`. Python has no such thing, so each is
// a syntax error as it stands, and resolveHost hands it to the runtime instead. A
// string or a comment holds none, and neither does a reference. `7 % 3`, with its
// space, stays Python's remainder, and a word of Python's own (`5 if x else 6`) is
// no unit. No spaces inside a unit: `5 km / rate` is 5 km divided by a rate.
const UNIT_WORD = "(?:\\p{L}|[°$€£¥])+(?:[²³]|\\^-?\\d+|\\d)?";
const LITERAL_UNIT = new RegExp(`^[ \\t]+(${UNIT_WORD}(?:/${UNIT_WORD})*)`, "u");
const LITERAL_SYMBOL = new RegExp(`^[$€£¥](?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?(?:/${UNIT_WORD})*`, "u");
const LITERAL_RAND = /^R(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\p{L}\p{N}_])/u;
const LITERAL_NUMBER = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d*)?|\.\d+)/;
const OPENS_OPERAND = /^[\p{L}\p{N}_(]/u;
// the number after a repository's own mark (`CHF 5`, units.js): a space from it
// or glued, and never glued to a name after it
const LITERAL_OWN = new RegExp(`^ ?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?(?:/${UNIT_WORD})*(?![\\p{L}\\p{N}_])`, "u");
function quantityLiterals(src, references) {
  const out = [];
  const ends = new Map((references || []).map((r) => [r.start, r.start + r.length]));
  const marks = units.prefixes();
  let i = 0;
  while (i < src.length) {
    if (ends.has(i)) { i = ends.get(i); continue; }
    const ch = src[i];
    if (ch === "#") break;
    if (ch === "'" || ch === "\"") {
      const triple = src.startsWith(ch.repeat(3), i);
      const close = triple ? ch.repeat(3) : ch;
      let j = i + close.length;
      while (j < src.length && !src.startsWith(close, j)) j += src[j] === "\\" ? 2 : 1;
      i = Math.min(src.length, j + close.length);
      continue;
    }
    // a mark the repository writes in front of a number, longest first, and not
    // the end of a name or an attribute (`x.CHF`)
    if (marks.length && (i === 0 || !/[\p{L}\p{N}_.]/u.test(src[i - 1]))) {
      const mark = marks.find((p) => src.startsWith(p, i));
      const m = mark ? LITERAL_OWN.exec(src.slice(i + mark.length)) : null;
      if (m) { out.push({ start: i, length: mark.length + m[0].length }); i += mark.length + m[0].length; continue; }
    }
    const rest = src.slice(i);
    if ("$€£¥".includes(ch)) {
      const m = LITERAL_SYMBOL.exec(rest);
      if (m) { out.push({ start: i, length: m[0].length }); i += m[0].length; continue; }
      i++;
      continue;
    }
    if (/[\p{L}_]/u.test(ch)) {
      const m = ch === "R" && src[i - 1] !== "." ? LITERAL_RAND.exec(rest) : null;
      if (m) { out.push({ start: i, length: m[0].length }); i += m[0].length; continue; }
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_]/u.test(src[j])) j++;
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = LITERAL_NUMBER.exec(rest);
      const after = rest.slice(m[0].length);
      // glued on to anything is Python's own (`1e5`, `0x10`, `5j`) or a mistake of
      // its own to report
      if (/^[\p{L}\p{N}_]/u.test(after)) {
        let j = i + m[0].length;
        while (j < src.length && /[\p{L}\p{N}_.]/u.test(src[j])) j++;
        i = j;
        continue;
      }
      if (after[0] === "%" && !OPENS_OPERAND.test(after.slice(1, 2)) && after[1] !== "@" && after[1] !== "=") {
        out.push({ start: i, length: m[0].length + 1 });
        i += m[0].length + 1;
        continue;
      }
      const unit = LITERAL_UNIT.exec(after);
      const word = unit && /^(?:\p{L}|[°$€£¥])+/u.exec(unit[1])[0];
      if (unit && !PY_KEYWORDS.has(word) && after[unit[0].length] !== "(") {
        out.push({ start: i, length: m[0].length + unit[0].length });
        i += m[0].length + unit[0].length;
        continue;
      }
      i += m[0].length;
      continue;
    }
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
//
// `generated` (optional) is what each bare `=` line last wrote — a Map of its
// address to the Concept names — so `@Sales` reads the live table the line's
// Python made, as it reads a Concept's own derivation's: the byConcept entry
// is then { kind: "generated", address, key, node }, `key` the name the
// result holds it under. A Concept's own derivation wins a shared name.
// `nodes` finds each written Concept's node, for a rename to follow.
//
// `lines` (optional) is the text, for the rest of what a reference may read: an
// Example's cell by its column (`byRow`), so that `@Item@price`, `@Item@Bob` or
// `@Item@Bob@price` reads a formula's live result rather than the text it last
// wrote, and depends on it. `blocks` finds each table once, and `targets` keeps
// what one pass has already read of a Concept: a column a thousand formulas
// read is read one time, and is one object to send and to hash.
function hostIndex(hosts, generated, nodes, lines) {
  const byNode = new Map();
  const byConcept = new Map();
  const byCell = new Map();
  const byRow = new Map(); // Example node -> Map(lowercased attribute -> host)
  const blocks = lines ? blockFinder(lines) : null;
  const inRow = (example, attr, h) => {
    if (!example) return;
    if (!byRow.has(example)) byRow.set(example, new Map());
    byRow.get(example).set(String(attr).toLowerCase(), h);
  };
  const exampleAt = new Map();
  for (const n of nodes || []) if (n.kind === KIND.INDIVIDUAL && !exampleAt.has(n.line)) exampleAt.set(n.line, n);
  for (const h of hosts) {
    if (h.kind === "value") {
      byNode.set(h.node, h);
      if (h.node.parent && h.node.parent.kind === KIND.INDIVIDUAL) inRow(h.node.parent, h.node.name, h);
    } else if (h.kind === "concept") byConcept.set(fold(h.node.name), h);
    else if (h.kind === "cell") {
      byCell.set(`${h.cell.line}:${h.cell.col}`, h);
      const block = blocks && blocks(h.line - 1);
      const head = block ? table.headerIndex(block) : -1;
      if (head !== -1) inRow(exampleAt.get(h.line), table.columnTerm(block.rows[head].cells[h.cell.col] || ""), h);
    }
  }
  for (const h of hosts) {
    if (h.kind !== "generator" || !generated) continue;
    for (const name of generated.get(h.address) || []) {
      const key = fold(name);
      if (byConcept.has(key)) continue;
      const node = (nodes || []).find((n) => n.kind === KIND.CONCEPT && fold(n.name) === key) || null;
      byConcept.set(key, { kind: "generated", address: h.address, key: name, node });
    }
  }
  return { byNode, byConcept, byCell, byRow, blocks, targets: new Map(), readers: new Map() };
}

// The table block around a line, each table found once for the whole text.
function blockFinder(lines) {
  const found = new Map();
  return (at) => {
    if (found.has(at)) return found.get(at);
    const block = table.blockAt(lines, at);
    if (block) for (let i = block.start; i <= block.end; i++) found.set(i, block);
    else found.set(at, null);
    return block;
  };
}

// What an Example's cell reads as: `text`, or where a formula computes the cell,
// a reference to that formula's live result.
const liveOr = (index, example, attr, text) => {
  const row = index.byRow && index.byRow.get(example);
  const h = row && row.get(String(attr).toLowerCase());
  return h ? { $live: h.address } : text;
};

// A Concept carrying its own derivation, named at the head of `rest`:
// { length, host } or null. Longest name wins, as every reference resolves.
function derivedConcept(rest, index) {
  const m = table.longestMatch(rest, [...index.byConcept.keys()].map((key) => ({ key, id: key })));
  return m ? { length: m.length, host: index.byConcept.get(m.id) } : null;
}

// The live result a derivation host stands for — for a Concept a bare `=`
// line wrote, the one table of it that the Concept is.
const liveTarget = (host) => (host.key !== undefined
  ? { kind: "object", address: host.address, key: host.key }
  : { kind: "object", address: host.address });

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
    target = liveTarget(derived);
    if (column !== null) target.column = display(column);
    if (row !== null) target.row = scope.rows[row];
    return { length: i - at, target, names };
  }
  // one read of each thing a pass reads of a Concept, however many formulas do
  const memo = index.targets;
  const key = memo && `${scope.name}\0${column}\0${row}`;
  if (memo && memo.has(key)) return { length: i - at, target: memo.get(key), names };
  if (column !== null && row !== null) {
    const live = liveOr(index, scope.examples[row], column, null);
    target = live ? { kind: "object", address: live.$live } : { kind: "value", text: scope.cellAt(column, row) };
  } else if (column !== null) {
    target = {
      kind: "column", name: display(column), index: scope.rows,
      values: scope.column(column).map((text, r) => liveOr(index, scope.examples[r], column, text)),
    };
  } else if (row !== null) {
    target = recordOf(scope.examples[row], scope, index);
  } else {
    const grid = scope.grid();
    const columns = grid[0].map((name) => String(name).toLowerCase());
    target = {
      kind: "frame", name: scope.name, header: grid[0],
      rows: grid.slice(1).map((cells, r) => cells.map((text, k) => (k === 0 ? text : liveOr(index, scope.examples[r], columns[k], text)))),
    };
  }
  if (memo) memo.set(key, target);
  return { length: i - at, target, names };
}

// An Example as a dict of its attributes, the Concept's defaults filling in
// what it is silent on.
function recordOf(ex, scope, index) {
  const fields = {};
  const live = (attr, text) => (index ? liveOr(index, ex, attr, text) : text);
  if (scope) {
    const r = scope.examples.indexOf(ex);
    for (const col of scope.columns) {
      fields[col] = r === -1 ? "" : live(col, scope.cellAt(col.toLowerCase(), r));
    }
  } else {
    for (const c of ex.children) {
      if (c.kind === KIND.DEFAULT) fields[c.name] = live(c.name, c.value || "");
    }
  }
  return { kind: "record", name: ex.name, fields };
}

// The formulas a reference's target reads. A target read by many is worked out
// once, and hashed once (runHash).
const targetDepsMemo = new WeakMap();
function targetDeps(t) {
  if (t.kind === "object") return [t.address];
  if (targetDepsMemo.has(t)) return targetDepsMemo.get(t);
  const out = [];
  const add = (v) => { if (v && v.$live) out.push(v.$live); };
  if (t.kind === "column") t.values.forEach(add);
  else if (t.kind === "frame") t.rows.forEach((r) => r.forEach(add));
  else if (t.kind === "record") Object.values(t.fields).forEach(add);
  targetDepsMemo.set(t, out);
  return out;
}

// The resolver for a line-form value or a Concept line: the host's own
// siblings and its Concept's defaults first (the local reading a formula
// gets), then any Concept in the registry.
function lineResolver(host, registry, index) {
  // a Concept line reads what a value on its parent would read, and so does
  // a bare `=` line, on the node it is filed under
  const anchor = host.kind === "concept" || host.kind === "generator"
    ? { kind: KIND.DEFAULT, name: "", parent: host.kind === "concept" ? host.node.parent : host.gen.parent, children: [] }
    : host.node;
  const ctx = derive.makeCtx(anchor, (n) => n.value || "", registry);
  const kinds = anchor.parent ? derive.kindsAbove(anchor.parent) : [];
  // the attribute node a local name reads — the host's own owner first, then
  // the kinds whose defaults an Example inherits, the nearest first
  const nodeFor = (id) => {
    for (const where of [anchor.parent, ...kinds]) {
      if (!where) continue;
      const hit = where.children.find((c) => c.kind === KIND.DEFAULT
        && (c.name.toLowerCase() === id || (c.alias && c.alias.toLowerCase() === id)));
      if (hit) return hit;
    }
    return null;
  };
  // every declaration a local attribute name means — on the owner, its
  // sibling Examples and the kinds above — for a rename to follow
  const { examples } = derive.scopeOf(anchor);
  const owners = [...new Set([anchor.parent, ...kinds, ...examples])].filter(Boolean);
  const attrsNamed = (id) => owners.flatMap((o) => o.children.filter((c) =>
    (c.kind === KIND.DEFAULT || c.kind === KIND.ATTRIBUTE) && c.name.toLowerCase() === id));
  // a named Example's value: its formula's live result where one computes it
  const cellTarget = (example, id) => {
    const live = liveOr(index, example, id, null);
    return live ? { kind: "object", address: live.$live } : { kind: "value", text: ctx.cellAt(id, example) };
  };
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
      const names = [{ offset: at + 1, length: der.length, kind: "table", nodes: [der.host.node].filter(Boolean) }];
      return { length: 1 + der.length, target: liveTarget(der.host), names };
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
          return { length: end - at, target: cellTarget(r.id, col.id), names };
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
          return { length: end - at, target: cellTarget(row.id, c.id), names };
        }
      }
      return { length: end - at, target: recordOf(row.id, null, index), names };
    }
    const scope = ctx.table(tab.id);
    if (!scope) return null;
    const tail = conceptTail(src, at + 1 + tab.length, scope, index);
    const names = [{ offset: at + 1, length: tab.length, kind: "table", id: tab.id }, ...tail.names];
    return { length: 1 + tab.length + tail.length, target: tail.target, names };
  };
}

// The resolver for a grid cell. A reference that names no Concept reads the
// current one: `@price` is this row's value, `@Acme` the named row, and
// `@Acme@price` or `@price@Acme` the named row's value. A name that is a
// Concept, reading as far as the local reading does, stays that Concept, so
// the current Concept answers only where no other is named.
function cellResolver(host, lines, registry, rootName, index) {
  const at0 = host.line - 1;
  // what every formula of one table shares is read once for the table
  const block = index.blocks ? index.blocks(at0) : table.blockAt(lines, at0);
  const readers = index.readers || new Map();
  if (!readers.has(block)) {
    const rows = table.dataRowsOf(block);
    const header = block.rows[table.headerIndex(block)].cells;
    const outer = table.enclosingScope(lines, block, registry, rootName);
    const headerLine = block.start + table.headerIndex(block) + 1;
    readers.set(block, {
      outer, headerLine, headerCells: table.cells(lines[headerLine - 1] || ""),
      read: table.tableReader(rows, header, registry, outer),
      lineOf: new Map(block.rows.map((r, k) => [r, block.start + k + 1])),
    });
  }
  const { outer, headerLine, headerCells, read, lineOf } = readers.get(block);
  const row = block.rows[at0 - block.start];
  const ctx = read(row);
  const columnName = (col, offset) => (typeof col.id === "number"
    ? { offset, length: col.length, kind: "column", site: { line: headerLine, col: (headerCells[col.id - 1] || {}).col } }
    : { offset, length: col.length, kind: "column", conceptNode: outer && outer.node, attrKey: col.id });
  // tableCtx.matchRow answers a row of this grid, or { outerRow } for a
  // line-form Example of the Concept; either way the Example it is, if the
  // registry holds it
  const inGrid = (r) => r.cells !== undefined;
  const exampleOf = (r) => {
    if (!outer) return undefined;
    if (!inGrid(r)) return outer.examples[r.outerRow];
    const name = table.splitCell(r.cells[0] || "").value;
    const m = outer.matchRow(name);
    return m && m.length === name.length ? outer.examples[m.id] : undefined;
  };
  const rowName = (r, offset, length) => ({ offset, length, kind: "row", nodes: [exampleOf(r)].filter(Boolean) });
  // a cell a derivation holds reads its live result, which then runs first,
  // so what reads it never sees last run's value
  const liveCell = (line, col) => {
    const derived = typeof col.id === "number" ? index.byCell.get(`${line}:${col.id - 1}`) : null;
    return derived && derived !== host ? { kind: "object", address: derived.address } : null;
  };
  // a name no column of this grid holds, or a line-form Example of the Concept:
  // its formula, if one computes it
  const liveRow = (col, r) => {
    if (typeof col.id !== "string") return null;
    const live = liveOr(index, exampleOf(r), col.id, null);
    return live && live.$live !== host.address ? { kind: "object", address: live.$live } : null;
  };
  const cellOf = (col, r) => (inGrid(r) && liveCell(lineOf.get(r), col))
    || liveRow(col, r)
    || { kind: "value", text: ctx.cellAt(col.id, r) };
  return (src, at) => {
    const rest = src.slice(at + 1);
    const col = ctx.matchColumn(rest);
    const named = ctx.matchRow(rest);
    const tab = ctx.matchTable ? ctx.matchTable(rest) : null;
    const der = derivedConcept(rest, index);
    // how far each local reading runs: a column with the row beside it, a row
    // with the column beside it
    const beside = (first, match) => {
      const end = at + 1 + first.length;
      return src[end] === "@" ? match(src.slice(end + 1)) : null;
    };
    const colRow = col ? beside(col, ctx.matchRow) : null;
    const rowCol = named ? beside(named, ctx.matchColumn) : null;
    const colReach = col ? col.length + (colRow ? 1 + colRow.length : 0) : 0;
    const rowReach = named ? named.length + (rowCol ? 1 + rowCol.length : 0) : 0;
    const tabLength = tab ? tab.length : 0;
    if (der && der.length > colReach && der.length > tabLength && der.length >= rowReach) {
      const names = [{ offset: at + 1, length: der.length, kind: "table", nodes: [der.host.node].filter(Boolean) }];
      return { length: 1 + der.length, target: liveTarget(der.host), names };
    }
    let tail = null;
    if (tab) {
      const scope = ctx.table(tab.id);
      tail = scope ? conceptTail(src, at + 1 + tab.length, scope, index) : null;
    }
    const concept = () => ({
      length: 1 + tab.length + tail.length,
      target: tail.target,
      names: [{ offset: at + 1, length: tab.length, kind: "table", id: tab.id }, ...tail.names],
    });
    if (tail && tail.length && tab.length + tail.length >= Math.max(colReach, rowReach)) return concept();
    if (col && colReach >= rowReach && colReach >= tabLength) {
      const names = [columnName(col, at + 1)];
      if (!colRow) return { length: 1 + colReach, target: liveCell(host.line, col) || { kind: "value", text: ctx.cell(col.id) }, names };
      names.push(rowName(colRow.id, at + 2 + col.length, colRow.length));
      return { length: 1 + colReach, target: cellOf(col, colRow.id), names };
    }
    if (named && rowReach > tabLength) {
      const ex = exampleOf(named.id);
      if (!rowCol && !ex) return null;
      const names = [rowName(named.id, at + 1, named.length)];
      if (!rowCol) return { length: 1 + rowReach, target: recordOf(ex, outer, index), names };
      names.push(columnName(rowCol, at + 2 + named.length));
      return { length: 1 + rowReach, target: cellOf(rowCol, named.id), names };
    }
    return tail ? concept() : null;
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
  const refs = []; // { start, length, k }
  let last = 0;
  for (const { start } of referenceStarts(src)) {
    if (start < last) continue;
    let hit = null;
    try { hit = resolveAt(src, start); } catch (e) { errors.push(e.message); }
    if (!hit) {
      const name = (/^@[\p{L}\p{N}_ ]*/u.exec(src.slice(start)) || ["@"])[0].trim();
      errors.push(`name something that exists — ${name} names nothing here: no attribute, Example or Concept is called that`);
      continue;
    }
    refs.push({ start, length: hit.length, k: targets.length });
    targets.push(hit.target);
    spans.push({ start, length: hit.length, text: src.slice(start, start + hit.length) });
    for (const n of hit.names || []) names.push(Object.assign({ start: n.offset, text: src.slice(n.offset, n.offset + n.length) }, n));
    for (const d of targetDeps(hit.target)) deps.add(d);
    last = start + hit.length;
  }
  // the source with each reference and each number with a unit handed to the
  // runtime, the rest of it Python's own
  const pieces = [
    ...refs.map((r) => ({ start: r.start, length: r.length, code: `_aot_ref(${r.k})` })),
    ...quantityLiterals(src, refs).map((q) => ({ start: q.start, length: q.length, code: `_aot_q(${JSON.stringify(src.slice(q.start, q.start + q.length))})` })),
  ].sort((a, b) => a.start - b.start);
  let code = "";
  let at = 0;
  for (const p of pieces) {
    code += src.slice(at, p.start) + p.code;
    at = p.start + p.length;
  }
  code += src.slice(at);
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
//
// Walked with a stack of its own: a column of running totals is a chain as long
// as the column, far deeper than the call stack should go.
function orderDerivations(hosts, depsOf) {
  const known = new Set(hosts.map((h) => h.address));
  const state = new Map(); // address -> 1 visiting, 2 done
  const order = [];
  const cycles = [];
  const inCycle = new Set();
  for (const h of hosts) {
    if (state.has(h.address)) continue;
    const path = [];
    const enter = (a) => {
      state.set(a, 1);
      path.push({ a, deps: depsOf(a) || [], next: 0 });
    };
    enter(h.address);
    while (path.length) {
      const top = path[path.length - 1];
      if (top.next >= top.deps.length) {
        state.set(top.a, 2);
        order.push(top.a);
        path.pop();
        continue;
      }
      const d = top.deps[top.next++];
      if (!known.has(d) || state.get(d) === 2) continue;
      if (state.get(d) === 1) {
        const loop = path.slice(path.findIndex((p) => p.a === d)).map((p) => p.a);
        cycles.push(loop);
        loop.forEach((x) => inCycle.add(x));
        continue;
      }
      enter(d);
    }
  }
  return { order: order.filter((a) => !inCycle.has(a)), cycles };
}

// What a pass must run to bring `seeds` up to date: the derivations themselves,
// every derivation downstream of them (so nothing that reads one is left stale),
// and whatever upstream `needs` says cannot be read as it stands — never computed
// in this session.
function affected(hosts, depsOf, seeds, needs) {
  const readers = new Map();
  for (const h of hosts) {
    for (const d of depsOf(h.address) || []) {
      if (!readers.has(d)) readers.set(d, []);
      readers.get(d).push(h.address);
    }
  }
  const start = Array.isArray(seeds) ? seeds : [seeds];
  const out = new Set(start);
  const down = [...start];
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
  // (a key only where there is one, so the hashes recorded before keys
  // existed still match)
  const live = (t) => (t.key === undefined ? [t.address, t.column, t.row] : [t.address, t.column, t.row, t.key]);
  h.update(JSON.stringify([source, targets.map((t) => (t.kind === "object" ? live(t) : targetDigest(t))), sidecarHash || "", upstream || []]));
  return h.digest("hex").slice(0, 16);
}

// One digest for a target however many formulas read it, so a column read by a
// thousand of them is hashed once.
const targetDigests = new WeakMap();
function targetDigest(t) {
  if (!targetDigests.has(t)) targetDigests.set(t, crypto.createHash("sha1").update(JSON.stringify(t)).digest("hex").slice(0, 16));
  return targetDigests.get(t);
}

// A host's run hash, what it reads and the formulas behind that included. What a
// target's formulas last computed is one digest too, per pass, for the same
// reason. `hashes` is the run hash of every address already ordered.
const upstreamMemo = new WeakMap();
function hostHash(host, r, code, hashes) {
  const upstream = (r.targets || []).map((t) => {
    if (t.kind === "object") return hashes.get(t.address) || "";
    const deps = targetDeps(t);
    if (!deps.length) return "";
    const memo = upstreamMemo.get(t);
    if (memo && memo.hashes === hashes) return memo.digest;
    const digest = crypto.createHash("sha1").update(deps.map((d) => hashes.get(d) || "").join()).digest("hex").slice(0, 16);
    upstreamMemo.set(t, { hashes, digest });
    return digest;
  });
  // a column's unit is what its formula's result is written in, so a change to it
  // is a change to the calculation
  return runHash(host.unit ? `${host.source}\0${host.unit}` : host.source, r.targets || [], code, upstream);
}

// Whether a value written in front of a formula is what the formula gives: the
// same text, or the same number in the same unit to 15 significant digits, a
// float's noise aside. A plain number under a column with a unit is in that unit.
function sameResult(written, computed, unit) {
  const a = String(table.withUnit(table.readValue(String(written == null ? "" : written)).trim(), unit)).trim();
  const b = String(table.withUnit(table.readValue(String(computed == null ? "" : computed)).trim(), unit)).trim();
  if (a === b) return true;
  const x = table.writtenForm(a), y = table.writtenForm(b);
  if (!x.number || !y.number || x.unit !== y.unit) return false;
  return Number(table.numericValue(a).toPrecision(15)) === Number(table.numericValue(b).toPrecision(15));
}

// Whether a text in front of a formula holds no number yet, only the unit it is to
// be written in: `speed: mph =@distance/@time`.
const onlyAUnit = (text) => {
  const t = String(text || "").trim();
  return t === "%" || (!/^[-+(]?[$€£¥R]?\s?\d/.test(t) && units.isUnit(t));
};

// A bound as its declaration writes it, and what a value that breaks it is told.
const boundSaid = (p) => `'${p.check.a.name} ${p.clause.opText || p.clause.op}${p.clause.formula}'`;
const breachMessage = (p, r) => `change the value, or the bound — '${p.check.value}' breaks ${boundSaid(p)}: it is not ${p.clause.op === "==" ? "" : `${p.clause.op} `}${r.bound}`;

// Whether a text carries anything that runs, from its nodes alone.
const hasFormulas = (nodes, text) => {
  const lines = String(text).split(/\r?\n/);
  return calcHosts(nodes, lines, "x").length > 0 || constraintChecks(nodes, lines).length > 0;
};

// The tree a Python file sees through `aot`: each value as a formula reads it.
const KIND_NAMES = ["Example", "Default Value", "Concept", "attribute", "Map"];
const treeOf = (node) => ({
  line: node.line, kind: KIND_NAMES[node.kind], name: node.name,
  value: node.kind === KIND.DEFAULT ? table.withUnit(node.value, unitOf(node)) : node.value,
  alias: node.alias || null, children: node.children.map(treeOf),
});

// What the runtime is asked for one formula: its code, what it reads, and what its
// cell and column say now, so a result lands in their unit.
function evalItem(host, resolved, refs) {
  return Object.assign(
    { address: host.address, code: resolved.code, refs, host: host.defined ? "defined" : host.kind },
    host.kind === "value" || host.kind === "cell" ? { value: host.value } : {},
    host.unit ? { unit: host.unit } : {},
  );
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
    // -E: no PYTHON* variable steers it. -I (an environment of the project's
    // own) is that, and no user site-packages or current directory either.
    const args = [o.isolated ? "-I" : "-E", "-B", "-u", "-X", "utf8", o.runtime];
    const base = o.env || process.env;
    const env = Object.assign({}, base, {
      PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8", MPLBACKEND: "Agg",
    }, blasThreads(base));
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
      if (!msg || !this.pending.has(msg.id)) continue;
      // one formula of a batch finished: told to whoever asked, and the clock
      // starts again, since the limit is on one formula rather than on all of them
      if (msg.partial) {
        const p = this.pending.get(msg.id);
        if (p.arm) p.arm();
        if (p.onPartial) p.onPartial(msg);
        continue;
      }
      this.settle(msg.id, msg);
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

  request(msg, timeoutMs, onPartial) {
    if (!this.alive) return Promise.reject(new Error("the Python session is not running"));
    const id = this.nextId++;
    // The runtime answers one request at a time, in the order they arrive.
    // So a request's clock starts when the one before it has been answered:
    // time spent queued behind another's work — the warm-up importing
    // pandas, say — is not this request's, and must not time it out.
    const turn = this.tail || Promise.resolve();
    const answered = new Promise((resolve, reject) => {
      const ms = timeoutMs || this.options.timeoutMs || 15000;
      const entry = { resolve, reject, timer: null, onPartial };
      this.pending.set(id, entry);
      entry.arm = () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          // a hung expression holds the interpreter: the only way to stop it
          // is to stop the process, and every request in flight goes with it
          this.pending.delete(id);
          reject(new Error(`timed out after ${Math.round(ms / 1000)} s (aot.python.timeoutMs) — the session was stopped`));
          this.kill("timed out");
        }, ms);
      };
      turn.then(() => {
        if (!this.pending.has(id)) return; // answered, or the session died
        entry.arm();
      });
      try {
        this.proc.stdin.write(JSON.stringify(Object.assign({ id }, msg)) + "\n");
      } catch (e) {
        this.settle(id, null, `could not reach Python — ${e.message}`);
      }
    });
    this.tail = answered.then(() => {}, () => {});
    return answered;
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

// numpy's BLAS starts a thread per core the moment it is imported, each with
// a buffer of its own, so on a many-core machine (WSL often is one) the
// session holds gigabytes before a derivation runs — and under the memory
// cap an import can fail outright. A derivation is a small computation, so
// the threads are capped at four; a variable the user set is left as set.
const BLAS_THREADS = ["OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"];
function blasThreads(env) {
  const out = {};
  for (const k of BLAS_THREADS) if (!(env && env[k])) out[k] = "4";
  return out;
}

// The interpreter names PATH is searched for when no path is set, in order.
// Windows has `python`; Debian, Ubuntu and WSL ship only `python3` unless
// python-is-python3 is installed, so elsewhere that comes first.
const defaultPythons = (platform) => (platform === "win32" ? ["python"] : ["python3", "python"]);

// The environment the runtime starts with, the credentials held back. The
// editor's own environment carries whatever the shell that launched it did —
// GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY, the ssh agent's socket — and a
// derivation reads os.environ as easily as any file. So a variable whose name
// says it is a secret is withheld, and so are the editor's own (VSCODE_*,
// ELECTRON_*, the askpass helpers: doors back into the editor and its git
// credentials). { env, withheld: [names] }.
const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTH|COOKIE|SESSION)/i;
const EDITOR_ENV = /^(VSCODE_|ELECTRON_)|^(GIT|SSH|SUDO)_ASKPASS$/i;
function scrubbedEnv(env) {
  const out = {};
  const withheld = [];
  for (const [k, v] of Object.entries(env || {})) {
    if (SECRET_ENV.test(k) || EDITOR_ENV.test(k)) withheld.push(k);
    else out[k] = v;
  }
  return { env: out, withheld };
}

// The program a bare command names, found on PATH and nowhere else: never
// in the directory the child starts in. On Windows, launching `python` by
// its bare name looks in the child's working directory first — and the run
// starts in aot.files, where a repository could leave a `python.exe` of its
// own. So the name is resolved here, against PATH's absolute entries alone
// (a relative entry is a directory relative to wherever that is), and the
// absolute path is what is launched. A path is taken as written, a relative
// one against `base`. null when nothing on PATH answers.
function resolveExecutable(command, o) {
  const opts = o || {};
  const platform = opts.platform || process.platform;
  const p = platform === "win32" ? pathLib.win32 : pathLib.posix;
  const exists = opts.exists || ((f) => { try { return require("fs").statSync(f).isFile(); } catch { return false; } });
  const cmd = String(command || "").trim();
  if (!cmd) return null;
  if (p.isAbsolute(cmd)) return cmd;
  if (/[\\/]/.test(cmd)) return opts.base ? p.resolve(opts.base, cmd) : null;
  const env = opts.env || process.env;
  const PATH = env.PATH || env.Path || env.path || "";
  const exts = platform === "win32"
    ? (/\.[A-Za-z0-9]+$/.test(cmd) ? [""] : [".exe", ".com"])
    : [""];
  for (const dir of PATH.split(platform === "win32" ? ";" : ":")) {
    const d = dir.trim().replace(/^"(.*)"$/, "$1");
    if (!d || !p.isAbsolute(d)) continue;
    for (const ext of exts) {
      const f = p.join(d, cmd + ext);
      if (exists(f)) return f;
    }
  }
  return null;
}

// A failure in plain words, for the end of a formula's line: what went wrong
// rather than which Python exception said so. The original stays in the hover.
function plainError(message) {
  const m = String(message || "");
  let x;
  if ((x = /^NameError: name '(.+?)' is not defined/.exec(m))) return `'${x[1]}' isn't a known name`;
  // a function that wants a plain number, handed one with a unit
  if (!/\.value/.test(m) && /'Quantity'/.test(m)) return "use .value for the plain number — this number has a unit, and what reads it wants one without";
  if (/^ZeroDivisionError\b/.test(m)) return "division by zero";
  if ((x = /^KeyError: ([^]*)$/.exec(m))) return `${x[1]} isn't there`;
  if ((x = /^SyntaxError: ([^(]*)/.exec(m))) return `this isn't a formula yet: ${x[1].trim()}`;
  if ((x = /^(?:[A-Za-z]*Error|Exception): ([^]*)$/.exec(m))) return x[1];
  return m;
}

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

// A number as the language writes a computed one: the runtime sends its text, so
// that no digit is lost on the way.
const formatNumber = (n, old, unit) => (typeof n === "number" ? table.formatValue(n, old || "", unit) : table.formatNumberText(n, old || "", unit));
// A grid cell's number, as the runtime sends one: { $n: its text, $u: its unit }.
const numberIn = (v) => (v && typeof v === "object" && v.$n !== undefined ? v.$n : undefined);

// --- what a result may write ----------------------------------------------------
// Two things a result is never allowed to put into the file.
//
// Code. What Python writes is data — a value read off a downloaded CSV, a
// column named by somebody's spreadsheet — and data must never become code.
// A value holding ` =os.system(…)` would read as a derivation on the next
// run, and a column named `n >=evil()` as a constraint's bound, each written
// by this editor's own run and so never asked about. So a written value's
// `=` that would open a derivation is escaped by doubling it, `==` (the
// language's own escape, table.writtenValue, which a reader never sees), and
// a name that would read as a bound or a derivation has its operators
// swapped for their full-width forms.
//
// A credential. What is written into the file is committed and pushed, and
// mirrored into aot.files; a private key or an access token read into a
// derivation — by accident or by design — would go with it. A result that
// looks like one is refused, and says why.

const inertValue = (s) => table.writtenValue(s);
const { inertName } = table;

const SECRETS = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, "a private key"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/, "a GitHub token"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic API key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, "an API secret key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "a Google API key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "a signed token (JWT)"],
];
// What a text looks like, when it looks like a credential: "a private key", …
function looksSecret(text) {
  const s = String(text || "");
  for (const [re, what] of SECRETS) if (re.test(s)) return what;
  return null;
}
function refuseSecret(text) {
  const what = looksSecret(text);
  if (what) {
    throw new Error(`the result looks like ${what}, so it is not written into the file, where a commit would carry it — return something else`);
  }
}

// A grid cell as the runtime sends it: numbers with every digit, formatted here
// so a formula's and Python's numbers read alike, everything else already text.
function cellText(v) {
  if (v === null || v === undefined) return "";
  const n = numberIn(v);
  if (typeof v === "number" || n !== undefined) {
    try { return formatNumber(n !== undefined ? n : v, "", (n !== undefined && v.$u) || ""); } catch { return String(n !== undefined ? n : v); }
  }
  return inertValue(String(v).replace(/\r\n|\r|\n/g, table.LINE_BREAK).replace(/\|/g, "¦"));
}

// An Example name: never thousands-separated (`2026` names a year, not a sum),
// and holding no tab, as no name does (linter noTabs)
const nameText = (v) => (v === null || v === undefined ? ""
  : inertName(String(numberIn(v) !== undefined ? numberIn(v) : v).replace(/\r?\n/g, " ").replace(/\t/g, " ").replace(/\|/g, "¦").trim()));

// The table a Concept derivation writes: header [Concept, ...columns], rows
// [[Example, ...cells]]. Its rows are numbered 1, 2, 3 — unless a column
// carries the Concept's own name (`quarter` under Quarter): then that
// column's values name the Examples, and it is no column of its own. Not
// when they would name two Examples alike or leave one unnamed: the rows are
// numbered then, and the column stays. A grid Python named row by row
// (aot.grid) keeps its names.
function gridOf(result, conceptName) {
  // a column's name is a name like any other: a pipe in it would split the
  // header and leave every value after it under the wrong column
  let columns = (result.columns || []).map(nameText);
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
  for (const s of [...columns, ...rows.flat()]) refuseSecret(s);
  return { header: [conceptName, ...columns], rows };
}

// Write the table a Concept's derivation returned. Python owns the Concept's
// rows outright: its `- ` Examples and any grid it had go, whole.
//
// The table IS the Concept. Its first header cell is the Concept as it is
// written, derivation and all — `Quarter =quarters()|units|revenue` — and it
// stands where the Concept's line stood, its rows at the same indent: the
// standalone form, the one that names its Concept in its first cell. Everything
// else the Concept holds stays, one level under the table.
//
// A derivation holding a pipe heads its table like any other — a pipe
// inside Python still open is the Python's, never a divider (table.dividers).
// One Concept cannot be written so, and keeps its line with the table beneath
// it repeating its name (the merge form): one whose derivation a header cell
// cannot hold, as `Sales =frame() # it's`, whose quote would swallow the
// divider after it. Returns fresh lines.
function writeGrid(lines, concept, grid) {
  const out = lines.slice();
  const at = concept.line - 1;
  const raw = out[at] || "";
  const isHeader = table.isRowText(raw);
  const head = isHeader ? ((table.cells(raw)[0] || {}).text || concept.name) : raw.trim();
  // the divider after the first cell has to read as one
  const headerSafe = table.cells(`${head}|x`).length === 2;
  if (!isHeader && !headerSafe) return writeMergeGrid(out, concept, grid);
  const indent = raw.match(/^ */)[0];
  const last = derive.lastLineOf(concept) - 1;
  const drawn = table.render({
    indent,
    rows: [{ sep: false, cells: [head, ...grid.header.slice(1)] }, ...grid.rows.map((cells) => ({ sep: false, cells }))],
  });
  // what it holds besides its rows and columns stays, one level under the table
  for (const c of concept.children) {
    if (c.kind === KIND.INDIVIDUAL || (c.kind !== KIND.CONCEPT && (c.cell || c.header))) continue;
    derive.putApart(drawn, out.slice(c.line - 1, derive.lastLineOf(c)));
  }
  // a table must not run into a neighbouring one: two blocks of rows with no
  // line between them read as one
  const before = at > 0 && table.isRowText(out[at - 1]) ? [""] : [];
  const after = last + 1 < out.length && table.isRowText(out[last + 1]) ? [""] : [];
  out.splice(at, last - at + 1, ...before, ...drawn, ...after);
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
    if (table.isRowAt(out, c.line - 1)) continue; // a grid row goes with its block
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

// The name a Concept a bare `=` line returned is written under: a Python key
// read as the language writes a Concept — `_` as a space, and capitalised,
// since a lowercase first header cell is an error — made inert like every
// name a result writes.
function conceptNameOf(v) {
  const t = nameText(String(v === null || v === undefined ? "" : v).replace(/_/g, " ").replace(/\s+/g, " "));
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

// Write what a bare `=` line returned, Concept by Concept, re-reading the
// file between each, since every table written moves the lines below it:
//
//   a Concept already in the file   its rows are replaced where it stands,
//                                    exactly as its own derivation would
//                                    write them (writeGrid) — the "hook"
//   one with a derivation of its own left alone: that Python owns its rows,
//                                    and the editor warns that two places
//                                    return it
//   a new name                       a standalone table at the line's own
//                                    indent, after the tables already
//                                    standing directly beneath it — so at
//                                    the top of a file the Concepts stand at
//                                    the top level, under the line
//
// Nothing is deleted: a Concept the line no longer returns stays. Answers
// { lines, written: [names], left: [names], errors: [messages] } — `left`
// the names their own derivation writes, which is no failure of the line's.
function writeGenerated(lines, host, grids, rootName) {
  let out = lines.slice();
  const written = [];
  const left = [];
  const errors = [];
  for (const g of grids) {
    const { nodes } = lint(out.join("\n"), rootName);
    const gen = (nodes.generators || [])[host.ordinal];
    if (!gen) {
      errors.push("the line could not be found again while its tables were written");
      break;
    }
    const key = fold(g.name);
    const concept = nodes.find((n) => n.kind === KIND.CONCEPT && fold(n.name) === key);
    if (concept && concept.formula !== undefined) {
      left.push(g.name);
      continue;
    }
    if (concept) {
      out = writeGrid(out, concept, g.grid);
      written.push(g.name);
      continue;
    }
    // the run of the line's own tables standing directly beneath it, at its
    // indent, one blank line between each — tables it returns, never one
    // somebody else wrote there — and a new one joins the end of it
    const indent = " ".repeat(gen.col);
    const ownNames = new Set(grids.map((x) => fold(x.name)).filter((k) =>
      !nodes.some((n) => n.kind === KIND.CONCEPT && fold(n.name) === k && n.formula !== undefined)));
    const at = (i) => i < out.length && table.isRowText(out[i]) && (out[i].match(/^ */)[0] === indent)
      && ownNames.has(fold(table.cleanName((table.cells(out[i])[0] || {}).text || "")));
    let end = gen.line - 1; // 0-based: the last line of the run so far
    for (;;) {
      let j = end + 1;
      if (end > gen.line - 1 && j < out.length && !out[j].trim()) j++;
      if (!at(j)) break;
      end = table.blockAt(out, j).end;
    }
    const drawn = table.render({
      indent,
      rows: [{ sep: false, cells: g.grid.header }, ...g.grid.rows.map((cells) => ({ sep: false, cells }))],
    });
    const before = end > gen.line - 1 ? [""] : [];
    const after = end + 1 < out.length && table.isRowText(out[end + 1]) ? [""] : [];
    out.splice(end + 1, 0, ...before, ...drawn, ...after);
    written.push(g.name);
  }
  return { lines: out, written, left, errors };
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

// Whether a result's unit is the column's, however it spells a percent.
const sameUnit = (a, b) => !!a && !!b && (a === b || (a === "%" && (units.builtIn(b) || {}).kind === "Ratio"));

// What one result says to write, before any file is touched:
// { text } for a value, { file, bytes | body, text } for an image or long
// text (the value becomes the file's path), { grid } for a Concept's table.
// `old` is the value as it stands, whose `$` a number keeps.
function resultOf(host, result, maxInlineText) {
  const r = result || {};
  if (host.kind === "generator") {
    if (r.kind !== "grids") {
      throw new Error(`a bare = derivation writes Concepts — return them by name, {"Sales": df, …}, or as a list of aot.grid(header, rows) — this one produced ${r.summary || r.kind || "nothing"}`);
    }
    const grids = (r.grids || []).map((g) => {
      const name = conceptNameOf(g.name);
      if (!name) throw new Error('a table the bare = derivation returned has no name — name each one, as in {"Sales": df}');
      return { name, grid: gridOf(g, name) };
    });
    const seen = new Set();
    for (const g of grids) {
      if (seen.has(fold(g.name))) throw new Error(`'${g.name}' is returned twice — one name, one Concept`);
      seen.add(fold(g.name));
    }
    return { grids, count: grids.reduce((n, g) => n + g.grid.rows.length, 0) };
  }
  if (host.kind === "concept") {
    if (r.kind !== "frame") {
      throw new Error(`a Concept's derivation must produce a table (a DataFrame, a list of dicts, or aot.grid(header, rows)) — this one produced ${r.summary || r.kind || "nothing"}`);
    }
    return { grid: gridOf(r, host.node.name), count: (r.rows || []).length };
  }
  switch (r.kind) {
    // in the column's unit the header says so, and the cell holds the number alone
    case "number": return { text: formatNumber(r.text !== undefined ? r.text : r.value, host.value, sameUnit(r.unit, host.unit) ? "" : r.unit) };
    case "text": {
      const s = String(r.text || "");
      refuseSecret(s);
      if (s.length > (maxInlineText || 120) || /\r|\n/.test(s)) {
        const stem = outputStem(host.address);
        return { file: stem + ".md", body: s.endsWith("\n") ? s : s + "\n" };
      }
      return { text: inertValue(s.replace(/\|/g, "¦")) };
    }
    case "image": return { file: outputStem(host.address) + "." + (r.ext || "png"), bytes: Buffer.from(r.base64 || "", "base64") };
    case "frame": return { text: r.summary || `<DataFrame ${(r.rows || []).length} rows>` };
    default: {
      const s = String(r.summary || r.text || "");
      refuseSecret(s);
      return { text: inertValue(s.replace(/\|/g, "¦")) };
    }
  }
}

module.exports = {
  PROTOCOL, readsAsExpression,
  hostsOf, calcHosts, hostIndex, constraintChecks, checkItems, referenceStarts, quantityLiterals, evalItem, sameResult, onlyAUnit, boundSaid, breachMessage, hasFormulas, treeOf, callSites, resolveHost, valueDerivation, moduleFiles, referencedModules,
  orderDerivations, affected, runHash, hostHash, sourceHash, targetDeps, plainError,
  inertValue, inertName, looksSecret,
  Session, spawnMessage, resolveExecutable, scrubbedEnv, defaultPythons, blasThreads, outputStem, resultOf, gridOf, writeGrid, writeValue, cellText,
  writeGenerated, conceptNameOf, generatorAddress,
};
