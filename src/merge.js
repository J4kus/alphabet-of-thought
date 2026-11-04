// A semantic three-way merge of an .aot file, for git's merge driver
// (`node verify.js --merge %O %A %B %P`).
//
// A line merge sees text; this sees ideas. Both sides are read against the
// common ancestor as changes to Concepts and Examples — found by name and,
// where a name changed, by content (godel.pairNodes: a renamed Concept is
// still the same Concept) — and theirs are replayed onto ours:
//
//     a rename                       the node's name, on its line or cell
//     an attribute set, added, gone  one line, or one cell of a table row
//     a node added                   its lines, after the sibling it follows
//                                    on its own side (a row, into its table)
//     a node removed                 its lines, or its row and the rows under it
//
// So a rename on one side and a value change on the other both land — the
// case a line merge cannot do when the two touch neighbouring lines — and
// two edits to one row of a table merge cell by cell.
//
// Conflicts are per attribute: the same attribute changed two ways is marked
// on that line alone; a node one side removed and the other changed is
// marked on the node's block; a name changed two ways on the name's line.
//
// Two checks keep it honest, and anything either cannot vouch for falls back
// to git's own line merge (`fallback`), so the driver is never worse than
// git's:
//
//   replay      each side's change set, applied to the ancestor alone, must
//               give back that side exactly (tables compared aligned, runs of
//               blank lines as one) — an edit this module has no word for, a
//               move or a reordering, fails it
//   arithmetic  every node's Gödel number in the result must be, prime by
//               prime, theirs where theirs changed it, else ours — base ⊕
//               ours ⊕ theirs — with all four numbered as one
//
// Pure: no I/O.

const { lint, KIND, INDENT } = require("./linter");
const godel = require("./godel");
const table = require("./table");
const { lastLineOf } = require("./derive");

const isSubstance = (n) => n.kind === KIND.CONCEPT || n.kind === KIND.INDIVIDUAL;
const isSlot = (n) => n.kind === KIND.ATTRIBUTE || n.kind === KIND.DEFAULT;
const indentOf = (s) => String(s || "").match(/^ */)[0];
const fold = (s) => table.numberless(String(s || "")).trim().toLowerCase();

function parse(text, rootName) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const r = lint(lines.join("\n"), rootName);
  return { lines, root: r.root, nodes: r.nodes, errors: r.errors };
}

// An error as it is the same error wherever it stands: its line numbers out,
// since a merge moves lines without changing what is wrong.
const errorKind = (e) => String(e.message).replace(/\d+/g, "#");

// A text as the merge compares it: every table drawn aligned, trailing
// spaces off, a run of blank lines one blank line, none at either end.
function canonical(lines, rootName) {
  let out = lines.slice();
  try {
    const edits = table.align(out.join("\n"), undefined, rootName);
    for (const e of [...edits].sort((a, b) => b.line - a.line)) {
      out.splice(e.line - 1, (e.to || e.line) - e.line + 1, ...e.text.split("\n"));
    }
  } catch { /* compared as written */ }
  out = out.map((l) => l.replace(/\s+$/, ""));
  const kept = [];
  for (const l of out) if (l || (kept.length && kept[kept.length - 1])) kept.push(l);
  while (kept.length && !kept[kept.length - 1]) kept.pop();
  return kept.join("\n");
}

// --- what a node says of itself ------------------------------------------------

// A row of a table: an Example whose own line is a grid row.
const isRowNode = (d, n) => n.kind === KIND.INDIVIDUAL && n.nameCol !== undefined && table.isRowText(d.lines[n.line - 1] || "");
// The Concept a standalone table names in its first header cell.
const isHeaderNode = (d, n) => n.kind === KIND.CONCEPT && n.cell && table.isRowText(d.lines[n.line - 1] || "");

