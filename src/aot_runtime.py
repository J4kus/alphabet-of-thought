"""The Python side of Alpha's `=` derivations.

The editor starts one of these per .aot document and keeps it alive between
runs, so a DataFrame one derivation made is still there when the next one
reads it. It speaks JSON lines: one request per line on stdin, one response
per line on stdout, matched by "id". Nothing else is ever written to stdout —
a stray print from user code is captured and handed back in the response, and
anything printed outside an evaluation goes to stderr — because one foreign
line on stdout would break the frame.

Requests
    hello   the protocol version, this interpreter, which libraries exist
    warm    import pandas and numpy ahead of the first run (no user code)
    open    the document's tree and its sidecar, aot.files/<file>.py
    eval    one derivation: its code (every `@` already rewritten by the
            editor to `_aot_ref(k)`), the targets those stand for, and what
            it is hosted on — a value, a grid cell, or a Concept line
    evalBatch  many derivations in order, sharing their targets, each answered
            on a line of its own as it finishes
    reset   forget every result and the sidecar, as a fresh process would
    bye     exit

Only the standard library is imported here. pandas, numpy, matplotlib and
the rest are bound to lazy proxies that import on first use, so a library
nobody touches costs nothing, and a missing one fails only on the line that
reaches for it — with the command that installs it.
"""

import base64
import builtins
import collections
import contextlib
import datetime as _dt
import decimal
import fractions
import functools
import importlib
import importlib.machinery
import importlib.util
import io
import itertools
import json
import math
import os
import platform
import random
import re
import statistics
import sys
import time
import traceback
from pathlib import Path

PROTOCOL = 1

# a long integer is written with every digit it has: 10**5000 is a number, and
# Python's guard against converting a huge one to text is for parsing untrusted
# input, which this is not doing
if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)

# stdout is the protocol channel and nothing else's
_OUT = sys.stdout
sys.stdout = sys.stderr

# ...and so is stdin. Code that read it would swallow the next request, or wait
# for one that never comes while the editor waits for it, so user code finds it
# empty and input() says why.
_IN = sys.stdin
sys.stdin = io.StringIO("")


def _no_input(*_args):
    raise RuntimeError("put the value in a cell and reference it with @ — a formula can't ask for input")


builtins.input = _no_input


def _send(obj):
    _OUT.write(json.dumps(_clean(obj), ensure_ascii=False, allow_nan=False) + "\n")
    _OUT.flush()


def _clean(v):
    """JSON has no NaN or infinity; they travel as null."""
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {str(k): _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


# --- the libraries -----------------------------------------------------------

# What a missing library's message says to do: pip's command, unless the
# editor says the environment is a uv project's (open's "install").
_install = {"hint": None}


def _install_advice(pip):
    return _install["hint"] or f"python -m pip install {pip}"


class _Lazy:
    """A module (or one name in it) imported the first time it is used."""

    def __init__(self, label, load, pip):
        object.__setattr__(self, "_label", label)
        object.__setattr__(self, "_load", load)
        object.__setattr__(self, "_pip", pip)
        object.__setattr__(self, "_obj", None)

    def _get(self):
        obj = object.__getattribute__(self, "_obj")
        if obj is None:
            try:
                obj = object.__getattribute__(self, "_load")()
            except ImportError:
                pip = object.__getattribute__(self, "_pip")
                raise ModuleNotFoundError(
                    f"{pip} is not installed — {_install_advice(pip)}") from None
            object.__setattr__(self, "_obj", obj)
        return obj

    def __getattr__(self, name):
        return getattr(self._get(), name)

    def __call__(self, *args, **kwargs):
        return self._get()(*args, **kwargs)

    def __repr__(self):
        return f"<lazy {object.__getattribute__(self, '_label')}>"


def _pyplot():
    # no window may ever open from a process nobody can see
    import matplotlib
    matplotlib.use("Agg", force=True)
    import matplotlib.pyplot as pyplot
    return pyplot


def _seaborn():
    _pyplot()
    import seaborn
    return seaborn


def _no_exit(*_args):
    # the builtin exit() closes stdin before it raises — which would end the
    # session, not the expression
    raise SystemExit


def _preloaded():
    """The names every derivation can use without importing anything."""
    names = {
        "exit": _no_exit, "quit": _no_exit,
        "math": math, "statistics": statistics, "re": re, "json": json, "random": random,
        "itertools": itertools, "functools": functools, "Path": Path,
        "date": _dt.date, "datetime": _dt.datetime, "timedelta": _dt.timedelta,
        "Decimal": decimal.Decimal, "Counter": collections.Counter,
        "defaultdict": collections.defaultdict,
    }
    names.update({
        "pd": _Lazy("pandas", lambda: importlib.import_module("pandas"), "pandas"),
        "np": _Lazy("numpy", lambda: importlib.import_module("numpy"), "numpy"),
        "plt": _Lazy("matplotlib.pyplot", _pyplot, "matplotlib"),
        "sns": _Lazy("seaborn", _seaborn, "seaborn"),
        "stats": _Lazy("scipy.stats", lambda: importlib.import_module("scipy.stats"), "scipy"),
        "Image": _Lazy("PIL.Image", lambda: importlib.import_module("PIL.Image"), "pillow"),
        "requests": _Lazy("requests", lambda: importlib.import_module("requests"), "requests"),
        "relativedelta": _Lazy(
            "dateutil.relativedelta",
            lambda: importlib.import_module("dateutil.relativedelta").relativedelta,
            "python-dateutil"),
    })
    return names


# distribution name -> the name the environment listing shows
LIBRARIES = [
    ("pandas", "pandas"), ("numpy", "numpy"), ("matplotlib", "matplotlib"),
    ("seaborn", "seaborn"), ("scipy", "scipy"), ("Pillow", "pillow"),
    ("requests", "requests"), ("python-dateutil", "python-dateutil"),
    ("openpyxl", "openpyxl"), ("pyarrow", "pyarrow"),
]


def _library_versions():
    from importlib import metadata
    out = {}
    for dist, label in LIBRARIES:
        try:
            out[label] = metadata.version(dist)
        except Exception:
            out[label] = None
    return out


def _loaded(module):
    """A library already imported by somebody, else None: classifying a
    result never imports pandas just to ask whether something is a DataFrame."""
    return sys.modules.get(module)


# --- the units ---------------------------------------------------------------
# `120 km` is a number with a unit, and a formula calculates with it: a speed
# comes out of a distance over a time, `5 km + 500 m` is `5.5 km`, and `3 kg + 2 km`
# is an error rather than a number. The built-in units and the hierarchy they sit
# in are in units.json, beside this file, which the editor reads too; any other
# word is a unit of its own that matches only itself, singular or plural.
#
# A Quantity is deliberately not a float. numpy and pandas take a float's value
# and drop whatever else it carries, so a `.median()` of one would quietly lose
# the unit, and a column in two units would come out wrong with no error.

_SYMBOLS = "$€£¥R"
_SUPERS = {"²": 2, "³": 3}
# the base of each kind of thing, marked so no word of a file can be taken for one
_BASE_MARK = "\0"


# each built-in kind's dimensions, by its name lowercased: a unit a repository
# writes under a kind of the same name (Length) converts with these
_KIND_DIMS = {}


def _load_units():
    """{word: (factor, dims)}, and the same by lowercase for words of three
    letters or more: `Hours` is `hours` and `kwh` is `kWh`, but `M` is never `m`."""
    exact, folded = {}, {}
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "units.json"), encoding="utf-8") as fh:
            table = json.load(fh)
    except (OSError, ValueError):
        return exact, folded
    for kind_name, entry in table.items():
        measures = tuple(sorted((_BASE_MARK + base, power) for base, power in entry.get("measures", {}).items()))
        if measures:
            _KIND_DIMS[kind_name.lower()] = measures
        for row in entry["units"]:
            factor = fractions.Fraction(row[0])
            # each currency is a thing of its own: nothing converts it to another
            dims = ((_BASE_MARK + row[1], 1),) if entry.get("each") else measures
            for name in row[1:]:
                exact[name] = (factor, dims)
                if len(name) >= 3:
                    folded[name.lower()] = (factor, dims)
    return exact, folded


_UNITS, _UNITS_FOLDED = _load_units()
_BUILT_IN = (dict(_UNITS), dict(_UNITS_FOLDED))
# the marks a repository's own units are written with in front of a number
# (`CHF 1,200`): mark -> unit word
_OWN_PREFIX = {}


def _define_units(units):
    """The units a repository writes itself, as rows of a kind under a Concept
    called Unit (the editor reads them; see units.js): each one's factor in its
    kind's base unit, and the mark its format puts in front of a number. A kind
    named as a built-in one (Length) converts with the built-in units of that
    kind; a kind of the repository's own (Money) converts within itself. A unit
    with no factor converts to nothing. Each call replaces the last: the units
    are the repository's as it stands."""
    global _VALUE
    _UNITS.clear()
    _UNITS.update(_BUILT_IN[0])
    _UNITS_FOLDED.clear()
    _UNITS_FOLDED.update(_BUILT_IN[1])
    _OWN_PREFIX.clear()
    _MEASURES.clear()
    for u in units or []:
        name = str(u.get("name") or "").strip()
        if not name:
            continue
        kind = str(u.get("kind") or "").strip()
        factor_text = str(u.get("factor") or "").strip().replace(",", "")
        if factor_text:
            try:
                factor = fractions.Fraction(factor_text)
            except (ValueError, ZeroDivisionError):
                continue
            dims = _KIND_DIMS.get(kind.lower()) or ((_BASE_MARK + "own " + kind.lower(), 1),)
        else:
            factor, dims = fractions.Fraction(1), ((_BASE_MARK + "own " + name, 1),)
        words = [name] + [m for m in (u.get("suffix"), u.get("prefix")) if m and m != name]
        for w in words:
            _UNITS[w] = (factor, dims)
            if len(w) >= 3:
                _UNITS_FOLDED[w.lower()] = (factor, dims)
        if u.get("prefix"):
            _OWN_PREFIX[str(u["prefix"])] = name
    marks = sorted(_OWN_PREFIX, key=len, reverse=True)
    front = "|".join([re.escape(m) for m in marks] + [f"[{_SYMBOLS}]"])
    _VALUE = re.compile(rf"^([-+]?)(?:({front}) ?)?([-+]?)({_DIGITS})(.*)$", re.S)


