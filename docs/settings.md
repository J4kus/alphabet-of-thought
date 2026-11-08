# Settings

[Back to the README](../README.md)

| Setting | Default | What it does |
|---------|---------|--------------|
| `aot.tableCsvSync` | `true` | Mirror every Concept with Examples to one union `aot.files/<Concept>.csv` (one folder at the repository root), kept in step both ways: [the file saved last overrides the other](tables.md#the-csv-mirror); an orphaned CSV is archived `_<name>.csv`, never deleted. |
| `aot.tableCsvSyncMode` | `auto` | When the mirror syncs: `auto` on every `.aot` save, every CSV edit and when the editor starts; `manual` only on **AOT: Sync CSVs Now** (`Ctrl+K Y`). The rule is the same either way. |
| `aot.spellingHints` | `true` | Check spelling and number in English: hint words no English dialect knows, on their span and on hover, never in the Problems panel, and warn when a Concept's name looks plural. A lowercase word passes if its Capitalised form is known (`december` / `December`). Each suggestion is a **Replace with 'X'** Quick Fix, and a lone suggestion is preferred, so `Ctrl+.` `Enter` applies it in one stroke. **`Ctrl+.` anywhere in a `.aot` offers Turn off (or on) spelling checks**, for writing in another language. Off also stops the plural warning, the same kind of English-only guess. |
| `aot.acceptedWords` | `[]` | Your own vocabulary, case-insensitive — fed by the Quick Fix on a spelling hint or a plural warning. |
| `aot.exampleHints` | `true` | Hint a value that names no Example of the Concept typing its attribute, with a Quick Fix that lists it. See [Values against their Concept](language.md#values-against-their-concept). |
| `aot.synonymWarnings` | `true` | Warn when two Concepts look like two names for one idea (rule 14). Repo-wide. |
| `aot.distinctConcepts` | `[]` | Pairs you have declared genuinely different, written `client\|customer` — fed by the Quick Fix on a synonym warning. |
| `aot.godelRegistry` | `true` | Keep the [Gödel numbers](checks.md#gödel-numbering) stable in `aot.files/godel.tsv`, written on save when the repository gains an attribute or a value. Commit it; **AOT: Set Up Git Merge for .aot Files** merges it with git's union driver. Safe to delete: it is rebuilt, with new numbers. |
| `aot.dependencyFindings` | `false` | Surface the inferred functional-dependency warnings (rules 12–13) as squiggles. Off by default: correlated attributes are allowed; `verify.js --fd` always prints the full set. Past 5,000 Examples in a file they are not worked out, and a warning on the first line says so. |
| `aot.chainHints` | `true` | Write the first dependency chain in small print (an inlay hint) at the end of each crosslinked line; the full chains stay on hover. |
| `aot.urlMetadata` | `true` | Hovering a URL fetches its status, content type, and last-modified date (one cached HEAD request); Ctrl+click opens it regardless. |
| `aot.parkedValueMarks` | `true` | Tint every value whose derivation is [parked](formulas.md#parking-the-derivations), so a computed number is never mistaken for a typed one; hover names the derivation and offers the key back. |
| `aot.python.enabled` | `false` | Calculate the [formulas](formulas.md) a file carries. The first formula offers to turn this on. A user setting only, and never in an untrusted workspace. |
| `aot.calculation` | `automatic` | When formulas calculate: `automatic` as a spreadsheet does ([Running](formulas.md#running)), or `manual`, only on `F9` and `Ctrl+Alt+F9`, for a file whose formulas write files or call services. |
| `aot.shortNumbers` | `true` | Show a computed number's first useful digits: `0.3` for `0.30000000000000004`, `0.3̅` for `0.3333333333333333`, `0.363...` for `0.363466035246486`. The file and the CSV keep every digit, and the cell a cursor stands in shows them. See [How a number shows](formulas.md#how-a-number-shows). |
| `aot.python.manager` | `auto` | Which Python runs: `auto` (the path below if set, else the [uv environment](formulas.md#the-environment-uv) set up here, else `python3` or `python` on PATH), `uv`, or `python`. User setting only. |
| `aot.python.path` | `""` | The interpreter, as an absolute path. Empty uses the uv environment or `python` on PATH, never one in the folder the run starts in. User setting only. |
| `aot.uv.path` | `""` | uv, for **AOT: Set Up Python Environment**. Empty finds `uv` on PATH. User setting only. |
| `aot.python.maxMemoryMb` | `4096` | The memory Python may take, enforced by the operating system; `0` for no limit. User setting only. See [Trust](trust.md). |
| `aot.python.allowSubprocess` | `false` | Let Python start other programs. User setting only. |
| `aot.python.allowNetwork` | `true` | Let Python open connections beyond this machine. User setting only. |
| `aot.python.protectCredentials` | `true` | Refuse Python the places credentials are kept, and withhold the secrets in the editor's environment. User setting only. |
| `aot.python.timeoutMs` | `15000` | How long one formula may run before its session is stopped. It then waits until it changes, and the rest go on in a fresh session. |
| `aot.python.idleTimeoutMs` | `300000` | How long an idle session — and the live results it holds — is kept once its file is off screen. |
| `aot.python.maxResultBytes` | `8000000` | The largest result a derivation may send back; a bigger one stops the session with a message. |
| `aot.python.maxInlineText` | `120` | Longer text (or any with a line break) is written to `aot.files/<address>.md`, the value its path. |
