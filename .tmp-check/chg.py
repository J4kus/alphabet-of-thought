# -*- coding: utf-8 -*-
import io
p = 'CHANGELOG.md'
lines = io.open(p, encoding='utf-8').read().split('\n')

# the alignment bullet never shipped, and the rule it was written on is gone
out = [l for l in lines if not l.startswith('- **A column can declare its alignment**')]
assert len(out) == len(lines) - 1
s = '\n'.join(out)

old = "- **The pipe divides; it no longer borders.**"
new = ("""- **No rule, and no alignment with it.** A table's header used to be declared by the `---+---` rule under it. The rule said nothing the *order* did not — the header is the row that stands first — while costing a line of every table, a key (`Alt+-`), and a shape every reader had to skip. It is gone: a table is a header row and the rows under it, and that is the whole grammar. A rule left in an older file is **skipped without ending the table and drawn away on the next re-draw**, so Format Document is the upgrade here too. Column alignment goes with it, since the colons were written *in* the rule (`:---`, `---:`, `:--:`): every column is padded on its right to its column's width, the four **Align Column** commands are gone, and nothing written down is lost — alignment was presentation, and no crosslink, formula, CSV row or Gödel number ever saw it. A table being typed is never wrong-shaped now: one row is a header whose rows are still to come, so the fresh-table skeleton is two lines rather than three.

""" + old)
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