def _known(word):
    return _UNITS.get(word) or (_UNITS_FOLDED.get(word.lower()) if len(word) >= 3 else None)


def _singular(word):
    """A word as one of it: `clients` and `client` are one unit. `len > 3` so
    that a short word (`gas`, `bus`) is left as it is."""
    if len(word) > 3:
        low = word.lower()
        if low.endswith("ies"):
            return word[:-3] + "y"
        if low.endswith(("ches", "shes", "xes", "sses", "zes")):
            return word[:-2]
        if low.endswith("s") and not low.endswith("ss"):
            return word[:-1]
    return word


def _atom(word):
    """(factor, dims) of one unit word."""
    hit = _known(word)
    if hit is not None:
        return hit
    return (fractions.Fraction(1), ((_singular(word).lower(), 1),))


_MEASURES = {}


def _measure(unit):
    """(factor, dims) of a unit: `km/h` is 5/18 of a metre per second."""
    hit = _MEASURES.get(unit)
    if hit is None:
        factor = fractions.Fraction(1)
        dims = {}
        for word, power in unit:
            f, d = _atom(word)
            factor *= f ** power
            for base, p in d:
                dims[base] = dims.get(base, 0) + p * power
        hit = (factor, tuple(sorted((b, p) for b, p in dims.items() if p)))
        _MEASURES[unit] = hit
    return hit


# (a superscript is a word character to `\w`, and a power here, never a letter)
_UNIT_WORD = re.compile(r"^((?:[^\W\d_²³¹]|[°$€£¥])+)(?:\^(-?\d+)|([²³])|(\d))?$")
_UNIT_SEP = re.compile(r"([/*·])")


def _parse_unit(text):
    """A unit as written, as ((word, power), ...): `km/h`, `$/kg`, `kg*m/s^2`,
    `m²`, `m2`. None when the text is no unit."""
    parts = _UNIT_SEP.split(str(text).strip())
    out = []
    power = 1
    for k, piece in enumerate(parts):
        if k % 2:
            power = -1 if piece == "/" else 1
            continue
        if k == 0 and len(parts) > 1 and piece in ("", "1"):  # `1/h`
            continue
        m = _UNIT_WORD.match(piece)
        if not m:
            return None
        word, caret, sup, digit = m.groups()
        # a bare digit is a power only on a unit it knows: m2, never CO2
        if digit and not _known(word):
            return None
        p = int(caret) if caret else _SUPERS[sup] if sup else int(digit) if digit else 1
        if p:
            out.append((word, power * p))
    if not out:
        return None
    merged = []
    for word, p in out:
        for i, (w, q) in enumerate(merged):
            if w == word:
                merged[i] = (w, q + p)
                break
        else:
            merged.append((word, p))
    merged = tuple(x for x in merged if x[1])
    return merged or None


def _combine(left, right):
    """Two units multiplied: (the unit, the ratio the numbers take on the way).
    Words measuring one thing merge into the first, so a kilometre over a metre is
    a pure number and an hour cancels a minute."""
    out = list(left)
    ratio = fractions.Fraction(1)
    for word, power in right:
        f, d = _atom(word)
        for i, (w, p) in enumerate(out):
            g, e = _atom(w)
            if e == d:
                ratio *= (f / g) ** power
                out[i] = (w, p + power)
                break
        else:
            out.append((word, power))
    return tuple(x for x in out if x[1]), ratio


def _label(unit):
    """A unit as the file writes it: `km/h`, `$/client`, `m²`. Words below the line
    read as one of them, a currency comes first."""
    def word(name, power):
        power = abs(power)
        return name + ({2: "²", 3: "³"}.get(power) or (f"^{power}" if power != 1 else ""))
    top = [u for u in unit if u[1] > 0]
    top.sort(key=lambda u: 0 if u[0] in _SYMBOLS else 1)
    head = "*".join(word(n, p) for n, p in top) or "1"
    return head + "".join("/" + word(_singular(n), p) for n, p in unit if p < 0)


def _scale(v, ratio):
    """A number times an exact ratio, with no float's noise: a kilometre is 1,000
    metres, so 1.1 km is 1100 m and never 1100.0000000000002."""
    if ratio == 1:
        return v
    if isinstance(v, decimal.Decimal):
        return v * ratio.numerator / ratio.denominator
    exact = fractions.Fraction(repr(v)) if isinstance(v, float) else fractions.Fraction(v)
    out = exact * ratio
    return int(out) if isinstance(v, int) and out.denominator == 1 else float(out)


def _group(text):
    sign = "-" if text.startswith("-") else ""
    body = text.lstrip("-")
    whole, dot, frac = body.partition(".")
    return f"{sign}{int(whole):,}{dot}{frac}"


def _compose(digits, label):
    """A number and its unit as the file writes them: `$1,204`, `-$5`, `$10/kg`,
    `120 km`."""
    if label in _OWN_PREFIX:
        sign = "-" if digits.startswith("-") else ""
        return f"{sign}{label} {digits.lstrip('-')}"
    if re.match(r"^[$€£¥R](?=$|[/*·])", label):
        sign = "-" if digits.startswith("-") else ""
        return f"{sign}{label[0]}{digits.lstrip('-')}{label[1:]}"
    return f"{digits} {label}"


class UnitError(TypeError):
    """Two numbers whose units do not go together. Never read as text: `5 km > 3`
    is a mistake to show, not two strings to compare."""


_PAST = {"add": "added", "subtract": "subtracted", "compare": "compared"}


class Quantity:
    """A number and its unit: what `120 km` or `$10/kg` is in a formula. It
    multiplies and divides with anything; it adds, subtracts and compares only
    with what it converts to, and with 0. A value that merely looks like one
    (`12 Monkeys`) still reads as the text it is, until it is calculated with."""

    __slots__ = ("value", "_unit", "_text")
    # numpy leaves the arithmetic to this class rather than taking it apart
    __array_ufunc__ = None
    __array_priority__ = 1000

    def __init__(self, value, unit, text=None):
        self.value = _scalar(value)
        self._unit = unit
        self._text = text

    @property
    def unit(self):
        return _label(self._unit)

    def to(self, unit):
        """This quantity in another unit: `q.to("mi")`."""
        target = _parse_unit(unit)
        if target is None:
            raise ValueError(f"write a unit such as 'km' or 'km/h' — '{unit}' does not read as one")
        return Quantity(self._in(target, f"change the unit — {self} can't be written in {unit}: they don't convert"), target)

    def _in(self, unit, message=None):
        """The number in another unit."""
        if unit == self._unit:
            return self.value
        f, d = _measure(self._unit)
        g, e = _measure(unit)
        if d != e:
            raise UnitError(message or f"use one unit for both — {self} and {_label(unit)} don't convert into each other")
        return _scale(self.value, f / g)

    def _like(self, other, doing):
        """`other` as a number in this unit, for + - and comparing, or None when
        it is nothing a number could be."""
        other = _scalar(other)
        if isinstance(other, Quantity):
            return other._in(self._unit, f"use one unit for both — {self} and {other} don't convert into each other, so they can't be {_PAST[doing]}")
        if isinstance(other, (int, float, decimal.Decimal)):
            if other == 0:
                return 0
            if isinstance(other, float) and math.isnan(other):
                return other
            return self._plain(other, doing)
        if isinstance(other, _CellText) and doing != "compare":
            raise TypeError(f"change the value, or leave it out of the formula — '{other}' is text, so it can't be {_PAST[doing]} to {self}"
                            if doing == "add" else f"change the value, or leave it out of the formula — '{other}' is text, so it can't be {_PAST[doing]} from {self}")
        return None

    def _plain(self, other, doing):
        shown = _compose(_group(_number_text(other)), self.unit)
        raise UnitError(f"write the unit on {_number_text(other)}, as in {shown} — {self} has a unit and {_number_text(other)} has none, so they can't be {_PAST[doing]}")

    def _dates(self, other, sign):
        """A date or a span of time moved by this many seconds, hours or days."""
        if not isinstance(other, (_dt.date, _dt.timedelta)):
            return None
        f, d = _measure(self._unit)
        if d != ((_BASE_MARK + "time", 1),):
            raise UnitError(f"write a number of days or hours — {self} isn't a length of time a date can move by")
        return other + sign * _dt.timedelta(seconds=float(_scale(self.value, f)))

    # adding and subtracting

    def __add__(self, other):
        moved = self._dates(other, 1)
        if moved is not None:
            return moved
        if type(other) is str:  # text in a formula: this reads as the text it is
            return str(self) + other
        n = self._like(other, "add")
        return NotImplemented if n is None else Quantity(self.value + n, self._unit)

    def __radd__(self, other):
        moved = self._dates(other, 1)
        if moved is not None:
            return moved
        if type(other) is str:
            return other + str(self)
        n = self._like(other, "add")
        return NotImplemented if n is None else Quantity(n + self.value, self._unit)

    def __sub__(self, other):
        n = self._like(other, "subtract")
        return NotImplemented if n is None else Quantity(self.value - n, self._unit)

    def __rsub__(self, other):
        moved = self._dates(other, -1)
        if moved is not None:
            return moved
        n = self._like(other, "subtract")
        return NotImplemented if n is None else Quantity(n - self.value, self._unit)

    # multiplying and dividing: a unit multiplies with its number

    def _times(self, other, power):
        """self * other, or self / other. A pure result is a plain number."""
        other = _scalar(other)
        if isinstance(other, Quantity):
            unit, ratio = _combine(self._unit, tuple((w, p * power) for w, p in other._unit))
            value = self.value * other.value if power > 0 else self.value / other.value
            value = _scale(value, ratio)
            return Quantity(value, unit) if unit else value
        if isinstance(other, (int, float, decimal.Decimal)):
            return Quantity(self.value * other if power > 0 else self.value / other, self._unit)
        return NotImplemented

    def _each(self, array, f):
        out = [None if _is_missing(v) else f(v) for v in array.tolist()]
        return _quantity_array()(out) if _loaded("pandas") else _object_array(out)

    def __mul__(self, other):
        if _is(other, "numpy", "ndarray"):
            return self._each(other, lambda v: self * v)
        return self._times(other, 1)

    def __rmul__(self, other):
        if _is(other, "numpy", "ndarray"):
            return self._each(other, lambda v: self * v)
        return self._times(other, 1)

    def __truediv__(self, other):
        if _is(other, "numpy", "ndarray"):
            return self._each(other, lambda v: self / v)
        return self._times(other, -1)

    def __rtruediv__(self, other):
        if _is(other, "numpy", "ndarray"):
            return self._each(other, lambda v: v / self)
        other = _scalar(other)
        if not isinstance(other, (int, float, decimal.Decimal)):
            return NotImplemented
        return Quantity(other / self.value, tuple((w, -p) for w, p in self._unit))

    def __pow__(self, power):
        power = _scalar(power)
        if not isinstance(power, (int, float)):
            return NotImplemented
        unit = []
        for word, p in self._unit:
            q = p * power
            if q != int(q):
                raise UnitError(f"take this power of a number without a unit — {self} has no power {power} that is still a unit")
            unit.append((word, int(q)))
        unit = tuple(u for u in unit if u[1])
        value = self.value ** power
        return Quantity(value, unit) if unit else value

    def __neg__(self):
        return Quantity(-self.value, self._unit)

    def __pos__(self):
        return self

    def __abs__(self):
        return Quantity(abs(self.value), self._unit)

    def __round__(self, digits=None):
        return Quantity(round(self.value, digits), self._unit)

    def __floor__(self):
        return Quantity(math.floor(self.value), self._unit)

    def __ceil__(self):
        return Quantity(math.ceil(self.value), self._unit)

    def __trunc__(self):
        return Quantity(math.trunc(self.value), self._unit)

    # comparing

    def __eq__(self, other):
        other = _scalar(other)
        if isinstance(other, Quantity):
            try:
                return self.value == other._in(self._unit)
            except UnitError:
                return False
        if isinstance(other, str):
            return str(self) == other
        if isinstance(other, (int, float, decimal.Decimal)):
            return other == 0 and self.value == 0
        return NotImplemented

    def __ne__(self, other):
        same = self.__eq__(other)
        return same if same is NotImplemented else not same

    def __lt__(self, other):
        n = self._like(other, "compare")
        return NotImplemented if n is None else self.value < n

    def __le__(self, other):
        n = self._like(other, "compare")
        return NotImplemented if n is None else self.value <= n

    def __gt__(self, other):
        n = self._like(other, "compare")
        return NotImplemented if n is None else self.value > n

    def __ge__(self, other):
        n = self._like(other, "compare")
        return NotImplemented if n is None else self.value >= n

    # by its text: a value that only looks like a quantity is still looked up as
    # the text it is, `{"R100": 1}[@code]`
    def __hash__(self):
        return hash(str(self))

    def __bool__(self):
        return bool(self.value)

    def __float__(self):
        raise TypeError(f"use .value for the plain number — {self} has a unit, and this needs a number without one")

    __int__ = __float__
    __complex__ = __float__

    def __str__(self):
        if self._text is not None:
            return self._text
        return _compose(_group(_number_text(self.value)), self.unit)

    __repr__ = __str__

    def __format__(self, spec):
        return _compose(format(self.value, spec), self.unit) if spec else str(self)

    def __getattr__(self, name):
        # what text can do: `@code.startswith("R")`. Never a dunder, or numpy and
        # pandas would take this for a sequence.
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(str(self), name)


