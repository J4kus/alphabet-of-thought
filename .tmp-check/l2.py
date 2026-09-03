# -*- coding: utf-8 -*-
import io
p = 'out/test-linter.js'
s = io.open(p, encoding='utf-8').read()
subs = [
 ("""  // data rows with no header have no columns to read the cells by
  {
    const r = makeReport();
    parse(aot("Otter", "    Ollie | 5", "    Pebble | 3"), "Zoo", r);
    check("table: data rows without a header are an error", hasError(r, /no header names its columns/));
  }""",
  """  // the row that opens a run is the header: no rule declares it
  {
    const r = makeReport();
    const p = parse(aot("Thing", "    Otter | size", "    Ollie | 5"), "Zoo", r);
    check("table: the row standing first is the header, no rule needed",
      r.errors.length === 0
      && node(p.root, p.nodes, "Otter").kind === CONCEPT
      && node(p.root, p.nodes, "Ollie").kind === INDIVIDUAL);
  }"""),
 ("""  // a row with no header above it has nothing naming its columns
  {
    const r = makeReport();
    parse(aot("Thing", "    Pear|5", "    Plum|6"), "Root", r);
    check("table: a row with no header names its columns is an error",
      hasError(r, /no header names its columns/));
  }
""",
  ""),
 ("""  // a blank line ends the table, as in org: rows beyond it no longer
  // belong to the header's columns
  {
    const r = makeReport();
    parse(aot("Otter | size", "", "Ollie | 5", "Pebble | 3"), "Zoo", r);
    check("table: a blank line ends the table", hasError(r, /no header names its columns/));
  }""",
  """  // a blank line ends the table, as in org: what follows it is a table of
  // its own, its first row the header again
  {
    const r = makeReport();
    const p = parse(aot("Otter | size", "", "Ollie | 5", "Pebble | 3"), "Zoo", r);
    check("table: a blank line ends the table",
      node(p.root, p.nodes, "Ollie").kind === CONCEPT
      && node(p.root, p.nodes, "Pebble").kind === INDIVIDUAL
      && node(p.root, p.nodes, "Pebble").parent.name === "Ollie");
  }"""),
]
for a, b in subs:
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
