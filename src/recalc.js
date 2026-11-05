// When a file's formulas calculate, and how what they compute lands in it.
//
// A spreadsheet recalculates when a cell is committed: Enter, Tab, an arrow, a
// click elsewhere. While you type in a cell nothing runs, so a half-written
// number never reaches a formula. A text editor has no commit key, but it has
// the same moment, the one hold.js already goes by: you say you are done by
// moving on. So there is no timer here.
//
//   typing in a cell            waits, for as long as a cursor stands in it
//   leaving the cell            calculates
//   anything that is no typing  calculates straight away: a paste, a fill, a
//                               deleted row, an undo, a CSV arriving, a save
//
// A new commit while a pass is running marks that pass cancelled, which it
// notices between batches; a new pass then plans again from what the file says.
// So however fast the writing goes there is one pass at a time and the last one
// sees the last word.
//
// Pure: no vscode, no I/O. The extension says what happened and what a pass is.

// A scheduler for one document. `run(reasons, isCancelled)` is one pass, a
// promise of anything; it may answer { again: true } to be run once more. `delay`
// is how long a burst of commits is gathered for, in milliseconds.
function createScheduler({ run, delay = 30, timers = { set: setTimeout, clear: clearTimeout } }) {
  const waiting = new Map(); // "line:cell" -> { line, cell }
  let timer = null;
  let running = false;
  let cancelled = false;
  let again = false;
  let reasons = new Set();
  let disposed = false;

  const start = () => {
    timer = null;
    if (disposed) return;
    if (running) {
      again = true;
      cancelled = true;
      return;
    }
    const these = reasons;
    reasons = new Set();
    running = true;
    cancelled = false;
    again = false;
    let answer;
    try {
      answer = Promise.resolve(run(these, () => cancelled));
    } catch (e) {
      answer = Promise.reject(e);
    }
    answer.then((r) => r, () => null).then((r) => {
      running = false;
      if (disposed) return;
      if (again || (r && r.again)) {
        if (r && r.again && !reasons.size) these.forEach((x) => reasons.add(x));
        arm(delay);
      }
    });
  };

  const arm = (ms) => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(start, ms);
  };

  const self = {
    // Text typed into these cells ({ line, cell }, cell -1 off a table): it
    // waits until no cursor stands in any of them.
    typed(cells) {
      for (const c of cells) waiting.set(`${c.line}:${c.cell}`, c);
    },
    // The cursors now ({ line, cell }). Leaving every waiting cell commits.
    moved(cursors) {
      if (!waiting.size) return false;
      const here = new Set(cursors.map((c) => `${c.line}:${c.cell}`));
      for (const key of waiting.keys()) if (here.has(key)) return false;
      self.commit("left");
      return true;
    },
    // Calculate now, for this reason. Whatever was waiting is part of it.
    commit(reason) {
      waiting.clear();
      reasons.add(reason || "edit");
      if (running) cancelled = true;
      arm(delay);
    },
    // Whether a typed cell is still waiting for its cursor to leave.
    get isWaiting() { return waiting.size > 0; },
    get isRunning() { return running; },
    dispose() {
      disposed = true;
      if (timer !== null) timers.clear(timer);
      timer = null;
      waiting.clear();
    },
  };
  return self;
}

// An edit that is typing, as a text change says it: inside one line, adding no
// line. Anything else (a paste of lines, Enter, a table redrawn) commits at once.
const isTyping = (changes) => changes.length > 0 && changes.every((c) =>
  c.range.start.line === c.range.end.line && !/[\r\n]/.test(c.text));

// --- how a result lands ------------------------------------------------------
// A result reaches a file someone may be typing in, so it must touch only what
// it changes: a cursor outside an edit stays where it is, and one to its right
// moves with the text. Replacing a whole line would drop the cursor at its end.

// The edit of one piece of a line, narrowed to the characters that differ.
function narrowed(before, after, line, offset) {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return {
    fromLine: line, fromCh: offset + p, toLine: line, toCh: offset + before.length - s,
    text: after.slice(p, after.length - s),
  };
}

// The edits turning one line into another. A table's line is narrowed cell by
// cell, so a value changing and a column widening are separate edits, and a
// cursor in another cell of the row is in neither.
function lineEdits(before, after, line) {
  if (before === after) return [];
  const a = before.split("|"), b = after.split("|");
  if (a.length !== b.length) return [narrowed(before, after, line, 0)];
  const out = [];
  let offset = 0;
  a.forEach((piece, k) => {
    if (piece !== b[k]) out.push(narrowed(piece, b[k], line, offset));
    offset += piece.length + 1;
  });
  return out;
}

// The smallest edits turning these lines into those: [{ fromLine, fromCh, toLine,
// toCh, text }], the text's lines joined with "\n". Where the line count holds
// (values changing, columns widening) each line has edits of its own. Where it
// does not (a table Python rewrote) what changed is one span.
function minimalEdits(before, after) {
  let a = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  if (a === before.length && a === after.length) return [];
  let b = 0;
  while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  const was = before.length - a - b, now = after.length - a - b;
  if (was === now) {
    const out = [];
    for (let k = 0; k < was; k++) out.push(...lineEdits(before[a + k], after[a + k], a + k));
    return out;
  }
  const middle = after.slice(a, a + now);
  if (!was) {
    // a pure insertion before line `a`, or after the last line
    if (a < before.length) return [{ fromLine: a, fromCh: 0, toLine: a, toCh: 0, text: middle.join("\n") + "\n" }];
    const end = before.length - 1;
    return [{ fromLine: end, fromCh: before[end].length, toLine: end, toCh: before[end].length, text: "\n" + middle.join("\n") }];
  }
  const to = a + was - 1;
  if (!now) {
    // lines going, with a line break of their own
    if (to + 1 < before.length) return [{ fromLine: a, fromCh: 0, toLine: to + 1, toCh: 0, text: "" }];
    if (a > 0) return [{ fromLine: a - 1, fromCh: before[a - 1].length, toLine: to, toCh: before[to].length, text: "" }];
    return [{ fromLine: 0, fromCh: 0, toLine: to, toCh: before[to].length, text: "" }];
  }
  return [{ fromLine: a, fromCh: 0, toLine: to, toCh: before[to].length, text: middle.join("\n") }];
}

module.exports = { createScheduler, isTyping, lineEdits, minimalEdits };
