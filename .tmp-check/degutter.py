# -*- coding: utf-8 -*-
# The old form's gutter (`| name |`) became indentation when the leading pipe
# went. A row's indent is a whole number of levels, so snap any string that
# carries a pipe back to one.
import io,re,glob,sys
for f in glob.glob(sys.argv[1]):
    s=io.open(f,encoding='utf-8').read()
    def repl(m):
        body=m.group(1)
        if '|' not in body: return m.group(0)
        n=len(body)-len(body.lstrip(' '))
        if n%4==0: return m.group(0)
        return '"'+body[n%4:]+'"'
    out=re.sub(r'"((?:[^"\\n]|\.)*)"',repl,s)
    if out!=s:
        io.open(f,'w',encoding='utf-8',newline='').write(out)
        print('fixed',f)