// A row's table: a cell's index here is its index in the table the merge draws.
function rowOf(d, n) {
  const block = table.blockAt(d.lines, n.line - 1);
  if (!block) return null;
  const head = table.headerIndex(block);
  return { block, r: n.line - 1 - block.start, header: head === -1 ? [] : block.rows[head].cells };
}

// A node's own attribute lines, by lowercased name: { text, line? } for a
// line of its own (text: the line as written), { text, cell } for a cell of
// its row (text: the cell's), { text, header } for a column its header
// declares. The first of a name wins, as everywhere.
function slotsOf(d, n) {
  const out = new Map();
  if (n.line >= 1 && (isRowNode(d, n) || isHeaderNode(d, n))) {
    const at = rowOf(d, n);
    if (at) {
      const row = at.block.rows[at.r].cells;
      at.header.forEach((h, k) => {
        if (k < 1) return;
        const key = table.columnTerm(h).toLowerCase();
        const text = String(row[k] || "").trim();
        if (!key || !text || out.has(key)) return;
        out.set(key, isHeaderNode(d, n) ? { text, header: k } : { text, cell: k });
      });
    }
  }
  for (const c of n.children) {
    if (!isSlot(c) || c.cell || !(c.line >= 1)) continue;
    const key = c.name.toLowerCase();
    if (out.has(key)) continue;
    out.set(key, { text: String(d.lines[c.line - 1] || "").trim(), line: c.line });
  }
  return out;
}

// --- a side's changes ---------------------------------------------------------

// Everything one side did to the ancestor: renames, own-attribute changes,
// nodes removed and added (each subtree once, at its top). `unsupported`
// names an edit this module cannot replay (a move) — the merge falls back.
function changesBetween(base, side, pairing) {
  const { mapAB, how } = pairing;
  const ch = {
    renamed: new Map(), slots: new Map(), removed: [], added: [], unsupported: null,
    map: mapAB, back: new Map([...mapAB].map(([a, b]) => [b, a])),
  };
  for (const [a, b] of mapAB) {
    if (how.get(a) === "moved") ch.unsupported = `'${a.name}' moved to another parent`;
    if (a !== base.root && a.name !== b.name) ch.renamed.set(a, b.name);
    const sa = slotsOf(base, a), sb = slotsOf(side, b);
    const m = new Map();
    for (const [k, v] of sb) {
      const was = sa.get(k);
      if (!was) m.set(k, Object.assign({ op: "add" }, v));
      else if (was.text !== v.text) m.set(k, Object.assign({ op: "set", was }, v));
    }
    for (const [k, v] of sa) if (!sb.has(k)) m.set(k, { op: "remove", was: v, text: "" });
    if (m.size) ch.slots.set(a, m);
  }
  const removed = new Set(pairing.removed), added = new Set(pairing.added);
  ch.removed = pairing.removed.filter((a) => !removed.has(a.parent));
  ch.added = pairing.added.filter((b) => !added.has(b.parent));
  ch.removedAll = removed;
  ch.addedAll = added;
  return ch;
}

// Whether a side did anything at or under a base node that the other side's
// removing it would throw away: a rename, an attribute changed, a node added.
// Removing something under it is not such a thing — both sides then agree
// it goes.
function touched(ch, a) {
  const inside = (n) => { for (let p = n; p; p = p.parent) if (p === a) return true; return false; };
  if (ch.renamed.has(a) || ch.slots.has(a)) return true;
  for (const n of ch.renamed.keys()) if (inside(n)) return true;
  for (const n of ch.slots.keys()) if (inside(n)) return true;
  for (const b of ch.added) {
    const base = ch.back.get(b.parent);
    if (base && inside(base)) return true;
  }
  return false;
}

// --- replaying a change set onto a text ----------------------------------------

