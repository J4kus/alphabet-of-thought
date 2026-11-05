# Alpha features 1.14 — numbers as an analyst writes them, units of measure, and a check that can fail on a number

A per-feature reference for the **1.14.0** batch. It picks up where [features-1.13.md](features-1.13.md) leaves off. Each entry has four parts:

- **Before**: how it worked, or failed, without the feature.
- **What changed**: the feature, plainly.
- **Try it**: what to do in the editor (or the terminal), and what you should see.
- **How it is tested**: the check that holds it.

Run the whole suite with `npm test`: twenty-two plain Node scripts, each printing `PASS`/`FAIL` and exiting non-zero on failure.

The batch has three halves:
- **Numbers:** percent, currencies, brackets, and text that refuses arithmetic.
- **Units:** in a cell, in a formula, on a column through its normal alias, and through pandas.
- **Checks:** `check.js`, the master count in the status bar, and the mistakes that used to pass in silence.

---

## Numbers read the way an analyst writes them

### Before

`30%` read as `30`, so `$100,000` less `30%` was `-2,900,000` with no error. `€100` was text, so `€100` × 2 was `€100€100` and the sum of `€100` and `€200` was `€100€200`. `n/a` × 2 was `n/an/a`, and `€20,000` × -14 an empty value.

### What changed

- `30%` is `0.3`. A cell that says `%` shows its result as a percent.
- `$`, `€`, `£`, `¥` and `R` read as currencies. `(1,000)` is negative.
- Text in arithmetic is a visible error. `1.2M`, `450k`, `1.204,50` and `15/01/2026` stay text and say so.

### Try it

```aot
Deal|list price|discount|net =@list price*(1-@discount)
Acme|$100,000  |30%     |
Kite|€20,000   |15%     |
Bolt|n/a       |10%     |
```

`Acme` computes `$70,000` and `Kite` `€17,000`. `Bolt` says `'n/a' is text, so it can't be multiplied`, and keeps its cell as it was.

### How it is tested

`out/test-units.js`, against the real runtime; `out/test-mistakes.js` holds the brief's whole table of wrong numbers.

---

## Units of measure

### Before

`120 km` was text. Nothing knew a distance over a time was a speed, or that `3 kg + 2 km` was nonsense.

### What changed

Any number followed by one word has a unit, so `46 clients` needs no setup. About 80 units are built in, in a hierarchy (Unit ▸ Length ▸ km, in [`src/units.json`](../src/units.json)), and convert within their kind. A unit multiplies and divides with anything; it adds, subtracts and compares only with what it converts to, and with `0`.

A column takes its unit through its **normal alias**. `distance (km)` needs no new syntax: an alias already types an attribute by the Concept it names, and `km` is a Concept every file has. The file's own Concept of that name wins, and a Concept filed under one called `Unit` is a unit of the file's own.

### Try it

```aot
Trip|distance (km)|time (h)|speed (km/h) =@distance/@time
A   |120          |1.5     |80
B   |75 mi        |1       |120.7008

Summary
    total: =@Trip@distance.sum()
    in miles: mi =@Trip@distance.sum()
    average: =@Trip@speed.mean()
```

`total` computes `240.7008 km`, `in miles` the same in miles, and `average` a speed in km/h. Change `speed (km/h)` to `speed (mph)` and the column recalculates in mph. Hover `(km)` for where it sits in the hierarchy. Write `=@distance + 3` in a cell and it says `write the unit on 3, as in 3 km`.

### How it is tested

`out/test-units.js`: the hierarchy, the alias, reading and writing, literals in formulas, the CSV mirror, the flip, conversion to a cell's unit, and pandas.

---

## Roll-ups and inheritance

### Before

`@Deal@net.sum()` counted only the rows filed directly under `Deal`, so it could give `5` for `87,005` with no error. A default two levels up could not be read, and `@discount cap` beside a `discount` column read `@discount` and left ` cap` to fail.

### What changed

- `@Concept` includes the rows of the kinds beneath it, with a `kind` column. The CSV mirror keeps a row in the CSV of its own kind.
- A value is read from any kind above, the nearest first.
- The longest name wins across a column and a default.

### Try it

```aot
Deal
    net =@list price*(1-@discount)
    Enterprise Deal
        max discount: 35%
        Enterprise Deal|list price|discount|net
        Acme           |$100,000  |30%     |$70,000
    Standard Deal
        max discount: 20%
        Standard Deal|list price|discount|net
        Kite         |$20,000   |15%     |$17,000

Summary
    total: =@Deal@net.sum()
    by kind: =@Deal.groupby("kind")["net"].sum().iloc[0]
```

`total` computes `$87,000`, and `by kind` `$70,000`, the first kind's.

### How it is tested

`out/test-units.js` and `out/test-mistakes.js`.

---

## A check that can fail on a number

### Before

11 of the brief's 18 plausible mistakes passed `verify.js` with no finding at all, among them a stale value in front of a formula, a broken rule and a broken formula. In the editor the plug was corrected in silence, and `V = 0` could stand beside a broken rule.

### What changed

- **`node check.js [file or folder]`** checks every file, every agreement, every formula and every rule, and exits `1` on any problem. It runs the code in those files, so it is for your own files and trusted branches. See [The calculating check](../README.md#the-calculating-check).
- **`verify.js` still runs nothing**, and says what it did not calculate: `12 formulas and 3 rules not calculated here — run check.js`.
- **The status bar** adds violations and calculation into one count, and says when formulas were not calculated.
- **A value a formula replaces says so**, until you edit the cell or close the file.
- **The same Example with two values across files** is rule 22, in lines or a table. **Two numbers on one attribute of one Example** are rule 26.
- **The tools say when row checks stopped** at 200 rows in a file.

Of the 18, 16 are now found as written. Two can't be: a typed total with no formula, and a status of Green against a missed target, because nothing in the file says the numbers should agree. Both are caught once a formula or rule states it.

### Try it

```aot
Sale|amount
North|20000
South|33760

Summary
    total revenue: 60000 =@Sale@amount.sum()
```

`node check.js` says `'60000' is written here, and its formula gives '53,760'` and exits 1. `node verify.js` says `V = 0`, then `1 formula not calculated here — run check.js`.

### How it is tested

`out/test-mistakes.js` is the standing record of the 18 mistakes, including the two that need a stated relationship. `out/test-check.js` holds the exit codes, that nothing is written, and the guards.
