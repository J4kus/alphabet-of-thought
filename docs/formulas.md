# Formulas

[Back to the README](../README.md)

A value may be **derived** rather than typed, and what derives it is **Python**, written behind `=` after the value it computes. What Python produces lands in the file as ordinary text: a value in front of its derivation, a table where a Concept stood, or a picture or long text in `aot.files` with its path as the value. An attribute's **constraint** is Python too, so a bound can say anything Python can. When you have finished writing derivations and want the data back, `Ctrl+Shift+`` [parks every derivation](#parking-the-derivations) out of the file, and the same key puts them back.

```aot
Sales Report
    tax rate: 0.2
    raw: <DataFrame 1,204 rows × 4 cols> =load()
    revenue: 53,760 =@Sales.amount.sum()
    vat: 10,752 =@revenue*@tax rate
    best: Q2 =@Sales.amount.idxmax()
    chart: aot.files/Sales Report.chart.png =plot(@Sales)
    Sales =by_month(@raw)|month  |amount
    P1                   |2026-01|15,000
    Q1                   |2026-01|18,060
    Q2                   |2026-04|20,700
```

Before its first run, the last Concept was the line `Sales =by_month(@raw)`. The run made that line the header of the table its Python returned.

**A file calculates the way a spreadsheet does**: change a number, move on, and every total is right (see [Running](#running)). There is no key to remember. Formulas are **off until you turn them on**: the first one you write offers to, in one click (see [Trust](trust.md)).

*The spreadsheet formula language is gone.* It covered `sum()`, `xlookup()`, backtick text and `or()`, and recomputed on every keystroke. Python says everything it said, and one language behind one `=` is the simpler rule. A formula left in a file stays as text until it runs, and then Python says on its line what it makes of it. Backtick text does not parse, and `sum(@price)` is Python's `sum` over one value, which fails. Rewrite such a formula as Python: `"text"` for `` `text` ``, `@Order@price.sum()` for a column's total, `("draft", "sent")` for `or(`draft`, `sent`)`.

## Where it goes

- **On a value**, as in `total: =load()`, or **in a grid cell**, as in `|=math.prod([@width, @height])`, it computes the value in front of it.
  - **A row may carry several**, one per cell, side by side. A `|` inside a cell's brackets or strings belongs to its Python, as in `|=",".join(@tags)|=len("a|b")`; a cell whose Python is still open reads every pipe as a divider, so the row stays a row.
  - **A column every row derives alike is a calculated column.** The lightbulb on such a cell offers **Define 'vat' for the whole column**, which moves the derivation onto the header as `vat =@price*0.2` and leaves each cell its value alone (see [`=` naming one value defines](#constraints)). Two formula columns then read as plain numbers.
- **On a Concept line**, as in `Sales =by_month(@raw)`, it writes the Concept's **table**. The derivation can return a DataFrame, a list of dicts, or `aot.grid(header, rows)`. **The table is the Concept.** The run turns the Concept's line into the table's header, with the Concept and its derivation in the first cell (`Sales =by_month(@raw)|month|amount`). The rows stand at the Concept's own indent. The table names its Concept in its first cell; it never sits beneath the Concept repeating its name.
  - **Python owns the rows outright.** Each run replaces them, including a row typed into the table, and removes the Concept's `- ` Examples too.
  - **The rows are the Concept's Examples, numbered `1`, `2`, `3` …** Every column of the frame is a column of the table, and an index that means something (a groupby's months) becomes the first column.
  - **A column named after the Concept names the Examples instead.** For example, a `quarter` column under `Quarter` supplies the Example names, and it is not written as a column. This does not happen when two rows would share a name or one would have none; then the rows are numbered and the column stays. `aot.grid(header, rows)` names the rows directly.
  - **Columns are written the language's way:** lowercased, with `_` as a space, since a capitalised column is an error.
  - **The name column is as wide as the derivation** until it is [parked](#parking-the-derivations).
  - **Pipes in the derivation:** a `|` inside the derivation's brackets or strings belongs to the Python. One outside every bracket divides the header, so wrap it, as in `Flags =(a() | b())`.
  - **What a Concept states for itself stays, [one level under the table](tables.md).** A table written beneath its Concept's line becomes the header on its next run. The one exception is a derivation a header cell cannot hold, as `Sales =frame() # it's`, whose quote would swallow the divider after it: it keeps its line, with the table beneath it.
- **On a line of its own**, as in `=load_all()`, with nothing before the `=`, it writes **several Concepts** at once. It returns its tables by name — a dict, `{"Sales": df, "Region": rows}`, or a list of `aot.grid(header, rows)`, each naming its Concept in its header's first cell — and each is written as that Concept's table:
  ```aot
  =load_all()
  Sales|month  |amount
  1    |2026-01|15,000

  Region|code
  1     |EU
  ```
  - **A new name** is written as a table at the line's own indent, directly beneath it (after the tables it already wrote), so a bare line at the top of a file writes top-level Concepts, and one under a Concept writes Concepts filed under it.
  - **A name the file already has hooks into that Concept**: its rows are replaced where it stands, exactly as its own derivation would write them. One with a derivation of its own (`Plan =p()`) is left to it. That is no failure — the line ran and wrote the rest, and its inlay says `'Plan' left to its own formula` — but one Concept returned from two places is a warning on the line: keep one.
  - **Names are read as the language writes a Concept**: `_` as a space and the first letter capitalised, so `{"sales_report": df}` writes `Sales report`.
  - **Nothing is ever deleted.** A Concept it no longer returns stays, and its inlay says `'Old' no longer written`.
  - **`@Sales` elsewhere reads the live table** the line's Python made, and runs after it, as a Concept's own derivation is read, and is right the first time. The rows the line wrote are tinted as Python's.
  - **The line is no idea of the model's**, so it is no node: the linter reads past it. A lone `=` is an error, and so is a bound with no attribute in front of it (`==("a", "b")`). A pipe on the line is its Python's.
- **One line, one expression.** Statements, loops and `def`s live in a Python file. That can be **`aot.files/<file>.py`**, the file's *sidecar*, whose public names are in every derivation's scope, or [any other Python file of the repository](#the-repositorys-python). It is ordinary Python, with ordinary tooling.
- **On a bare attribute** it is a [definition](#constraints), not a value: `vat =@price*0.2` says what every value of `vat` is. A tail that does not read as Python (`note = some words`) defines nothing and is an error; to make it the value's own derivation, add the colon. Not in a `...` Map either.
- **A value may hold a literal `=`** by doubling it: `note: a == b` is the value `a = b`, not a derivation of `a`. Only an `=` where a derivation could open — at the start of the value or after a space — needs it, and there any run is read one shorter, so `a === b` is the value `a == b`. One inside a word (`a=b`) was never a derivation. The value is read shorter everywhere, while the line keeps what was typed through every rewrite.

## `@` references

`@` names things **by name**, as a spreadsheet's references do. It is resolved **before Python sees the source**, and each reference arrives as a typed Python value:

| Reference | Names | Arrives as |
|-----------|-------|-----------|
| `@price`, `@basket size` | The same Example's (or row's) attribute. This is the longest case-insensitive match, spaces allowed, an `(alias)` too. On an Example, a value its Concept states is read when the Example states none | The value, typed **strictly**: `30%` is `0.3`, `$1,204` is 1,204 dollars and `120 km` 120 kilometres (see [Numbers and units](#numbers-and-units)), `2026-09-22` a `date`, `Yes`/`No` a `bool`, empty `None`. `2026-01` is not a whole number, so it stays text |
| `@price@Acme` / `@Acme@price` | The named sibling Example's value, in either order — or, from a value on an Example, one of the sub-Examples beneath it | The value |
| `@Order@price@Acme` | Another Concept's cell: the Concept first, then a column and an Example in either order. It may live in any `.aot` in the workspace; the current file's own names win a shared name | The value |
| `@Measurement@alias` | A Concept's **own** value, the default its Examples inherit | The value |
| `@Order` | A Concept, with its Examples written as rows or as `- ` lines — **sub-Examples included**, depth-first, and **the rows of the kinds beneath it** | A **DataFrame** (a list of dicts without pandas); a column of dates is a datetime column. Where the Examples nest, a `parent` column names the row each one sits under, exactly as the [CSV mirror](tables.md#the-csv-mirror) writes it. Where rows come from kinds beneath, a `kind` column names each one's, so `@Deal@net.sum()` is every deal's and `@Deal.groupby("kind")` splits them |
| `@Order@price` | A Concept's column | A **Series** |
| `@Acme` | A sibling Example, or a sub-Example of the value's own Example | A `dict` of its values |
| `@raw`, `@Sales` | Another derivation | Its **live result**: the DataFrame itself, not its summary. It runs first when it is stale |

- **A reference to a computed cell reads what the formula computed**, every digit, never the text in the cell. That goes for a column, a row and a whole table too, so three `=1/3` cells total 1, and a total of a column of formulas is right the first time. A cell reading a column it stands in is a circular reference, as in a spreadsheet.
- **A value is read from any kind above**, the nearest first, as an Example silent on an attribute inherits it. **The longest name wins** across a column and a default: `@discount cap` beside a `discount` column is the default.
- **The local reading is tried first.** A Concept's name gets its turn when the local reading names nothing, or when the Concept reading goes further. In `@Integer@is prime`, `integer` may also be a local alias, but only the Concept Integer has an `is prime`.
- **A number after `@` names an Example** (`- 35`), never a column position.
- **An `@` inside a string or a comment is text.** An `@` straight after an operand is Python's matrix operator.
- **Typing `@` pops a completion** of the columns, then the Examples, then the repository's Concepts. A rename, by F2 or by typing over a name, follows through every reference, in every file.

## Numbers and units

A value is read the way an analyst writes it, and the whole text must be a number for it to be one:

| Written | Reads as |
|---|---|
| `30%` | `0.3`, as a spreadsheet reads it. A cell that says `%` shows its result as a percent |
| `$1,204`, `€5`, `£5`, `¥5`, `R1,204` | A number in that currency |
| `(1,000)`, `($1,000)` | Negative, as an accountant writes it. A cell that brackets a negative keeps doing so |
| `120 km`, `46 clients`, `3 m²`, `40 km/h`, `$10/kg` | A number with a unit |
| `120km`, `5kg` | The same, glued on, for a built-in unit. `3D`, `12A` and `2nd` stay text |
| `1.2M`, `450k`, `1.204,50`, `15/01/2026`, `n/a` | **Text.** Arithmetic on text is a visible error, never `n/an/a` |

**Any number followed by one word has a unit**, so `46 clients` needs no setup. About 80 units are built in, in a hierarchy: **Unit ▸ Length ▸ km**. Two units convert when they measure the same thing: length, area, volume, mass, time, speed, energy, power, data. `month`, `quarter` and `year` convert to each other but not to days, since a month is no fixed number of them. A currency converts to no other, and `$` and `USD` are two units. Any other word matches only itself, singular or plural. `°C` and `°F` do not convert yet.

A unit multiplies and divides with anything. It adds, subtracts and compares only with what it converts to:

| Formula | Gives |
|---|---|
| `120 km / 2 h` | `60 km/h` |
| `$10/kg * 3 kg` | `$30` |
| `5 km + 500 m` | `5.5 km` |
| `10 km / 1000 m` | `10`: a unit that cancels leaves a plain number |
| `$100,000 * (1 - 30%)` | `$70,000` |
| `$100 + 5`, `5 km > 3` | An error saying to write the unit: `$100 + $5`. Only `0` needs none |
| `$100,000 - 30%` | The same error, which is the point: `0.3` is no amount of money |
| `$5 + €5`, `3 kg + 2 km` | An error: they don't convert |

**A column takes its unit through its normal alias**, `distance (km)`, because an alias types an attribute by the Concept it names. The cells stay plain numbers, so the CSV mirror still sums in Excel, with `distance (km)` as its heading:

```aot
Trip|distance (km)|time (h)|speed (km/h) =@distance/@time
A   |120          |1.5     |80
B   |75 mi        |1       |120.7008
```

- **A cell's own unit wins**, and is converted. `75 mi` above is 120.7 km to whatever adds it up.
- **The same goes for an attribute on its line**: `distance (km)` on a Concept puts every `distance: 120` beneath it in km.
- **A result lands in its cell's unit.** A cell that says `5 m` shows `120 km` as `120,000 m`. A cell holding only a built-in unit chooses it before the first calculation: `speed: mph =@distance/@time`. A result of the wrong kind is an error, and a plain number takes the unit the cell names.
- **A number written straight in a column's rule is in its unit**: `distance (km) <=500`, `discount (%) <=35`. Anywhere else, write it: `distance <=500 km`.
- **The file's own Concept of that name wins**, as its own names always do: with a Concept `Hour` in the file, `start (hour)` is typed by that. A Concept filed under one called `Unit` is a unit of the file's own, which a column can use: `size (fte)`. To give your own units a worth and a written form, see [Your own units](#your-own-units).
- **Consequence:** an alias that is also a unit is a unit. `height (h)` means hours, so a short name for `height` has to be another word.

**In a formula or a rule** write them as you would anywhere: `=@price + $5,000`, `=@distance + 5 km`, `=@price*30%`, `=@start + 30 days`, `distance <=500 km`. No spaces inside a unit, so `5 km / rate` divides 5 km by a rate. `7 % 3`, with a space, stays the remainder.

**A column with units is still a column:** `.sum()`, `.mean()`, `.median()`, `.min()`, `.max()`, `.std()`, `.cumsum()`, sorting, filtering, `merge` and `groupby(...).sum()` or `.mean()` keep the unit. `groupby(...).std()` is an error rather than a number. `@a.value` is the plain number and `@a.unit` its unit, `@a.to("mi")` converts, and `aot.quantity(5, "km")` makes one in a Python file. `float(@a)` and `math.sqrt(@a)` are errors until you write `.value`, because a function that takes a plain number would otherwise lose the unit without saying so. A value that only looks like a quantity (`12 Monkeys`, a code like `R100`) still behaves as the text it is, until it is calculated with.

### Your own units

A repository writes its own units as it writes anything else: as rows of a kind, under a Concept called `Unit`.

```aot
Unit
    Money|factor|format
    CHF  |1     |CHF #
    Rappen|0.01 |# Rp
        measures: worth

    Effort|factor
    FTE   |1
    PD    |1/220
        measures: work
```

With that anywhere in the repository, `CHF 10` plus `50 Rp` is `CHF 10.5`, and `2 FTE` plus `220 PD` is `3 FTE`.

- **A Concept under `Unit` is a kind, and each of its Examples is a unit.** Units convert only within their kind. A kind named as a built-in one (`Length`, `Mass`, `Time` and the rest) converts with the built-in units of that kind too: `league|4828` under `Length` makes `@a.to("km")` of `2 league` give `9.656 km`.
- **`factor` is what one unit is worth in the kind's base**, the unit whose factor is `1`: a whole number, a decimal, `1,000`, or a fraction such as `1/220`. A unit with no factor converts to nothing, as `46 clients` doesn't.
- **`format` says how a value in it is written**, `#` standing for the number: `CHF #` writes `CHF 1,200`, `# Rp` writes `50 Rp`, and `CHF #.00` keeps two decimals. The mark names the unit too, so `50 Rp` is 50 Rappen and `CHF 5` is 5 CHF. With no format, a value reads `5 FTE`.
- **A unit you write wins over a built-in one of the same name.** `CHF` above is your `Money`, which converts to Rappen and to no built-in currency.
- **Every file of the repository reads them**, wherever they are written: the editor, `verify.js` and `check.js` alike. Two files giving one unit two factors contradict each other, and both go red ([rule 22](checks.md#errors--red-squiggle-counted-in-v-the-file-does-not-verify)).
- **They work wherever a unit does:** in a cell, in a column's alias (`price (CHF)`), in a formula (`=@price + CHF 5`) and in a rule (`price <=CHF 500`). Hover the alias for where the unit sits and what it is worth: *Unit ▸ Money ▸ Rappen, written in this repository. 1 Rappen = 0.01 CHF.*

**Each kind says what it measures.** The kinds are sibling Concepts, so they need a [differentia](checks.md#warnings--yellow-squiggle-in-the-problems-panel-but-not-counted-in-v) like any others: two kind tables with the same columns and nothing else carry one definition, which is an error. A line one level under each table, `measures: worth` and `measures: work` above, tells them apart. Two kind tables need a blank line between them, as any two tables do. A `Unit` with a single kind of its own is fine, since the built-in kinds are its siblings.

**A definition must be readable** ([rule 27](checks.md#errors--red-squiggle-counted-in-v-the-file-does-not-verify)): a factor that is a plain number, a `#` in a format, and a unit's name, and the mark its format writes behind the number, of one word each, since a value's unit is the one word after its number. `FTE day` is two words, so `5 FTE day` would read as text; `PD` is one.

## Constraints

**Constraints live on the attribute; derivations live on the value.** A constraint is schema, so it is declared once, on the attribute: a bare line (`age >=18`) or a table header cell (`Order|qty >=1`). **Every value the attribute takes is held to it**: the Concept's Examples, its table's cells, and everything deeper in the subtree. A nearer declaration shadows an outer one. **A rule or a definition governs the file it is written in**: the same Concept's rows in another file are not held to it, and its text is not compared across files.

- **Bounds chain.** `age >=18 <=65` holds the attribute both ways.
- **The bound is Python**, for example `cap <=@price*1.5`, `start <=date(2026, 12, 31)` or `status =("draft", "sent")`. Its references resolve *per value*, against that value's own Example or row, so `Order|price|margin >=@price*0.1` holds each row's margin to that row's price.
- **It is checked when the file calculates**, all of a file's bounds in one round trip, and only those whose value or inputs changed. It is never checked on a keystroke.
- **A breach is a warning** on the offending value, under the source `formula`, and never counts in `V`. It stands until the value is edited or the next calculation. A bound that cannot compute is one error, on the clause that wrote it.
- **An empty value asserts nothing**, so it is held to nothing.
- **Values never carry bounds.** `age: 25 >=18` is just the value `25 >=18`.
- **Prose is safe.** `speed > none noted` and `age >= 18 years old` stay plain names, because a bound is believed only when the text after the operator reads as a Python expression, without running it: brackets and strings closed, no two words side by side ([`src/pyshape.js`](../src/pyshape.js)). A number and its unit are one thing, so `age >= 18 years` is a bound.

**`=` naming one value defines.** A `>=` says a value must be *at least* something. An `=` on the attribute whose bound computes **one value** says what the value **is**, so it derives every value of that attribute, written once where the attribute is declared:

```aot
Order
    tax rate: 0.2
    Order|price|vat =@price*@tax rate
    A    |100  |20
    B    |40   |8
```

Each calculation writes the definition into every value of the attribute that has no derivation of its own. That includes an empty cell, and it corrects one that drifted. The cells carry the **value alone**, because the definition lives in the header. The same holds in line form: `vat =@price*0.2` on the attribute fills the `vat:` of every Example beneath it that has a `vat:` line. A value's **own `=` derivation wins**, as the nearer word, and a value it computes that differs from the definition is a warning.

**`=` naming a collection lists the allowed values.** A tuple, list or set of values names no single value, so it is membership, not a definition, and fills nothing in:

```
Order
    status =("draft", "sent", "paid")
    - A
        status: sent          <- one of the three; nothing to report
    - B
        status: void          <- once it calculates: 'void' breaks 'status =("draft", "sent", "paid")'
                                 — it is not one of 'draft', 'sent', 'paid'
```

An ordering against a collection holds when the value meets any of its members: `>=(1, 9)`.

## The repository's Python

**Any Python file in the repository serves a derivation**, in `aot.files` or anywhere else. It is named as a module, with no `import` to write:

| Written | Reaches |
|---------|---------|
| `=finance.revenue(@Sales)` | `finance.py` in `aot.files`, else at the repository's root, else the one file of that name anywhere else in it |
| `=tools.finance.revenue(@Sales)` | `tools/finance.py`, by its dotted path from the root. A folder holding Python is a package, with or without `__init__` |
| `=aot.use("tools/my helpers.py").total(@Sales)` | A file by its path, for one whose name is not an identifier |
| `=csv.QUOTE_ALL`, `=scipy.stats.norm.cdf(1)` | Any module of the standard library or an installed package, with submodules imported as they are reached |

- **The standard library and installed packages come first**, so no file in the repository can stand in for one. An `os.py` anywhere shadows nothing.
- **Two files of one name are an error** that names both and the dotted path to write instead.
- **Some folders are never searched:** a virtual environment, `node_modules`, `__pycache__` and hidden folders. They are not the repository's own code.
- **A module changed on disk is imported again on the next calculation**, and every derivation naming it fades until then. A module it imports in turn is not followed, so `Ctrl+Alt+F9` takes in a change there.

## What comes back

| Result | Written |
|--------|---------|
| A number | `3,628,800`: separated, **every digit**, no scientific notation, in the unit its cell names or the one it comes with. See [Numbers and units](#numbers-and-units) and [How a number shows](#how-a-number-shows) |
| A date, a datetime | `2026-09-22`, `2026-09-22 14:30` |
| `True` / `False` | `Yes` / `No` |
| `None`, NaN | An empty value |
| Short text | The value, with any pipe bent to `¦` |
| Text in a cell of a table a formula returned | The cell, with any pipe bent to `¦` and a line break written `↵` |
| Text over `aot.python.maxInlineText` (120), or holding a line break | `aot.files/<address>.md`, and the value is its path |
| A matplotlib Figure or Axes, a PIL image, image bytes | `aot.files/<address>.png`, and the value is its path. Hover shows the picture |
| A DataFrame **on an attribute** | `<DataFrame 1,204 rows × 4 cols>`. The frame stays live for `@` |
| Anything else | `<list 3 items>`, `<dict 2 keys>`, `<ndarray 3 × 4>` … |

The file name is the value's `@` address, reduced to safe characters. It is never a path of Python's choosing.

**A computed number is always written with thousands separators and every digit**, while a value you *typed* is never reformatted: a typed `1815` stays `1815`. One surprise follows: a computed year reads `2,026`. When you mean a year, return text (`str(y)`) or a `date`.

## How a number shows

**The file keeps every digit, and the screen shows the short form.** The CSV holds the same digits, so a spreadsheet can sum it, and a CSV a spreadsheet re-saved at 15 digits counts as the same number. Only computed numbers are shortened: `=` cells, defined columns, rows a formula wrote and parked values. A number you typed is never touched.

The rule, in this order:

| # | Rule | Stored | Shown |
|---|------|--------|-------|
| 1 | A whole number shows every digit | `1,180,591,620,717,411,303,424` | the same |
| 2 | Round to 15 significant digits and drop trailing zeros, which takes off a float's noise | `0.30000000000000004` | `0.3` |
|   |   | `0.7999999999999999` | `0.8` |
| 3 | Short: three decimals or fewer after any leading decimal zeros show in full | `13.225` | `13.225` |
|   |   | `0.0000001` | `0.0000001` |
| 4 | Repeating: the block is shown once, an overline on each digit | `0.3333333333333333` | `0.3̅` |
|   |   | `0.8333333333333334` | `0.83̅` |
|   |   | `0.09090909090909091` | `0.0̅9̅` |
|   |   | `333.3333333333333` | `333.3̅` |
| 5 | Anything else: the leading decimal zeros and 3 digits, cut rather than rounded, then `...` | `0.363466035246486` | `0.363...` |
|   |   | `1234.56789` | `1,234.567...` |
|   |   | `0.000123456` | `0.000123...` |
|   |   | `0.14285714285714285` | `0.142...` |

**Rule 4 exactly.** Ignore the last of the 15 digits, since it may be rounded. A block of 1 to 3 digits repeats if it runs through the end, covers at least the last 5 digits and comes at least 3 times. A block of all `0`s or all `9`s does not count. That is why 1/7, with its six-digit block, falls to rule 5.

A sign or a currency stays in front of the short form, a unit behind it, and brackets around it. **With the cursor in the cell you see every digit**, as in a spreadsheet's formula bar, and the hover and copying give every digit too. In a table a formula stays one space behind the short form and the padding goes at the end of the cell, so the pipes stay lined up. A computed column stays as wide as its longest stored number, and GitHub shows all the digits. `aot.shortNumbers` set to `false` shows every digit everywhere.

## Running

**A file calculates the way a spreadsheet does.** There is no timer, and no key to remember: you say you are done with a cell by moving on.

| You do this | What happens |
|---|---|
| Type in a cell | Nothing runs, so a half-written number reaches no formula. The results it will change fade |
| Leave the cell (`Enter`, `Tab`, an arrow, a click) | It calculates |
| Paste lines, fill down, delete a row, undo, any edit that is not typing on one line | It calculates straight away |
| Save, switch editor, or switch to another program | It calculates |
| A CSV edit arrives | That `.aot` calculates, and is saved if it held no unsaved work |
| Open a file | What is out of date calculates, and nothing starts if nothing is |
| `F9` (**AOT: Calculate Now**) | Everything out of date, whatever reads nothing in the file, and anything that failed |
| `Ctrl+Alt+F9` (**AOT: Recalculate Everything**) | A new session, then every formula |

`aot.calculation` set to `manual` matches a spreadsheet's Calculation Options: only `F9` and `Ctrl+Alt+F9` calculate, and an out-of-date formula says so. `Ctrl+Enter` is VS Code's own.

- **Only what is out of date runs.** A formula is out of date when its source, what it reads, or the Python files it names (the sidecar among them) changed since it last calculated. A table of 5,000 formulas with one changed cell runs what reads that cell.
- **It is right the first time.** Every formula knows what it reads before anything runs, whether that is a cell, a column, a row, a whole table or a `@Concept@row@col` path, so it runs after them. A defined column (`vat =@price*0.2`) is one calculation per row in that same order, and what reads a Concept a bare `=` line writes runs once the line has written it. A cycle runs nothing and names its members as a circular reference. Constraints are checked last.
- **It never disturbs your typing.**
  - Python runs in its own process, and a new edit stops a pass at its next batch of 64, then plans again.
  - A result touches only the characters that change, so a cursor stays where it is. A cell a cursor stands in waits until it leaves.
  - Each result is found again by its address, so a line added while it ran moves it along. One whose formula changed meanwhile is dropped, and runs again.
  - A result joins your last edit, so one `Ctrl+Z` takes back a change with what it calculated. An undo writes nothing unless a formula now gives a different answer, such as `random()`, so redo survives.
- **A failure** leaves the value as it was and says why on its line, and whatever reads it does not run. Nothing is written over a good value. It waits until it or what it reads changes, or `F9` asks again, so a slow failure never holds up the rest.
- **A formula that hangs or crashes** stops its session. The limit is `aot.python.timeoutMs` per formula, so a long batch of quick ones never trips it. It then waits like any failure, and the rest go on in a fresh session.
- **Past half a second the status bar says `Calculating 3/12`**, and a click stops it (**AOT: Stop Calculating**). What it did not reach stays out of date, and no one is told it failed.
- **There is one Python session per document**, kept between calculations along with its live results. It ends after `aot.python.idleTimeoutMs` idle with its file off screen, when the file closes, and when a formula exceeds its limit. A hung expression holds the interpreter, so stopping the process is the only way to end it.
- **`Ctrl+Shift+``** runs every derivation **fresh** and checks every constraint, then [parks](#parking-the-derivations) them all, so what parks is current. Putting them back runs nothing.
- **A copied derivation arrives without a value** and fills when the file next calculates. This covers `Ctrl+'`, a fill, *Copy Formula Down the Column*, *Across the Row* and *to Sibling Examples*. The value in front of the original was computed where it stood, not where the copy lands.

What this asks of you:

- **A side effect repeats.** A formula that writes a file or calls a service runs each time what it reads changes. A spreadsheet formula cannot do that, but Python can. Give a file like that `aot.calculation: manual`.
- **A volatile value waits for `F9`.** `=date.today()` and `=random.random()` update when what they read changes, or on `F9`. A spreadsheet recalculates these constantly, but here that would dirty the file on every edit.
- **Other files update later.** Other open `.aot` files that read this one update when this one is saved, and closed ones when next opened.
- **The formula itself is still Python**, and a library like `pd` is still called by its name.

## Libraries

- **Always there:** `math`, `statistics`, `re`, `json`, `random`, `itertools`, `functools`, `Path`, `date`, `datetime`, `timedelta`, `Decimal`, `Counter` and `defaultdict`.
- **Imported in the background once Python is on:** **`pd`** (pandas) and **`np`** (numpy).
- **Imported the first time a derivation uses them:** **`plt`** (matplotlib, on the non-interactive `Agg` backend, so no window ever opens), **`sns`** (seaborn), **`stats`** (scipy.stats), **`Image`** (PIL), **`requests`** and **`relativedelta`**.
- **A missing library fails only on the line that uses it**, naming what installs it. **AOT: Show Python Environment** lists the interpreter, what it has, and what it is held to.
- **Worth installing:** `openpyxl` for `pd.read_excel` and `pyarrow` for parquet.
- **Anything else is there by its name.** See [the repository's Python](#the-repositorys-python).

## The environment (uv)

A repository can carry its own Python environment, set up with [uv](https://docs.astral.sh/uv/), so every writer runs the derivations with the same libraries.

**AOT: Set Up Python Environment (uv)** does it in four steps:

1. **The project.** It asks which libraries you want (pandas, numpy and matplotlib come ticked) and writes `aot.files/pyproject.toml`. A repository that is already a uv project (a `uv.lock` beside a `pyproject.toml` at its root) is used as it is.
2. **The lock.** `uv lock` resolves the project into `uv.lock` from built wheels only. Commit both files.
3. **The review.** Before anything is installed, it shows what the lock would install: every package, and by name any that comes from outside PyPI (a git repository, a URL, another index). Nothing installs without "Install".
4. **The install.** `uv sync --locked --no-build --no-install-project --compile-bytecode` installs exactly what the lock says into `aot.files/.venv`, from built wheels alone, so nothing is built or run to install it. uv keeps the environment out of git itself.
   - **One environment per operating system.** On Linux and macOS it goes to `.venv-linux` / `.venv-darwin` instead. A checkout on `C:` used from Windows and from WSL keeps one of each, and neither setup ever replaces the other's.
   - It compiles the environment to bytecode as it installs. The runtime never writes `.pyc` files itself, so without them every session would compile pandas from source, 40 seconds and more, before its first derivation could run.

- **An unchanged project installs again without asking.** One whose `pyproject.toml` or `uv.lock` changed since (a pull) is reviewed again first.
- **A run never installs anything.** When the project has moved on since the setup, the run says so, once, and goes on with the packages as they were installed. Run the setup to bring it up to date.
- **To add a library,** add it to `aot.files/pyproject.toml` and run the setup again. A missing library's message says exactly that.

**Which Python runs** (`aot.python.manager`):
- **`auto`** (the default): `aot.python.path` when it is set, else the uv environment set up here, else Python on PATH: `python` on Windows, and `python3` then `python` elsewhere, since Debian, Ubuntu and WSL ship no bare `python`.
- **`uv`**: the environment only; a run with none says to set one up.
- **`python`**: never an environment.

A uv environment is started **isolated** (`-I`): no `PYTHON*` variables, no user site-packages, no current directory on the path.

**An environment is used only as it was set up here.** The setup records a hash of the environment's interpreter, and a run starts that interpreter only while the hash still matches.
- A `.venv` a repository arrived with is never run.
- An interpreter that changed since the setup is never run either; the run says to set up again.
- The setup replaces a `.venv` it did not make rather than taking it over.

## In the editor

- **Every formula finding has a source of its own** (`formula`), and **none counts in `V`**: a failed formula or a broken bound is a verdict on a calculation, not on the model. With formulas off or in manual calculation, one that is out of date says so, as information.
- **The status bar adds it all up**: `$(check) 0 problems` or `$(error) 3 problems`, violations and calculation together, with the breakdown in its tooltip and the Problems panel on a click. While formulas are off, paused or out of date it says `formulas not calculated`, so it can't look clean over numbers nobody checked.
- **A value a formula replaces says so.** When a formula overwrites a number somebody typed, as opposed to one it wrote itself, a warning stays on the cell until you edit it or close the file: `find out where '99,999' came from — its formula gives 35,000, so that is what the cell now says`.
- **A formula that calculated says nothing at the end of its line**, as a spreadsheet's cell says nothing. Only what needs you does: `✗ 'units' isn't a known name · 16:04`, `– did not calculate · 16:04`, `ⓘ 'Old' no longer written`.
  - Common errors read plainly (`'su' isn't a known name`, `division by zero`), with Python's own message and traceback in the tooltip.
  - A table row holding several formulas has **one** inlay, naming the first cell in trouble: `✗ net: 'x' isn't a known name · 16:04`. Its tooltip has a line for each cell, and hover on a cell's value says what computed that cell.
  - **Hover on a value** says when it calculated, how long it took and with what: `Calculated 2026-09-23 16:04:11 in 12 ms · python 3.13.0 · pandas 2.2.2`. The time is kept with the run records, so it outlasts the session and a restart of the editor.
  - A value older than its formula (edited, or something it reads changed) is **faded**.
  - A table Python wrote is tinted, and its hover says every row of it is the derivation's.
- **The function a derivation calls is underlined when a Python file here defines it**, and **Ctrl+click** opens that file at its `def`. That can be the sidecar's own function, one the sidecar imports (`from helpers import load`), or a module's (`finance.revenue`, `tools.finance.revenue`, `aot.use("…").total`). A function of the standard library or an installed package has no file here, so it is not underlined.
- **Hover** a function for its signature, docstring and file.
- **Completion:** after `=` it offers the sidecar's functions and the repository's modules, after `finance.` that module's functions, and after `@Sales.` the table's columns.
- **The derivation wears its own colour.** Everything from the operator to its end, a constraint's bound included, is painted as Python, so code reads apart from data at a glance.
- **The model never sees a derivation.** The Attribute Value is the value part alone, so crosslinks, FCA, Gödel numbers and dependency inference all work on clean data.
- **The lightbulb** calculates now, creates a stub for a function the sidecar lacks, or **moves the expression into the sidecar**. Each `@` reference becomes a parameter, and the line calls the new function.
- **The `.aot` holds what you know; the `.py` holds how you got it.** Every attribute is part of the model, so a pipeline's intermediate steps belong in the sidecar, and only facts should surface in the file.

## Parking the derivations

A file that computes holds two things in one place:

- the **values**, which are what you read;
- the **derivations**, which you wrote once and mostly never want to look at again.

`20 =@price*@tax rate` in every cell of a column makes it three times as wide as its data and buries the number under the code that produced it.

**`Ctrl+Shift+`` takes every `=` derivation, and every constraint on an attribute declaration, out of the data**, and the same key puts them back. The order is the whole design:

1. **Python runs first**, every derivation fresh and every constraint checked, so every derived value is materialised where it stood. With Python off, or in an untrusted workspace, the values park as they stand, and the status bar says so.
2. Only then do the derivations leave, for `aot.files/<file>.formulas`, which records the interpreter and library versions that computed them.
3. The tables re-align, so the columns narrow to their data. One `Ctrl+Z` undoes the lot.

```aot
before                                    after Ctrl+Shift+`
Invoice|price >=0|vat           |        |Invoice|price|vat
INV-1  |100      |20 =@price*0.2|        |INV-1  |100  |20
INV-2  |250      |50 =@price*0.2|        |INV-2  |250  |50
```

```
aot.files/Ledger.formulas
    @Invoice@price: >=0
    @Invoice@vat@INV-1: =@price*0.2
    @Invoice@vat@INV-2: =@price*0.2
```

**The parked file still stands on its own.** Every value is present, so it still says exactly what it said. The derivations are done with, since their results are already written in the data. The **constraints are not**: a bound computes nothing that could stand in its place, so taking it out of the file would silently switch it off. So **a parked constraint is still checked**. The editor reads the constraints back out of the store, and each run holds every value to them exactly as when they stood on the declaration: `price: -5` still warns, now as a breach of the *parked* bound. A parked `==` definition still defines. `verify.js` runs no Python, so it checks neither; [`check.js`](cli.md#the-calculating-check) checks a parked bound. Nothing in the CSV mirror or the cross-file reconcile knows the store exists.

**Each derivation is addressed with the `@` path the language already uses.** `@Invoice@vat@INV-1` is the `vat` of the Example `INV-1` of the Concept `Invoice`. [A table and a `- ` list are one idea in two spellings](tables.md#tables-are-pure-shorthand), so that one address finds the Example whichever way it is written.

- A value on the Concept itself is two segments (`@Invoice@tax rate`).
- An Example nested inside another adds a segment, outermost first.
- A Concept's own derivation is filed under the Concept alone (`@Sales`).
- A bare `=` line comes off **whole**, and is filed by where it stood and what it wrote, `@=Sales@Region: =load_all()`. It comes home on the line above the Concept that stood directly beneath it — normally the first table it wrote; one it did not write is marked `^` (`@=^Notes`), so its rows are never tinted as the line's. A line with no Concept beneath it has nowhere to come home to, so it stays in the file, and the park key says so.

**A parked value says so.** The same plainness that lets a parked file stand on its own sets one trap: `20` in a cell looks exactly like a `20` somebody typed, so it invites being typed over, and that edit stands only until the derivations come home and run again. So every value the store owns is **tinted where it stands**, in the editor's inlay-hint colours: it is a number the editor is showing you rather than one you wrote.

- Hover names the derivation, the address it is filed under and the store it is in. It offers to put the derivations back in one click, which is where you change what a value computes.
- The mark is a background and never added text, so a marked cell keeps the width its column aligned it to.
- It is drawn from the store rather than the data. It appears the moment the store lands and goes the moment the store is deleted, whether by the key, by hand, or by a pull.
- Turn it off with `aot.parkedValueMarks`.

More about parking:

- **Constraints park with the derivations.** `age >=18`, `status =("draft", "sent")` and `vat =@price*0.2` leave their declarations: a header cell narrows to its column's bare name, and a bare attribute line to its term. Each is filed under the declaration's own address, `@Person@age: >=18`. A stored entry shows which it is by how it opens: a derivation with one `=`, a constraint with its operator. The attribute's name is tinted like a parked value, and its hover names the constraint and says it is still checked.
- **A cell holding only a derivation parks too**, and leaves its computed value behind. That is what step 1 is for.
- **Nothing is ever invented back.** Rename or delete a row while its derivation is parked and that address no longer names anything. It is reported and **kept in the store** rather than guessed at, and the store stays until it resolves.
- **The store's existence is the state.** A file is parked when it has one, and putting the derivations back deletes it. Commit it beside the `.aot`, since it is the only copy of the derivations while they are out. **It may hold Python**, so review a change to it as you would code.
- **An address that no longer names anything is not marked**, for the same reason it is never invented back. The mark is drawn by the resolution that puts the derivations home, so what the editor tints is exactly what unparking would rewrite.

[`examples/python edge cases.aot`](../examples/python%20edge%20cases.aot) is a catalogue of the cases worth knowing, each with what should happen. Run it with its sidecar, [`aot.files/python edge cases.py`](../aot.files/python%20edge%20cases.py), to see.
