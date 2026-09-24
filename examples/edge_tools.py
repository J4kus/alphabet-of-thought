"""A Python module outside aot.files, for 'python edge cases.aot'.

A derivation reaches it by its name alone (`=edge_tools.shout("hi")`), by
its dotted path from the repository's root (`=examples.edge_tools.shout(…)`)
or by its path (`=aot.use("examples/edge_tools.py").shout(…)`). The editor
asks before it first runs, and again if it changes anywhere but in the editor.
"""


def shout(text):
    """The text in capitals, with a bang."""
    return str(text).upper() + "!"
