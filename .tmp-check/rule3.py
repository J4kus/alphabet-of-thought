# -*- coding: utf-8 -*-
import io
p = 'src/linter.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""    // a '---+---' separator row is table layout, never a node: it marks
    // the row above it as the table's header
    if (isSeparator(trimmed)) return;""",
  """    // a '---+---' rule is layout left over from before 1.12, when it marked
    // the row above it as the header. Standing first is what marks the header
    // now, so the rule states nothing — it is skipped without ending the
    // table, and the next re-draw takes it out of the file
    if (isSeparator(trimmed)) return;"""),
 ("""      // A header row is told from a data row as in org: the line directly
      // beneath it is a '---+---' separator. A lone row — nothing tabular
      // on the next line — is a header being typed: it is assumed, the
      // separator and data rows still to come.
      const below = i + 1 < lines.length ? lines[i + 1].trim() : "";
      const separatorBelow = isSeparator(below);
      const rowBelow = !separatorBelow && isRowText(below);
      if (!table && (separatorBelow || !rowBelow)) {""",
  """      // The header is the row that opens the table: no rule declares it,
      // standing first does. Every row under it is an Example, and a row with
      // no table open is a header with its rows still to come.
      if (!table) {"""),
 ("""      report.error(line, `table row has ${row.length} cells but no header names its columns — add a header row of attribute names directly above the data rows, with a '---+---' separator row between them; if you meant a literal pipe in a value, write it as the broken bar '¦', which is what a table cell holds`);
      return;
    }""",
  """    }"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
