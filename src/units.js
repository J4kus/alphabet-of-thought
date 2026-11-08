// The units Alpha knows without being told.
//
// `distance (km)` is an attribute with an alias, and an alias types an attribute
// by the Concept it names (crosslinks.conceptType). A unit is such a Concept that
// every file already has: it sits in a hierarchy, Unit > Length > km, and two
// units convert when they measure the same thing. units.json holds the hierarchy,
// and the formula engine reads the same file to do the arithmetic. A file's own
// Concept of the same name wins, as a file's own names always do.
//
// A name is matched as written, then, at three letters or more, with case aside:
// `Hours` is `hours` and `kwh` is `kWh`, but `M` is never `m`.
//
// Pure: no vscode, no requires but the table. A leaf, so table.js may use it.

const TABLE = require("./units.json");

const exact = new Map();
const folded = new Map();
for (const [kind, entry] of Object.entries(TABLE)) {
  for (const [factor, ...names] of entry.units) {
    const unit = { name: names[0], kind, factor, names };
    for (const n of names) {
      exact.set(n, unit);
      if ([...n].length >= 3) folded.set(n.toLowerCase(), unit);
    }
  }
}

// --- the units a repository writes itself ---------------------------------------
// A repository may say its own units in plain Alphabet of Thought, as rows of a
// kind under a Concept called Unit:
//
//     Unit
//         Length|factor|format
//         m     |1     |# m
//         km    |1000  |# km
//         Money|factor|format
//         CHF  |1     |CHF #
//
// Each Example is a unit, its kind the sub-Concept above it. `factor` is what
// one is worth in the kind's base — the unit whose factor is 1 — and units of
// one kind convert into each other; a kind Alpha knows (Length, Mass, Time …)
// converts with the built-in units of that kind too. `format` is optional:
// `#` stands for the number, the text before it is written in front
// (`CHF 1,200`, `R1,200`), the text after it behind (`120 km`, `3x`), and
// `.00` after the `#` fixes the decimals. With no format a value reads
// `<number> <unit>`. A unit the repository defines wins over the built-in one
// of the same name. crosslinks.unitsFromTree reads them off a file; the
// extension and the command line hand every file's to defineUnits before a
// file is read, so all of a repository's files share them.

// A format as { prefix, prefixSpace, suffix, suffixSpace, decimals }.
function parseFormat(format, name) {
  const f = String(format || "").trim();
  const at = f.indexOf("#");
  if (at === -1) return { prefix: "", prefixSpace: false, suffix: name, suffixSpace: true, decimals: null };
  const before = f.slice(0, at), after = f.slice(at + 1);
  const dec = /^\.(0+)/.exec(after);
  const rest = dec ? after.slice(dec[0].length) : after;
  return {
    prefix: before.trim(), prefixSpace: /\s$/.test(before),
    suffix: rest.trim(), suffixSpace: /^\s/.test(rest),
    decimals: dec ? dec[1].length : null,
  };
}

let own = new Map();       // word -> unit, as a file wrote it
let ownFolded = new Map(); // the same, by lowercase, for words of three letters or more
let ownMarks = new Map();  // a prefix or suffix mark -> unit (`CHF`, `x`)
let defined = [];          // what defineUnits was handed, for the formulas' runtime
let generation = 0;        // bumped on every definition, so a reader can rebuild what it built from them

// The units every file now reads by: [{ name, kind, factor, format }], as
// crosslinks.unitsFromTree answers them. An empty list leaves the built-ins alone.
let lastDefined = "[]";
function defineUnits(list) {
  // the same units handed again change nothing, and rebuild nothing
  const said = JSON.stringify((list || []).map((u) => [u.name, u.kind, u.factor, u.format]));
  if (said === lastDefined) return;
  lastDefined = said;
  own = new Map();
  ownFolded = new Map();
  ownMarks = new Map();
  defined = [];
  for (const u of list || []) {
    const name = String(u.name || "").trim();
    if (!name) continue;
    const unit = { name, kind: String(u.kind || ""), factor: String(u.factor || "").trim(), names: [name], format: parseFormat(u.format, name), own: true };
    own.set(name, unit);
    if ([...name].length >= 3) ownFolded.set(name.toLowerCase(), unit);
    if (unit.format.prefix) ownMarks.set(unit.format.prefix, unit);
    if (unit.format.suffix && unit.format.suffix !== name) ownMarks.set(unit.format.suffix, unit);
    defined.push({ name, kind: unit.kind, factor: unit.factor, prefix: unit.format.prefix, suffix: unit.format.suffix, decimals: unit.format.decimals });
  }
  generation++;
}