class _CellText(str):
    """Text read from a file. A string in Python repeats when multiplied, so `n/a`
    × 2 would be `n/an/a` and `€20,000` × -14 an empty value, each with no error.
    Here that is the visible failure a spreadsheet gives. Text still joins: only
    two values that both start like numbers refuse to, since `1.2M` + `450k` is a
    sum that came out as `1.2M450k`."""

    def __mul__(self, other):
        raise TypeError(f"change the value, or leave it out of the formula — '{self}' is text, so it can't be multiplied")

    __rmul__ = __mul__

    def __add__(self, other):
        if isinstance(other, _CellText) and _STARTS_NUMERIC.match(self) and _STARTS_NUMERIC.match(other):
            raise TypeError(f"write them as plain numbers — '{self}' and '{other}' are text, so they can't be added")
        return str.__add__(self, other)


_CellText.__name__ = "text"
_STARTS_NUMERIC = re.compile(r"^[-+(]?[$€£¥R]?\s?\d")


def _object_array(values):
    np = importlib.import_module("numpy")
    out = np.empty(len(values), dtype=object)
    for i, v in enumerate(values):
        out[i] = v
    return out


_QUANTITY_ARRAY = {}


def _quantity_array():
    """The pandas column type for values with units, made the first time one is
    needed: so a file without units never reaches it, and pandas stays lazy."""
    made = _QUANTITY_ARRAY.get("class")
    if made is not None:
        return made
    np = importlib.import_module("numpy")
    pd = importlib.import_module("pandas")
    from pandas.api.extensions import ExtensionArray, ExtensionDtype, register_extension_dtype, take as pd_take

    class QuantityDtype(ExtensionDtype):
        name = "quantity"
        type = Quantity
        na_value = None
        kind = "O"

        @classmethod
        def construct_array_type(cls):
            return QuantityArray

        @classmethod
        def construct_from_string(cls, string):
            if string == cls.name:
                return cls()
            raise TypeError(f"Cannot construct a 'QuantityDtype' from '{string}'")

    class QuantityArray(ExtensionArray):
        def __init__(self, values):
            self._a = np.empty(len(values), dtype=object)
            for i, v in enumerate(values):
                self._a[i] = None if _is_missing(_scalar(v)) else _scalar(v)

        dtype = property(lambda self: QuantityDtype())
        nbytes = property(lambda self: self._a.nbytes)

        @classmethod
        def _from_sequence(cls, scalars, *, dtype=None, copy=False):
            return cls(list(scalars))

        @classmethod
        def _from_factorized(cls, values, original):
            return cls(list(values))

        @classmethod
        def _concat_same_type(cls, arrays):
            return cls([v for a in arrays for v in a._a])

        def __getitem__(self, item):
            hit = self._a[item]
            return QuantityArray(list(hit)) if isinstance(hit, np.ndarray) else hit

        def __setitem__(self, item, value):
            self._a[item] = value._a if isinstance(value, QuantityArray) else value

        def __len__(self):
            return len(self._a)

        def __array__(self, dtype=None, copy=None):
            return self._a if dtype is None or dtype == object else self._a.astype(dtype)

        def isna(self):
            return np.array([v is None for v in self._a], dtype=bool)

        def take(self, indices, *, allow_fill=False, fill_value=None):
            return QuantityArray(list(pd_take(self._a, indices, allow_fill=allow_fill, fill_value=fill_value)))

        def copy(self):
            return QuantityArray(list(self._a))

        def _values_for_factorize(self):
            return self._a, None

        def _values_for_argsort(self):
            first = next((v for v in self._a if isinstance(v, Quantity)), None)
            return np.array([np.nan if v is None else float(v._in(first._unit) if isinstance(v, Quantity) else v)
                             for v in self._a], dtype=float)

        def _reduce(self, name, *, skipna=True, keepdims=False, **kwargs):
            values = [v for v in self._a if v is not None]
            if not values or (not skipna and len(values) != len(self._a)):
                result = None
            elif name == "sum":
                result = sum(values)
            elif name == "mean":
                result = sum(values) / len(values)
            elif name == "min":
                result = min(values)
            elif name == "max":
                result = max(values)
            elif name == "median":
                ordered = sorted(values)
                mid = len(ordered) // 2
                result = ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2
            elif name in ("var", "std"):
                ddof = kwargs.get("ddof", 1)
                if len(values) <= ddof:
                    result = None
                else:
                    mean = sum(values) / len(values)
                    result = sum((v - mean) * (v - mean) for v in values) / (len(values) - ddof)
                    if name == "std":
                        result = result ** 0.5
            elif name == "any":
                result = any(values)
            elif name == "all":
                result = all(values)
            else:
                raise TypeError(f"{name} isn't defined for numbers with units — use .value for the plain numbers")
            return QuantityArray([result]) if keepdims else result

        def _accumulate(self, name, *, skipna=True, **kwargs):
            pick = {"cumsum": lambda a, b: a + b, "cummin": min, "cummax": max}.get(name)
            if pick is None:
                raise TypeError(f"{name} isn't defined for numbers with units — use .value for the plain numbers")
            out = []
            running = None
            for v in self._a:
                if v is not None:
                    running = v if running is None else pick(running, v)
                out.append(None if v is None else running)
            return QuantityArray(out)

        def round(self, decimals=0, *args, **kwargs):
            return QuantityArray([None if v is None else round(v, decimals) for v in self._a])

        def __abs__(self):
            return QuantityArray([None if v is None else abs(v) for v in self._a])

        def __neg__(self):
            return QuantityArray([None if v is None else -v for v in self._a])

        def _rights(self, other):
            if isinstance(other, (QuantityArray, list, np.ndarray, pd.Series, pd.Index)):
                return [None if _is_missing(_scalar(v)) else v for v in other]
            return [other] * len(self)

        def _compare(self, other, op):
            return np.array([a is not None and b is not None and bool(op(a, b))
                             for a, b in zip(self._a, self._rights(other))], dtype=bool)

        def __lt__(self, other):
            return self._compare(other, lambda a, b: a < b)

        def __le__(self, other):
            return self._compare(other, lambda a, b: a <= b)

        def __gt__(self, other):
            return self._compare(other, lambda a, b: a > b)

        def __ge__(self, other):
            return self._compare(other, lambda a, b: a >= b)

        def __eq__(self, other):
            return self._compare(other, lambda a, b: a == b)

        def __ne__(self, other):
            return ~self._compare(other, lambda a, b: a == b)

        def _calc(self, other, f):
            values = [None if a is None or b is None else f(a, b) for a, b in zip(self._a, self._rights(other))]
            # units that cancelled in every row are plain numbers again
            if any(isinstance(v, Quantity) for v in values) or not any(v is not None for v in values):
                return QuantityArray(values)
            return np.array([np.nan if v is None else v for v in values], dtype=float)

        def __add__(self, other):
            return self._calc(other, lambda a, b: a + b)

        def __radd__(self, other):
            return self._calc(other, lambda a, b: b + a)

        def __sub__(self, other):
            return self._calc(other, lambda a, b: a - b)

        def __rsub__(self, other):
            return self._calc(other, lambda a, b: b - a)

        def __mul__(self, other):
            return self._calc(other, lambda a, b: a * b)

        def __rmul__(self, other):
            return self._calc(other, lambda a, b: b * a)

        def __truediv__(self, other):
            return self._calc(other, lambda a, b: a / b)

        def __rtruediv__(self, other):
            return self._calc(other, lambda a, b: b / a)

    register_extension_dtype(QuantityDtype)
    _QUANTITY_ARRAY["class"] = QuantityArray
    return QuantityArray


