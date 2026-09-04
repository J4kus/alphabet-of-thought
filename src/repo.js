// What a Concept means when it appears in more than one .aot file.
//
// A single file answers "what is this?" with one tree. A repository answers it
// with several, and the same name turns up in more than one of them. Alpha
// used to have exactly one relationship for that — "duplicate, pick one" — and
// applied it to two situations that are nothing alike. This module draws the
// distinction logic already gives a Concept and treats the two halves
// differently:
//
//     intension(N)  the definition: the attributes and values N declares, and
//                   the kind it is filed under. This MUST agree across files.
//                   One side silent is not disagreement — it simply says
//                   less, and reconcileOps writes the rest in. Two sides
//                   naming the same attribute with different values is a real
//                   equivocation, and an error.
//
//     extension(N)  the Examples N lists — the individuals it vouches for.
//                   This is a partial sample per file: each file lists the
//                   individuals its own subject needs, and the repo-wide truth
//                   is the union. Differences here are never a conflict, and
//                   are never merged away. A `...` line says how many live
//                   elsewhere and where, and that is all.
//
// Every occurrence is a peer. No file owns a Concept and no file is exempt
// from declaring itself partial — the `...` keeps exactly the meaning it
// already has in subsumption.js (an open, ⊑ definition), fca.js (this side
// intentionally incomplete) and linter.js (the rest is still to come).
//
// Pure: no I/O, no vscode. Shared by the extension and verify.js, so the
// editor and the command line reach the same verdict.

const path = require("path");
const { KIND, INDENT } = require("./linter");
const { numberless, tablesOf, updateTable } = require("./table");
const { lastLineOf, headerColName } = require("./derive");

// The maintained `...` line, told from anything you wrote by its own shape.
// Only a Map whose note matches this is ever rewritten or removed; a
// `... still to do` beside it is left exactly as it stands.
const NOTE_RE = /^\d+ more in /;
const MAX_FILES = 3; // then `, …`, and the rest of the list moves to the hover

const fold = (name) => numberless(name).trim().toLowerCase();
const isAttr = (c) => c.kind === KIND.ATTRIBUTE || c.kind === KIND.DEFAULT;
const examplesOf = (node) => node.children.filter((c) => c.kind === KIND.INDIVIDUAL);

// Every maintained `...` in a Concept's own scope, in document order —
// including any that landed on a row rather than on the Concept, which is
// how a standalone table used to collect one on every save. The search stops
// at a deeper Concept, whose notes are its own business.
function maintainedNotes(node) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (c.kind === KIND.MAP && NOTE_RE.test(c.name)) out.push(c);
      else if (c.kind !== KIND.CONCEPT) walk(c);
    }
  };
  walk(node);
  return out.sort((a, b) => a.line - b.line);
}

// The attributes a node declares itself, nearest-first by name. A node may
// write the same attribute twice (its own problem, rule 5); the first wins
// here so this never depends on which duplicate is read.
function declared(node) {
  const m = new Map();
  for (const c of node.children) {
    if (!isAttr(c)) continue;
    const k = c.name.toLowerCase();
    if (!m.has(k)) m.set(k, c);
  }
  return m;
}

// The attributes in force at a node: its own, then every ancestor's, with the
// nearest declaration winning — the inheritance the README describes and the
// same override rule subsumption.js's effIntent applies. This, not `declared`,
// decides whether an attribute is missing: an attribute a peer merely
// inherits is already in force here too, and copying it in as a literal line
// would drag that peer's ancestry into this file.
function effective(node) {
  const m = new Map();
  for (let a = node; a; a = a.parent) {
    for (const c of a.children) {
      if (!isAttr(c)) continue;
      const k = c.name.toLowerCase();
      if (!m.has(k)) m.set(k, c);
    }
  }
  return m;
}

// The kind a Concept is filed under: its nearest named ancestor, or null at
// the top of a file (the root names the file, not a filing place).
//
// Only the *nearest* ancestor is compared across files. It is what the
// placement directly asserts — `Jakus` under `- Motivation` says Jakus is a
// motivation — while anything further up is how that file happens to nest its
// own subject, and two files are entitled to differ there. And a Concept at
// the top of one file does not contradict one filed in another: that is
// silence, which this module never reads as disagreement.
const genusOf = (node) => (node.parent && node.parent.parent ? fold(node.parent.name) : null);

