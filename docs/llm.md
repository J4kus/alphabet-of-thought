# Using Alphabet of Thought with an LLM

[Back to the README](../README.md)

Alphabet of Thought was designed so that a language model can read, extend, and critique a model, with checks that don't depend on the model. The workflow:

1. Give the model [the rules below](#the-rules-to-give-an-llm) as its instructions. For everything, add the [language reference](language.md#language-reference), [formulas](formulas.md) and [checks](checks.md).
2. Paste your `.aot` file and ask it to extend, critique, or explain the model. Have it edit the model file itself: a rule governs the file it is written in, so rows it puts in a file of its own are not held to your rules.
3. Let the checks judge the result: in VS Code, or with [`node check.js`](cli.md#the-calculating-check), which calculates every formula and rule and exits `0` only when nothing disagrees. An agent can loop on that code. It runs the code in the files, so it is for files you trust. `node verify.js <file.aot>` runs nothing and checks structure only, so `V = 0` says nothing about the numbers.
4. Read the diff. `0 problems` can't tell you a typed number is true, and a rule or formula the LLM edited still passes, so `git diff` is where you see those.

## Keep your assumptions in their own file

Write the values an LLM must not change in a file it is told not to edit, and repeat them in the model. If one changes in the model, both files go red, each naming the other, until someone decides.

```aot
Standard Deal
    max discount: 20%
    ...
Enterprise Deal
    max discount: 35%
    ...
```

This covers values. The text of a rule or a formula is not compared across files, and a rule governs the file it is written in, so rules and formulas stay in the model, and you read their diff.

## The rules to give an LLM

Paste this into `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` or your editor's rules file:

```text
This repo's models are Alphabet of Thought files (.aot). Indent 4 spaces, never tabs.
The file name is the root, so never repeat it as a line.
Capitalised line = a kind of thing. lowercase line = a column. "- Name" = a row.
"column: value" = a cell.
Table: the first row names the kind and its columns, as "Deal|list price|discount".
Each later row starts with its name. No pipes at either end. What no row says goes one
level under the table, as "    max discount: 20%".
Numbers: 30%, $100,000, (1,000), 120 km. Not 1.2M or 1.204,50, which are text.
Formula: the value, a space, then =python, as "net: $35,000 =@list price*(1-@discount)".
@price is this row's column. @Order@price is a pandas Series. @Order is a DataFrame that
includes the rows of its sub-kinds. @Order@price@Acme is one cell.
Defined column: "net =@list price*(1-@discount)" on the parent or in the header.
Rule: "discount <=@max discount" or "status =("draft", "sent")".
Never define a kind twice. Never restate an assumption with a different value.
Mark what you don't know with an indented "... why".

Your rules:
1. Every number you state goes in the file as a row or a formula, not only in chat.
2. Edit the model file itself. A rule only governs the file it is written in.
3. Under a defined column, write results unrounded, because a rounded value fails the
   check. You may leave a cell empty only when the formula is on that table's own header.
4. Write a claim as a row with a rule and a tolerance, in the column's unit:
   "stated <=@Sale@amount.sum()+$1 >=@Sale@amount.sum()-$1".
5. Don't edit assumptions.aot, or any rule, definition or assumption, unless asked.
   If you must, say so first.
6. Run node check.js and fix what it finds until it passes. Never edit a rule to pass.
```

## The rules for a model's structure

These are the rules an LLM must follow, in brief, when a model is about ideas more than numbers:

```
You are writing Alphabet of Thought (.aot): an indented plain-text tree. Indent exactly 4 spaces
per level; never use tabs. The file name is the root Concept — never repeat it as
a line. Four kinds of line only:
  Capitalised name            = Concept (a kind; child Concept is-a parent, never has-a)
  lowercase name              = attribute (a property the parent has)
  - Name                      = Example (a concrete individual of the parent)
  attribute: value            = the attribute plus its concrete value on one line
Concepts define essence: their attributes are inherited by all children. Examples
may override inherited values and add accidental attributes, never essential ones.
Every idea has exactly one parent; model relationships as their own Concepts whose
attributes name the linked Concepts (lowercase) and whose Example values name the
linked Examples (case-insensitive). File an Example only under a kind nothing stops
being (Human, not Manager); write roles and phases as Examples of their own Concept,
joined by a relation Concept. No "and" in a Concept name. Never define the same
Concept name twice. Singular Concept names. 3–7 children per objective; at most 8
sub-Concepts per node. Give every pair of sibling sub-Concepts a distinguishing
attribute or value (a differentia). Mark anything intentionally incomplete with an
indented "..." Map line. Every measurement carries both target: and actual:.
```