# --- values in ---------------------------------------------------------------
# A value arrives as the text the file holds and is read the way the file
# means it — strictly: the whole text must be a number for it to be one, so
# `2026-01` stays text rather than becoming 2026.
#
#     30%                    0.3, as a spreadsheet reads it
#     (1,000)                -1000, as an accountant writes it
#     $1,204  €5  R1,204     a number with its currency
#     120 km  46 clients     a number and one word: a unit, whatever the word
#     120km  40km/h          glued on: only a unit it knows, so `3D` and `12A` stay text
#     $10/kg                 a currency per something
#
# Anything else is text. `1.2M`, `1.204,50` and `15/01/2026` are, and arithmetic
# on them fails where you can see it rather than repeating the text.

_DIGITS = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
_VALUE = re.compile(rf"^([-+]?)(?:([{_SYMBOLS}]) ?)?([-+]?)({_DIGITS})(.*)$", re.S)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$")


def _read_number(s):
    """The number a whole text says, with its unit, or None when it says none."""
    if s.startswith("(") and s.endswith(")"):
        inner = s[1:-1].strip()
        if inner[:1] in ("-", "+"):
            return None
        n = _read_number(inner)
        if isinstance(n, Quantity):
            return Quantity(-n.value, n._unit, s)
        return None if n is None else -n
    m = _VALUE.match(s)
    if not m:
        return None
    sign, symbol, late, digits, tail = m.groups()
    if sign and late:
        return None
    plain = digits.replace(",", "")
    n = float(plain) if "." in plain else int(plain)
    negative = "-" in (sign, late)
    if negative:
        n = -n
    if symbol:
        if not tail:
            return Quantity(n, ((symbol, 1),), s)
        if tail[0] not in "/*·":
            return None
        unit = _parse_unit(symbol + tail)
        return None if unit is None else Quantity(n, unit, s)
    if not tail:
        return n
    word = tail.strip()
    if word == "%" or word.lower() == "percent":
        share = float(decimal.Decimal(plain).scaleb(-2))
        return -share if negative else share
    unit = _parse_unit(word)
    if unit is None:
        return None
    # glued on it must be a unit it knows: `3D` and `2nd` are no quantities
    if tail == word and not all(_known(w) for w, _ in unit):
        return None
    return Quantity(n, unit, s)


def _typed(text):
    if text is None:
        return None
    s = str(text).strip()
    if s == "":
        return None
    low = s.lower()
    if low in ("yes", "true"):
        return True
    if low in ("no", "false"):
        return False
    number = _read_number(s)
    if number is not None:
        return number
    if _DATE.match(s):
        try:
            return _dt.date.fromisoformat(s)
        except ValueError:
            return _CellText(s)
    if _DATETIME.match(s):
        try:
            return _dt.datetime.fromisoformat(s.replace(" ", "T"))
        except ValueError:
            return _CellText(s)
    # one row is one line of the file, so a line break in a cell is written ↵
    return _CellText(s.replace("↵", "\n"))


def _literal(text):
    """A number with a unit written in a formula or a bound: `$5,000`, `5 km`, `30%`."""
    n = _read_number(str(text).strip())
    if n is None:
        raise ValueError(f"'{text}' doesn't read as a number with a unit")
    return n


def _cell_unit(text):
    """The unit a cell's text says it holds: "%" for a percent, a unit for `120 km`
    or for a unit standing alone, as in `speed: mph =@distance/@time`, else None.
    Alone it must be one this knows, so a word waiting for its value (`pending`)
    names nothing."""
    s = "" if text is None else str(text).strip()
    if not s:
        return None
    if s == "%" or s.lower() == "percent":
        return "%"
    n = _read_number(s)
    if isinstance(n, Quantity):
        return n._unit
    if n is not None:
        return "%" if s.rstrip(" )").endswith("%") or s.lower().rstrip(" )").endswith("percent") else None
    unit = _parse_unit(s)
    return unit if unit is not None and any(_known(w) for w, _ in unit) else None


def _landed(v, own, column):
    """A result as it stands in its cell: (the number, the unit's label). The cell's
    own unit wins, then its column's, and a result in another unit of the same kind
    is converted. A plain number takes the unit the cell names; a percent cell holds
    a share, so 0.7 stands as 70%."""
    form = _cell_unit(own) or _cell_unit(column)
    if isinstance(v, Quantity):
        if form == "%":
            raise UnitError(f"change the formula, or the cell's unit — the formula gives {v.unit}, and this cell holds a percent")
        if form is None:
            return v.value, v.unit
        return v._in(form, f"change the formula, or the cell's unit — the formula gives {v.unit}, and this cell says {_label(form)}"), _label(form)
    if form == "%":
        return _scale(v, fractions.Fraction(100)), "%"
    return v, (_label(form) if form is not None else "")


def _read(cell):
    """One cell of a target: its text, typed on arrival, or — where a formula
    computes it — that formula's live result, every digit of it."""
    if isinstance(cell, dict) and "$live" in cell:
        address = cell["$live"]
        if address not in _registry:
            raise LookupError(f"{address} has not been computed in this session")
        return _scalar(_registry[address])
    return _typed(cell)


class _Column(list):
    """A column where pandas is not installed: the values, and the sums a
    spreadsheet reaches for. An empty cell counts for nothing, as it does there."""

    def _numbers(self):
        return [v for v in self if v is not None and not isinstance(v, (str, bool))]

    def sum(self):
        return sum(self._numbers())

    def mean(self):
        n = self._numbers()
        return sum(n) / len(n) if n else None

    def min(self):
        n = self._numbers()
        return min(n) if n else None

    def max(self):
        n = self._numbers()
        return max(n) if n else None

    def count(self):
        return len([v for v in self if v is not None])

    def copy(self):
        return _Column(self)


def _frame_from(header, names, rows):
    """A Concept's Examples as a DataFrame — one row per Example, indexed by
    its name — or a list of dicts where pandas is not installed."""
    cols = [str(c) for c in header[1:]]
    data = [[_read(v) for v in row] for row in rows]
    try:
        pd = importlib.import_module("pandas")
    except ImportError:
        return [dict([(header[0], n)] + list(zip(cols, d))) for n, d in zip(names, data)]
    df = pd.DataFrame(data, columns=cols, index=pd.Index(names, name=header[0]))
    for k, c in enumerate(cols):
        # from what was read: pandas' own string column keeps no text of ours
        whole = [row[k] if k < len(row) else None for row in data]
        values = [v for v in whole if not _is_missing(v)]
        # a column of dates is a datetime column, so `.dt` works on it
        if values and all(isinstance(v, (_dt.date, _dt.datetime)) for v in values):
            df[c] = pd.to_datetime(df[c])
        elif _has_units(values):
            df[c] = _quantity_array()(whole)
        elif any(isinstance(v, _CellText) for v in values):
            df[c] = pd.Series(whole, index=df.index, dtype=object)
    return df


def _has_units(values):
    """Whether a column is numbers with units: text among them leaves it a column
    of objects, where a sum across the text fails as it should."""
    return any(isinstance(v, Quantity) for v in values) and not any(isinstance(v, str) for v in values)


def _series_from(name, index, values):
    typed = [_read(v) for v in values]
    try:
        pd = importlib.import_module("pandas")
    except ImportError:
        return _Column(typed)
    index = list(index) if index else None
    present = [v for v in typed if not _is_missing(v)]
    if _has_units(present):
        return pd.Series(_quantity_array()(typed), index=index, name=name)
    if any(isinstance(v, _CellText) for v in present):
        return pd.Series(typed, index=index, name=name, dtype=object)
    return pd.Series(typed, index=index, name=name)


def _norm(name):
    return re.sub(r"\s+", " ", str(name).replace("_", " ")).strip().lower()


def _pick(obj, column=None, row=None):
    """A column or a cell of a live result, named the way the file names it:
    `@Sales@total revenue` reads the column `total_revenue`."""
    if column is not None:
        cols = getattr(obj, "columns", None)
        if cols is None:
            raise KeyError(f"'{column}' — the result is not a table")
        match = [c for c in cols if str(c) == column] or [c for c in cols if _norm(c) == _norm(column)]
        if not match:
            raise KeyError(f"'{column}' is not a column of it")
        obj = obj[match[0]]
    if row is not None:
        index = getattr(obj, "index", None)
        if index is None:
            raise KeyError(f"'{row}' — the result has no rows")
        if row in index:
            return obj.loc[row]
        if str(row) in [str(x) for x in index]:
            return obj.loc[[x for x in index if str(x) == str(row)][0]]
        raise KeyError(f"'{row}' is not a row of it")
    return obj


# --- values out --------------------------------------------------------------

class _Image:
    def __init__(self, value):
        self.value = value


class _Text:
    def __init__(self, value):
        self.value = value


class _Grid:
    def __init__(self, header, rows):
        self.header = list(header)
        self.rows = [list(r) for r in rows]


def _is(v, module, *names):
    t = type(v)
    return t.__module__.split(".")[0] == module and (not names or t.__name__ in names)


def _iso(v):
    """A date as the file writes one: yyyy-mm-dd, with the time only when
    there is one."""
    if isinstance(v, _dt.datetime):
        if (v.hour, v.minute, v.second, v.microsecond) == (0, 0, 0, 0):
            return v.strftime("%Y-%m-%d")
        return v.strftime("%Y-%m-%d %H:%M")
    return v.strftime("%Y-%m-%d")


def _is_missing(v):
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    if isinstance(v, decimal.Decimal) and v.is_nan():
        return True
    if type(v).__name__ in ("NaTType", "NAType"):
        return True
    return False


def _number_text(v):
    """A number as the file holds it: every digit, never in scientific notation,
    and travelling as text so that nothing on the way can round it. A float is
    Python's shortest text that reads back as the same float."""
    if isinstance(v, int):
        return str(v)
    if isinstance(v, decimal.Decimal):
        return format(v, "f")
    text = format(decimal.Decimal(repr(v)), "f")
    return text[:-2] if text.endswith(".0") else text