// Every Concept in the repo, by folded name. `entries` is
// [{ file, text, root, nodes }] — the shape crosslinks.externalIndex already
// takes, plus the text, which reconcileOps needs to copy lines verbatim.
function occurrences(entries) {
  const byName = new Map();
  for (const entry of entries) {
    const lines = entry.text === undefined ? null : entry.text.split(/\r?\n/);
    for (const node of entry.nodes) {
      if (node.kind !== KIND.CONCEPT) continue;
      const key = fold(node.name);
      if (!key) continue;
      const list = byName.get(key) || [];
      list.push({ file: entry.file, root: entry.root, node, lines, key });
      byName.set(key, list);
    }
  }
  return byName;
}

// The peers of one occurrence: the same Concept in *other* files. Two
// definitions in one file are rule 9's business, not this module's.
const peersOf = (occ, all) => all.filter((o) => o.file !== occ.file);

// The repo-wide extension: every Example listed for a name, with the file and
// line each was found in. Feeds the hover and the note's count.
function unionExamples(all) {
  const out = [];
  for (const occ of all) {
    for (const ex of examplesOf(occ.node)) {
      out.push({ name: ex.name, file: occ.file, line: ex.line, node: ex });
    }
  }
  return out;
}

// --- the `...` line ---------------------------------------------------------

// The note this occurrence should carry, or null when no peer lists an
// Example it lacks — an occurrence whose peers add nothing is not partial and
// says nothing.
//
//     4 more in bank recon.aot:14
//     7 more in bank recon.aot:14, payroll.aot:9
//     11 more in bank recon.aot:14, payroll.aot:9, vat return.aot:22, …
//
// The total comes first because it is the thing worth knowing; the locations
// are `file:line`, which is how the rest of this codebase points across files
// and the one form every editor makes clickable.
function noteFor(occ, peers) {
  const here = new Set(examplesOf(occ.node).map((e) => fold(e.name)));
  const carrying = [];
  for (const p of peers) {
    const extra = examplesOf(p.node).filter((e) => !here.has(fold(e.name)));
    if (extra.length) carrying.push({ peer: p, count: extra.length });
  }
  if (!carrying.length) return null;
  carrying.sort((a, b) => path.basename(a.peer.file).localeCompare(path.basename(b.peer.file)));
  const total = carrying.reduce((sum, c) => sum + c.count, 0);
  const shown = carrying.slice(0, MAX_FILES)
    .map((c) => `${path.basename(c.peer.file)}:${c.peer.node.line}`);
  return `${total} more in ${shown.join(", ")}${carrying.length > MAX_FILES ? ", …" : ""}`;
}

// The `file:line` spans inside this file's maintained `...` lines, so the
// DocumentLinkProvider can make each one open that file at that line.
// Returns [{ line, startCol, endCol, file, target }], 1-based lines.
function noteSpans(lines, root, nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.kind !== KIND.MAP || !NOTE_RE.test(node.name)) continue;
    const raw = lines[node.line - 1] || "";
    // every `name.aot:12` in the line, taken from the raw text so the columns
    // are the ones the editor will highlight
    for (const m of raw.matchAll(/([^\s,]+\.aot):(\d+)/g)) {
      out.push({
        line: node.line,
        startCol: m.index,
        endCol: m.index + m[0].length,
        file: m[1],
        target: Number(m[2]),
      });
    }
  }
  return out;
}

// --- findings ---------------------------------------------------------------

