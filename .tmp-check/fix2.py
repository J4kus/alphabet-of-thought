# -*- coding: utf-8 -*-
import io
p = 'out/test-linter.js'
s = io.open(p, encoding='utf-8').read()

subs = [
# the lone-cell pipe Example is gone: a row is a row by its divider, and a
# name on its own is written the one way it always could be
('''    "    - Apple",
    "    | Pear",
''',
 '''    "    - Apple",
'''),
('''  check("classify: '- Apple' -> INDIVIDUAL", kid("Apple").kind === INDIVIDUAL);
  check("classify: '| Pear' (table row) -> INDIVIDUAL", kid("Pear").kind === INDIVIDUAL);
''',
 '''  check("classify: '- Apple' -> INDIVIDUAL", kid("Apple").kind === INDIVIDUAL);
'''),
('''  {
    const report = makeReport();
    const p = parse(aot("Thing", "    |Pear"), "Root", report);
    check("parse: '|Pear' (no gutter after pipe) is not an error", !hasError(report, /0 spaces after/));
    check("parse: '|Pear' still becomes the INDIVIDUAL 'Pear'", node(p.root, p.nodes, "Pear").kind === INDIVIDUAL);
  }
''',
 '''  {
    const report = makeReport();
    parse(aot("Otter|size", "-----+----", "Ollie|5"), "Root", report);
    check("parse: a row needs no gutter after its divider", !hasError(report, /0 spaces after/));
  }
'''),
# one-column tables went with the borders: a rule under a line carrying no
# divider heads nothing, and the line stays the Concept it reads as
('''  // a single-cell row above a separator heads a one-column table
  {
    const r = makeReport();
    const p = parse(aot("Person", "--------", "John Doe", "Jane Smith"), "Zoo", r);
    const person = node(p.root, p.nodes, "Person");
    check("table: a single-cell header names the Concept, its rows are Examples",
      r.errors.length === 0
      && person && person.kind === CONCEPT && person.cell === true
      && person.children.filter((c) => c.kind === INDIVIDUAL).length === 2
      && node(p.root, p.nodes, "John Doe").kind === INDIVIDUAL);
  }
''',
 '''  // a table needs a divider: a rule under a line that carries none heads no
  // table, and the lines around it read exactly as they are written
  {
    const r = makeReport();
    const p = parse(aot("Person", "--------", "John Doe"), "Zoo", r);
    const person = node(p.root, p.nodes, "Person");
    check("table: a line with no divider is no header, rule or no rule",
      r.errors.length === 0 && person && person.kind === CONCEPT && !person.cell
      && node(p.root, p.nodes, "John Doe").kind === CONCEPT);
  }
'''),
('''  // a lone-cell pipe row stays a plain Example, closing pipe or not
  {
    const r = makeReport();
    const p = parse(aot("Thing", "    Pear"), "Root", r);
    check("table: '| Pear |' (lone cell) is the plain Example 'Pear'",
      node(p.root, p.nodes, "Pear").kind === INDIVIDUAL && r.errors.length === 0);
  }
''',
 '''  // a row with no header above it has nothing naming its columns
  {
    const r = makeReport();
    parse(aot("Thing", "    Pear|5"), "Root", r);
    check("table: a row with no header names its columns is an error",
      hasError(r, /no header names its columns/));
  }
'''),
# spans: every column moved one left with the border
('''      attr && attr.kind === ATTRIBUTE && attr.alias === "length" && attr.aliasCol === 16);''',
 '''      attr && attr.kind === ATTRIBUTE && attr.alias === "length" && attr.aliasCol === 15);'''),
('''      e && e.startCol === 10 && e.endCol === 14);''',
 '''      e && e.startCol === 9 && e.endCol === 13);'''),
('''  check("cells: offsets point at the cell text", cells("a | b")[1].col === 6);
  check("cells: '| gegeg' (no closing pipe) is one cell", cells("| gegeg").length === 1);
  check("isSeparator: '|---+---|' yes, '| a |' no", isSeparator("---+---") && !isSeparator("a"));''',
 '''  check("cells: offsets point at the cell text", cells("a | b")[1].col === 4);
  check("cells: a leading divider opens an empty name cell", cells("|gegeg").length === 2
    && cells("|gegeg")[0].text === "" && cells("|gegeg")[1].text === "gegeg");
  check("isSeparator: '---+---' yes, a name and a lone dash no",
    isSeparator("---+---") && !isSeparator("a") && !isSeparator("-"));'''),
('''    "A   |x",
    "    y",''',
 '''    "A   |x",
    "    |y",'''),
]

for a, b in subs:
    assert s.count(a) == 1, (a, s.count(a))
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