def _scalar(v):
    """numpy's scalars as plain Python ones."""
    if _is(v, "numpy") and hasattr(v, "item"):
        try:
            return v.item()
        except Exception:
            return v
    return v


def _cell(v):
    """One grid cell: a number with every digit ({"$n": its text}), or text."""
    v = _scalar(v)
    if _is_missing(v):
        return None
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, decimal.Decimal) and not v.is_finite():
        return None
    if isinstance(v, Quantity):
        if isinstance(v.value, float) and not math.isfinite(v.value):
            return None
        return {"$n": _number_text(v.value), "$u": v.unit}
    if isinstance(v, (int, float, decimal.Decimal)):
        return {"$n": _number_text(v)}
    if isinstance(v, (_dt.date, _dt.datetime)):
        return _iso(v)
    return str(v)


def _name(v):
    """An Example name: text, never a thousands-separated number."""
    v = _scalar(v)
    if _is_missing(v):
        return ""
    if isinstance(v, (_dt.date, _dt.datetime)):
        return _iso(v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, tuple):
        return " / ".join(_name(x) for x in v)
    return str(v)


def _column(name, k):
    n = _norm(name)
    return n or f"column {k}"


def _count(n, word):
    return f"{n:,} {word}{'' if n == 1 else 's'}"


def _summary(v):
    t = type(v).__name__
    shape = getattr(v, "shape", None)
    if _is(v, "pandas", "DataFrame"):
        return f"<DataFrame {_count(v.shape[0], 'row')} × {_count(v.shape[1], 'col')}>"
    if _is(v, "pandas", "Series"):
        return f"<Series {_count(len(v), 'row')}>"
    if isinstance(shape, tuple) and shape:
        return f"<{t} " + " × ".join(f"{d:,}" for d in shape) + ">"
    if isinstance(v, dict):
        return f"<dict {_count(len(v), 'key')}>"
    if isinstance(v, (list, tuple, set, frozenset)):
        return f"<{t} {_count(len(v), 'item')}>"
    return f"<{t}>"


# A frame's rows are the Concept's Examples, numbered 1, 2, 3 … in order, and
# every column of it is a column of the table — the first one included, never
# spent on naming the rows. An index that is not the default counts (a
# groupby's months, say) and becomes the first column rather than be lost.
# aot.grid(header, rows) is the way to name the rows yourself.

def _grid_from_df(df):
    pd = _loaded("pandas")
    original = df
    index = df.index
    default = pd is not None and isinstance(index, pd.RangeIndex) and index.name is None
    if not default:
        df = df.reset_index()
    if pd is not None and isinstance(df.columns, pd.MultiIndex):
        cols = [" ".join(str(x) for x in c if str(x)) for c in df.columns]
    else:
        cols = [str(c) for c in df.columns]
    rows = [[str(k + 1)] + [_cell(v) for v in row]
            for k, row in enumerate(df.itertuples(index=False, name=None))]
    return {"kind": "frame", "columns": [_column(c, k + 1) for k, c in enumerate(cols)],
            "rows": rows, "summary": _summary(original)}


def _grid_from_records(records):
    keys = []
    for r in records:
        for k in r.keys():
            if k not in keys:
                keys.append(k)
    rows = [[str(n + 1)] + [_cell(r.get(k)) for k in keys] for n, r in enumerate(records)]
    return {"kind": "frame", "columns": [_column(k, i + 1) for i, k in enumerate(keys)],
            "rows": rows, "summary": _summary(records)}


def _grid_from_rows(header, rows):
    header = list(header)
    body = [[_name(r[0] if r else "")] + [_cell(v) for v in list(r)[1:]] for r in rows]
    return {"kind": "frame", "columns": [_column(c, k + 1) for k, c in enumerate(header[1:])],
            "rows": body, "summary": f"<table {len(body):,} rows>", "named": True}


_SIGNATURES = [(b"\x89PNG", "png"), (b"\xff\xd8\xff", "jpg"), (b"GIF8", "gif")]


def _image_bytes(v):
    """(bytes, extension) for anything that is a picture, else None."""
    if isinstance(v, (bytes, bytearray)):
        b = bytes(v)
        for sig, ext in _SIGNATURES:
            if b.startswith(sig):
                return b, ext
        head = b[:512].lstrip().lower()
        if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in head):
            return b, "svg"
        return None
    if _is(v, "matplotlib"):
        fig = v if hasattr(v, "savefig") else getattr(v, "figure", None)
        if fig is not None and hasattr(fig, "savefig"):
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
            plt = _loaded("matplotlib.pyplot")
            if plt is not None:
                plt.close(fig)
            return buf.getvalue(), "png"
    if _is(v, "numpy", "ndarray") and v.size and _is(v.flat[0], "matplotlib"):
        return _image_bytes(v.flat[0])  # df.plot(subplots=True): an array of Axes
    if _is(v, "PIL") and hasattr(v, "save"):
        buf = io.BytesIO()
        v.save(buf, format="PNG")
        return buf.getvalue(), "png"
    return None


def _generated(v):
    """A bare `=` line's result as (name, table) pairs: a dict of tables by
    name, or aot.grid()s, each naming its Concept in its header's first
    cell. None when it is neither."""
    if isinstance(v, _Grid):
        return [(v.header[0] if v.header else "", v)]
    if isinstance(v, dict):
        return list(v.items())
    if isinstance(v, (list, tuple)) and v and all(isinstance(g, _Grid) for g in v):
        return [(g.header[0] if g.header else "", g) for g in v]
    return None


def _member(obj, key):
    """One Concept a bare `=` line wrote, read out of its live result by the
    name the file writes it under — `@Sales` is the "sales" table of
    `{"sales": df}`. An aot.grid() arrives as a frame, like any Concept."""
    for name, table in _generated(obj) or []:
        if str(name) == key or _norm(name) == _norm(key):
            if isinstance(table, _Grid):
                rows = table.rows
                return _frame_from(table.header, [r[0] if r else "" for r in rows], [list(r)[1:] for r in rows])
            return table
    raise KeyError(f"'{key}' is not one of the Concepts it wrote")


def _envelope(v, host, cell=None):
    """What the file receives for a result — the classification the editor
    writes from. The result itself stays in the registry untouched. `cell` is
    the formula's request: what its cell says now, and its column's unit."""
    if host == "generator":
        items = _generated(v)
        if items is None:
            return {"kind": "object", "summary": _summary(v)}
        grids = []
        for name, table in items:
            env = _envelope(table, "concept")
            if env.get("kind") != "frame":
                raise TypeError(f"'{name}' is {env.get('summary') or _summary(table)}, not a table — each Concept "
                                "a bare = derivation writes is a DataFrame, a list of dicts, or aot.grid(header, rows)")
            env["name"] = str(name)
            grids.append(env)
        return {"kind": "grids", "grids": grids,
                "summary": f"<{len(grids)} Concept{'' if len(grids) == 1 else 's'}>"}
    if isinstance(v, _Image):
        pic = _image_bytes(v.value)
        if pic is None:
            raise TypeError(f"aot.image() was given {_summary(v.value)}, which is not a picture")
        return {"kind": "image", "ext": pic[1], "base64": base64.b64encode(pic[0]).decode("ascii")}
    if isinstance(v, _Text):
        return {"kind": "text", "text": str(v.value)}
    if isinstance(v, _Grid):
        return _grid_from_rows(v.header, v.rows)
    if host == "concept":
        if _is(v, "pandas", "DataFrame"):
            return _grid_from_df(v)
        if _is(v, "pandas", "Series"):
            return _grid_from_df(v.to_frame())
        if isinstance(v, (list, tuple)) and v and all(isinstance(r, dict) for r in v):
            return _grid_from_records(list(v))
        if isinstance(v, tuple) and len(v) == 2 and isinstance(v[0], (list, tuple)):
            return _grid_from_rows(v[0], v[1])
        return {"kind": "object", "summary": _summary(v)}
    v = _scalar(v)
    if _is_missing(v):
        return {"kind": "text", "text": ""}
    if isinstance(v, bool):
        return {"kind": "text", "text": "Yes" if v else "No"}
    if isinstance(v, (int, float, decimal.Decimal, Quantity)):
        number, unit = _landed(v, (cell or {}).get("value"), (cell or {}).get("unit"))
        if (isinstance(number, float) and math.isinf(number)) or (isinstance(number, decimal.Decimal) and number.is_infinite()):
            raise ValueError("the result is infinite")
        return {"kind": "number", "text": _number_text(number), "unit": unit}
    if isinstance(v, (_dt.date, _dt.datetime)):
        return {"kind": "text", "text": _iso(v)}
    if isinstance(v, str):
        return {"kind": "text", "text": v}
    pic = _image_bytes(v)
    if pic is not None:
        return {"kind": "image", "ext": pic[1], "base64": base64.b64encode(pic[0]).decode("ascii")}
    if _is(v, "pandas", "DataFrame"):
        return {"kind": "frame", "summary": _summary(v), "rows": [], "columns": []}
    return {"kind": "object", "summary": _summary(v)}


# --- the aot object ----------------------------------------------------------

