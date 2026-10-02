<!-- @import /home/lab/.claude/CLAUDE.md -->
<!-- @import /home/lab/workspace/.claude/CLAUDE.md -->

# Project-Specific Configuration

This file is an overlay. It imports two layers and copies neither:

- **User layer** - `/home/lab/.claude/CLAUDE.md`, applies to every project on this machine
- **Workspace layer** - `/home/lab/workspace/.claude/CLAUDE.md`, applies to everything under `~/workspace`

Both layers apply in full. Rules below extend or strengthen them; where they overlap, the stricter
wording wins. The workspace `/home/lab/workspace/.claude/` directory and the skills the two layers
name carry every standard not restated here.

## Mandatory Bans (Reinforced)

The following workspace rules are STRICTLY ENFORCED for this project:

- **No automatic git tags** - only create tags when user explicitly requests
- **No automatic version changes** - only modify version in package.json/pyproject.toml/etc. when user explicitly requests
- **No automatic publishing** - never run `make publish`, `npm publish`, `twine upload`, or similar without explicit user request
- **No manual package installs if Makefile exists** - use `make install` or equivalent Makefile targets, not direct `pip install`/`uv install`/`npm install`
- **No automatic git commits or pushes** - only when user explicitly requests

## Project Context

JupyterLab 4 extension, `kind: frontend-and-server`, scaffolded from the official copier template
`jupyterlab/extension-template` v4.6.5. It is a viewer for HTML files: it shows an `.html` file, the
user can trust it (let its scripts run) or refresh it as the built-in JupyterLab HTML viewer does,
and on top of that it carries the marks, comments and notes panel of the advanced Markdown viewer.

The reference design is the sibling project
`/home/lab/workspace/private/jupyterlab/jupyterlab_advanced_markdown_viewer_extension` - its
`README.md`, `docs/acc-crit-advanced-markdown-viewer.md` and `src/`. Read them before changing the
marks, comments or notes panel here.

**The rule that shapes this project**: a comment attaches only to content written in the HTML file
itself. Content the page's scripts produce while it runs is not in the file and takes no comment.
A comment on file content is stored in the file.

**How file text is told from page content**: the frame loads the file with an attribute
`data-jp-ahv` numbering every start tag (`src/source.ts`); parse5 reads the same text with the file
offset of every character. After load, a text node is file text when its element's number occurs
once in the page and its characters continue that element's file text (`src/origin.ts`). Text a
script adds or changes, and anything an iframe, object or embed of the page shows, takes no
comment. Marks are painted through the CSS Custom Highlight API (`src/paint.ts`), so the page's
DOM is never touched.

**Architecture**:

- **Frontend** (TypeScript, `src/`) - `viewer.ts` the widget, trust and refresh, render on a
  non-marker change only, hidden by content-visibility and never `display: none` so the frame keeps
  its size and scroll position behind another tab; `follow.ts` loads a change on disk; `marks.ts` the marker grammar of the
  advanced Markdown viewer; `store.ts` the edits into the file; `notes.ts` the controller and the
  write path; `notes-panel.ts`, `handle.ts`, `icons.ts`, `swatch.ts` ported from the Markdown
  viewer; `index.ts` the factory (default for `.html`), commands and context menu
- **Server** (Python, `jupyterlab_advanced_html_viewer_extension/routes.py`) - `POST write`, the
  compare-and-write route a marker write sends its edits to; the server makes them in the file
