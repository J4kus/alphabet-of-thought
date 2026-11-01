// The CSV mirror, both ways at once: every cell merged three ways, against
// the last text the .aot and its CSV agreed on.
//
// A table lives twice — in its .aot, and as aot.files/<Concept>.csv, which
// anyone may edit in anything. Until 1.13 nothing remembered what the two
// last agreed on, so every difference was settled the CSV's way: a
// spreadsheet holding a stale copy saved over newer .aot edits, a .aot
// changed while the editor was closed (a pull) was reverted, and an Example
// the .aot had deleted came back. Now the text both last agreed on is kept —
// the baseline, B — and each cell is judged against it, which is what tells
// the two kinds of difference apart. It is git's merge base, and the archive
// of the last synchronised state that Unison keeps for the same reason:
//
//     B -> the CSV   B -> the .aot        the cell becomes
//     unchanged      changed              the .aot's (the CSV is rewritten)
//     changed        unchanged            the CSV's (folded into the .aot)
//     changed        changed, the same    what both say
//     changed        changed, apart       the later save's: a conflict, said
//
// So an emptied cell now empties (it held a value in B), a row the CSV
// dropped is a deletion to ask about, and a row the .aot dropped stays
// dropped. Rows are keyed by the Example's name, columns by the attribute's,
// case aside. A column comes from the .aot alone: one the CSV adds is not
// read, as it never was. Without any baseline the rule is the one before
// 1.13 — what the CSV says, where it says something, is the later word.
//
// Pure: grids in ([header, ...rows], as table.fromCsv reads them and
// derive.mirrorGrids writes them), a plan out. extension.js keeps the
// baselines and applies the plan.

const key = (s) => String(s == null ? "" : s).trim().toLowerCase();
// what a cell says, as a table holds it: a pipe bent to the broken bar
const cellOf = (s) => String(s == null ? "" : s).trim().replace(/\|/g, "¦");
const same = (x, y) => cellOf(x) === cellOf(y);

// A grid indexed: { header, cols (lowercased, by position), names (col ->
// the header as written), rows (name -> { name, cells: col -> text }),
// order }. The first row of a name wins, as the fold has always read one.
function indexGrid(grid) {
  if (!grid || !grid.length || !grid[0]) return null;
  const header = grid[0];
  const cols = header.slice(1).map(key);
  const names = new Map();
  cols.forEach((c, i) => { if (c && !names.has(c)) names.set(c, String(header[i + 1]).trim()); });
  const rows = new Map();
  const order = [];
  for (const r of grid.slice(1)) {
    const k = key(r[0]);
    if (!k || rows.has(k)) continue;
    const cells = new Map();
    cols.forEach((c, i) => { if (c && !cells.has(c)) cells.set(c, cellOf(r[i + 1])); });
    rows.set(k, { name: String(r[0]).trim(), cells });
    order.push(k);
  }
  return { header, cols: [...names.keys()], names, rows, order };
}

// A cell of an indexed grid: its text, "" for a column the grid has and the
// row leaves empty, undefined for a row or a column the grid does not have.
function cellAt(g, row, col) {
  if (!g) return undefined;
  const r = g.rows.get(row);
  if (!r || !g.names.has(col)) return undefined;
  return r.cells.get(col) || "";
}

// How many cells two grids hold differently — a row one of them lacks counts
// each of its cells. What decides which remembered baseline a CSV descends
// from.
function distance(x, y) {
  const a = indexGrid(x), b = indexGrid(y);
  if (!a || !b) return Infinity;
  const cols = [...new Set([...a.cols, ...b.cols])];
  let n = 0;
  for (const row of new Set([...a.order, ...b.order])) {
    for (const col of cols) if (!same(cellAt(a, row, col) || "", cellAt(b, row, col) || "")) n++;
    if (!a.rows.has(row) || !b.rows.has(row)) n++;
  }
  return n;
}

