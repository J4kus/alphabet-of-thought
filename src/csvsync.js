// The CSV mirror's one rule: the file saved last overrides the other.
//
// A table lives twice — in its .aot, and as aot.files/<Concept>.csv, which
// anyone may edit in anything. Whichever was saved last is right, and the
// other is made to say the same, even where it was edited too since they last
// agreed. Nothing is merged and nothing needs remembering: the two files' save
// times decide (extension.js reads them), so the rule holds on a fresh clone,
// in a moved folder and on a new profile exactly as it does anywhere else.
//
//     saved last   what happens
//     the .aot     the CSV is rewritten from it, whatever the CSV said
//     the CSV      the .aot takes every cell where the two differ
//
// So an emptied cell empties, a new row arrives and a row it lacks is deleted.
// A column comes from the .aot alone: one the CSV adds is not read. Rows are
// keyed by the Example's name, columns by the attribute's, case aside.
//
// Unsaved text is no save, so it never wins: a .aot buffer takes the CSV's word
// on every cell and every row, its own unsaved edits to them included. What the
// buffer holds outside the mirrored table is no business of the CSV's.
//
// Pure: grids in ([header, ...rows], as table.fromCsv reads them and
// derive.mirrorGrids writes them), a plan out. extension.js reads the save
// times and applies the plan.

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

// The plan when the CSV was saved last: `csv` the CSV as it stands, `aot` what
// the .aot files say now, unsaved edits included. Answers {
//   fold: [header, ...rows] | null — the cells the .aot takes from the CSV, a
//     row per Example touched (its parent cell kept as the .aot has it, unless
//     that is what changed), blank wherever nothing changes —
//     derive.updateScope's grid;
//   erase: [{ row, col }] — values the CSV emptied, the .aot's own to empty;
//   deletions: [name] — rows the CSV lacks, to go;
// }.
function csvOverrides(csv, aot) {
  const C = indexGrid(csv), A = indexGrid(aot);
  const plan = { fold: null, erase: [], deletions: [] };
  if (!C || !A) return plan;
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
  for (const row of [...A.order, ...C.order.filter((r) => !A.rows.has(r))]) {
    const inA = A.rows.has(row), inC = C.rows.has(row);
    if (inA && inC) {
      for (const col of cols) {
        const c = cellAt(C, row, col);
        if (c === undefined) continue; // a column the CSV does not have says nothing
        if (!same(cellAt(A, row, col), c)) take(row, col, c);
      }
    } else if (inC) {
      // a row the .aot does not have: new
      for (const col of cols) {
        const c = cellAt(C, row, col);
        if (c) put(row, col, c);
      }
      if (!folds.has(row)) folds.set(row, new Map());
    } else {
      plan.deletions.push(A.rows.get(row).name);
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

module.exports = { csvOverrides, unionGrids, indexGrid };
