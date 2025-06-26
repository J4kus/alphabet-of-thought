import ply.lex as lex
import ply.yacc as yacc

# -------------------
# Lexer
# -------------------
tokens = (
    'CONCEPT', 'ATTRIBUTE', 'ALIAS', 'EXAMPLE', 'MAP',
    'NEWLINE', 'DEFAULT',
)

# Token regex
t_CONCEPT = r'[^a-z\s][^\n(]*'
t_ATTRIBUTE = r'[a-z][^(:\n]*'

def t_ALIAS(t):
    r'\([^)]+\)'
    t.value = t.value[1:-1].strip()  # Remove the ( and ) and strip whitespace
    return t

def t_DEFAULT(t):
    r':[^\n]*'
    t.value = t.value[1:].strip()  # Remove the colon and strip whitespace
    return t

def t_MAP(t):
    r'\.\.\.[^\n]*'
    t.value = t.value[3:].strip()  # Remove the ... and strip whitespace
    return t

def t_EXAMPLE(t):
    r'-[^\n]*'
    t.value = t.value[1:].strip()  # Remove the dash and strip whitespace
    return t

def t_NEWLINE(t):
    r'\n[ \t]*'
    lines = t.value.count('\n')
    t.lexer.lineno += lines
    last_line = t.value.split('\n')[-1]
    t.value = len(last_line)
    return t

def t_error(t):
    print(f"Illegal character '{t.value[0]}' at line {t.lineno}")
    t.lexer.skip(1)

lexer = lex.lex()

# -------------------
# Parser
# -------------------

def p_elements(p):
    '''elements : element elements
                | element
                | NEWLINE elements
                | NEWLINE'''
    if len(p) == 3:
        if p.slice[1].type == 'NEWLINE':
            # Store NEWLINE as a dict with its value (number of spaces)
            p[0] = [('newline', p.lineno(1), p[1])] + p[2]
        else:
            p[0] = [p[1]] + p[2]
    elif len(p) == 2:
        if p.slice[1].type == 'NEWLINE':
            p[0] = [('newline', p.lineno(1), p[1])]
        else:
            p[0] = [p[1]]

def p_element(p):
    '''element : concept_line
               | attribute_line
               | example_line
               | map_line'''
    p[0] = p[1]

def p_concept_line(p):
    'concept_line : CONCEPT opt_alias opt_newline'
    p[0] = ('concept', p[1], p[2], p.lineno(1), p[3])
    

def p_attribute_line(p):
    '''attribute_line : ATTRIBUTE opt_alias DEFAULT opt_newline
                     | ATTRIBUTE opt_alias opt_newline'''
    if len(p) == 5:
        p[0] = ('attribute', p[1], p[2], p[3], p.lineno(1), p[4])
    else:
        p[0] = ('attribute', p[1], p[2], None, p.lineno(1), p[3])

def p_example_line(p):
    '''example_line : EXAMPLE opt_newline'''
    p[0] = ('example', p[1], p.lineno(1), p[2])

def p_map_line(p):
    '''map_line : MAP opt_newline'''
    p[0] = ('map', p[1], p.lineno(1), p[2])

def p_opt_alias(p):
    '''opt_alias : ALIAS
                | empty'''
    p[0] = p[1] if len(p) > 1 else None

def p_opt_newline(p):
    '''opt_newline : NEWLINE
                  | empty'''
    if len(p) > 1:
        p[0] = p[1]
    else:
        p[0] = None

def p_empty(p):
    'empty :'
    pass

def p_error(p):
    if p:
        print(f"Syntax error at '{p.value}' (type {p.type}) line {p.lineno}")
    else:
        print("Syntax error at EOF")

parser = yacc.yacc()

# Helper to build hierarchy based on indentation
def get_parent(levels, spaces):
    return levels[max([level for level in levels if level < spaces])]

def check_if_parent_replacement(levels, spaces, element):
    if spaces not in levels or element[-1] > spaces:
        new_levels = {}
        for level in levels:
            if level < spaces:
                new_levels[level] = levels[level]
        new_levels[spaces] = element
    else: new_levels = levels.copy()
    return new_levels
def build_tree(elements):
    # Remove the last item from each tuple in elements if it's a tuple
    levels = {}
    spaces = 0
    result = []
    for element in elements:
        if element[0] != 'newline':
            if spaces == 0:
                levels = {0 : element}
                spaces = 0
                result.append((element[:-1], None))
            else:
                levels = check_if_parent_replacement(levels, spaces, element)
                parent = get_parent(levels, spaces)
                result.append((element[:-1], parent[:-1]))
                ...
            spaces = element[-1]
    return result

# -------------
# Example usage
# -------------
if __name__ == "__main__":
    
    with open("example.aot") as f:
        data = f.read()
    with open("alphabet of thought.aot") as f:
        data = f.read()
    
    parsed = parser.parse(data)
    tree = build_tree(parsed)
    print(tree)
