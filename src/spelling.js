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

// word -> null when some dialect accepts it, else its cached suggestions.
// Vocabulary repeats heavily across keystrokes, so the cache means each
// distinct word pays for correct() (and the costly suggest()) exactly once.
const verdicts = new Map();

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
// extraWords is the user's own vocabulary (aot.spellingWords), lowercased.
function check(text, extraWords) {
  const [gb, us] = load();
  const hints = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    for (const m of raw.matchAll(/[^\s|]+/g)) {
      const lead = (m[0].match(LEAD) || [""])[0].length;
      const word = m[0].slice(lead).replace(TRAIL, "");
      if (word.length < MIN_LENGTH || !PLAIN.test(word)) continue;
      const low = word.toLowerCase();
      if (BUILT_IN.has(low) || (extraWords && extraWords.has(low))) continue;
      let verdict = verdicts.get(word);
      if (verdict === undefined) {
        verdict = gb.correct(word) || us.correct(word) ? null : suggestions(word);
        verdicts.set(word, verdict);
      }
      if (verdict === null) continue;
      hints.push({
        line: i + 1,
        startCol: m.index + lead,
        endCol: m.index + lead + word.length,
        message: verdict.length
          ? `'${word}' is not in the dictionary — did you mean ${verdict.map((s) => `'${s}'`).join(", ")}?`
          : `'${word}' is not in the dictionary — check the spelling`,
      });
    }
  });
  return hints;
}

module.exports = { check, MIN_LENGTH };