class _Api:
    """What a derivation knows about the file it stands in."""

    def __init__(self):
        self.tree = None      # the parsed .aot, as nested dicts
        self.file = None      # the .aot's path
        self.root = None      # its root Concept (the file name)
        self.files = None     # aot.files, a Path

    def _path(self, name):
        """The nodes from the root down to the Concept named `name`, or None."""
        want = _norm(re.sub(r"^\d+\.(\d+(\.\d+)*)?\s+", "", str(name)))

        def walk(node, trail):
            trail = trail + [node]
            if node.get("kind") == "Concept" and _norm(node.get("name", "")) == want:
                return trail
            for c in node.get("children", []):
                hit = walk(c, trail)
                if hit:
                    return hit
            return None
        return walk(self.tree, []) if self.tree else None

    def _find(self, name):
        trail = self._path(name)
        return trail[-1] if trail else None

    def concept(self, name):
        """The Concept named `name`, as a dict: {line, kind, name, value, alias, children}."""
        return self._find(name)

    def examples(self, name):
        """A Concept's Examples, each a dict of its attributes (typed): its own
        values, and on an attribute it is silent on, the default its Concept
        (or a Concept above that, the nearest first) states — as `@Concept`
        frames read them. An Example above lends nothing: a part inherits
        nothing from its whole."""
        trail = self._path(name)
        if trail is None:
            raise KeyError(f"there is no Concept '{name}' in {self.root}")
        node = trail[-1]
        defaults = {}  # lowercased name -> (name as written, value)
        for kind in reversed(trail):
            if kind.get("kind") == "Example":
                continue
            for a in kind.get("children", []):
                key = str(a.get("name", "")).lower()
                if a.get("kind") == "Default Value" and key not in defaults:
                    defaults[key] = (a.get("name"), a.get("value"))
        out = []
        for c in node.get("children", []):
            if c.get("kind") != "Example":
                continue
            rec = {"name": c.get("name")}
            said = set()  # a bare attribute names no value, so the default still holds
            for a in c.get("children", []):
                if a.get("kind") == "Default Value":
                    said.add(str(a.get("name", "")).lower())
                    rec[a.get("name")] = _typed(a.get("value"))
            for key, (written, value) in defaults.items():
                if key not in said:
                    rec[written] = _typed(value)
            out.append(rec)
        return out

    def frame(self, name):
        """A Concept's Examples as a DataFrame (a list of dicts without pandas)."""
        records = self.examples(name)
        cols = []
        for r in records:
            for k in r:
                if k != "name" and k not in cols:
                    cols.append(k)
        header = [name] + cols
        return _frame_from(header, [r["name"] for r in records],
                           [["" if r.get(c) is None else str(r.get(c)) for c in cols] for r in records])

    def image(self, value):
        """Write `value` (a Figure, Axes, PIL image or image bytes) as a picture."""
        return _Image(value)

    def text(self, value):
        """Write `value` as text, however long — a long text becomes a .md file."""
        return _Text(value)

    def quantity(self, value, unit=None):
        """A number with a unit: aot.quantity(5, "km"), or aot.quantity("5 km")."""
        if unit is None:
            return _literal(value)
        parsed = _parse_unit(unit)
        if parsed is None:
            raise ValueError(f"write a unit such as 'km' or 'km/h' — '{unit}' does not read as one")
        return Quantity(value, parsed)

    def grid(self, header, rows):
        """A table from a header and rows: header[0] labels the names column."""
        return _Grid(header, rows)

    def use(self, path):
        """A Python file of the repository, loaded by its path — for one whose
        name is no identifier: aot.use("tools/my helpers.py").total(...)"""
        return _use(path)


# --- the repository's own Python ---------------------------------------------
# A derivation names a module and gets it — `=finance.revenue(@Sales)` — with
# no import to write. The standard library and installed packages come first,
# so nothing in the repository can stand in for them (an `os.py` shadows
# nothing); then the repository's own files: `aot.files/finance.py`, then
# `finance.py` at the root, then the one `finance.py` anywhere else in it, or a
# dotted path from the root, `tools.finance`. Only the files the editor listed
# are candidates — never a virtual environment's, never node_modules'.
#
# And none of them runs until its present content has been allowed. A file
# is allowed by its hash, so a change — a pull, another tool — is asked about
# again; the editor sends what the writer allowed, and a file it has not
# answers NeedsConsent, which the editor turns into the question.

import hashlib

_repo = {
    "root": None, "aot_files": None,
    "files": set(),     # every Python file the editor listed, by key
    "stems": {},        # module name -> [paths] of the files so named
    "dirs": set(),      # every directory holding one of them, at any depth
    "approved": {},     # key -> the sha256 of the content allowed to run
    "loaded": {},       # key -> mtime, of every repository file run so far
    "modules": set(),   # the module names this finder loaded
    "used": {},         # key -> (mtime, module), for aot.use
}


def _key(p):
    return os.path.normcase(os.path.abspath(p))


def _inside_repo(p):
    root = _repo["root"]
    if not root:
        return False
    try:
        return os.path.commonpath([_key(root), _key(p)]) == _key(root)
    except ValueError:  # another drive
        return False


def _rel(p):
    try:
        return os.path.relpath(p, _repo["root"]).replace(os.sep, "/")
    except ValueError:
        return p


class NeedsConsent(ImportError):
    """A repository file whose present content has not been allowed to run."""

    def __init__(self, path, digest):
        super().__init__(f"{_rel(path)} has not been allowed to run here")
        self.path = path
        self.digest = digest


def _digest(path):
    # sha256, not sha1: a sha1 collision can be chosen
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def _allowed(path):
    digest = _digest(path)
    if _repo["approved"].get(_key(path)) != digest:
        raise NeedsConsent(path, digest)
    _repo["loaded"][_key(path)] = os.path.getmtime(path)


def _index(root, aot_files, files):
    _repo["root"] = root
    _repo["aot_files"] = aot_files
    _repo["files"] = {_key(f) for f in files}
    stems, dirs = {}, set()
    for f in files:
        stem = os.path.splitext(os.path.basename(f))[0]
        if stem != "__init__":
            stems.setdefault(stem, []).append(f)
        d = os.path.dirname(f)
        while _inside_repo(d) and _key(d) not in dirs:
            dirs.add(_key(d))
            if _key(d) == _key(root):
                break
            d = os.path.dirname(d)
    _repo["stems"] = stems
    _repo["dirs"] = dirs


def _listed(path):
    return _key(path) in _repo["files"]


def _found_in(name, base):
    """A module `name` directly under `base`: ("file", path), ("package",
    __init__, dir), ("namespace", dir) — or None."""
    f = os.path.join(base, name + ".py")
    if _listed(f):
        return ("file", f)
    d = os.path.join(base, name)
    init = os.path.join(d, "__init__.py")
    if _listed(init):
        return ("package", init, d)
    if _key(d) in _repo["dirs"] and _key(d) != _key(base):
        return ("namespace", d)
    return None


def _locate(name):
    for base in (_repo["aot_files"], _repo["root"]):
        hit = base and _found_in(name, base)
        if hit:
            return hit
    hits = _repo["stems"].get(name, [])
    if len(hits) == 1:
        return ("file", hits[0])
    if len(hits) > 1:
        dotted = [os.path.splitext(_rel(h))[0].replace("/", ".") for h in hits]
        raise ImportError(f"'{name}' names {len(hits)} files — {', '.join(_rel(h) for h in hits)} — "
                          f"write the dotted path from the repository's root, as {dotted[0]}")
    return None


class _RepoFinder:
    """Finds the repository's own modules, after everything else has had its turn."""

    @classmethod
    def find_spec(cls, fullname, path=None, target=None):
        if not _repo["root"]:
            return None
        if path is None:
            if fullname in sys.builtin_module_names:
                return None
            try:
                if importlib.machinery.PathFinder.find_spec(fullname) is not None:
                    return None  # the standard library, an installed package
            except (ImportError, ValueError):
                pass
            found = _locate(fullname)
        else:
            dirs = [p for p in path if _inside_repo(p)]
            found = None
            for d in dirs:
                found = _found_in(fullname.rpartition(".")[2], d)
                if found:
                    break
        if not found:
            return None
        _repo["modules"].add(fullname)
        if found[0] == "namespace":
            spec = importlib.machinery.ModuleSpec(fullname, None, is_package=True)
            spec.submodule_search_locations = [found[1]]
            return spec
        _allowed(found[1])
        if found[0] == "package":
            return importlib.util.spec_from_file_location(fullname, found[1], submodule_search_locations=[found[2]])
        return importlib.util.spec_from_file_location(fullname, found[1])


sys.meta_path.insert(0, _RepoFinder)


def _use(path):
    root = _repo["root"]
    if not root:
        raise LookupError("no repository is open")
    tried = [path] if os.path.isabs(path) else [os.path.join(b, path) for b in (_repo["aot_files"], root) if b]
    for candidate in tried:
        candidate = os.path.normpath(candidate)
        if not os.path.isfile(candidate):
            continue
        if not _inside_repo(candidate):
            raise PermissionError(f"{path} is outside the repository")
        key = _key(candidate)
        mtime = os.path.getmtime(candidate)
        cached = _repo["used"].get(key)
        if cached and cached[0] == mtime:
            return cached[1]
        _allowed(candidate)
        name = "aot_use_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
        spec = importlib.util.spec_from_file_location(name, candidate)
        module = importlib.util.module_from_spec(spec)
        for k, v in _BASE.items():
            setattr(module, k, v)
        module.aot = _api
        spec.loader.exec_module(module)
        _repo["used"][key] = (mtime, module)
        return module
    raise FileNotFoundError(f"{path} is no file in aot.files or the repository")


def _forget_changed():
    """A repository file that changed since it ran: every module this finder
    loaded goes, so the next use imports the file as it is now — all of them,
    since one module holds on to another. The sidecar reloads with them."""
    changed = False
    for key, mtime in list(_repo["loaded"].items()):
        try:
            changed = changed or os.path.getmtime(key) != mtime
        except OSError:
            changed = True
    if not changed:
        return
    for name in list(_repo["modules"]):
        sys.modules.pop(name, None)
    _repo["modules"].clear()
    _repo["loaded"].clear()
    _repo["used"].clear()
    _sidecar["mtime"] = object()  # never equal: the sidecar loads again
    importlib.invalidate_caches()


class _Package:
    """A package whose submodules import as they are reached: tools.finance."""

    def __init__(self, module):
        object.__setattr__(self, "_module", module)

    def __getattr__(self, attr):
        module = object.__getattribute__(self, "_module")
        try:
            return getattr(module, attr)
        except AttributeError:
            pass
        name = f"{module.__name__}.{attr}"
        try:
            sub = importlib.import_module(name)
        except ModuleNotFoundError as e:
            if e.name == name:
                raise AttributeError(f"{module.__name__} has no {attr}") from None
            raise
        return _Package(sub) if hasattr(sub, "__path__") else sub

    def __repr__(self):
        return repr(object.__getattribute__(self, "_module"))


class _Scope(dict):
    """A derivation's names: what it is given, and then any module a name
    imports — so `=finance.revenue(@Sales)` or `=csv.…` needs no import."""

    def __missing__(self, name):
        if hasattr(builtins, name):
            raise KeyError(name)  # the builtins answer it
        try:
            module = importlib.import_module(name)
        except ModuleNotFoundError as e:
            if e.name == name:
                raise KeyError(name) from None  # a NameError, as it should be
            raise
        wrapped = _Package(module) if hasattr(module, "__path__") else module
        self[name] = wrapped
        return wrapped


