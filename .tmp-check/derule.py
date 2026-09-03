# -*- coding: utf-8 -*-
# Take the leftover '---+---' rule rows out of the test fixtures: a whole
# line when the literal is alone on one, otherwise just the element.
import io, re, glob, sys

BS = chr(92)

def is_rule(b):
    return bool(re.match(r'^[\s\-+:|]*$', b)) and '-' in b and len(b.strip()) > 1

def strings(line):
    out, i, n = [], 0, len(line)
    while i < n:
        c = line[i]
        if c == "'":
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
        lines, out, hits = src.split('\n'), [], 0
        for line in lines:
            rules = [(a, b, body) for a, b, body in strings(line) if is_rule(body)]
            if not rules:
                out.append(line)
                continue
            hits += len(rules)
            # the literal alone on its line (with an optional trailing comma
            # and comment): the line goes with it
            if len(rules) == 1 and re.match(r'^\s*"', line) and re.match(r'^\s*,?\s*(//.*)?$', line[rules[0][1]:]):
                continue
            for a, b, body in reversed(rules):
                rest = line[b:]
                m = re.match(r'^,\s*', rest)
                if m:
                    line = line[:a] + rest[m.end():]
                else:
                    line = (line[:a].rstrip().rstrip(',')) + rest
            out.append(line)
        if hits:
            io.open(f, 'w', encoding='utf-8', newline='').write('\n'.join(out))
            print('%-28s %d rules' % (f, hits))
