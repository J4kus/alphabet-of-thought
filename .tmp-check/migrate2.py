# -*- coding: utf-8 -*-
# Rewrite old-form table rows ("|a|b|") as new-form ones ("a|b") inside the
# double-quoted string literals of the test fixtures. Scanned line by line so
# quote pairing can never run away, and only strings that are whole rows —
# a leading pipe with a second pipe or a rule behind it — are touched.
import io, re, glob, sys

BS = chr(92)

def strip_row(content):
    m = re.match(r'^(\s*)\|(.*)$', content)
    indent, rest = m.group(1), m.group(2)
    lead = len(rest) - len(rest.lstrip(' '))
    if lead < 4:
        rest = rest[lead:]                   # gutter, not a nested row's depth
    rest = re.sub(r'\|[ \t]*$', '', rest)    # the closing border
    return (indent + rest).rstrip()

def is_row(b):
    t = b.lstrip()
    if not t.startswith('|'):
        return False
    body = t[1:]
    return '|' in body or bool(re.match(r'^[-+: ]*-[-+: ]*$', body))

def strings(line):
    """(start, end, body) of each double-quoted literal on one line."""
    out, i, n = [], 0, len(line)
    while i < n:
        c = line[i]
        if c == "'":                         # a single-quoted string: skip it
            i += 1
            while i < n and line[i] != "'":
                i += 2 if line[i] == BS else 1
            i += 1
        elif c == '"':
            j, body = i + 1, []
            while j < n and line[j] != '"':
                if line[j] == BS:
                    body.append(line[j:j + 2]); j += 2
                else:
                    body.append(line[j]); j += 1
            if j < n:
                out.append((i, j + 1, ''.join(body)))
            i = j + 1
        else:
            i += 1
    return out

for pat in sys.argv[1:]:
    for f in glob.glob(pat):
        src = io.open(f, encoding='utf-8').read()
        lines, hits = src.split('\n'), 0
        for k, line in enumerate(lines):
            edits = [(a, b, body) for a, b, body in strings(line) if is_row(body)]
            for a, b, body in reversed(edits):
                line = line[:a] + '"' + strip_row(body) + '"' + line[b:]
                hits += 1
            lines[k] = line
        if hits:
            io.open(f, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
            print('%-28s %d rows' % (f, hits))