// The repo-wide errors and warnings for one file, given every occurrence in
// the repo. Errors are the two things no tool may decide for you; the warning
// is only reachable with auto-reconcile off, when the note has gone stale and
// nothing is rewriting it.
//
// Returns { errors, warnings }, each [{ line, message, related }] with related
// entries [{ file, line, message }] — the shape the extension publishes and
// verify.js prints.
function findings(file, all, opts) {
  const errors = [];
  const warnings = [];
  const stale = !opts || opts.autoReconcile === false;
  for (const [, list] of all) {
    const mine = list.filter((o) => o.file === file);
    if (!mine.length || list.length === mine.length) continue;
    for (const occ of mine) {
      const peers = peersOf(occ, list);
      const where = (p) => ({
        file: p.file, line: p.node.line,
        message: `'${p.node.name}' also written here`,
      });

      // a value both sides name differently — the one thing that is a
      // genuine equivocation rather than one side saying less
      const eff = effective(occ.node);
      for (const [key, ours] of eff) {
        if (ours.kind !== KIND.DEFAULT || ours.value == null) continue;
        for (const p of peers) {
          const theirs = effective(p.node).get(key);
          if (!theirs || theirs.kind !== KIND.DEFAULT || theirs.value == null) continue;
          if (String(ours.value).trim().toLowerCase() === String(theirs.value).trim().toLowerCase()) continue;
          errors.push({
            line: ours.line,
            message: `'${occ.node.name}' sets '${ours.name}' to '${ours.value}' here but '${theirs.value}' in `
              + `${path.basename(p.file)}:${theirs.line} — one name must mean one thing, so a Concept cannot `
              + `carry two values for one attribute; pick the one that is right and set it everywhere, or `
              + `qualify one of the two Concepts if they are different ideas`,
            related: [where(p)],
          });
          break; // one report per attribute, naming the first peer that differs
        }
      }

      // filed under two different kinds — a modelling decision, never ours
      const ourGenus = genusOf(occ.node);
      if (ourGenus) {
        for (const p of peers) {
          const theirGenus = genusOf(p.node);
          if (!theirGenus || theirGenus === ourGenus) continue;
          errors.push({
            line: occ.node.line,
            message: `'${occ.node.name}' is filed under '${occ.node.parent.name}' here but `
              + `'${p.node.parent.name}' in ${path.basename(p.file)}:${p.node.line} — a Concept is one kind, `
              + `so it cannot be a kind of two things; move one, or qualify one of the two names`,
            related: [where(p)],
          });
          break;
        }
      }

      if (!stale) continue;
      const want = noteFor(occ, peers);
      const have = maintainedNotes(occ.node).find((n) => n.parent === occ.node) || null;
      if (want && (!have || have.name !== want)) {
        warnings.push({
          line: have ? have.line : occ.node.line,
          message: `'${occ.node.name}' lists ${examplesOf(occ.node).length} of its Examples here and the rest `
            + `live elsewhere — the '...' should read '${want}'; run 'AOT: Reconcile Concepts Across Files', `
            + `or turn aot.autoReconcile back on to have it kept true on save`,
          related: peers.map(where),
        });
      }
    }
  }
  const byLine = (a, b) => a.line - b.line;
  return { errors: errors.sort(byLine), warnings: warnings.sort(byLine) };
}

// --- auto-reconcile ---------------------------------------------------------

// One child of a peer as lines for this file: the raw subtree re-indented so
// aliases, constraints and formulas survive verbatim, or synthesised when the
// node came from a table row and has no line of its own.
function subtreeLines(node, peerLines, indent, childIndent) {
  if (node.cell || !peerLines) {
    if (node.kind === KIND.INDIVIDUAL) {
      const out = [indent + `- ${node.name}`];
      for (const c of node.children) {
        if (c.kind === KIND.DEFAULT && c.value != null && String(c.value) !== "") {
          out.push(childIndent + `${c.name}: ${c.value}`);
        }
      }
      return out;
    }
    const value = node.kind === KIND.DEFAULT && node.value != null ? `: ${node.value}` : "";
    return [indent + node.name + (node.alias ? ` (${node.alias})` : "") + value];
  }
  const src = peerLines.slice(node.line - 1, lastLineOf(node));
  if (!src.length) return [];
  const srcIndent = (src[0].match(/^ */) || [""])[0].length;
  const delta = indent.length - srcIndent;
  return src.map((l) => {
    const lead = (l.match(/^ */) || [""])[0].length;
    return " ".repeat(Math.max(0, lead + delta)) + l.trimStart();
  });
}

