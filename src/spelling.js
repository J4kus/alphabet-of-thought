// Spelling hints for .aot documents: every plain word longer than four
// characters is checked against Hunspell English via nspell — pure JS, so it
// runs inside the editor's Node runtime with no native binaries. Two dialects
// are consulted, British and American (the language's own examples write
// 'colour'), and a word either accepts is correct. Each dialect keeps its own
// nspell instance: merging the two .dic files under one .aff misreads the
// second dialect's affix flags and starts accepting misspellings.
//
// Findings are advisory only — the editor surfaces them as Hint diagnostics,
// never counted in V. Pure apart from reading the bundled dictionaries once.

const fs = require("fs");
const path = require("path");
const nspell = require("nspell");

// "longer than four characters": shorter words are dense in abbreviations
// and codes ('aot', 'vsix', 'utf'), and misspelling them is rare
const MIN_LENGTH = 5;
const MAX_SUGGESTIONS = 3;

let spellers = null;
function load() {
  if (!spellers) {
    const read = (mod) => {
      const base = path.dirname(require.resolve(mod));
      return nspell(
        fs.readFileSync(path.join(base, "index.aff")),
        fs.readFileSync(path.join(base, "index.dic"))
      );
    };
    spellers = [read("dictionary-en-gb"), read("dictionary-en")];
  }
  return spellers;
}

// The language's own vocabulary: words its documentation and lint messages
// use that the general dictionaries don't carry. Checked lowercased.
const BUILT_IN = new Set(["differentia", "differentiae", "univocity", "crosslink", "crosslinks", "crosslinked", "arity"]);

// How many judged words to remember. The verdicts are booleans, so the cap is
// about not growing without bound over a long session rather than about size;
// past it the oldest entry goes, which a Map's insertion order hands over.
const MAX_REMEMBERED = 5000;

// word -> true when some dialect accepts it, false when none does. Vocabulary
// repeats heavily across keystrokes, so each distinct word is judged once.
const verdicts = new Map();
// word -> its suggestions, filled only when something actually asks for them.
const suggested = new Map();

function remember(cache, word, value) {
  if (cache.size >= MAX_REMEMBERED) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(word, value);
  return value;
}

function suggestions(word) {
  const out = [];
  for (const speller of load()) {
    for (const s of speller.suggest(word)) {
      if (!out.includes(s)) out.push(s);
      if (out.length === MAX_SUGGESTIONS) return out;
    }
  }
  return out;
}

// What a misspelt word might have been, for the Quick Fix that offers to
// replace it. This is the expensive half of spelling and it is deliberately
// *not* on the typing path: nspell's suggest() walks the dictionary by edit
// distance, twice (both dialects), which costs milliseconds for a near miss
// and over half a second for a word with no near neighbours at all. Every
// half-typed word is a misspelling, so calling it as the hints are computed
// spent that on every keystroke — 3 seconds to open a file, ~150 ms for each
// new word typed. The hint only needs to know *whether* a word is known,
// which correct() answers for free; the candidates are worth computing when
// the writer opens the lightbulb and asks, for the one word they asked about.
function suggestionsFor(word) {
  const hit = suggested.get(word);
  if (hit !== undefined) return hit;
  return remember(suggested, word, suggestions(word));
}

// Whether some dialect knows the word. Hunspell accepts the Capitalised form
// of a lowercase entry but not the reverse, so 'december' would fail while
// 'December' passes; the Capitalised variant is tried too before a lowercase
// word is called wrong.
function known(word) {
  const hit = verdicts.get(word);
  if (hit !== undefined) return hit;
  const [gb, us] = load();
  const cap = word[0] >= "a" && word[0] <= "z" ? word[0].toUpperCase() + word.slice(1) : null;
  return remember(verdicts, word,
    !!(gb.correct(word) || us.correct(word) || (cap && (gb.correct(cap) || us.correct(cap)))));
}

// Words are read out of whitespace/pipe-separated chunks, then judged only
// when what remains after peeling surrounding punctuation is a plain
// lowercase or Capitalised run of letters (an apostrophe part allowed:
// "doesn't", "Child's"). ALLCAPS, CamelCase, digits, paths, URLs and cell
// formulas all fail that shape — they are names or code, not prose.
const LEAD = /^[("'`\[{]+/;
const TRAIL = /[)"'`\]}.,:;!?]+$/;
const PLAIN = /^[A-Za-z][a-z]*(?:'[a-z]+)?$/;

// Spelling hints over a document's text. Returns { line, message, startCol,
// endCol } findings (1-based lines, 0-based columns), one per occurrence.
// extraWords is the user's own vocabulary (aot.acceptedWords), lowercased.
function check(text, extraWords) {
  load();
  const hints = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    for (const m of raw.matchAll(/[^\s|]+/g)) {
      const lead = (m[0].match(LEAD) || [""])[0].length;
      const word = m[0].slice(lead).replace(TRAIL, "");
      if (word.length < MIN_LENGTH || !PLAIN.test(word)) continue;
      const low = word.toLowerCase();
      if (BUILT_IN.has(low) || (extraWords && extraWords.has(low))) continue;
      if (known(word)) continue;
      hints.push({
        line: i + 1,
        startCol: m.index + lead,
        endCol: m.index + lead + word.length,
        // the message stays the wire contract the code actions parse; the
        // candidates are fetched by suggestionsFor when the lightbulb asks
        message: `'${word}' is not in the dictionary — check the spelling`,
      });
    }
  });
  return hints;
}

module.exports = { check, suggestionsFor, MIN_LENGTH };