// The unit one word names, or null: { name, kind, factor, names } — the
// repository's own first, then the built-in ones. (The name stays from when
// every unit was built in.)
function builtIn(word) {
  const w = String(word || "");
  const mine = own.get(w) || ownMarks.get(w) || ([...w].length >= 3 ? ownFolded.get(w.toLowerCase()) : null);
  if (mine) return mine;
  return exact.get(w) || ([...w].length >= 3 ? folded.get(w.toLowerCase()) : null) || null;
}

// The repository's own unit a word or a mark names, with its format, or null.
const ownUnit = (word) => {
  const w = String(word || "");
  return own.get(w) || ownMarks.get(w) || ([...w].length >= 3 ? ownFolded.get(w.toLowerCase()) : null) || null;
};

// The marks written in front of a number: the currencies Alpha knows, then the
// repository's own prefixes, longest first so `CHF` is never read as `C`.
const prefixes = () => [...ownMarks.entries()].filter(([m, u]) => u.format.prefix === m).map(([m]) => m)
  .sort((a, b) => b.length - a.length);

// What was defined, for the formulas' runtime: [{ name, kind, factor, prefix, suffix, decimals }].
const definedUnits = () => defined.slice();
const unitsGeneration = () => generation;

// The words of a unit as written: `km/h` is km and h, `kg*m/s^2` is kg, m and s,
// `m²` is m and `m2` is m. null when it is not written as a unit at all.
function wordsOf(text) {
  const out = [];
  const t = String(text || "").trim();
  if (!t) return null;
  const parts = t.split(/[/*·]/);
  for (let i = 0; i < parts.length; i++) {
    if (i === 0 && parts.length > 1 && (parts[0] === "" || parts[0] === "1")) continue;
    const m = /^((?:\p{L}|[°$€£¥%])+)(?:\^-?\d+|[²³]|(\d))?$/u.exec(parts[i]);
    if (!m) return null;
    // a bare digit is a power only on a unit it knows: m2, never CO2
    if (m[2] && !builtIn(m[1])) return null;
    out.push(m[1]);
  }
  return out.length ? out : null;
}

// Whether a text names a unit: every part of it reads as a unit word, and at
// least one is built in, so `km/h` and `$/client` do and `and/or` does not.
function isUnit(text) {
  const words = wordsOf(text);
  return !!words && words.some((w) => builtIn(w));
}

// The hierarchy a unit sits in, for a hover: ["Unit", "Length", "km"].
function pathOf(word) {
  const u = builtIn(word);
  return u ? ["Unit", u.kind, u.name] : null;
}

// One unit in words: where it sits, and what it is worth where that means
// something. "Unit ▸ Length ▸ km. 1 km = 1000 m."
function describe(word) {
  const u = builtIn(word);
  if (!u) return null;
  const path = pathOf(word).join(" ▸ ");
  if (u.own) {
    if (!u.factor) return `${path}, written in this repository. It converts to no other unit.`;
    // the kind's base: the repository's own unit worth 1, else the built-in one
    // of a kind Alpha knows (a league under Length is in metres); currencies
    // convert into none, so theirs is no base
    const mine = [...own.values()].find((o) => o.kind === u.kind && Number(o.factor) === 1);
    const known = Object.keys(TABLE).find((k) => k.toLowerCase() === u.kind.toLowerCase() && !TABLE[k].each);
    const base = mine ? mine.name : known ? (TABLE[known].units.find((row) => row[0] === "1") || [])[1] : null;
    return base && base !== u.name ? `${path}, written in this repository. 1 ${u.name} = ${u.factor} ${base}.` : `${path}, written in this repository.`;
  }
  if (u.kind === "Currency") return `${path}. It converts to no other currency.`;
  const base = (TABLE[u.kind].units.find((row) => row[0] === "1") || [])[1];
  return base && base !== u.name ? `${path}. 1 ${u.name} = ${u.factor} ${base}.` : `${path}.`;
}

module.exports = {
  TABLE, builtIn, wordsOf, isUnit, pathOf, describe,
  parseFormat, defineUnits, definedUnits, ownUnit, prefixes, unitsGeneration,
};