// Everything this file can be made to agree on without a human deciding
// anything. Additive: attributes and values a peer declares and this
// occurrence does not have in force, the same for a same-named Example's
// attributes, and the maintained `...` line.
//
// The only line it ever removes is a maintained `...` that has stopped being
// true — a line this module wrote, never one you did. Nothing you wrote is
// deleted, and no peer's file is touched: a save reconciles the file being
// saved and nothing else.
//
// Returns ops in the shape derive.updateExamples already returns —
// { type: "replace" | "insert" | "block" | "delete" } — to be applied in
// **descending line order**, with at most one op per line.
function reconcileOps(lines, occ, peers, rootName, registry) {
  const node = occ.node;
  const ops = [];
  const indent = " ".repeat(INDENT * (node.depth + 1));
  const childIndent = " ".repeat(INDENT * (node.depth + 2));
  const grid = tablesOf(lines, rootName)
    .find((t) => fold(t.name) === fold(node.name));

  // 1) attributes a peer declares that are not in force here. A bare `age`
  //    facing a peer's `age: 41` takes the value rather than counting as a
  //    disagreement — the valued line is strictly more definite.
  const eff = effective(node);
  const own = declared(node);
  const fresh = [];
  const columns = [];
  const taken = new Set();
  for (const p of peers) {
    for (const [key, theirs] of declared(p.node)) {
      if (taken.has(key)) continue;
      const ours = eff.get(key);
      if (ours) {
        const bare = ours.kind === KIND.ATTRIBUTE && theirs.kind === KIND.DEFAULT;
        if (!bare || !own.has(key) || ours.cell) continue;
        taken.add(key);
        const raw = lines[ours.line - 1] || "";
        ops.push({ type: "replace", line: ours.line, text: `${raw.trimEnd()}: ${theirs.value}` });
        continue;
      }
      taken.add(key);
      if (grid) columns.push({ key, node: theirs });
      else fresh.push(...subtreeLines(theirs, p.lines, indent, childIndent));
    }
  }
  if (fresh.length) {
    // directly under the Concept's own line-form declarations, before its
    // Examples, so the definition still reads before the individuals do
    const before = node.children.filter((c) => isAttr(c) && !c.cell);
    const after = before.length ? lastLineOf(before[before.length - 1]) : node.line;
    ops.push({ type: "insert", afterLine: after, text: fresh.join("\n") });
  }

  // 2) attributes a peer gives an Example this file also lists. An Example
  //    has an intension too, and the same rule settles it.
  const mineByName = new Map(examplesOf(node).map((e) => [fold(e.name), e]));
  const rowFill = new Map(); // Example name -> { attr -> value } for the grid
  for (const p of peers) {
    for (const theirEx of examplesOf(p.node)) {
      const ours = mineByName.get(fold(theirEx.name));
      if (!ours) continue; // a peer's own Example stays a peer's own Example
      const have = effective(ours);
      const add = [];
      for (const [key, attr] of declared(theirEx)) {
        if (have.has(key)) continue;
        have.set(key, attr);
        if (ours.cell) {
          const at = rowFill.get(fold(ours.name)) || new Map();
          at.set(key, attr.value == null ? "" : String(attr.value));
          rowFill.set(fold(ours.name), at);
          if (grid && !grid.header.some((h) => headerColName(h).toLowerCase() === key)) {
            if (!columns.some((c) => c.key === key)) columns.push({ key, node: attr });
          }
        } else {
          add.push(...subtreeLines(attr, p.lines, childIndent, childIndent + " ".repeat(INDENT)));
        }
      }
      if (add.length) ops.push({ type: "insert", afterLine: lastLineOf(ours), text: add.join("\n") });
    }
  }

  // 3) the table form of 1) and 2): missing attributes become columns, and a
  //    row gains the values its Example was given elsewhere
  if (grid && (columns.length || rowFill.size)) {
    const header = [...grid.header];
    for (const c of columns) {
      if (!header.some((h) => headerColName(h).toLowerCase() === c.key)) header.push(c.node.name);
    }
    const rows = grid.rows.map((row) => {
      const out = header.map((h, k) => (k < row.length ? row[k] : ""));
      const fill = rowFill.get(fold(row[0] || ""));
      if (fill) {
        header.forEach((h, k) => {
          if (k === 0) return;
          const key = headerColName(h).toLowerCase();
          if (!out[k] && fill.has(key)) out[k] = fill.get(key);
        });
      }
      return out;
    });
    const u = updateTable(lines, grid.name, header, rows, rootName, registry);
    if (u && u.changed) ops.push({ type: "block", from: u.from, to: u.to, block: u.block });
  }

  // 4) the `...` line — written, kept true, or dropped when it stops being
  //    true. These are the only lines reconcileOps ever removes, and it only
  //    ever removes ones it wrote itself.
  //
  //    The line goes one level under the Concept's own, wherever that is:
  //    under its line in the line form, and under the last row of a table —
  //    a table names its Concept in its first header cell, so one level
  //    under the grid is exactly one level under the Concept, and the
  //    linter files a '...' written there on the Concept rather than on the
  //    row above it. That is what lets the next pass find this line instead
  //    of writing a second one, which is what a standalone table used to
  //    collect on every save.
  const want = noteFor(occ, peers);
  const notes = maintainedNotes(node);
  // reuse a note that really is the Concept's own; every other one is a
  // stray to clear away, whether from an older pass or a restructured file
  const keep = want ? notes.find((n) => n.parent === node) : null;
  for (const n of notes) if (n !== keep) ops.push({ type: "delete", line: n.line });
  if (want) {
    const text = `${indent}... ${want}`;
    if (!keep) ops.push({ type: "insert", afterLine: lastLineOf(node), text });
    else if ((lines[keep.line - 1] || "") !== text) ops.push({ type: "replace", line: keep.line, text });
  }

  return mergeInserts(ops);
}

