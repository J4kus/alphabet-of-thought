# -*- coding: utf-8 -*-
import io,re,sys,glob

def strip_row(content):
    m = re.match(r'^(\s*)\|(.*)$', content)
    if not m: return content, False
    indent, rest = m.group(1), m.group(2)
    # drop one trailing pipe, then the trailing whitespace it was padding
    rest = re.sub(r'\|[ \t]*$', '', rest)
    return (indent + rest).rstrip(), True

def is_row(content):
    t = content.lstrip()
    return t.startswith('|') and t != '|'

singles = []

def js(path):
    s = io.open(path, encoding='utf-8').read()
    def repl(m):
        body = m.group(1)
        if not is_row(body): return m.group(0)
        if body.count('|') < 2: singles.append((path, body))
        out, ok = strip_row(body)
        return '"' + out + '"'
    out = re.sub(r'"((?:[^"\\n]|\.)*)"', repl, s)
    if out != s:
        io.open(path,'w',encoding='utf-8',newline='').write(out)
        print('js  ', path)

def plain(path):
    s = io.open(path, encoding='utf-8').read()
    lines = s.split('\n')
    changed = False
    for i,l in enumerate(lines):
        if is_row(l):
            if l.count('|') < 2: singles.append((path, l))
            new,_ = strip_row(l)
            if new != l: lines[i] = new; changed = True
    if changed:
        io.open(path,'w',encoding='utf-8',newline='').write('\n'.join(lines))
        print('txt ', path)

for p in sys.argv[1:]:
    for f in glob.glob(p):
        (js if f.endswith('.js') else plain)(f)

if singles:
    print('\n--- single-pipe lines (review by hand) ---')
    for f,b in singles: print(f, '::', repr(b))