# --- the session -------------------------------------------------------------

_api = _Api()
_registry = {}          # address -> the live result
_sidecar = {"path": None, "mtime": None, "names": {}}
_BASE = _preloaded()


def _load_sidecar(path):
    """aot.files/<file>.py, imported by its path — never by putting aot.files
    on sys.path, where an `os.py` beside it would shadow the real one."""
    _allowed(path)
    spec = importlib.util.spec_from_file_location("aot_sidecar", path)
    module = importlib.util.module_from_spec(spec)
    # the sidecar may use what a derivation may, without importing it
    for k, v in _BASE.items():
        setattr(module, k, v)
    module.aot = _api
    spec.loader.exec_module(module)
    return {k: v for k, v in vars(module).items() if not k.startswith("_")}


def _error(e, extra=None):
    out = {"ok": False, "error": f"{type(e).__name__}: {e}".rstrip(": ")}
    if isinstance(e, NeedsConsent):
        # the question the editor asks before anything of it runs
        out["consent"] = {"path": e.path, "digest": e.digest}
    tb = traceback.extract_tb(e.__traceback__)
    sidecar = _sidecar.get("path")
    # the innermost frame in the sidecar, or in any file of the repository,
    # is where the reader should look
    for frame in reversed(tb):
        here = os.path.abspath(frame.filename)
        if (sidecar and _key(here) == _key(sidecar)) or (_listed(here) and _inside_repo(here)):
            out["file"] = here
            out["line"] = frame.lineno
            break
    out["traceback"] = "".join(traceback.format_exception(type(e), e, e.__traceback__))[-4000:]
    if extra:
        out.update(extra)
    return out


def _target(t):
    kind = t.get("kind")
    if kind == "object":
        address = t["address"]
        if address not in _registry:
            raise LookupError(f"{address} has not been computed in this session")
        obj = _registry[address]
        if t.get("key") is not None:
            obj = _member(obj, t["key"])
        return _pick(obj, t.get("column"), t.get("row"))
    if kind == "value":
        return _typed(t.get("text"))
    if kind == "frame":
        rows = t.get("rows") or []
        return _frame_from(t["header"], [r[0] for r in rows], [r[1:] for r in rows])
    if kind == "column":
        return _series_from(t.get("name"), t.get("index"), t.get("values") or [])
    if kind == "record":
        fields = dict((k, _read(v)) for k, v in (t.get("fields") or {}).items())
        fields.setdefault("name", t.get("name"))
        return fields
    raise LookupError(f"unknown reference kind {kind!r}")


def _scope(targets):
    """A derivation's names — or a bound's: the preloaded modules, `aot`, the
    sidecar's names, and every `@` reference as _aot_ref(k)."""
    scope = _Scope({"__builtins__": builtins})
    scope.update(_BASE)
    scope["aot"] = _api
    scope.update(_sidecar["names"])
    scope["_aot_ref"] = lambda k: _target(targets[k])
    scope["_aot_q"] = _literal
    return scope


# --- the constraints ---------------------------------------------------------

def _alternatives(v):
    """The values a collection bound lists — `==("draft", "sent")` — or None
    for a bound that is one value."""
    if isinstance(v, (str, bytes, dict)):
        return None
    if isinstance(v, (list, tuple, set, frozenset)):
        return list(v)
    if _is(v, "pandas", "Series", "Index") or _is(v, "numpy", "ndarray"):
        return list(v.tolist())
    return None


_OPS = {
    "==": lambda a, b: a == b, "<=": lambda a, b: a <= b, ">=": lambda a, b: a >= b,
    "<": lambda a, b: a < b, ">": lambda a, b: a > b,
}


def _as_text(v):
    if isinstance(v, (_dt.date, _dt.datetime)):
        return _iso(v)
    return "" if v is None else str(v)


def _holds(rel, value, bound, column=None):
    """Whether a value keeps a bound: as the two are, else — a number held to
    text, say — as the text each is written as. Two numbers whose units do not go
    together are an error, which no reading as text may hide. `column` is the
    unit of a column whose bound is a number written straight, which is then in
    that unit: `distance (km) <=500`, `discount (%) <=35`."""
    a, b = _scalar(value), _scalar(bound)
    if isinstance(b, str):
        s = b.strip()
        n = _read_number(s)
        b = n if n is not None else _typed(b) if _DATE.match(s) else str(b)
    if column and isinstance(b, (int, float, decimal.Decimal)) and not isinstance(b, bool):
        unit = _cell_unit(column)
        if unit == "%":
            b = _scale(b, fractions.Fraction(1, 100))
        elif unit is not None:
            b = Quantity(b, unit)
    # `==` never raises in Python, so it says the rule itself
    for q, other in ((a, b), (b, a)):
        if isinstance(q, Quantity) and isinstance(other, (int, float, decimal.Decimal)) and not isinstance(other, bool):
            q._like(other, "compare")
    try:
        return bool(_OPS[rel](a, b))
    except UnitError:
        raise
    except TypeError:
        return bool(_OPS[rel](_as_text(a), _as_text(b)))


def _describe(v):
    many = _alternatives(v)
    if many is not None:
        return "one of " + ", ".join(_describe(x) for x in many)
    v = _scalar(v)
    if isinstance(v, Quantity):
        return str(v)
    if isinstance(v, str):
        return repr(str(v))
    if isinstance(v, (_dt.date, _dt.datetime)):
        return _iso(v)
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, int):
        return f"{v:,}"
    if isinstance(v, float) and math.isfinite(v):
        # as a cell shows a number: separated, and without a float's binary noise
        return f"{v:,.15g}"
    return str(v)


def _check(req):
    """A constraint's bound, evaluated against one value it holds. A `==`
    whose bound is one value defines the value rather than bounding it: the
    answer carries it (`define`) along with whether the value already is it."""
    buf = io.StringIO()
    try:
        code = compile(req["code"], f"<{req.get('address', 'constraint')}>", "eval")
        with contextlib.redirect_stdout(buf):
            bound = eval(code, _scope(req.get("targets") or []))
    except SystemExit:
        return {"ok": False, "error": "the bound asked Python to exit — a bound computes a value"}
    except BaseException as e:
        return _error(e)
    rel = req.get("rel")
    many = _alternatives(bound)
    value = _typed(req.get("value"))
    try:
        holds = any(_holds(rel, value, b, req.get("unit")) for b in (many if many is not None else [bound]))
        out = {"ok": True, "holds": holds, "bound": _describe(bound)}
        if rel == "==" and many is None:
            out["define"] = _envelope(bound, "value")
    except BaseException as e:
        return _error(e)
    return out


# --- the guards --------------------------------------------------------------
# What the editor asks this process to refuse, set once, at hello — before
# any code of the repository's has run — and never lifted: a later hello
# cannot loosen them, and an audit hook cannot be removed.
#
#   memory       the operating system's own limit: a job object on Windows,
#                an address-space limit elsewhere. Past it an allocation fails.
#   subprocess   on Windows the job object admits no second process, which
#                nothing inside Python can undo; elsewhere an audit hook
#                refuses the calls that start one.
#   network      an audit hook refuses connections beyond this machine.
#   credentials  an audit hook refuses the places credentials are kept.
#
# The hooks are Python's own: they stop the calls that make them, not code
# written to get round them (ctypes, an extension module). They are a guard
# against the ordinary payload and the honest mistake, not a sandbox, and the
# editor says so.

_guards = {"set": False, "report": {}}

_SUBPROCESS_EVENTS = frozenset({
    "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn",
    "os.startfile", "os.fork", "os.forkpty", "pty.spawn", "_winapi.CreateProcess",
})
_NET_EVENTS = frozenset({
    "socket.connect", "socket.bind", "socket.sendto", "socket.sendmsg",
    "socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyname_ex", "socket.gethostbyaddr",
})
_PATH_EVENTS = frozenset({"open", "os.listdir", "os.scandir", "os.chdir", "shutil.copyfile", "shutil.copytree", "shutil.make_archive"})


def _credential_dirs():
    home = os.path.expanduser("~")
    j = os.path.join
    places = [j(home, p) for p in (
        ".ssh", ".aws", ".azure", ".gnupg", ".kube", ".docker", j(".config", "gcloud"), j(".config", "gh"),
        ".netrc", "_netrc", ".git-credentials", ".pypirc", ".mozilla", j(".config", "google-chrome"),
        j(".config", "chromium"), j(".config", "BraveSoftware"), j("Library", "Keychains"),
        j("Library", "Application Support", "Google", "Chrome"), j("Library", "Application Support", "Firefox"),
    )]
    for var, subs in (
        ("APPDATA", (j("Microsoft", "Credentials"), j("Microsoft", "Protect"), j("Mozilla", "Firefox"))),
        ("LOCALAPPDATA", (j("Microsoft", "Credentials"), j("Google", "Chrome", "User Data"),
                          j("Microsoft", "Edge", "User Data"), j("BraveSoftware", "Brave-Browser", "User Data"))),
    ):
        base = os.environ.get(var)
        if base:
            places += [j(base, s) for s in subs]
    return tuple(os.path.normcase(os.path.abspath(p)) for p in places)


def _loopback(host):
    h = str(host or "").strip("[]").lower()
    return h in ("", "localhost", "::1") or h.startswith("127.")


def _windows_job(memory_mb, one_process):
    """Put this process in a job object the operating system enforces."""
    import ctypes
    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class EXTENDED(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO_COUNTERS),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
    kernel32.SetInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        raise OSError(ctypes.get_last_error(), "CreateJobObject failed")
    info = EXTENDED()
    flags = 0
    if memory_mb:
        flags |= 0x100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
        info.ProcessMemoryLimit = int(memory_mb) * 1024 * 1024
    if one_process:
        flags |= 0x8    # JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        info.BasicLimitInformation.ActiveProcessLimit = 1
    info.BasicLimitInformation.LimitFlags = flags
    if not kernel32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):  # extended limits
        raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")
    if not kernel32.AssignProcessToJobObject(job, kernel32.GetCurrentProcess()):
        raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject failed")
    _guards["job"] = job  # held for the life of the process


