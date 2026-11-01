// Findings elsewhere wait while you write — and only those.
//
// Typing a child sets off findings that are not about the line being typed:
// the parent "has 1 sub-Concept" the moment its first child exists, a sibling
// now overlaps, an ancestor reads as misfiled, a name elsewhere has a
// duplicate. Squiggles flashing up around the line you are on interrupt the
// thought mid-line, and most are gone again a line later. So, from the first
// edit of a burst until you leave what you are editing:
//
//   - a finding already on screen when the burst began keeps showing, so
//     nothing flickers; one that goes away goes at once — a fix shows;
//   - a finding on a line you edited during the burst shows, at the usual
//     debounce: your own lines speak;
//   - every other finding that is new waits.
//
// The burst ends, and what waited shows, when the cursor leaves the family of
// what was edited — the edited node's parent and everything under it, the
// parent's own line aside, so typing three siblings in a row keeps the parent
// quiet; at the top of the file, the edited node's own subtree — on save, or
// when another editor takes over. No timer: you say when you are done, by
// moving on. The extension counts what waits in the status bar, so nothing is
// hidden silently.
//
// Pure: the extension wires it (trackEdits, refresh, the selection handler).

// A finding as the same finding wherever it stands: its severity and its
// message, any `line N` / `lines N, M` in it taken out — a line edited above
// moves a finding without changing what it says.
function keyOf(d) {
  const message = String(d.message || "").replace(/\blines? \d+(?:(?:\s*,\s*|\s+and\s+)\d+)*/g, "line");
  return `${d.severity}|${message}`;
}

// A set of 0-based line numbers carried through one text change: lines
// [start, end] (the old range, inclusive) became `added` lines. Lines above
// stay, lines below move by the difference, and the lines the change wrote
// — [from, to], by default all `added` of them — are in the set after it.
// A line break typed at the end of a line writes the lines after it and
// leaves that line as it was, which is what `from` says.
function shiftLines(lines, change) {
  const { start, end, added } = change;
  const from = change.from === undefined ? start : change.from;
  const to = change.to === undefined ? start + added - 1 : change.to;
  const delta = added - (end - start + 1);
  const out = new Set();
  for (const l of lines) {
    if (l < start) out.add(l);
    else if (l > end) out.add(l + delta);
    else if (l >= start && l < from) out.add(l); // a line the change left as it was
  }
  for (let l = from; l <= to; l++) out.add(l);
  return out;
}

// The family of the node a line holds (1-based; on a line with none, the
// nearest node above it): its parent and everything under it, the parent's
// own line aside — or at the top of the file, the node's own subtree. {
// name (what the family is named after), from, to } — the lines (1-based,
// inclusive) the cursor may move about in without ending the burst. null for
// a line no node stands at or above.
function familyOf(root, nodes, line) {
  let node = null;
  for (const n of nodes) {
    if (!(n.line >= 1) || n.line > line) continue;
    // the line's own shallowest node, else the nearest above
    if (!node || n.line > node.line || (n.line === node.line && n.depth < node.depth)) node = n;
  }
  if (!node) return null;
  const head = node.parent && node.parent !== root ? node.parent : node;
  let from = Infinity, to = -Infinity;
  const walk = (n) => {
    for (const c of n.children) {
      if (c.line >= 1) { from = Math.min(from, c.line); to = Math.max(to, c.line); }
      walk(c);
    }
  };
  walk(head);
  if (head === node) { from = Math.min(from, head.line); to = Math.max(to, head.line); }
  if (from === Infinity) { from = to = node.line; }
  return { name: head.name, from, to };
}

// Split findings into { show, held }: a finding shows when it was on screen
// as the burst began (`baseline`: keys) or stands on a line edited during it
// (`edited`: 0-based lines); every other one waits.
function partition(diags, baseline, edited) {
  const show = [], held = [];
  for (const d of diags) {
    const line = d.range && d.range.start ? d.range.start.line : -1;
    if ((baseline && baseline.has(keyOf(d))) || (edited && edited.has(line))) show.push(d);
    else held.push(d);
  }
  return { show, held };
}

module.exports = { keyOf, shiftLines, familyOf, partition };
