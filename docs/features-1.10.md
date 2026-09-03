# Alpha features 1.10 — a Concept written in two files is one idea

A per-feature reference for the **1.10.0** batch. It picks up where [features-1.8.md](features-1.8.md) leaves off. Each entry has four parts:

- **Before** — how it worked (or failed) without the feature. Worth reading: most of these exist because the old behaviour bit someone.
- **What changed** — the feature, plainly.
- **Write** — snippets you can paste into a `.aot` file: the case that works, and the neighbouring case that does **not**, with why.
- **How it is tested** — the check that holds it, and what that check actually does.

Every snippet uses the **current** syntax, so it runs as written. The file **verifies** when its violation total **V = 0**: errors count toward V, warnings and hints never do.

Run the whole suite with `npm test` (614 checks across ten plain Node scripts — no framework, each prints `PASS`/`FAIL` and exits non-zero on failure).

The batch has one idea behind it: **a repository is not a bag of unrelated files, and a name that appears in two of them is one idea seen twice.** So Alpha stops asking you to pick a winner and starts keeping the two in step — closing every gap that can be closed without a decision, and reserving the errors for the two disagreements only a person can settle.

---

## The extension is a partial sample, not a duplicate

### Before

One warning covered every case of a name appearing twice, and one Quick Fix "resolved" it:

```
Concept 'Jakus' is also defined in bank recon.aot:2 — one name should mean one
thing across the repo; qualify one, or make them the same idea in a shared file.
Differs: Examples only there: 'All Transactions Are Reconciled', …
```

`Reconcile: keep this definition` merged what the other file had **by name** that this one lacked, then deleted the other file's whole subtree and saved both. Anything present on both sides by name but different underneath went with it — an Example's attributes, a value the two set differently, a table column the kept grid had no header for. The most common real case was the worst served: two files each listing the motivations *their own subject* needed. Nothing was in conflict, and reconciling threw four of the five Examples away.

### What changed

A Concept has two halves and they behave differently across files:

| | What it is | Across files |
|---|---|---|
| **Intension** | attributes, values, and the kind it is filed under | **must agree** — and save makes it agree |
| **Extension** | the Examples it lists | **a partial sample.** The truth is the union; differences are never a conflict |

Every occurrence is a **peer**: no file owns a Concept, and none is exempt from saying it is partial. `...` keeps exactly the meaning it already has in [subsumption.js](../src/subsumption.js) (an open, ⊑ definition), [fca.js](../src/fca.js) (this side intentionally incomplete) and [linter.js](../src/linter.js) (the rest is still to come) — there is no second sense of it, and no new syntax.

### Write

Two files, one person, no diagnostic:

```aot
# monthly close.aot
- Motivation
    Jakus
        role: financial controller
        - Do Monthly Processing (Monthly Work Currently Done By Jaco)
        ... 4 more in bank recon.aot:2
```
```aot
# bank recon.aot
- Motivation
    Jakus
        role: financial controller
        - All Transactions Are Reconciled
        - Transactions Are Reconciled Correctly
        - Incorrectly Reconciled Transactions Are Trivially Flagged (un-allocated expense)
        - Future Transactions Are Reconciled With Automated Banking Rules
        ... 1 more in monthly close.aot:2
```

`role: financial controller` was written in **one** of those files. The `...` lines were written in neither. Both arrived on the first save.

The neighbouring case that does **not** pass — the same name meaning two things:

```aot
# a.aot                      # b.aot
Team                         Team
    Jakus                        Jakus
        role: analyst                role: bookkeeper
```

Error on **both** sides, at both `role:` lines, each carrying the other as a clickable related location. Nothing is auto-resolved: only you know which is right.

### How it is tested

`out/test-repo.js` runs the real case as `JAKUS` and asserts the whole shape of it: `a split extension is no error at all` (both directions), `no peer's Example is copied in — the extension stays split`, and `this file's own Example is untouched`. The old failure mode has its own test under `nothing you wrote is ever deleted`, built from the exact `- Beetle`-on-both-sides shape the retired `mergeConceptOps` used to eat: it checks the shared Example keeps `year: 1938`, *gains* the peer's `colour: blue`, and that `no op deletes a line anyone wrote`.

---

## Saving a file makes it agree with the repo

### Before

