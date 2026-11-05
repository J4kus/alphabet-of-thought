# Trust

[Back to the README](../README.md)

A `.aot` with Python in it is **a program**, and it runs with your permissions. It can read your files, reach the network, and write what it finds into the document, where a commit and the CSV mirror carry it on. Python cannot be sandboxed inside its own process, so this is a **marked trust boundary**, not a sandbox. The boundary is drawn in layers:

**A formula runs on its own, each time what it reads changes.** That is what makes a file calculate like a spreadsheet, and it is why this boundary matters: a formula that writes a file or calls a service does so again each time. Give a file like that `aot.calculation: manual`, and read formulas you did not write before you enable them.

**What may run at all**
- **`aot.python.enabled` is off until you turn it on**: the first formula offers to, in one click, and that answer is yours alone. Nothing runs in a workspace VS Code does not trust.
- **The settings that decide what runs are yours alone.** `aot.python.enabled`, `aot.python.manager`, `aot.python.path`, `aot.uv.path` and every guard below are user settings, so no repository's `.vscode/settings.json` can turn Python on, choose the program that runs, or loosen a guard.
- **A program is found on PATH and nowhere else.** On Windows, launching `python` by its bare name also looks in the folder the process starts in, and a run starts in `aot.files`, where a repository could leave a `python.exe` of its own. So `python` and `uv` are resolved to absolute paths from PATH's absolute entries before anything is launched.

**What is asked about first**
- **The Python a `.aot` carries is asked about piece by piece.** Each derivation and each constraint's bound is known by a hash of its text.
  - One written in this editor is yours and runs without asking, saved or not.
  - One that arrived from outside waits, and nothing stops for it: the values stay as they are, the status bar says `Formulas paused`, and one notice asks. That covers code on disk that never ran here (a pull, a clone, another tool), and code the editor brought in itself: a store coming home, a CSV folded back, a peer file reconciled.
  - The notice names the lines and the code: **Enable** calculates them, and **Show Them** lists them all. `F9` asks again.
- **Every Python file is asked about by its path the first time a calculation reaches it.** That includes the sidecar, a module a derivation names, and a module those import, because a file's top-level code runs the moment it loads.
  - The answer is kept per file, by a SHA-256 hash of its content.
  - A change saved **in this editor** is yours and runs without asking. A change that arrives from **outside** is asked about again, and **Show Changes** opens the version you allowed beside the one that is there now.
  - No folder is put on Python's import path. The runtime finds the repository's files itself, after the standard library and installed packages, so nothing in the repository can stand in for them.
- **An install is asked about before it happens**, listing what it will install (see [the environment](formulas.md#the-environment-uv)), since an installed package runs whenever Python starts.
- **Every answer is kept in VS Code's workspace state**, never in the repository, so no repository can ship its own.

**What the process is held to** (checked at start, before any repository code runs, and never lifted; **Show Python Environment** reports them):

| Setting | Default | What it does |
|---|---|---|
| `aot.python.maxMemoryMb` | 4096 | Memory is capped by the operating system: a job object on Windows, a data-size limit on Linux (the memory actually used, not the address space numpy and pyarrow reserve, so they import under it on a many-core machine). Past the cap an allocation fails instead of the machine grinding. numpy's BLAS is also held to four threads unless `OPENBLAS_NUM_THREADS` / `OMP_NUM_THREADS` / `MKL_NUM_THREADS` say otherwise. |
| `aot.python.allowSubprocess` | off | The process may not start another program. On Windows this is the operating system's refusal (the job object admits no second process), which nothing inside Python can undo. Elsewhere Python refuses the calls that start one. |
| `aot.python.allowNetwork` | on | When off, Python refuses connections beyond this machine. |
| `aot.python.protectCredentials` | on | Python refuses the places credentials are kept: `~/.ssh`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.kube`, `~/.docker`, `~/.gnupg`, `.netrc`, `.git-credentials`, the browsers' profiles, and the Windows credential store. The process also starts without the editor's secrets: variables such as `GITHUB_TOKEN` and `AWS_SECRET_ACCESS_KEY`, the ssh agent's socket, and VS Code's own askpass handles are withheld. |

Python's own refusals are its audit hooks. They stop the calls that make them, not code written to get round them (ctypes, an extension module), so they guard against the ordinary payload and the honest mistake. Only the operating system's limits hold against anything.

**What a result may write**
- **Data never becomes code.** A value Python writes has any `=` that would open a derivation doubled (`==`, which a reader sees as the one `=` it is). A column or row name that would read as a bound or a derivation has its operators made full-width. A CSV folded back is escaped the same way. So a downloaded table holding `x =os.system(…)`, or a column named `n >=evil()`, stays text.
- **A result that looks like a credential is not written.** That covers a private key, and AWS, GitHub, Slack, Anthropic, OpenAI-style or Google keys and tokens. What is written into the file is committed and pushed, so such a result is refused with a message saying why.

**What it does not do**
- **`verify.js` never runs Python**, so a CI job checking a pull request cannot be made to. [`check.js`](cli.md#the-calculating-check) does run it, and running it is the consent, so it is for your own files and trusted branches only. Nor should CI run `uv sync` for a pull request it has not reviewed. The `.formulas` store says it may hold Python.
- **What it costs:** "the file stands on its own" holds in letter, since every value is written and `V` judges them. But a Python value's provenance is no longer checkable from the text alone. The run records the interpreter and library versions, and the hover shows them.
- **Real containment is not done here.** Running the process in a container or an operating-system sandbox, with no network and a read-only repository, is the only way to hold code that is written to escape. Until then, the switch, workspace trust and the questions above are the protection.
