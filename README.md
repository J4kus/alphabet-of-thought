# Alphabet of Thought

**See where your numbers disagree, whether you typed them or an LLM did.**

Alphabet of Thought is a plain-text spreadsheet for VS Code. Formulas are real Python. State a rule, a definition or an assumption once, and every number under it has to agree. Two files that disagree both go red. Every edit shows up in `git diff`.

<!-- The opening animation goes here once it is recorded. -->

```text
code --install-extension Jakus.alphabet-of-thought
```

You need VS Code, and Python with pandas for formulas. [Try it in five minutes](#try-it-in-five-minutes).

## A model is a text file

Save this as `Q3 Revenue.aot`. It passes every check.

```aot
Deal
    discount <=@max discount
    net =@list price*(1-@discount)
    Enterprise Deal|list price|discount|net
    Acme           |$100,000  |30%     |$70,000
    Bolt           |$80,000   |10%     |$72,000
        max discount: 35%
    Standard Deal|list price|discount|net
    Kite         |$20,000   |15%     |$17,000
        max discount: 20%

Summary
    total net: $159,000 =@Deal@net.sum()
```

- **It calculates like a spreadsheet.** Change a number, leave the cell, and whatever reads it updates. `Tab`, `Enter`, `Ctrl+D`, `Ctrl+R` and `F9` do what your hands expect.
- **Write it once.** The rule and the `net` formula sit on `Deal`, and every table under it follows. A plug can't hide in that column: a typed number that differs from the formula is replaced, and the cell says so.
- **Set an assumption once.** Every row under `max discount` reads it, however deep. A row can override it, in a column whose header states the default, and `verify.js --overrides` lists every override. That's inheritance, in spreadsheet terms.
- **Totals roll up.** `@Deal@net.sum()` reaches every kind under `Deal`, and `@Deal.groupby("kind")` splits them.
- **Numbers read as you write them.** `30%`, `$100,000`, `(1,000)` and `120 km` are numbers. `$100 + €200` is an error, not a total.
- **It stays open.** It's text that git can diff and merge, and every table is mirrored to a CSV that Excel opens.

## An LLM edits it

Ask an LLM to add a deal, and you might get this back. The mistakes are planted, so you can see each one.

```diff
     Kite         |$20,000   |15%     |$17,000
+    Wren         |$50,000   |30%     |$99,999
```

```text
$ node check.js "Q3 Revenue.aot"
check.js runs the formulas in these files and any Python they name, with your permissions.
Q3 Revenue.aot:10: error: change the value, or the formula — '$99,999' is written here, and its formula gives '$35,000'
Q3 Revenue.aot:14: error: change the value, or the formula — '$159,000' is written here, and its formula gives '$194,000'
Q3 Revenue.aot:10: error: change the value, or the bound — '30%' breaks 'discount <=@max discount': it is not <= 0.2

1 file: violations V = 0, 0 contradictions between files, 0 values naming no row
formulas: 5 calculated, 0 failed, 2 differ from what is written, 0 not written yet
rules: 8 values checked, 1 broken, 0 could not be checked
3 problems
```

That's a net figure that matches nothing, a total that's no longer true, and a discount above that kind's limit. It exits with code `1`. In the editor the same findings appear as you go, and the status bar counts them.

If the LLM writes `max discount: 25%` for Standard Deal in a file of its own, both files go red, each naming the other, until you choose.

## What `0 problems` means

`0 problems` means every file agrees with itself, its rules, its formulas and the other files. It can't tell you a typed number is true, and it checks only what you've stated.

| It catches | It can't catch |
|---|---|
| A metric defined twice, a row filed under the wrong kind, a repeated row | An invented deal that obeys every rule |
| A broken rule, a formula that fails | A wrong list price |
| A value that differs from its formula | A typed total with no formula; add one and it's caught |
| Text in arithmetic, `$100 + €200`, `5 apples + 3 oranges` | A rule or formula someone edited; `git diff` shows it |
| One assumption with two values across files | Rows in another file; a rule governs the file it's written in |

## Try it in five minutes

1. Install the extension and save the model above as `Q3 Revenue.aot`, in a folder of its own.
2. Click **Enable** when it offers to calculate. The status bar says `0 problems`.
3. Change Kite's discount to `18%` and leave the cell. `net` and the total update.
4. Add Wren's row from the diff above and leave the cell. `$99,999` becomes `$35,000` and says so, `30%` gets a warning, and the status bar counts them.
5. Saving writes each table to `aot.files/` as a CSV. Open one in Excel, change a cell and save, and the change comes back.

To run the same check in a terminal (an npm package isn't out yet):

```text
git clone https://github.com/J4kus/alphabet-of-thought
cd alphabet-of-thought
npm install
node check.js "path/to/Q3 Revenue.aot"
```

## Your own data

- **A few rows:** paste them, select them, and run **AOT Table: Create Table from Selected Lines** from the Command Palette.
- **A whole file:** write `Sale =pd.read_csv("/path/to/sales.csv")`. The rows are written into the file, and each run replaces them.
- **A big file:** keep it out of the text. `raw: =pd.read_csv("/path/to/big.csv")` holds a live frame, and the file only says how big it is. Then `total: =@raw["amount"].sum()`.
- **Your own Python:** any `.py` file in the repository is there by name, as in `=finance.revenue(@Sale)`, and it runs on your machine with your packages.

## Two ways to work

Each [rationale](docs/why.md#the-four-rationales) answers one question about a subject:

| | Ends | Means |
|---|---|---|
| **Extrinsic:** from outside | Motivation: why, and for whom | Factor: who acts, in what order |
| **Intrinsic:** in itself | Function: what it does | Graph: what it's made of |

Motivation and Factor inform Function and Graph. So there are two ways in:

- **Go deep.** Expand one rationale until you reach what you don't know, and mark it `...`.
- **Go across.** Write one Concept in all four. The one you can't write is what you've been assuming.

## Make your LLM answer in the file

A claim in chat can't be checked. A claim in the file can.

1. **Answer in the file.** Every number goes in as a row or a formula. A claim is a value with a formula behind it, or a row held by a rule with a tolerance: `stated <=@Sale@amount.sum()+$1 >=@Sale@amount.sum()-$1`.
2. **Edit the model itself.** A rule governs the file it's written in, so rows the LLM puts in a file of its own aren't held to it.
3. **Keep your assumptions in their own file.** Write the values in `assumptions.aot`, tell the LLM not to edit it, and repeat them in the model. If one changes in the model, both files go red.
4. **Read the diff.** If an LLM edits a rule or a formula, the check still passes, so `git diff` is where you see it.

[The LLM guide](docs/llm.md) has the rules to paste into `AGENTS.md`, `CLAUDE.md` or your editor's rules file. An agent can loop on `node check.js`, which exits `1` on any problem. It runs the code in the files, so it's for files you trust.

## Coming from Excel, notebooks or dbt

| In Excel | Here |
|---|---|
| `=SUM(B2:B10)` | `=@Order@price.sum()` |
| `$B$1` | A default, `tax rate: 20%`, read as `@tax rate` |
| A formula filled down a column | One formula on the header: `vat =@price*@tax rate` |
| `XLOOKUP` | `=@Order@price@Acme`, or a pandas merge |
| Data validation | `status =("draft", "sent", "paid")`, `qty >=1` |
| Pivot table | `By Region =@Order.groupby("region", as_index=False)["price"].sum()` |
| Master check cell | The status bar's `0 problems` |
| Trace precedents and dependents | Hover, Ctrl+click, Shift+F12 |
| Spreadsheet Compare | `git diff` |

- **Excel:** keep it for the deliverable. Your tables stay CSV.
- **Notebooks:** explore in a notebook, and keep the model you defend here. Results stay visible as data, and calculation order is automatic.
- **dbt:** dbt tests your tables, and this checks your thinking about them. `unique`, `accepted_values`, `relationships` and `expression_is_true` all have equivalents. `not_null` doesn't: a blank a formula reads fails that formula, and a blank nothing reads passes.

## Questions analysts ask first

- **Can the LLM cheat the check?** Yes, by editing a rule or a formula. That's why you read the diff.
- **How many rows?** Keep raw data in files and load it into a live frame. In a test run, `check.js` calculated a 50,000-row table with a formula column in 8.5 seconds. Every check runs at any size except derivable columns, which stop at 5,000 rows, and the tools say so.
- **Can I send it to my boss?** Every table is a CSV that Excel opens. There's no `.xlsx` export.
- **Does my data leave my laptop?** There's no telemetry. Hovering a URL makes one request (`aot.urlMetadata` turns that off). A formula runs with your permissions, so it can do what your Python can, and your LLM is your own choice.
- **Is it safe to open someone's file?** Formulas are off until you enable them, and code from elsewhere asks first. A file with formulas is a program: read [Trust](docs/trust.md).
- **What if this project dies?** You keep text, CSV and an MIT license.
- **What's the catch?** The file saved last wins. A CSV saved after its `.aot` overwrites cells and deletes rows it no longer lists, with nothing asked. Keep the folder in git.
- **Pivots and charts?** You write them as Python, not with a GUI.

## Working as a team

- **Review:** a model is reviewed as a diff, line by line. [`AOT: Set Up Git Merge for .aot Files`](docs/cli.md#merging-with-git) merges by meaning when git's line merge conflicts.
- **CI:** `node verify.js` runs no code and checks structure, so it's safe on a pull request nobody has read. `node check.js` runs the code in the files, so it's for trusted branches.
- **Colleagues in Excel:** they edit the CSV, and saving brings the change back into the model, where the checks run on it.

More in [Working in a team](docs/team.md).

## Everything else

| Read | For |
|---|---|
| [The language](docs/language.md) | The notation in sixty seconds, a quick start, the four kinds of line, classifying correctly, inheritance, Concepts across files, aliases and `...` markers, numbering, crosslinks, starting a model, style rules |
| [Tables](docs/tables.md) | Pipe tables, the table editor and its keys, Excel-style selecting, sums, sorting and filters, the CSV mirror, flipping between a table and free text |
| [Formulas](docs/formulas.md) | Where a formula goes, `@` references, numbers and units, your own units, rules, your own Python, what comes back, how a number shows, when a file calculates, libraries, the uv environment, parking formulas |
| [Trust](docs/trust.md) | What may run, what's asked first, what a formula is held to, what it may write |
| [The checks](docs/checks.md) | Every rule, errors and warnings, two names for one idea, Gödel numbering, dependency inference |
| [Settings](docs/settings.md) | Every setting |
| [The command line](docs/cli.md) | `verify.js` and its queries, `check.js`, merging with git |
| [Using an LLM](docs/llm.md) | The workflow, assumptions in their own file, the rules to paste |
| [Working in a team](docs/team.md) | Review, governance, the conformance examples |
| [Why](docs/why.md) | The idea behind it, a KPI-tree case study, incompleteness, the four rationales and two ways to work with them, design principles from Aristotle and Leibniz, what it costs in tokens |
| [Repository layout](docs/repository.md) | Every file, and how to build from source |
| [Changelog](CHANGELOG.md), [feature notes](docs/features-1.15.md) | What changed, release by release |

## License

MIT, see [License.md](License.md). Made by Jakus van Rooyen. [Issues and questions](https://github.com/J4kus/alphabet-of-thought/issues) are welcome.
