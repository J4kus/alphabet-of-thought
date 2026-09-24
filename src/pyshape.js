// Whether text reads as a Python expression — without running it.
//
// A constraint's bound is Python (`age >=18`, `cap <=@price*1.5`,
// `status ==("draft", "sent")`), but an attribute's name may hold the same
// characters as prose: `speed > none noted` is an attribute called that, not
// `speed` bounded by `none noted`. Nothing may run Python to find out — the
// declaration is read on every keystroke — so the text decides: a bound is
// believed when its brackets and strings close and no two operands stand
// side by side with nothing between them (`none noted`, `18 years`). An
// `@` reference is one operand however many words its name holds.
//
// Pure: no I/O, no requires.

// Python's words that sit between operands, as an operator does.
const KEYWORDS = new Set(["and", "or", "not", "in", "is", "if", "else", "for", "lambda", "async", "await"]);

const isNameChar = (ch) => /[\p{L}\p{N}_]/u.test(ch);
const isIdentStart = (ch) => /[\p{L}_]/u.test(ch);

function readsAsExpression(src) {
  const s = String(src == null ? "" : src).trim();
  if (!s) return false;
  let i = 0;
  let depth = 0;
  let operand = false; // the token just read was an operand
  let pending = true;  // an operand is still owed (at the start, after an operator)
  const take = () => {
    if (operand) return false; // two operands side by side: prose
    operand = true;
    pending = false;
    return true;
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === " ") { i++; continue; }
    if (ch === "'" || ch === "\"") {
      let j = i + 1;
      while (j < s.length && s[j] !== ch) j += s[j] === "\\" ? 2 : 1;
      if (j >= s.length) return false; // an open string
      if (!take()) return false;
      i = j + 1;
      continue;
    }
    if (ch === "@") {
      if (operand) { i++; operand = false; pending = true; continue; } // matrix multiply
      do {
        i++;
        let end = i;
        while (end < s.length) {
          if (isNameChar(s[end])) { end++; continue; }
          if (s[end] !== " ") break;
          // a name may hold spaces, but not a word of Python's own: `@price
          // if …` is the reference `@price` and then the `if`
          const next = /^ +([\p{L}_][\p{L}\p{N}_]*)(?![\p{L}\p{N}_])/u.exec(s.slice(end));
          if (next && KEYWORDS.has(next[1])) break;
          end++;
        }
        while (end > i && s[end - 1] === " ") end--;
        if (end === i) return false;
        i = end;
      } while (s[i] === "@");
      if (!take()) return false;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s[i + 1] || ""))) {
      let j = i;
      while (j < s.length && /[0-9._a-zA-Z]/.test(s[j])) j++;
      if (!take()) return false;
      i = j;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i;
      while (j < s.length && isNameChar(s[j])) j++;
      const word = s.slice(i, j);
      i = j;
      if (KEYWORDS.has(word)) { operand = false; pending = true; continue; }
      // a string prefix glued to its quote (f"…", r'…') is the string's
      if ((s[i] === "'" || s[i] === "\"") && /^[rbfuRBFU]{1,2}$/.test(word)) continue;
      if (!take()) return false;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      // a call or an index straight after an operand, or a new operand
      operand = false;
      pending = true;
      i++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) return false;
      operand = true;
      pending = false;
      i++;
      continue;
    }
    if (ch === ".") { operand = false; pending = true; i++; continue; } // an attribute follows
    if (ch === ",") { operand = false; pending = true; i++; continue; }
    if (ch === ":") { operand = false; pending = true; i++; continue; } // a slice, a dict, a lambda
    // an operator: anything left between two operands
    operand = false;
    pending = true;
    i++;
  }
  return depth === 0 && !pending;
}

module.exports = { readsAsExpression };