// Apply `ch` (a side's changes against the ancestor) to `target`, whose nodes
// `toTarget` maps from the ancestor's. `side` is the document the changes
// came from, for the lines an added node carries. Answers { lines } or
// { unsupported }.
function applyChanges(ch, target, toTarget, side) {
  const replaced = new Map(); // line (1-based) -> text
  const deleted = new Set(); // lines (1-based)
  const inserts = new Map(); // afterLine (1-based, 0 = the top) -> [lines]
  const tables = new Map(); // block start -> table edit
  let unsupported = null;
  const fail = (why) => { if (!unsupported) unsupported = why; };
  const tableEdit = (line0) => {
    const block = table.blockAt(target.lines, line0);
    if (!block) return null;
    if (!tables.has(block.start)) {
      tables.set(block.start, { block, drop: new Set(), cells: new Map(), after: new Map(), before: [] });
    }
    return tables.get(block.start);
  };
  const colIn = (te, key) => {
    const head = table.headerIndex(te.block);
    return head === -1 ? -1 : te.block.rows[head].cells.findIndex((h, k) => k > 0 && table.columnTerm(h).toLowerCase() === key);
  };
  const setCell = (te, r, k, text) => {
    if (!te.cells.has(r)) te.cells.set(r, new Map());
    te.cells.get(r).set(k, text);
  };
  const insertAfter = (line, lines) => {
    if (!inserts.has(line)) inserts.set(line, []);
    inserts.get(line).push(...lines);
  };
  // where a node's own attribute lines end — what a new one follows
  const slotsEnd = (t) => {
    const own = t.children.filter((c) => isSlot(c) && !c.cell && c.line >= 1);
    return own.length ? lastLineOf(own[own.length - 1]) : t.line;
  };

  // 1) nodes removed
  for (const a of ch.removed) {
    const t = toTarget.get(a);
    if (!t) continue; // gone there already
    if (isRowNode(target, t)) {
      // the row, and the rows that name it as their parent, at any depth
      const te = tableEdit(t.line - 1);
      const r = t.line - 1 - te.block.start;
      for (const k of [r, ...table.branchOf(te.block, r)]) te.drop.add(k);
    } else if (t.line >= 1) {
      for (let l = t.line; l <= lastLineOf(t); l++) deleted.add(l);
    }
  }

  // 2) renames
  for (const [a, name] of ch.renamed) {
    const t = toTarget.get(a);
    if (!t) continue;
    if (isRowNode(target, t)) {
      const te = tableEdit(t.line - 1);
      setCell(te, t.line - 1 - te.block.start, 0, name);
      continue;
    }
    const raw = target.lines[t.line - 1] || "";
    const lead = indentOf(raw).length;
    if (isHeaderNode(target, t)) {
      // the first header cell opens with the Concept's name, an (alias) or a
      // derivation after it: only the name is replaced
      const te = tableEdit(t.line - 1);
      const head = table.headerIndex(te.block);
      setCell(te, head, 0, name + (te.block.rows[head].cells[0] || "").slice(t.name.length));
      continue;
    }
    const at = lead + (t.kind === KIND.INDIVIDUAL ? 2 : 0);
    if (raw.slice(at, at + t.name.length) !== t.name) { fail(`'${t.name}' is not where its line says`); continue; }
    replaced.set(t.line, raw.slice(0, at) + name + raw.slice(at + t.name.length));
  }

  // 3) attributes set, added and removed
  for (const [a, m] of ch.slots) {
    const t = toTarget.get(a);
    if (!t) continue;
    const mine = slotsOf(target, t);
    const row = isRowNode(target, t) || isHeaderNode(target, t) ? tableEdit(t.line - 1) : null;
    const rowIndex = row ? t.line - 1 - row.block.start : -1;
    const childIndent = t.line >= 1 ? indentOf(target.lines[t.line - 1]) + " ".repeat(INDENT) : "";
    for (const [key, c] of m) {
      const here = mine.get(key);
      if (c.header !== undefined || (here && here.header !== undefined)) {
        if (c.op !== "set" || !here) { fail(`a column of '${t.name}' was added or removed`); continue; }
        setCell(row, rowIndex, here.header, c.text);
        continue;
      }
      const toCell = c.cell !== undefined || (c.op === "remove" && c.was && c.was.cell !== undefined);
      if (toCell || (here && here.cell !== undefined)) {
        if (!row) { fail(`'${t.name}' is a row on one side and lines on the other`); continue; }
        const k = colIn(row, key);
        if (k < 1) { fail(`'${key}' is no column of '${t.name}'s table`); continue; }
        setCell(row, rowIndex, k, c.op === "remove" ? "" : c.text);
        continue;
      }
      if (c.op === "remove") {
        if (here && here.line) deleted.add(here.line);
      } else if (here && here.line) {
        if (here.text !== c.text) replaced.set(here.line, indentOf(target.lines[here.line - 1]) + c.text);
      } else if (row) {
        fail(`'${key}' was written as a line under the row '${t.name}'`);
      } else {
        insertAfter(slotsEnd(t), [childIndent + c.text]);
      }
    }
  }

  // 4) nodes added, after the sibling they follow on their own side
  for (const b of ch.added) {
    const baseParent = ch.back.get(b.parent);
    const tp = baseParent && toTarget.get(baseParent);
    if (!tp) { fail(`'${b.name}' was added under something the other side removed`); continue; }
    const siblings = b.parent.children.filter(isSubstance);
    let prev = null;
    for (const s of siblings) {
      if (s === b) break;
      if (!ch.addedAll.has(s)) prev = s;
    }
    const tPrev = prev ? toTarget.get(ch.back.get(prev)) : null;
    const sideRaw = side.lines[b.line - 1] || "";
    if (isRowNode(side, b)) {
      // a row: its cells by the target table's own columns, its sub-rows with it
      const src = rowOf(side, b);
      const anchor = tPrev && isRowNode(target, tPrev) ? tPrev : null;
      const te = anchor ? tableEdit(anchor.line - 1) : null;
      if (!te) { fail(`nowhere to put the row '${b.name}'`); continue; }
      const head = table.headerIndex(te.block);
      const targetHeader = te.block.rows[head].cells;
      // the row and the rows naming it as their parent, in the order its
      // side writes them: cells merge as cells, the parent cell among them
      const rows = [];
      for (const k of [src.r, ...table.branchOf(src.block, src.r)].sort((x, y) => x - y)) {
        const cells = src.block.rows[k].cells;
        const out = targetHeader.map(() => "");
        out[0] = cells[0] || "";
        src.header.forEach((h, j) => {
          if (j < 1 || !String(cells[j] || "").trim()) return;
          const at = targetHeader.findIndex((th, i) => i > 0 && table.columnTerm(th).toLowerCase() === table.columnTerm(h).toLowerCase());
          if (at < 1) fail(`the row '${b.name}' has a column '${table.columnTerm(h)}' the table here lacks`);
          else out[at] = cells[j];
        });
        rows.push({ sep: false, cells: out });
      }
      // after the sibling it follows, and the rows under that sibling
      const anchorRow = anchor.line - 1 - te.block.start;
      const afterRow = Math.max(anchorRow, ...table.branchOf(te.block, anchorRow));
      if (!te.after.has(afterRow)) te.after.set(afterRow, []);
      te.after.get(afterRow).push(...rows);
      continue;
    }
    if (table.isRowText(sideRaw)) { fail(`'${b.name}' is a table the other side has no place for`); continue; }
    const want = tp === target.root || !(tp.line >= 1) ? "" : indentOf(target.lines[tp.line - 1]) + " ".repeat(INDENT);
    const have = indentOf(sideRaw);
    const lines = side.lines.slice(b.line - 1, lastLineOf(b)).map((l) => (l.trim() ? want + l.slice(Math.min(have.length, indentOf(l).length)) : l));
    const after = tPrev && !isRowNode(target, tPrev) ? lastLineOf(tPrev) : slotsEnd(tp);
    insertAfter(after, lines);
  }

  if (unsupported) return { unsupported };
  // every touched table drawn once, whole
  const blocks = new Map(); // start line (1-based) -> { end (1-based), lines }
  for (const te of tables.values()) {
    const rows = [];
    te.block.rows.forEach((row, r) => {
      if (row.sep) {
        rows.push({ sep: true, cells: [] }); // a divider stays where it stands
        return;
      }
      if (!te.drop.has(r)) {
        const cells = row.cells.slice();
        for (const [k, text] of te.cells.get(r) || []) {
          while (cells.length <= k) cells.push("");
          cells[k] = text;
        }
        rows.push({ sep: false, cells });
      }
      for (const added of te.after.get(r) || []) rows.push(added);
    });
    for (let l = te.block.start + 1; l <= te.block.end + 1; l++) {
      if (replaced.has(l) || deleted.has(l)) return { unsupported: "a line edit inside a table" };
    }
    blocks.set(te.block.start + 1, { end: te.block.end + 1, lines: rows.length ? table.render({ indent: te.block.indent, rows }) : [] });
  }
  // one pass over the target: a table drawn anew, a line replaced or
  // deleted, and what is inserted after a line — after it even when the
  // line itself goes, so an attribute removed and one added land in order
  const out = [...(inserts.get(0) || [])];
  for (let l = 1; l <= target.lines.length; l++) {
    const block = blocks.get(l);
    if (block) {
      out.push(...block.lines);
      for (let k = l; k <= block.end; k++) out.push(...(inserts.get(k) || []));
      l = block.end;
      continue;
    }
    if (!deleted.has(l)) out.push(replaced.has(l) ? replaced.get(l) : target.lines[l - 1]);
    out.push(...(inserts.get(l) || []));
  }
  return { lines: out };
}