Nothing propagated. If `bank recon.aot` said `role: financial controller` and `monthly close.aot` did not, a reader of the second file simply never learned it, and the only tool that would have told them also deleted a file.

### What changed

`repo.reconcileOps` runs on save, additively. It writes in what a peer declares and this occurrence does not have **in force**, including onto a same-named Example, and as a new column when the occurrence is written as a table. It never emits a deletion of anything you wrote.

**Pull, never push.** Saving `monthly close.aot` writes to `monthly close.aot` and nothing else, so peers converge as you save each of them. Files that were never open catch up with `AOT: Reconcile Concepts Across Files` or `node verify.js --workspace --reconcile`.

Two things it deliberately does not do:

- **Absence is not disagreement.** A file silent about `role` is not corrected *away* from anything — it is filled in.
- **Inherited attributes are not copied.** An attribute a peer merely inherits from its own ancestors is already in force here too; writing it in as a literal line would drag that peer's ancestry into this file.

### Write

Works — the bare attribute takes the definite value, because the valued line is strictly more definite:

```aot
# a.aot                # b.aot
Team                   Team
    Jakus                  Jakus
        role                   role: analyst
```

After saving `a.aot`: `role: analyst`. Not a clash, not a warning — a fill.

Does **not** propagate, and should not:

```aot
# a.aot                        # b.aot
Team                           Team
    role: analyst                  Jakus
    Jakus                              role: analyst
        - Close The Books
```

`a.aot`'s `Jakus` already has `role` in force by inheritance from `Team`. Nothing is written.

### How it is tested

`an attribute only the peer declares is written in` and `it lands above the Examples, so the definition still reads first` cover the ordinary case; `a bare attribute takes the peer's value rather than counting as a clash` and `an inherited attribute is not copied in as a declared one` cover the two edges above. `the peer that said more gains nothing back` holds the asymmetry — filling one side must not push anything back at the other. `a second reconcile is a no-op` holds the fixpoint, which is what makes it safe to run on every save and in CI.

---

## One `...` line says where the rest of the Examples are

### Before

There was no way to say "this listing is partial *because the rest is in another file*". A bare `...` said incomplete; it could not say where.

### What changed

Because save fills the attributes in everywhere, and a surviving disagreement is an error with its own squiggle, the `...` carries the one thing that cannot be filled in:

```
... 4 more in bank recon.aot:14
... 7 more in bank recon.aot:14, payroll.aot:9
... 11 more in bank recon.aot:14, payroll.aot:9, vat return.aot:22, …
```

Total first, then `file:line` — the form this codebase already used to point across files, and the one every editor makes clickable. Peers sort by filename so ordering never flips; past three the line stops growing and the rest moves to the hover, which lists the whole extension grouped by file with every Example a link.

A `...` **you** wrote is never touched. Only the maintained shape (`N more in …`) is rewritten, so a `... still to do` sits beside it, untouched, and the two never interfere.

### Write

Works — the maintained line is corrected in place, not doubled, and yours survives:

```aot
Team
    Jakus
        - One
        ... still to do
        ... 9 more in bank.aot:2      <- wrong; rewritten to '... 1 more in bank.aot:2'
```

Does **not** get a line at all — a peer that adds no Example makes this listing complete, so there is nothing to declare:

```aot
# a.aot                # b.aot
Team                   Team
    Jakus                  Jakus
        - One                  - One
```

And a maintained line whose peers have stopped carrying anything is **removed** — the only deletion in the whole feature, and it is the tool taking back its own line.

Does **not** get a line either — a Concept written as a **standalone table**:

```aot
- Motivation
    Jakus                 |role
    Do Monthly Processing |
```

The first header cell *is* the Concept, so `Jakus` and its rows sit at the same depth and there is no depth at which a Map can be its child — a line one level in attaches to the last **row**. Writing one there anyway is what made such a file collect a fresh `...` on every single save: the next pass looked for the note among the Concept's children, found nothing, and wrote another. Give the Concept its own line above the grid (the merge form) and the slot is back:

```aot
- Motivation
    Jakus
        Jakus                 |role
        Do Monthly Processing |
        ... 1 more in bank recon.aot:2
```

Any stray a pre-fix save left under a row is cleared the next time the file is reconciled — those are the tool's own lines to take back.

### How it is tested