def _memory_cap(platform):
    """The limit that caps memory off Windows, and how hello says so. On Linux
    it is the data size: the heap and the private writable mappings, which is
    the memory the process uses. An address-space cap also counts what numpy's
    BLAS threads and pyarrow reserve and never touch, so on a many-core machine
    (WSL often is one) importing them fails under it. macOS has no data limit
    worth the name, and enforces neither."""
    if platform.startswith("linux"):
        return "RLIMIT_DATA", "a data-size limit"
    if platform == "darwin":
        return "RLIMIT_AS", "an address-space limit, which macOS does not enforce"
    return "RLIMIT_AS", "an address-space limit"


def _set_guards(policy):
    """Install the guards a policy asks for. Once only; a report of what holds."""
    if _guards["set"]:
        return _guards["report"]
    _guards["set"] = True
    report = {}
    memory_mb = int(policy.get("memoryMb") or 0)
    allow_sub = bool(policy.get("subprocess"))
    allow_net = policy.get("network", True) is not False
    protect = bool(policy.get("credentials"))

    os_sub = False
    if os.name == "nt" and (memory_mb or not allow_sub):
        try:
            _windows_job(memory_mb, not allow_sub)
            os_sub = not allow_sub
            if memory_mb:
                report["memory"] = f"at most {memory_mb:,} MB (a job object)"
        except Exception as e:
            report["memory"] = f"not limited — the job object failed: {e}"
    elif memory_mb:
        try:
            import resource
            limit = memory_mb * 1024 * 1024
            which, how = _memory_cap(sys.platform)
            resource.setrlimit(getattr(resource, which), (limit, limit))
            report["memory"] = f"at most {memory_mb:,} MB ({how})"
        except Exception as e:
            report["memory"] = f"not limited — {e}"
    report.setdefault("memory", "not limited")
    report["subprocess"] = ("allowed" if allow_sub else
                            "refused by the operating system (a job object)" if os_sub else
                            "refused by Python's audit hook")
    report["network"] = "allowed" if allow_net else "refused beyond this machine, by Python's audit hook"
    report["credentials"] = "protected by Python's audit hook" if protect else "not protected"

    dirs = _credential_dirs() if protect else ()
    skip = tuple(os.path.normcase(os.path.abspath(p)) for p in {sys.prefix, sys.base_prefix, sys.exec_prefix})
    busy = [False]

    def refused(message):
        return PermissionError(message)

    def hook(event, args):
        if busy[0]:
            return
        if not allow_sub and event in _SUBPROCESS_EVENTS:
            raise refused("a derivation may not start another program here (aot.python.allowSubprocess is off)")
        if not allow_net and event in _NET_EVENTS:
            if event in ("socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyname_ex", "socket.gethostbyaddr"):
                host = args[0] if args else None
            else:
                address = args[1] if len(args) > 1 else None
                if isinstance(address, (str, bytes)):  # a Unix socket: a door into this machine's services
                    raise refused("a derivation may not open a socket here (aot.python.allowNetwork is off)")
                host = address[0] if isinstance(address, tuple) and address else None
            if not _loopback(host.decode() if isinstance(host, bytes) else host):
                raise refused(f"a derivation may not reach {host} here (aot.python.allowNetwork is off)")
        if dirs and event in _PATH_EVENTS and args:
            target = args[0]
            if isinstance(target, int) or target is None:
                return
            busy[0] = True
            try:
                p = os.path.normcase(os.path.abspath(os.fsdecode(target)))
                if not p.startswith(skip):
                    real = os.path.normcase(os.path.realpath(p))
                    for d in dirs:
                        for q in (p, real):
                            if q == d or q.startswith(d + os.sep):
                                raise refused(f"{os.fsdecode(target)} is where credentials are kept, and a derivation "
                                              "may not read it (aot.python.protectCredentials)")
            except PermissionError:
                raise
            except Exception:
                pass
            finally:
                busy[0] = False

    if not allow_sub or not allow_net or protect:
        sys.addaudithook(hook)
    _guards["report"] = report
    return report


class _SharedTargets:
    """The targets one batch shares: a table read by a thousand formulas is built
    once, and each is handed its own copy to change as it likes. A formula's own
    live result is the object itself, as it always was: nothing is copied. Every
    reader of a target runs after what the target reads, so what is built for the
    first holds for the rest."""

    def __init__(self, targets):
        self.targets = targets
        self.built = {}

    def read(self, k):
        t = self.targets[k]
        if t.get("kind") == "object":
            return _target(t)
        if k not in self.built:
            self.built[k] = _target(t)
        made = self.built[k]
        return made.copy() if hasattr(made, "copy") else made


def _eval_one(item, shared):
    """One formula. A failed one leaves no result behind, so what reads it does not
    run at all: everything it reads is read first, and no part of its code runs on
    an older value. A formula on a column's definition may name what a value may be
    rather than what it is: a collection, which writes nothing, and the cell's own
    value stands."""
    address = item["address"]
    refs = item.get("refs") or []
    scope = _scope([])
    started = time.perf_counter()
    buf = io.StringIO()
    try:
        reads = [shared.read(k) for k in refs]
        scope["_aot_ref"] = lambda k: reads[k]
        code = compile(item["code"], f"<{address}>", "eval")
        with contextlib.redirect_stdout(buf):
            value = eval(code, scope)
        if item.get("host") == "defined":
            if _alternatives(value) is not None:
                _registry[address] = _typed(item.get("value"))
                return {"ok": True, "many": True, "ms": round((time.perf_counter() - started) * 1000)}
            _registry[address] = value
            envelope = _envelope(value, "value", item)
        else:
            _registry[address] = value
            envelope = _envelope(value, item.get("host"), item)
    except SystemExit:
        _registry.pop(address, None)
        return {"ok": False, "error": "the expression asked Python to exit — a formula computes a value"}
    except BaseException as e:
        _registry.pop(address, None)
        return _error(e, {"stdout": buf.getvalue()[-2000:]})
    return {"ok": True, "result": envelope, "stdout": buf.getvalue()[-2000:],
            "ms": round((time.perf_counter() - started) * 1000)}


def _handle(req):
    op = req.get("op")
    if op == "evalBatch":
        # formulas in the order they must run, one line of answer each as it
        # finishes, so the editor's clock measures one formula rather than the
        # batch, and what finished shows without waiting for what has not
        shared = _SharedTargets(req.get("targets") or [])
        items = req.get("items") or []
        for k, item in enumerate(items):
            answer = _eval_one(item, shared)
            answer.update({"id": req.get("id"), "partial": True, "k": k})
            try:
                _send(answer)
            except (TypeError, ValueError) as e:
                _registry.pop(item.get("address"), None)
                _send({"id": req.get("id"), "partial": True, "k": k, "ok": False, "error": f"the result could not be sent — {e}"})
        return {"ok": True, "count": len(items)}
    if op == "hello":
        guards = _set_guards(req["guards"]) if isinstance(req.get("guards"), dict) else {}
        return {"ok": True, "protocol": PROTOCOL, "python": platform.python_version(),
                "executable": sys.executable, "libraries": _library_versions(), "guards": guards}
    if op == "warm":
        warmed = []
        for name in ("pandas", "numpy"):
            try:
                importlib.import_module(name)
                warmed.append(name)
            except ImportError:
                pass
        return {"ok": True, "warmed": warmed}
    if op == "open":
        # (a tree the session already holds is not sent again)
        if "tree" in req:
            _api.tree = req.get("tree")
        # the units the repository writes itself, as it stands
        if "units" in req:
            _define_units(req.get("units"))
        _api.file = req.get("file")
        _api.root = req.get("root")
        _api.files = Path(req["aotFiles"]) if req.get("aotFiles") else None
        _install["hint"] = req.get("install") or None
        # the repository's Python: which files there are, and which of them
        # the writer has allowed to run, as they are now
        if req.get("repo"):
            _index(req["repo"], req.get("aotFiles"), req.get("pyFiles") or [])
        for p, digest in (req.get("approved") or {}).items():
            _repo["approved"][_key(p)] = digest
        _forget_changed()
        path = req.get("sidecar")
        mtime = req.get("sidecarMtime")
        if path != _sidecar["path"] or mtime != _sidecar["mtime"]:
            _sidecar.update({"path": path, "mtime": mtime, "names": {}})
            if path:
                try:
                    _sidecar["names"] = _load_sidecar(path)
                except BaseException as e:  # a sidecar that raises, or even exits
                    _sidecar.update({"path": None, "mtime": None, "names": {}})
                    return _error(e, {"sidecarFailed": True})
        return {"ok": True, "sidecar": bool(_sidecar["path"]),
                "functions": sorted(k for k, v in _sidecar["names"].items() if callable(v))}
    if op == "check":
        return _check(req)
    if op == "checks":
        # many bounds in one round trip; a file that needs consent stops the
        # batch, which is sent again once it is allowed
        results = []
        for item in req.get("items") or []:
            r = _check(item)
            if r.get("consent"):
                return r
            r.pop("traceback", None)  # a column of one failure need not carry it a thousand times
            results.append(r)
        return {"ok": True, "results": results}
    if op == "eval":
        targets = req.get("targets") or []
        return _eval_one(dict(req, refs=list(range(len(targets)))), _SharedTargets(targets))
    if op == "forget":
        for a in req.get("addresses") or []:
            _registry.pop(a, None)
        return {"ok": True}
    if op == "approve":
        for p, digest in (req.get("files") or {}).items():
            _repo["approved"][_key(p)] = digest
        return {"ok": True}
    if op == "reset":
        _registry.clear()
        _sidecar.update({"path": None, "mtime": None, "names": {}})
        # and the repository's modules: a fresh run imports them as they are now
        for name in list(_repo["modules"]):
            sys.modules.pop(name, None)
        _repo["modules"].clear()
        _repo["loaded"].clear()
        _repo["used"].clear()
        return {"ok": True}
    if op == "bye":
        return {"ok": True}
    return {"ok": False, "error": f"unknown op {op!r}"}


def main():
    while True:
        try:
            line = _IN.readline()
        except ValueError:  # stdin closed under us
            break
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            _send({"id": None, "ok": False, "error": "the request was not JSON"})
            continue
        try:
            resp = _handle(req)
        except BaseException as e:
            resp = _error(e)
        resp["id"] = req.get("id")
        try:
            _send(resp)
        except (TypeError, ValueError) as e:
            _send({"id": req.get("id"), "ok": False, "error": f"the result could not be sent — {e}"})
        if req.get("op") == "bye":
            break


if __name__ == "__main__":
    main()