- **Cost on a large file** - a file can be megabytes of embedded images or script, so: the route
  takes the edits and not the text; `src/parse.ts` parses with parse5's tokenizer taking a run of
  plain characters in one piece (`src/__tests__/parse.spec.ts` holds its tree to parse5's);
  `analyse` keeps no run for text that takes no mark
- **Schema** (`schema/plugin.json`) - the note handle (`author`) and the Accel Shift M shortcut
- **Tests** - pytest in `jupyterlab_advanced_html_viewer_extension/tests/`, Jest in
  `src/__tests__/`, Playwright/Galata in `ui-tests/`
- **CI/CD** - GitHub Actions plus jupyter-releaser under `.github/workflows/`
- **Agent skill** (`.agents/skills/jupyterlab-advanced-html-viewer-extension/`) - `SKILL.md` tells an
  AI assistant how to write and answer the markers, `scripts/watch-marks.py` reports new comments;
  the wheel installs the skill under `share/jupyter/agents/skills/` (shared-data in `pyproject.toml`);
  `src/__tests__/skill.spec.ts`, `tests/test_watch_marks.py` and `ui-tests/tests/skill.spec.ts` hold
  its examples to the viewer. A change to the marker grammar or to where markers go changes the skill
  in the same commit

**Feature specification** - criteria in `docs/acc-crit-advanced-html-viewer.md`, defects in
`docs/defects-advanced-html-viewer.md`, both written and read only through `pm-tools`.

## Build Lifecycle - Makefile Only

The Makefile owns the whole build lifecycle. Never run `pip`, `jlpm`, `yarn`, `npm`,
`python -m build`, `twine`, or any build, publish or clean command directly - those bypass the
project-local `.nodeenv/` toolchain the Makefile pins.

| Target          | Effect                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| `make install`  | build and install the extension (raises the patch version, by design of Makefile 1.42+) |
| `make publish`  | release to npm and PyPI - needs explicit approval every time                            |
| `make clean`    | remove build artefacts                                                                  |
| `make mrproper` | remove all build and virtual-environment artefacts                                      |
| `make test`     | Jest, pytest and the endpoint authentication gate                                       |

**Makefile version check**: the local Makefile declares its version on line 1. Compare it against
`/home/lab/workspace/private/jupyterlab/@utils/jupyterlab-extensions/Makefile` and copy the canonical
file over the local one as soon as a newer version is found. Check at the start of any build work.
Local version at project creation: 1.43, identical to canonical.

**The Galata suite has no Makefile target**, so it is the one lifecycle step outside the Makefile:
`jlpm install` and `jlpm playwright install chromium` in `ui-tests/`, then
`JUPYTER_TEST_PORT=<free port> jlpm playwright test`. Port 8888 belongs to this workstation's own
lab. Redirect output to a file instead of `| tee`, which reports tee's exit status.

## Git Rules (Project-Specific)

- The repository was initialised with `git init -b main` and an initial import of every artefact
- **Always commit `package.json`, `package-lock.json` and `yarn.lock` together** - a lockfile left
  behind makes CI fail with YN0028 on an immutable install. Makefile 1.41+ produces no
  `package-lock.json`, so in practice this is `package.json` with `yarn.lock`, and
  `ui-tests/package.json` with `ui-tests/yarn.lock`

## Journal Rules (Project-Specific)

- **APPEND ONLY**: New journal entries MUST be appended at the end of the file, never inserted between existing entries
- Entries maintain strict chronological order by position - the last entry in the file is always the most recent work
- Never reorder, move, or insert entries out of sequence
- The Stellars **journal plugin** is the canonical tool for this file: create via `/journal:create`, append via `/journal:update`, archive via `/journal:archive`. The `journal:journal` skill auto-triggers on any mention of "journal" and runs `journal-tools check` after every write
- Direct edits to `JOURNAL.md` are a last resort - prefer the plugin so modus secundis format, continuous numbering and append-only order are enforced automatically

## Acceptance Criteria and Defects

- Criteria live in `docs/acc-crit*.md` and defects in `docs/defects*.md`, written **only** through
  the project-management plugin (the `pm-tools` CLI), never by a hand edit of either file:
  `/project-management:acc-crit` adds, closes, rejects or relates a criterion,
  `/project-management:defect` files, triages, logs or closes a defect, `/project-management:report`
  gives status and coverage
- **Every feature gets its acceptance criteria before the code**, and every criterion names the test
  that proves it
- **Functional tests under `ui-tests/` are part of every feature**, not an afterthought, and run
  green before a release
- Close a criterion only on evidence - the test that ran and what it showed

## Command-Line Tools and Their Agent Skill

A command-line tool the extension ships (an entry point under `[project.scripts]` in
`pyproject.toml`) gets an agent skill at `.agents/skills/<cli-name>/SKILL.md` in the repository root.

- **Content** - how an agent runs each command, which commands keep a secret or a large output out
  of the agent's context, and what each error asks for next, all checked against the code
- **Same commit** - the skill changes in the same commit as the CLI
- **README** - says where the skill is and gives the line that links it into Claude Code:
  `ln -s "$PWD/.agents/skills/<cli-name>" ~/.claude/skills/<cli-name>`
- **Never inside the Python package** - the CI link check imports the package for every link in a
  Markdown file inside it, and fails without `jupyter_server`
- **Reference implementation** -
  `/home/lab/workspace/private/jupyterlab/jupyterlab_passkey_extension/.agents/skills/jupyterlab-passkey/SKILL.md`

## Scope Control - graphify

- Run `/graphify` once the first source is in place to build `tmp/graphify-out/`
- Run `graphify affected` before editing existing code to learn its callers and dependents; that
  affected set is the change budget, and an edit outside it needs the Star Colonel's word
- Run `graphify update` after every edit
- `tmp/` is gitignored, so the graph never ships

## Required Skills

| Skill                                   | Use                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `jupyterlab-extension`                  | extension development guidelines, testing strategy, CI/CD, caveats                    |
| `my-browser`                            | browser automation for screenshots and UI verification against the running JupyterLab |
| `project-management:project-management` | acceptance criteria and defects through the `pm-tools` CLI                            |
| `graphify`                              | the codebase graph and the impact analysis that bounds every change                   |
| `journal:journal`                       | the project journal through the `journal-tools` CLI                                   |

## Strengthened Rules

- **Styling through JupyterLab CSS variables only** - no literal colours, so every theme renders the
  viewer; verify on stock light and stock dark with `my-browser`
- **No screenshot claim without a render** - a statement about the viewer's visible behaviour needs a
  real browser session behind it
- **Untrusted HTML never runs scripts** - an untrusted file renders in a sandboxed frame without
  `allow-scripts`, as the built-in HTML viewer does; no feature of this extension may widen the
  sandbox before the user trusts the file