// Two inserts after one line would fight: applied bottom-up they arrive in
// the reverse of the order they were built. derive.updateExamples solves this
// the same way, and for the same reason — merge them into one op in build
// order, so no caller's sort can get it wrong.
function mergeInserts(ops) {
  const out = [];
  const at = new Map();
  for (const op of ops) {
    if (op.type !== "insert") { out.push(op); continue; }
    const collecting = at.get(op.afterLine);
    if (collecting) { collecting.text += "\n" + op.text; continue; }
    at.set(op.afterLine, op);
    out.push(op);
  }
  return out;
}

// Every op for a whole file, one Concept at a time. Ops are returned in
// descending line order, ready to apply.
function reconcileFile(file, all, lines, rootName, registry) {
  const ops = [];
  for (const [, list] of all) {
    for (const occ of list) {
      if (occ.file !== file) continue;
      const peers = peersOf(occ, list);
      if (!peers.length) continue;
      ops.push(...reconcileOps(lines, occ, peers, rootName, registry));
    }
  }
  const lineOf = (op) =>
    op.type === "replace" || op.type === "delete" ? op.line
      : op.type === "block" ? op.from + 1 : op.afterLine;
  return ops.sort((a, b) => lineOf(b) - lineOf(a));
}

// Apply ops to an array of lines, for verify.js and the tests. The extension
// applies the same ops as a WorkspaceEdit instead, so both paths agree on
// what an op means.
function applyOps(lines, ops) {
  const out = [...lines];
  const lineOf = (op) =>
    op.type === "replace" || op.type === "delete" ? op.line
      : op.type === "block" ? op.from + 1 : op.afterLine;
  for (const op of [...ops].sort((a, b) => lineOf(b) - lineOf(a))) {
    if (op.type === "block") out.splice(op.from, op.to - op.from + 1, ...op.block);
    else if (op.type === "replace") out[op.line - 1] = op.text;
    else if (op.type === "delete") out.splice(op.line - 1, 1);
    else out.splice(op.afterLine, 0, ...op.text.split("\n"));
  }
  return out;
}

module.exports = {
  occurrences, peersOf, unionExamples, findings,
  reconcileOps, reconcileFile, applyOps,
  noteFor, noteSpans, maintainedNotes, declared, effective, genusOf,
  NOTE_RE,
};
