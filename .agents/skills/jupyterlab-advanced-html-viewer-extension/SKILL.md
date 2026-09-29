---
name: jupyterlab-advanced-html-viewer-extension
description: Mark passages of an HTML file in one of six colours, comment on a passage or on the whole page, hide a mark, answer and close the user's comments, and watch a file for new comments - the HTML-comment markers that jupyterlab_advanced_html_viewer_extension shows in its JupyterLab HTML viewer and Notes panel. Use when an HTML file holds `mark:` HTML comments, when the user asks to mark, highlight, colour, hide or comment on text in an HTML file, to leave a note on the whole page, or to watch an HTML file for comments.
---

# HTML marks

`jupyterlab_advanced_html_viewer_extension` keeps marks and comment threads in the HTML file as HTML comments. Its viewer paints the marked text in the mark's colour and lists every thread in its Notes panel; a browser shows nothing. Edit the file on disk: an open viewer shows the change within a few seconds. The grammar is the one the advanced Markdown viewer writes; where the markers go differs.

## A mark

```html
<p>The cost is <!-- mark:0f8e5a52-3c1d-4b7a-9e2f-6a1b2c3d4e5f note colour=blue
@kj 2026-09-28T09:15:00Z: Per house or per farm?
@claude 2026-09-28T09:16:40Z: Per house, source table 2
-->40 EUR<!-- /mark:0f8e5a52-3c1d-4b7a-9e2f-6a1b2c3d4e5f --> per house.</p>
```

- **Id** - a new lowercase UUID version 4 (`python3 -c "import uuid; print(uuid.uuid4())"`), the same in the opening and the closing comment. A marker with any other id is ignored
- **Type** - `note`, directly after the id
- **Colour** - `colour=` then `yellow`, `blue`, `pink`, `orange`, `red` or `green`; no colour, or another word, reads as yellow. To recolour, replace the word. The extension gives the colours no meaning: use the meanings the user gives
- **Hidden** - `status=closed` after the colour. The viewer does not paint the mark; the Notes panel lists it under Show hidden. Remove `status=closed` to show it again
- **No comment** - the opening comment on one line: `<!-- mark:<id> note colour=green -->`
- **Comment line** - `@<handle> <YYYY-MM-DDTHH:MM:SSZ>: <text>`: UTC, whole seconds, `Z`, then a colon. A line of any other shape continues the line above it, so a stamp with milliseconds joins your text to the user's comment. Sign as `@claude` unless the user names another handle
- **Comments** - one per line after the attributes, with `-->` on its own line after the last, as the viewer writes them. To add one, put your line directly before that `-->`. On a marker with no comment yet, end the attribute line after the attributes and write your line, then `-->` on its own line
- **Comments on the marker's one line** - a marker can hold its comments on its first line, joined by a literal `\n`, as the Markdown viewer writes them in a table row. Add yours there as `\n@claude <stamp>: <text>` before ` -->`, with a `\` in your text written `\\`. A line break in such a marker makes the viewer drop the mark
- **Text** - write `-->` as `-- >` and `--!>` as `--! >`; no blank lines; a line that continues a comment and starts with `@` takes one leading space
- **Settings** - leave `<!-- marks:settings panel=... -->` as it is; the Notes panel writes it

## A comment on the whole page

```html
<!DOCTYPE html>
<!-- mark:6d2b7c1e-8f3a-4e5b-9c0d-1a2b3c4d5e6f document
@claude 2026-09-28T09:20:00Z: Sections 3 and 5 repeat the cost table. Keep which?
-->
<html>
<body>
<h1>Pilot proposal</h1>
</body>
</html>
```

- Type `document`, no closing comment, no marked text
- On a line of its own directly after the doctype line, or on line 1 of a file with no doctype, where the viewer writes it
- One per file: when the file has one, add your line to it

## Where the markers go

Only text written in the file takes a mark. The opening comment goes directly before the first marked character, the closing comment directly after the last, both touching the text: add no space or line break around them. A passage may run across tags, as in the list below.

- **Never inside a tag** or an attribute value
- **Never inside** `script`, `style`, `title`, `textarea`, `noscript`, `iframe`, `xmp`, `noembed`, `noframes` or `plaintext`: their content is read as text, so a marker there is no marker and can show on the page
- **Never split** a character reference such as `&amp;`
- **Never around** an `iframe`, `object` or `embed`: what they show is not in the file
- **Never on text a script writes**: it is not in the file. Do not nest marks

```html
<ul>
  <li><!-- mark:3c9d1f20-5a4b-4c6d-8e7f-0a1b2c3d4e5f note colour=pink -->Energy budget</li>
  <li>Second<!-- /mark:3c9d1f20-5a4b-4c6d-8e7f-0a1b2c3d4e5f --> item</li>
</ul>
<table>
  <tr><td>Heater</td><td><!-- mark:9a8b7c6d-5e4f-4a3b-b2c1-d0e1f2a3b4c5 note colour=red status=closed
@kj 2026-09-28T09:15:00Z: Wrong unit?
@claude 2026-09-28T09:16:40Z: Fixed, kWh
-->40 kWh<!-- /mark:9a8b7c6d-5e4f-4a3b-b2c1-d0e1f2a3b4c5 --></td></tr>
</table>
```

## Answering the user

1. Read the whole mark from the file: a thread can hold several lines, and the user can add lines while you work
2. Do what the comment says, in the file
3. Add one comment after the user's last one, saying what changed, at most 15 words. Keep the mark
4. When you cannot act without an answer, that line is the question
5. The user's last line is one word - `done`, `ok`, `resolved` or `remove`: delete both comments, from `<!--` to `-->`, and keep the marked text. The word `hide`, `close` or `closed`: add `status=closed` and keep the comments. With more words after that word, do the rest first
6. Never delete a mark unless step 5 says so. Leave a `status=closed` mark as it is unless the user asks to show it
7. Edit by exact replacement, and check that the old text occurs once before you write: the user edits the same file. Never rewrite the whole file to change one part

## Watching a file

`scripts/watch-marks.py` in this skill's directory prints one line for each thread the user adds to. Its options: `python3 scripts/watch-marks.py --help`.

1. Choose a list file for this session only, for example `watch-list.txt` in the session's scratch directory
2. `python3 <skill dir>/scripts/watch-marks.py add --list <list> <file> ...` - stops with an error on a file that does not exist
3. Start one background process: `python3 <skill dir>/scripts/watch-marks.py run --list <list> --me <handle>`, where `<handle>` is the handle you sign with, without the `@`. Each line it prints is one event. In Claude Code, run it with the Monitor tool, `timeout_ms` 1800000, and start it again each time it expires
4. To add a file later, run `add` again: the running process reads it within 5 seconds. `remove` takes a file out
5. Keep a task that holds the absolute paths and both commands, so a new session can start the watch again

| Event                               | Do                  |
| ----------------------------------- | ------------------- |
| `<file> \| watching`                | nothing             |
| `<file> \| missing`                 | tell the user       |
| `<file> \| new note <id> \| <text>` | answer it, as above |
| `<file> \| reply <id> \| <text>`    | answer it, as above |

- The first pass reports every open thread whose last line is not yours
- Your own lines, a hidden mark and a change of colour are not reported
- A user's line is reported even when a line of yours follows it: when that line of yours already answers it, do nothing
- To stop: end the background process, and name every mark that is still open
