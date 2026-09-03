# -*- coding: utf-8 -*-
import io
p = 'src/table.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 # sorting: the header is what the run must not cross
 ("""// C-c ^: sort the run of data rows around the cursor (bounded by separator
// rows, so the header keeps its place) by the cursor's column — numerically
// when every key reads as a number ($, % and thousands commas ignored),
// alphabetically otherwise.
function sortRows(block, row, col) {
  if (block.rows[row].sep) return null;
  let a = row, b = row;
  while (a > 0 && !block.rows[a - 1].sep) a--;
  while (b < block.rows.length - 1 && !block.rows[b + 1].sep) b++;""",
  """// C-c ^: sort the data rows around the cursor — the header standing first
// is what keeps it out of the run — by the cursor's column: numerically
// when every key reads as a number ($, % and thousands commas ignored),
// alphabetically otherwise.
function sortRows(block, row, col) {
  if (block.rows[row].sep) return null;
  const head = headerIndex(block);
  if (row <= head) return null;
  let a = row, b = row;
  while (a > head + 1 && !block.rows[a - 1].sep) a--;
  while (b < block.rows.length - 1 && !block.rows[b + 1].sep) b++;"""),
 # a table built from a region needs no rule under its header
 ("""    rows: [rows[0], { sep: true, cells: [] }, ...rows.slice(1)],""",
  """    rows,"""),
 # the data rows are simply the rows under the header
 ("""// The data rows of a complete table block (header and separators aside).
function dataRowsOf(block) {
  const rows = block.rows.filter((r) => !r.sep);
  return block.rows.length >= 2 && !block.rows[0].sep && block.rows[1].sep ? rows.slice(1) : [];
}""",
  """// The data rows of a table block: everything under the header.
function dataRowsOf(block) {
  return block.rows.filter((r) => !r.sep).slice(1);
}"""),
 ("""  const header = block.rows.length && !block.rows[0].sep ? block.rows[0].cells : [];""",
  """  const head = headerIndex(block);
  const header = head === -1 ? [] : block.rows[head].cells;"""),
 ("""function ownName(block) {
  if (!block.rows.length || block.rows[0].sep) return "";
  return cleanName(widthCookie(block.rows[0].cells[0] || "").text);
}""",
  """function ownName(block) {
  const head = headerIndex(block);
  if (head === -1) return "";
  return cleanName(widthCookie(block.rows[head].cells[0] || "").text);
}"""),
 # a complete table is a header with rows under it
 ("""    if (block.rows.length < 2 || block.rows[0].sep || !block.rows[1].sep) continue;
    // the table names the Concept it describes in its first header cell""",
  """    if (headerIndex(block) === -1 || !dataRowsOf(block).length) continue;
    // the table names the Concept it describes in its first header cell"""),
 ("""    if (b.rows[0].sep) continue;
    const cell0 = cleanName(widthCookie(b.rows[0].cells[0] || "").text);""",
  """    if (headerIndex(b) === -1) continue;
    const cell0 = cleanName(widthCookie(b.rows[headerIndex(b)].cells[0] || "").text);"""),
 ("""    rows: [
      { sep: false, cells: header },
      { sep: true, cells: [] },
      ...rows.map((cells) => ({ sep: false, cells })),
    ],""",
  """    rows: [
      { sep: false, cells: header },
      ...rows.map((cells) => ({ sep: false, cells })),
    ],"""),
 # a block worth drawing is one with a row in it; a leftover rule alone is not
 ("""    if (!block.rows.some((r) => r.sep) || !block.rows.some((r) => !r.sep)) continue;""",
  """    if (headerIndex(block) === -1) continue; // a leftover rule alone is no table"""),
]
for a, b in subs:
    n = 2 if a.strip().startswith('if (!block.rows.some') else 1
    assert s.count(a) == n, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
