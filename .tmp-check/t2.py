# -*- coding: utf-8 -*-
import io, re
p = 'out/test-table.js'
s = io.open(p, encoding='utf-8').read()

start = s.index("""// ---------------------------------------------------------------------------
// column alignment: markdown's colons in the separator
// ---------------------------------------------------------------------------""")
end = s.index("""// ---------------------------------------------------------------------------
// copying and cutting the text itself: copyCell / moveCell / copyRow / copyColumn""")

new = """// ---------------------------------------------------------------------------
// no rule, no alignment: every column is drawn left, and a leftover rule
// (colons and all) is layout the next draw takes out
// ---------------------------------------------------------------------------
{
  const written = [
    "default|left|right|centre",
    "-------|:---|----:|:----:",
    "1|1|1|1",
    "2|2|2|2",
  ];
  const b = blockAt(written, 0);
  const drawn = render(b);
  check("no alignment: every column is padded on its right, whatever the old rule said",
    drawn[1] === "1      |1   |1    |1     ");
  check("no rule: the leftover is dropped, so the drawn table is header and rows",
    drawn.length === 3 && drawn[0] === "default|left|right|centre");

  // the formatter must not churn: drawing an aligned table again changes
  // nothing, or every save would rewrite the file
  check("alignment: rendering is idempotent",
    render(blockAt(drawn, 0)).join("\\n") === drawn.join("\\n"));

  check("cellStart: a cell starts at its column's own edge",
    cellStart(b, 2) === "default|left|".length);

  // and the model cannot tell: every reader trims its cells
  check("alignment: the padding is presentation — the cells read the same",
    cells(drawn[1]).map((c) => c.text).join(",") === "1,1,1,1");
}

"""
s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