`the total comes first and the files follow, filename-sorted` and `past three peers the line stops growing and ends in an ellipsis` pin the format exactly, as literal string equality rather than a loose match. `a hand-written Map survives untouched beside the maintained line`, `a stale maintained line is corrected in place` (asserting exactly one maintained line survives, so a rewrite can never double it), `a maintained line with nothing left to say is removed` and `removing it is the only deletion, and it is the tool's own line` hold the rest. `noteSpans` has its own block checking the columns the `DocumentLinkProvider` hangs each `file:line` link on, including that a hand-written Map yields none.

---

## Two contradictions, counted in `V`

### Before

A cross-file difference was a **warning**, never counted in `V`, on the theory that a repo may hold independent models. That made a genuine equivocation — one name, two meanings — cost nothing, while the fix that "resolved" it destroyed data.

### What changed

Two new errors, both reported on **every** side at once:

| # | Rule | What triggers it |
|---|------|------------------|
| 22 | **Contradicted value** | The same Concept carries two values for one attribute across files |
| 23 | **Contradicted kind** | The same Concept is filed under two different kinds |

Rule 23 compares only the **nearest** named ancestor: that is what the placement directly asserts, while anything further up is how each file happens to nest its own subject. A Concept at the top of one file contradicts nothing — that is silence, which this module never reads as disagreement.

`V` becomes "the file's violations, given the repo it sits in". That is honest because a repo error is always reported on both sides at the lines that disagree, never inferred from a file you cannot see. A file linted alone — outside a workspace, or `lint(text, rootName)` with no fourth argument — is judged entirely on its own terms, so every pre-existing call site and test is unchanged.

### Write

Rule 22, with the fix that settles it:

```aot
# a.aot                # b.aot
Team                   Team
    Jakus                  Jakus
        role: analyst          role: bookkeeper
```

> `'Jakus' sets 'role' to 'analyst' here but 'bookkeeper' in b.aot:3 — one name must mean one thing…`

Lightbulb: **Set 'role' to 'analyst' everywhere** / **Set 'role' to 'bookkeeper' everywhere**. Either rewrites every file in the repo.

Rule 23, and the case that is **not** it:

```aot
# a.aot                # b.aot           # c.aot
- Motivation           Team              Jakus
    Jakus                  Jakus
```

`a.aot` and `b.aot` contradict — `Motivation` against `Team`. `c.aot` contradicts neither: it says nothing about the kind.

### How it is tested

`one attribute with two values errors`, `the error names both values and where the other is`, `it errors on the other side too, pointing back`, and `a contradiction is never auto-resolved` — that last one matters most, since the whole point is that save must *not* guess. `one Concept under two kinds errors` and `top level beside a filed one is silence, not a clash` cover rule 23 and its exclusion. A separate block drives `lint` itself both ways: `a file linted on its own is judged on its own terms`, `given the repo, a contradiction is an error counted in V`, `the error carries the other file as related information`, and `a split extension leaves V exactly where it was`.

---

## The command line

`node verify.js --workspace [dir]` lists every Concept written in more than one `.aot` and reports both sides of every contradiction, **exiting `1`** when there is one — so a pre-commit hook or CI job can gate on it. `--reconcile` writes the agreement in first, then checks what is now on disk rather than what was:

```
$ node verify.js --workspace examples --reconcile
reconciled examples\bank recon.aot (2 edits)
reconciled examples\monthly close.aot (1 edit)

2 files reconciled

Concept 'Jakus' is written in 2 places:
  examples\bank recon.aot:2
  examples\monthly close.aot:2

14 files scanned, 1 name written in more than one, 0 contradictions
$ echo $?
0
```

Run it twice and the second run prints `every shared Concept was already in step`. Both example files still verify at `V = 0` afterwards, which is the conformance check for this feature.

---

## What was removed

- `aot.reconcileConcept`, the command and its Quick Fix — the merge-then-delete path in full.
- `derive.mergeConceptOps`, `derive.diffConcepts`, `derive.conceptDiffClause`. `repo.js` compares intensions with a model that distinguishes a bare attribute from a valued one and reads inheritance properly, which the old `diffConcepts` did neither of; keeping a second, weaker notion of sameness beside it would have been the bug waiting to happen. `derive.headerColName` is now exported, and `lastLineOf` is unchanged.
- The cross-file duplicate **warning**. What it used to report is now either closed on save or raised as an error.