// --- the merge ----------------------------------------------------------------

const MARK_OURS = "<<<<<<< ours";
const MARK_MID = "=======";
const MARK_THEIRS = ">>>>>>> theirs";

// Merge `theirs` into `ours` against their common ancestor `base`. Answers
// { text, clean, conflicts: [{ line, message }], fallback } — `fallback` a
// reason when the merge cannot vouch for itself, and the caller should use
// git's own line merge instead.
function merge(baseText, oursText, theirsText, rootName) {
  const base = parse(baseText, rootName), ours = parse(oursText, rootName), theirs = parse(theirsText, rootName);
  const fallback = (why) => ({ text: null, clean: false, conflicts: [], fallback: why });
  // one numbering for all three, so a Concept's G compares alike everywhere
  const registry = godel.pool([base, ours, theirs], godel.parseRegistry("")).registry;
  const pO = godel.pairNodes(base.root, base.nodes, ours.root, ours.nodes, registry);
  const pT = godel.pairNodes(base.root, base.nodes, theirs.root, theirs.nodes, registry);
  const cO = changesBetween(base, ours, pO), cT = changesBetween(base, theirs, pT);
  if (cO.unsupported || cT.unsupported) return fallback(cO.unsupported || cT.unsupported);

  // the replay guard: each side's changes must rebuild that side exactly
  const identity = new Map([base.root, ...base.nodes].map((n) => [n, n]));
  for (const [c, side, who] of [[cO, ours, "ours"], [cT, theirs, "theirs"]]) {
    const r = applyChanges(c, base, identity, side);
    if (r.unsupported) return fallback(`${who}: ${r.unsupported}`);
    if (canonical(r.lines, rootName) !== canonical(side.lines, rootName)) return fallback(`${who}: an edit this merge cannot replay`);
  }

  // what both sides did, sorted into what theirs adds and what conflicts
  const conflicts = []; // { kind, a, key?, oursText?, theirsText?, b? }
  const apply = {
    renamed: new Map(), slots: new Map(), removed: [], added: [], map: cT.map, back: cT.back, addedAll: cT.addedAll,
  };
  for (const [a, name] of cT.renamed) {
    if (!cO.map.has(a)) continue; // ours removed it: settled below
    const mine = cO.renamed.get(a);
    if (mine === undefined) apply.renamed.set(a, name);
    else if (mine !== name) conflicts.push({ kind: "name", a, oursText: mine, theirsText: name });
  }
  for (const [a, m] of cT.slots) {
    if (!cO.map.has(a)) continue;
    const mine = cO.slots.get(a) || new Map();
    const take = new Map();
    for (const [key, c] of m) {
      const o = mine.get(key);
      if (!o) take.set(key, c);
      else if (o.text !== c.text || o.op !== c.op) conflicts.push({ kind: "slot", a, key, oursText: o.text, theirsText: c.text });
    }
    if (take.size) apply.slots.set(a, take);
  }
  for (const a of cT.removed) {
    if (!cO.map.has(a)) continue; // both removed it
    if (touched(cO, a)) conflicts.push({ kind: "removed-by-theirs", a });
    else apply.removed.push(a);
  }
  for (const a of cO.removed) {
    if (cT.map.has(a) && touched(cT, a)) conflicts.push({ kind: "removed-by-ours", a });
  }
  const addedOursUnder = new Map(); // base parent -> [ours nodes]
  for (const o of cO.added) {
    const bp = cO.back.get(o.parent);
    if (!addedOursUnder.has(bp)) addedOursUnder.set(bp, []);
    addedOursUnder.get(bp).push(o);
  }
  for (const b of cT.added) {
    const bp = cT.back.get(b.parent);
    if (!cO.map.has(bp)) continue; // under something ours removed: that conflict marks it
    const twin = (addedOursUnder.get(bp) || []).find((o) => o.kind === b.kind && fold(o.name) === fold(b.name));
    if (!twin) { apply.added.push(b); continue; }
    const same = canonical(ours.lines.slice(twin.line - 1, lastLineOf(twin)).map((l) => l.trim()), rootName)
      === canonical(theirs.lines.slice(b.line - 1, lastLineOf(b)).map((l) => l.trim()), rootName);
    if (!same) conflicts.push({ kind: "added-twice", a: bp, b, ours: twin });
  }

  const merged = applyChanges(apply, ours, cO.map, theirs);
  if (merged.unsupported) return fallback(merged.unsupported);
  const result = parse(merged.lines.join("\n"), rootName);
  // two edits each fine alone can be wrong together — a rename onto the name
  // the other side gave a new Concept. The numbers see each node, not that:
  // an error neither side had is no merge this can vouch for.
  const had = new Set([...ours.errors, ...theirs.errors].map(errorKind));
  const brought = result.errors.find((e) => !had.has(errorKind(e)));
  if (brought) return fallback(`the merge would bring an error neither side had — ${brought.message}`);

  // the arithmetic: every node, prime by prime, theirs where theirs changed
  // it, else ours (a conflict keeps ours until the markers say otherwise).
  // Only a prime one of the four carries can disagree — every other is 0 in
  // all of them — so each node's four factorisations are walked, not every
  // prime of the numbering.
  const pM = godel.pairNodes(base.root, base.nodes, result.root, result.nodes, registry);
  godel.pool([base, ours, theirs, result], registry); // pairing renumbered two of them: number all four as one again
  const exponent = (n, p) => godel.vecValuation(n.gvec, p);
  for (const a of [base.root, ...base.nodes].filter(isSubstance)) {
    const o = cO.map.get(a), t = cT.map.get(a), m = pM.mapAB.get(a);
    if (!o || !t) continue; // removed on a side: its block is the conflict's, or gone
    if (!m) return fallback(`'${a.name}' could not be found in the result`);
    const primes = new Set([...a.gvec.p, ...o.gvec.p, ...t.gvec.p, ...m.gvec.p]);
    for (const p of primes) {
      const vb = exponent(a, p), vo = exponent(o, p), vt = exponent(t, p);
      const want = vt !== vb && vo === vb ? vt : vo;
      if (vt !== vb && vo !== vb && vo !== vt) continue; // a conflict, marked on its line
      if (exponent(m, p) !== want) return fallback(`'${a.name}' did not merge to what both sides say`);
    }
  }

  // the conflicts, marked where they stand — bottom-up, so lines hold
  const out = result.lines.slice();
  const marks = [];
  const nodeIn = (a) => pM.mapAB.get(a);
  for (const c of conflicts) {
    if (c.kind === "slot") {
      const m = nodeIn(c.a);
      const here = m && slotsOf(result, m).get(c.key);
      if (!m) continue;
      const line = here && here.line ? here.line : m.line;
      const theirsLine = here && here.line ? indentOf(out[line - 1]) + c.theirsText
        : theirsRowOf(theirs, cT, c.a) || c.theirsText;
      marks.push({ from: line, to: line, ours: [out[line - 1]], theirs: [theirsLine], message: `'${c.key}' of '${c.a.name}' was changed two ways` });
    } else if (c.kind === "name") {
      const m = nodeIn(c.a);
      if (!m) continue;
      const t = cT.map.get(c.a);
      marks.push({ from: m.line, to: m.line, ours: [out[m.line - 1]], theirs: [indentOf(out[m.line - 1]) + String(theirs.lines[t.line - 1]).trim()], message: `'${c.a.name}' was renamed two ways` });
    } else if (c.kind === "removed-by-theirs") {
      const m = nodeIn(c.a);
      if (!m) continue;
      const end = lastLineOf(m);
      marks.push({ from: m.line, to: end, ours: out.slice(m.line - 1, end), theirs: [], message: `'${c.a.name}' was removed by theirs and changed by ours` });
    } else if (c.kind === "removed-by-ours") {
      const t = cT.map.get(c.a);
      const parent = c.a.parent && nodeIn(c.a.parent);
      const at = parent ? lastLineOf(parent) : out.length;
      const lines = theirs.lines.slice(t.line - 1, lastLineOf(t));
      marks.push({ from: at + 1, to: at, ours: [], theirs: lines, message: `'${c.a.name}' was removed by ours and changed by theirs` });
    } else if (c.kind === "added-twice") {
      const oursNode = result.nodes.find((n) => n.kind === c.ours.kind && fold(n.name) === fold(c.ours.name) && n.line >= 1);
      if (!oursNode) continue;
      const end = lastLineOf(oursNode);
      marks.push({ from: oursNode.line, to: end, ours: out.slice(oursNode.line - 1, end), theirs: theirs.lines.slice(c.b.line - 1, lastLineOf(c.b)), message: `'${c.b.name}' was added two ways` });
    }
  }
  // two conflicts on one line (two cells of one row) share one mark
  const byLines = new Map();
  for (const mk of marks) {
    const key = `${mk.from}:${mk.to}`;
    if (byLines.has(key)) byLines.get(key).message += `; ${mk.message}`;
    else byLines.set(key, mk);
  }
  const unique = [...byLines.values()].sort((x, y) => y.from - x.from);
  for (const mk of unique) out.splice(mk.from - 1, mk.to - mk.from + 1, MARK_OURS, ...mk.ours, MARK_MID, ...mk.theirs, MARK_THEIRS);
  // where each mark now stands, in file order
  const at = [];
  out.forEach((l, i) => { if (l === MARK_OURS) at.push(i + 1); });
  const conflictsOut = unique.slice().reverse().map((mk, i) => ({ line: at[i], message: mk.message }));
  return { text: out.join("\n"), clean: !conflictsOut.length, conflicts: conflictsOut, fallback: null };
}

// A conflicting cell is marked on its whole row: theirs' row, as theirs wrote it.
function theirsRowOf(theirs, cT, a) {
  const t = cT.map.get(a);
  return t ? theirs.lines[t.line - 1] : null;
}

module.exports = { merge, canonical, changesBetween, applyChanges, slotsOf, errorKind, MARK_OURS, MARK_MID, MARK_THEIRS };