// The baseline a CSV is merged against: of the texts the two copies last
// agreed on (newest first), the one the fewest cells away from what the CSV
// says now — its closest ancestor, so a copy saved by a program that held an
// older one contributes its own edits and never the reversal of everyone
// else's. A tie goes to the newer. The index, or -1 for none.
function closestBaseline(baselines, csv) {
  let best = -1, bestDistance = Infinity;
  baselines.forEach((b, i) => {
    const d = distance(b, csv);
    if (d < bestDistance) { best = i; bestDistance = d; }
  });
  return best;
}

// The grid a Concept written in several files mirrors: all their rows, the
// first file to list an Example giving its values and a later one filling a
// cell the earlier left empty; the columns in the order they are first met.
// So the CSV holds the one Concept, whichever files spell it.
function unionGrids(grids) {
  const list = grids.filter((g) => g && g.length && g[0]);
  if (!list.length) return null;
  const header = [list[0][0][0]];
  const colAt = new Map();
  for (const g of list) {
    g[0].slice(1).forEach((h) => {
      const k = key(h);
      if (k && !colAt.has(k)) { colAt.set(k, header.length); header.push(String(h).trim()); }
    });
  }
  const rows = new Map();
  for (const g of list) {
    const cols = g[0].slice(1).map(key);
    for (const r of g.slice(1)) {
      const k = key(r[0]);
      if (!k) continue;
      if (!rows.has(k)) rows.set(k, [String(r[0]).trim(), ...header.slice(1).map(() => "")]);
      const out = rows.get(k);
      cols.forEach((c, i) => {
        const at = colAt.get(c);
        if (at !== undefined && !out[at] && cellOf(r[i + 1])) out[at] = cellOf(r[i + 1]);
      });
    }
  }
  return [header, ...rows.values()];
}

