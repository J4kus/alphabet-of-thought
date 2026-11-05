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

// The built-in unit one word names, or null: { name, kind, factor, names }.
function builtIn(word) {
  const w = String(word || "");
  return exact.get(w) || ([...w].length >= 3 ? folded.get(w.toLowerCase()) : null) || null;
}

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
  if (u.kind === "Currency") return `${path}. It converts to no other currency.`;
  const base = (TABLE[u.kind].units.find((row) => row[0] === "1") || [])[1];
  return base && base !== u.name ? `${path}. 1 ${u.name} = ${u.factor} ${base}.` : `${path}.`;
}

module.exports = { TABLE, builtIn, wordsOf, isUnit, pathOf, describe };
