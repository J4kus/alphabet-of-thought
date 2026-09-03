# -*- coding: utf-8 -*-
# Drop the leftover '---+---' rule rows from the fenced code blocks of the
# docs (markdown's own tables, outside fences, are left alone).
import io, re, glob, sys

def is_rule(l):
    return bool(re.match(r'^[\s\-+:|]*$', l)) and '-' in l and len(l.strip()) > 1

for pat in sys.argv[1:]:
    for f in glob.glob(pat):
        lines = io.open(f, encoding='utf-8').read().split('\n')
        out, inside, hits = [], False, 0
        for l in lines:
            if l.lstrip().startswith('```'):
                inside = not inside
                out.append(l)
                continue
            if inside and is_rule(l):
                hits += 1
                continue
            out.append(l)
        if hits:
            io.open(f, 'w', encoding='utf-8', newline='').write('\n'.join(out))
            print('%-32s %d rules' % (f, hits))
