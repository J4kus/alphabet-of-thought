// When a file calculates, and how a result lands in it (src/recalc.js): typing
// waits for the cursor to leave its cell, anything else commits, a new commit
// cancels the pass under way, and an edit touches only what it changes.
//
// Plain Node script, no framework — run with: node out/test-recalc.js
const { createScheduler, isTyping, lineEdits, minimalEdits } = require("../src/recalc");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (line, cell) => ({ line, cell });
const rng = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });

(async () => {
  // --- what is typing -------------------------------------------------------
  check("typing: characters inside one line", isTyping([{ range: rng(1, 2, 1, 2), text: "a" }]));
  check("typing: several cursors typing at once", isTyping([{ range: rng(1, 2, 1, 2), text: "a" }, { range: rng(2, 2, 2, 2), text: "a" }]));
  check("not typing: Enter", !isTyping([{ range: rng(1, 2, 1, 2), text: "\n    " }]));
  check("not typing: a paste of lines", !isTyping([{ range: rng(1, 2, 1, 2), text: "a\nb" }]));
  check("not typing: a selection across lines deleted", !isTyping([{ range: rng(1, 2, 3, 0), text: "" }]));
  check("not typing: no change at all", !isTyping([]));

  // --- when a pass runs -----------------------------------------------------
  {
    const runs = [];
    const s = createScheduler({ delay: 1, run: (reasons) => { runs.push([...reasons]); } });
    s.typed([at(3, 1)]);
    await wait(15);
    check("typing in a cell runs nothing, however long you pause", runs.length === 0 && s.isWaiting);
    check("moving within the cell runs nothing", s.moved([at(3, 1)]) === false && !runs.length);
    check("leaving the cell commits", s.moved([at(3, 2)]) === true);
    await wait(15);
    check("...and one pass runs", runs.length === 1 && runs[0].includes("left") && !s.isWaiting);
    check("moving about with nothing typed runs nothing", s.moved([at(9, 0)]) === false);
    await wait(15);
    check("...still one pass", runs.length === 1);
    s.typed([at(3, 1), at(4, 1)]);
    check("several cursors: one still in a typed cell keeps it waiting", s.moved([at(4, 1), at(9, 0)]) === false);
    check("several cursors: all gone, it commits", s.moved([at(8, 0), at(9, 0)]) === true);
    await wait(15);
    check("...a second pass", runs.length === 2);
    s.dispose();
  }

  // --- a burst is one pass, and reasons gather ------------------------------
  {
    const runs = [];
    const s = createScheduler({ delay: 5, run: (reasons) => { runs.push([...reasons]); } });
    s.commit("edit");
    s.commit("save");
    s.commit("edit");
    await wait(25);
    check("a burst of commits is one pass, with every reason", runs.length === 1 && runs[0].includes("edit") && runs[0].includes("save"));
    s.typed([at(1, 0)]);
    s.commit("save");
    check("a commit takes in what was waiting", !s.isWaiting);
    s.dispose();
  }

  // --- a commit while a pass runs cancels it, and one more pass follows ------
  {
    const runs = [];
    let release;
    let seenCancelled = null;
    const s = createScheduler({
      delay: 1,
      run: async (reasons, isCancelled) => {
        runs.push([...reasons]);
        if (runs.length === 1) {
          await new Promise((r) => { release = r; });
          seenCancelled = isCancelled();
        }
      },
    });
    s.commit("edit");
    await wait(10);
    check("a pass is under way", runs.length === 1 && s.isRunning);
    s.commit("left");
    await wait(10);
    check("a new commit runs nothing beside it: one pass at a time", runs.length === 1);
    release();
    await wait(15);
    check("the pass under way was told it is cancelled", seenCancelled === true);
    check("the last word runs after it", runs.length === 2 && runs[1].includes("left") && !s.isRunning);
    s.dispose();
  }

  // --- a failed pass stops nothing, and dispose ends it ----------------------
  {
    let n = 0;
    const s = createScheduler({ delay: 1, run: () => { n++; throw new Error("broken"); } });
    s.commit("edit");
    await wait(10);
    s.commit("edit");
    await wait(10);
    check("a pass that throws does not stop the next", n === 2 && !s.isRunning);
    s.commit("edit");
    s.dispose();
    await wait(10);
    check("nothing runs after dispose", n === 2);
  }

  // --- an edit touches only what it changes ----------------------------------
  {
    const one = (before, after) => lineEdits(before, after, 0);
    check("edit: nothing changed, nothing to do", !one("a|b", "a|b").length);
    const widened = one("Bus|10|x", "Bus|100|x");
    check("edit: one cell's change is that cell's", widened.length === 1 && widened[0].fromCh === 6 && widened[0].toCh === 6 && widened[0].text === "0");
    const two = one("Bus|10 |x   |y", "Bus|12 |zzz |y");
    check("edit: two cells' changes are two edits, so a cursor in neither is in neither",
      two.length === 2 && two[0].fromCh === 5 && two[1].fromCh === 8);
    const pipes = one("Bus|10", "Bus|10|new");
    check("edit: a line gaining a cell is one narrowed edit", pipes.length === 1 && pipes[0].fromCh === 6 && pipes[0].text === "|new");

    const apply = (before, edits) => {
      let text = before.join("\n");
      const off = (l, c) => before.slice(0, l).reduce((n, s) => n + s.length + 1, 0) + c;
      for (const e of [...edits].sort((a, b) => off(b.fromLine, b.fromCh) - off(a.fromLine, a.fromCh))) {
        text = text.slice(0, off(e.fromLine, e.fromCh)) + e.text + text.slice(off(e.toLine, e.toCh));
      }
      return text.split("\n");
    };
    const round = (name, before, after) => {
      const edits = minimalEdits(before, after);
      check(`edits: ${name}`, apply(before, edits).join("\n") === after.join("\n"));
      return edits;
    };
    check("edits: nothing changed", !minimalEdits(["a"], ["a"]).length);
    const values = round("values changing keep every other line", ["x", "T|1", "y", "U|2", "z"], ["x", "T|5", "y", "U|6", "z"]);
    check("edits: each changed line has its own edit, none spanning a line between", values.length === 2 && values.every((e) => e.fromLine === e.toLine));
    round("a table growing", ["x", "T|1", "z"], ["x", "T|1", "U|2", "V|3", "z"]);
    round("a table shrinking", ["x", "T|1", "U|2", "z"], ["x", "T|1", "z"]);
    round("lines added at the end", ["x"], ["x", "y", "z"]);
    round("lines added at the start", ["x"], ["y", "z", "x"]);
    round("the last lines going", ["x", "y", "z"], ["x"]);
    round("the first lines going", ["x", "y", "z"], ["z"]);
    round("everything going", ["x", "y"], [""]);
    round("one span replaced by another of a different length", ["a", "b", "c", "d"], ["a", "x", "y", "z", "w", "d"]);
  }

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