// The plan for one CSV: `base` the baseline grid (null when none is
// known), `csv` the CSV as it stands, `aot` what the .aot files say now;
// `csvNewer` whether the CSV was saved after them — the side a conflict goes
// to. Answers {
//   fold: [header, ...rows] | null — the cells the .aot takes from the CSV,
//     a row per Example touched (its parent cell kept as the .aot has it,
//     unless that is what changed), blank wherever nothing changes —
//     derive.updateScope's grid;
//   erase: [{ row, col }] — values the CSV emptied, the .aot's own to empty;
//   deletions: [name] — rows the CSV dropped that the .aot never changed,
//     to be asked about, never done in silence;
//   conflicts: [{ row, col, aot, csv, winner: "aot" | "csv" }] — col null
//     for a whole row one side dropped and the other changed;
// }.
function threeWay(base, csv, aot, opts = {}) {
  const B = indexGrid(base), C = indexGrid(csv), A = indexGrid(aot);
  const plan = { fold: null, erase: [], deletions: [], conflicts: [] };
  if (!C || !A) return plan;
  const csvNewer = !!opts.csvNewer;
  const cols = A.cols;
  const parent = cols.includes("parent") ? "parent" : null;
  const folds = new Map(); // row -> Map(col -> text)
  const put = (row, col, text) => {
    if (!folds.has(row)) folds.set(row, new Map());
    folds.get(row).set(col, text);
  };
  // an emptied cell empties — but an emptied parent cell moves the row to
  // the Concept's own, which is where it is filed, not a value to erase
  const take = (row, col, text) => {
    if (cellOf(text) === "" && col !== parent) plan.erase.push({ row: (A.rows.get(row) || C.rows.get(row)).name, col: A.names.get(col) });
    else put(row, col, cellOf(text));
  };
  const changedSince = (g, row) => cols.some((col) => !same(cellAt(g, row, col) || "", cellAt(B, row, col) || ""));

  const order = [...A.order, ...C.order.filter((r) => !A.rows.has(r))];
  for (const row of order) {
    const inA = A.rows.has(row), inC = C.rows.has(row), inB = !!(B && B.rows.has(row));
    if (inA && inC) {
      for (const col of cols) {
        const c = cellAt(C, row, col);
        if (c === undefined) continue; // a column the CSV does not have says nothing
        const a = cellAt(A, row, col);
        if (same(a, c)) continue;
        const b = cellAt(B, row, col);
        if (b === undefined) {
          // nothing to judge it against: what the CSV says, where it says
          // something — against a value the .aot also gave, only when no
          // baseline is known at all (the rule before 1.13); otherwise the
          // later save's
          if (c === "") continue;
          if (a === "" || !B) { take(row, col, c); continue; }
          const winner = csvNewer ? "csv" : "aot";
          plan.conflicts.push({ row: A.rows.get(row).name, col: A.names.get(col), aot: a, csv: c, winner });
          if (winner === "csv") take(row, col, c);
          continue;
        }
        const csvChanged = !same(c, b), aotChanged = !same(a, b);
        if (!csvChanged) continue; // the .aot's word: the CSV is rewritten
        if (!aotChanged) { take(row, col, c); continue; }
        const winner = csvNewer ? "csv" : "aot";
        plan.conflicts.push({ row: A.rows.get(row).name, col: A.names.get(col), aot: a, csv: c, winner });
        if (winner === "csv") take(row, col, c);
      }
    } else if (inC) {
      // a row the .aot does not have: new in the CSV — or one the .aot
      // dropped since they agreed, which stays dropped unless the CSV
      // changed it after
      if (inB) {
        if (!changedSince(C, row)) continue;
        const winner = csvNewer ? "csv" : "aot";
        plan.conflicts.push({ row: C.rows.get(row).name, col: null, aot: "", csv: C.rows.get(row).name, winner });
        if (winner === "aot") continue;
      }
      for (const col of cols) {
        const c = cellAt(C, row, col);
        if (c) put(row, col, c);
      }
      if (!folds.has(row)) folds.set(row, new Map());
    } else if (inA && inB) {
      // the CSV dropped a row both had: a deletion, asked about — unless the
      // .aot changed the row since, which keeps it
      if (changedSince(A, row)) {
        plan.conflicts.push({ row: A.rows.get(row).name, col: null, aot: A.rows.get(row).name, csv: "", winner: "aot" });
      } else plan.deletions.push(A.rows.get(row).name);
    }
  }
  if (folds.size) {
    const header = [A.header[0], ...cols.map((c) => A.names.get(c))];
    plan.fold = [header, ...[...folds].map(([row, cells]) => {
      const name = (A.rows.get(row) || C.rows.get(row)).name;
      return [name, ...cols.map((col) => {
        if (cells.has(col)) return cells.get(col);
        // where a row is filed is kept exactly as the .aot has it, unless
        // the CSV changed that
        if (col === parent) return A.rows.has(row) ? cellAt(A, row, col) || "" : "";
        return "";
      })];
    })];
  }
  return plan;
}

// The fold that writes `values` ([{ row, col, value }]) into the .aot as it
// stands — `aot`, its mirror grid — in threeWay's shape: how one side of a
// conflict is taken after the fact, through the same edit a merge makes. An
// empty value erases (a parent cell's moves the row to the top); a column
// the .aot does not have is no value to write.
function foldOf(aot, values) {
  const A = indexGrid(aot);
  const plan = { fold: null, erase: [], deletions: [], conflicts: [] };
  if (!A) return plan;
  const parent = A.cols.includes("parent") ? "parent" : null;
  const rows = new Map();
  for (const v of values) {
    const row = key(v.row), col = key(v.col);
    if (!A.names.has(col)) continue;
    if (cellOf(v.value) === "" && col !== parent) { plan.erase.push({ row: String(v.row).trim(), col: A.names.get(col) }); continue; }
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row).set(col, cellOf(v.value));
  }
  if (rows.size) {
    plan.fold = [[A.header[0], ...A.cols.map((c) => A.names.get(c))], ...[...rows].map(([row, cells]) => [
      (A.rows.get(row) || { name: row }).name,
      ...A.cols.map((c) => (cells.has(c) ? cells.get(c) : c === parent ? cellAt(A, row, c) || "" : "")),
    ])];
  }
  return plan;
}

module.exports = { threeWay, unionGrids, closestBaseline, distance, indexGrid, foldOf };
