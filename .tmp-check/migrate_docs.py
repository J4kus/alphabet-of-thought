# -*- coding: utf-8 -*-
# Rewrite old-form table rows as new-form ones in .aot files and inside the
# fenced code blocks of the .md docs (markdown's own tables are left alone).
import io, re, glob, sys

def strip_row(line):
    m = re.match(r'^(\s*)\|(.*)$', line)
    indent, rest = m.group(1), m.group(2)
    lead = len(rest) - len(rest.lstrip(' '))
    if lead < 4:
        rest = rest[lead:]                  # gutter, not a nested row's depth
    rest = re.sub(r'\|[ \t]*$', '', rest)   # the closing border
    return (indent + rest).rstrip()

def is_row(l):
    t = l.lstrip()
    if not t.startswith('|'):
        return False
    body = t[1:]
    return '|' in body or bool(re.match(r'^[-+: ]*-[-+: ]*$', body))

def run(path, fenced_only):
    src = io.open(path, encoding='utf-8').read()
    lines = src.split('\n')
    inside, hits = not fenced_only, 0
    for i, l in enumerate(lines):
        if fenced_only and l.lstrip().startswith('```'):
            inside = not inside
            continue
        if inside and is_row(l):
            lines[i] = strip_row(l)
            hits += 1
    if hits:
        io.open(path, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
        print('%-40s %d rows' % (path, hits))

for pat in sys.argv[1:]:
    for f in glob.glob(pat):
        run(f, f.endswith('.md'))
