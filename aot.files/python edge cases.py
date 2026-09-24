"""Python for 'python edge cases.aot' — the functions its `=` derivations call.

Every public name here can be called from a derivation in that file, and pd,
np, plt, math, date, datetime, ... and `aot` are available without being
imported. Top-level code runs the moment this file is loaded, so it holds
only definitions. The editor asks before running this file, and again after
it changes.
"""

import struct
import zlib


def quarters():
    """Four quarters as records: a table, with or without pandas.

    The `quarter` key names each row, since it carries the Concept's own
    name (Quarter); `total_units` is written `total units`; True and False
    are written Yes and No; None leaves a cell empty.
    """
    return [
        {"quarter": "Q1", "total_units": 1204, "revenue": 18060.5, "closed": True},
        {"quarter": "Q2", "total_units": 1380, "revenue": 20700, "closed": True},
        {"quarter": "Q3", "total_units": 990, "revenue": 14850, "closed": False},
        {"quarter": "Q4", "total_units": None, "revenue": None, "closed": False},
    ]


def dot():
    """A one-pixel PNG, made with the standard library alone."""
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    pixel = b"\x00\xff\x80\x00"  # one row: its filter byte, then one orange pixel
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(pixel))
            + chunk(b"IEND", b""))


def bar_chart(rows):
    """Revenue by quarter as a bar chart. Needs matplotlib."""
    fig, ax = plt.subplots(figsize=(4, 2.5))
    ax.bar([r["quarter"] for r in rows], [r["revenue"] or 0 for r in rows])
    ax.set_title("Revenue by quarter")
    return fig


def summarise(rows):
    """Two lines about the quarters: text with a line break becomes a .md file."""
    closed = [r for r in rows if r["closed"]]
    best = max(closed, key=lambda r: r["revenue"])
    return (f"{len(closed)} of {len(rows)} quarters are closed.\n"
            f"The best so far is {best['quarter']}, at {best['revenue']:,.0f} revenue.\n")
