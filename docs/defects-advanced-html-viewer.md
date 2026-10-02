# Defects - jupyterlab_advanced_html_viewer_extension

Defects of the advanced HTML viewer: the sandboxed frame, the marks it paints and writes into the file, and the notes panel beside it.

## Authors

- `@kj` Konrad Jelen

## Viewing, trust and refresh `VIEW`

The sandboxed frame, trust, refresh and rendering the page again

- [x] `DEF-VIEW-1` **Page loaded again when the notes panel opens** - MAJOR; the first mark on a document opened the notes panel and the page loaded again: scroll lost, script state lost, markers in the page; cause: the box layout sends an update request to the viewer whenever it refits, and the viewer rendered on every update request, as the built-in HTMLViewer does; fix: render only on the viewer's own triggers; src/viewer.ts
  - evidence: Galata ACC-STORE-36 and ACC-MARK-42 red before the fix, green after on build 0.1.3; full suite 56 of 56
  - root-cause: 2026-09-28T13:53:33Z @kj Lumino BoxLayout._fit ends by sending UpdateRequest to the layout's parent; the stack of the render showed K._fit -> sendMessage -> onUpdateRequest
  - repro: mark the first passage of an unmarked file, read a property set on the frame window
  - test-tags: FUNCTIONAL
  - log: 2026-09-28T13:53:33Z @kj added; reason: the line carries symptom, cause, fix and file as the defect format asks
  - log: 2026-09-28T13:53:33Z @kj reported: Galata ACC-STORE-36 read undefined for the frame window property and ACC-MARK-42 found the markers in the page after a mark
  - log: 2026-09-28T13:53:33Z @kj closed: fixed: onUpdateRequest no longer renders; _render is called on context ready, a non-marker change, trust and refresh
- [x] `DEF-VIEW-18` **Selection rule turns selected HTML text white on a page that sets only a selection background** - MAJOR; found in review before release; page with ::selection { background: #b3d4fc } and no colour: the viewer's layered ::selection rule gives selected HTML text HighlightText, white on the page's light blue; SVG text the same
  - evidence: selector narrowed to svg ::selection; Galata viewer.spec 'ACC-VIEW-78' green on build 1.0.30: paragraph on a page with a selection background alone keeps rgb(34, 34, 34); HTML selection untouched on 7 page kinds measured in Chromium
  - repro: page with that rule, select a paragraph of colour #222: painted 255,255,255 on 179,212,252
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-02T07:23:04Z @kj the rule's selector is every element; the page's rule wins for background and the viewer's for colour
  - log: 2026-10-02T07:23:04Z @kj added
  - log: 2026-10-02T07:32:52Z @kj closed
- [x] `DEF-VIEW-24` **Selected SVG text takes mixed colours where a page's more specific rule sets one selection colour alone** - MINOR; deferred in review rounds 1 to 3; page with svg text::selection { background: #b3d4fc } and no colour: selected SVG text is 255,255,255 on 179,212,252 with the viewer's rule, 0,0,0 on the same background without it
  - evidence: wontfix, ruled in review rounds 1 to 3: needs a page rule on SVG text more specific than svg ::selection that sets one colour alone; a fix must read the page's ::selection rules, a new mechanism; the layered and the :where selector were measured and fail on more pages
  - related: ACC-VIEW-78, DEF-VIEW-18 - the selection rule these set
  - repro: Chromium 153, scratchpad r3/residual.js: five page rules, each with and without the viewer's rule
  - test-tags: MANUAL
  - root-cause: 2026-10-02T08:27:22Z @kj the page's rule wins for the property it sets and the viewer's svg ::selection supplies the others; CSS cannot make one colour of the pair depend on who set the other
  - log: 2026-10-02T08:27:22Z @kj added
  - log: 2026-10-02T08:27:35Z @kj closed

## Where text comes from `ORIGIN`

Reading the file and telling its text from content the page produces

- [x] `DEF-ORIGIN-2` **Blank page for a text over 120,000 characters** - CRITICAL; a file holding one text node longer than about 120,000 characters, such as an inline script of a self-contained report, showed a blank frame; analyse threw 'Maximum call stack size exceeded'; src/source.ts
  - related: ACC-VIEW-1 - the viewer opens the file
  - evidence: jest 'DEF-ORIGIN-2 reads a page holding a text of 200,000 characters' in src/__tests__/source.spec.ts red before the fix, green after; build 0.1.5: jest 63 of 63, pytest 8 of 8, Galata 57 of 57
  - repro: open a file with an inline script of 200,000 characters
  - test-tags: UNIT
  - root-cause: 2026-09-28T15:34:35Z @kj analyse appended each text node's offsets with push(...placed.starts), one call argument per character
  - log: 2026-09-28T15:34:35Z @kj added
  - log: 2026-09-28T15:40:31Z @kj closed: fixed: offsets appended one push per character; src/source.ts
- [x] `DEF-ORIGIN-13` **Opening a page with a large script exhausts browser memory** - CRITICAL; 13 MB page holding one 10.5 MB script: this viewer's heap reaches 1357 MB at open, the built-in viewer's 98 MB; the reporter's browser crashes; Node: 2.2 GB after one reading, 2.8 GB after the two made at open
  - evidence: generated 13 MB page with a 10.5 MB script, Chromium: heap after open 122 MB on build 1.0.17 (1105 MB before the parser change, 1357 MB on the reported file with 1.0.12; built-in viewer 98 MB), page shown after 0.48 s (was 3.9 s); Galata 69/69, jest 102, pytest 32
  - related: ACC-ORIGIN-75
  - related: ACC-ORIGIN-76
  - repro: open a 13 MB .html holding a 10 MB script element in the Advanced HTML Viewer; read the heap with CDP Runtime.getHeapUsage
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-10-02T02:21:46Z @kj analyse keeps a run for the text of script, style and the other raw-text elements, which takes no mark: the text plus two numbers per character, each built twice, for text every consumer treats as absent
  - log: 2026-10-02T02:21:46Z @kj added
  - log: 2026-10-02T02:51:28Z @kj closed
- [x] `DEF-ORIGIN-14` **A script on many short lines is parsed line by line** - MEDIUM; 13.4 MB page whose script has 560,000 lines of about 14 characters, Chromium, build 1.0.18: page shown after 1.6 s, Add Comment to note field 0.76-1.07 s, saved note shown 0.94-0.98 s; a script of the same size on one line: 0.25 s
  - evidence: same 13.4 MB page, Chromium, build 1.0.19: page shown after 0.48 s (was 1.6), Add Comment to note field 0.27-0.42 s (was 0.76-1.07), saved note shown 0.31-0.35 s (was 0.94-0.98); reading 87 ms in Node (was 554-670); jest parse.spec 23 green, 3 mutations of the line count fail it
  - related: ACC-ORIGIN-76
  - repro: open a page holding a 13 MB script of JSON written with indent=2, add a comment and save a note
  - test-tags: UNIT
  - root-cause: 2026-10-02T03:27:09Z @kj a run in src/parse.ts ends at every line break, so each line costs two steps and two character tokens; found by review round 1, deferred by its adjudicator
  - log: 2026-10-02T03:27:09Z @kj added
  - log: 2026-10-02T03:34:01Z @kj closed
- [x] `DEF-ORIGIN-15` **Run pattern exhausts the regular expression stack on millions of lines** - MAJOR; a script of more than about 2.1 million plain lines (3.36 million in Chromium 153) makes IN_RAW_TEXT throw RangeError, Maximum call stack size exceeded; parseDocument throws and the page does not show; parse5 parses the same page; uncommitted code, found by review round 2
  - evidence: jest parse.spec 'DEF-ORIGIN-15 takes a script of 3,400,000 lines without a throw': RangeError before the pattern change, green after, line 3400001 col 10 offset 10200025 as parse5; build 1.0.20: jest 108, pytest 32, Galata 69/69
  - repro: parseDocument of a script holding 2,400,000 lines of '  0.123456,' throws
  - test-tags: UNIT
  - root-cause: 2026-10-02T03:47:55Z @kj the pattern repeats a group once per line, and the engine keeps one stack entry per repetition; added with DEF-ORIGIN-14 beyond the round 1 plan
  - log: 2026-10-02T03:47:55Z @kj added
  - log: 2026-10-02T03:53:40Z @kj closed

## Marking in the page `MARK`

Making, painting and opening marks in the rendered page

- [x] `DEF-MARK-3` **Keyboard mark goes to the viewer last right-clicked** - MAJOR; Ctrl Shift M and the palette's Mark and Show notes acted on the viewer last right-clicked, not the viewer in front, and could write a mark into another file; src/index.ts
  - related: ACC-MARK-40 - marking from the keyboard
  - evidence: Galata 'DEF-MARK-3 marks from the keyboard in the viewer in front, not the one last right-clicked' in ui-tests/tests/marks.spec.ts red on build 0.1.4, green on 0.1.5; build 0.1.5: jest 63 of 63, pytest 8 of 8, Galata 57 of 57
  - repro: right-click in viewer A, press Escape, select text in viewer B, press Ctrl Shift M
  - test-tags: FUNCTIONAL
  - root-cause: 2026-09-28T15:34:35Z @kj the lab keeps the last contextmenu event and never clears it; target() resolved every command through app.contextMenuHitTest
  - log: 2026-09-28T15:34:35Z @kj added
  - log: 2026-09-28T15:40:31Z @kj closed: fixed: keyboard mark acts on its own viewer; commands consult the context menu only when run from it; src/index.ts
- [x] `DEF-MARK-7` **Key outside the frame is silent on a refused selection** - MINOR; focus in the viewer outside the frame, page holds a refused selection: Accel Shift M shows no notice, only a console warning; contradicts ACC-ORIGIN-21
  - evidence: Galata 'DEF-MARK-7 says why when the key is pressed outside the frame' in ui-tests/tests/origin.spec.ts, red on build 0.1.8 (no notice), green on 0.1.9, also asserts the palette call stays disabled; build 0.1.9: Galata 61 of 61, jest 64 of 64, pytest 8 of 8
  - related: ACC-ORIGIN-21 - the notice it breaks; ACC-MARK-40 - the palette rule the fix keeps
  - repro: trusted page, select script text, focus a viewer toolbar button, press Control Shift M
  - test-tags: FUNCTIONAL
  - root-cause: 2026-09-28T19:15:21Z @kj Lumino runs a key binding only when isEnabled is true; markSelection is enabled only for file text (ACC-MARK-40), so markSelected and its notice never run
  - log: 2026-09-28T19:15:21Z @kj added
  - log: 2026-09-28T19:23:40Z @kj closed: fixed

## Following the file `LIVE`

Loading a change another process writes to the file into the open viewer

- [x] `DEF-LIVE-4` **Line endings lost after a load from disk** - MAJOR; after the follower loaded a file whose line ending changed, the next marker write used the ending read at open, changing every line ending of the file; src/follow.ts
  - related: ACC-LIVE-11, ACC-STORE-28 - loading a change, keeping CRLF
  - evidence: jest 'DEF-LIVE-4 takes the line ending of the text it loads' in src/__tests__/follow.spec.ts red before the fix, green after; build 0.1.5: jest 63 of 63, pytest 8 of 8, Galata 57 of 57
  - repro: open an LF file, rewrite it on disk as CRLF, wait 2 s, add a mark
  - test-tags: UNIT
  - root-cause: 2026-09-28T15:34:36Z @kj Follower loaded the text and recorded the revision but not the context's _lineEnding, which the route write and context.save read
  - log: 2026-09-28T15:34:36Z @kj added
  - log: 2026-09-28T15:40:31Z @kj closed: fixed: follower sets the context line ending from the loaded text; src/follow.ts
- [x] `DEF-LIVE-16` **Place in the page lost after a change while the tab is behind** - MAJOR; file changes on disk while the viewer's tab is behind another tab: the page loads in a frame hidden by display: none, window 0 by 0, scroll read as 0; on return the page is at its top, a slide deck at slide 1
  - related: ACC-VIEW-77
  - evidence: Galata viewer.spec 'ACC-VIEW-77' green on build 1.0.25, red on a build without the change; deck copy, file rewritten while tab behind: scrollY 1918 kept, window 1330 by 959 at load; full Galata 70 of 70
  - repro: trust a deck, go to slide 3, open another tab, rewrite the file with other text, return: scrollY 0, was 1918
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-02T05:11:10Z @kj the dock panel hides a tab with display: none; the frame loses its box, so _render reads scrollY 0 and scrollTo on load does nothing
  - log: 2026-10-02T05:11:10Z @kj added
  - log: 2026-10-02T05:22:46Z @kj closed
- [x] `DEF-LIVE-21` **A trusted page takes the keyboard while its tab is behind another** - MAJOR; trusted page whose script calls focus(): loaded after a change on disk while the viewer's tab is behind a terminal, it takes the keyboard, and the keys typed go to the hidden page; same with display: none, so older than content-visibility hiding
  - evidence: Galata viewer.spec 'DEF-LIVE-21': editor behind which the page reloads holds 'abcd' and the page got no key; red on build 1.0.29 ('ab'), green on 1.0.30; full Galata 72 of 72
  - repro: trust a page with input.focus() in a script, put an editor tab in front, type, rewrite the file, type again: the second keys reach the page
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-02T07:23:19Z @kj nothing stops a script of a hidden frame from taking focus; the inert attribute does not
  - log: 2026-10-02T07:23:19Z @kj added
  - log: 2026-10-02T07:33:04Z @kj closed
- [x] `DEF-LIVE-22` **A hidden page takes the keyboard from the page of a second viewer** - MINOR; found in review; two viewers, keyboard inside the visible viewer's page: a trusted page of the hidden viewer whose script calls focus() takes it; the lab window is sent no blur, so the give-back of DEF-LIVE-21 does not run; same on 1.0.29
  - related: DEF-LIVE-21
  - evidence: Galata viewer.spec 'DEF-LIVE-22': front page gets a b c d and the hidden page no key; red on build 1.0.30 (front page a b), green on 1.0.32; harness 7 cases incl. timer and re-grab; full Galata 73 of 73
  - repro: trust a page with input.focus() in a script, open a second html page in front, click its input, type, rewrite the first file, type again: the second keys reach the hidden page
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-02T08:01:32Z @kj the give-back is triggered by the lab window's blur alone, which is sent only when the keyboard leaves the lab's own document
  - log: 2026-10-02T08:01:32Z @kj added
  - log: 2026-10-02T08:09:56Z @kj closed
- [x] `DEF-LIVE-23` **A hidden page holds the keyboard where it moved between two frames** - MINOR; found in review round 3; (a) three viewers, two side by side: after a click from one page straight into the other, a hidden page's focus() sends the keys to the earlier page; (b) two viewers: a hidden page calling focus() while parsing keeps the keys until its load event
  - evidence: wontfix, ruled in review round 3: not on the path with a terminal in front, not a regression, the harm ends at the next click (a) or at the load event (b); each remedy is a new mechanism (a holder shared between viewers, a blur listener in every page), unmeasured
  - related: DEF-LIVE-22 - remainder of that defect
  - repro: scratchpad harness architect5/three.js (a); r4/galata/attack.spec.ts test T1 with an image answered after 5 s (b)
  - test-tags: MANUAL
  - root-cause: 2026-10-02T08:27:20Z @kj a move of the keyboard from one frame to another sends the lab document no event; the viewer learns of it at its own frame's load event and through the listener installed at that event
  - log: 2026-10-02T08:27:20Z @kj added
  - log: 2026-10-02T08:27:34Z @kj closed

## Notes panel `PANEL`

The list of marks and their notes beside the page

- [x] `DEF-PANEL-5` **Page script changes rebuild the note field** - MAJOR; on a trusted page whose script changes its content, every change rebuilt the whole notes panel 150 ms later, so the note field being typed in lost its undo history, an IME composition and a click straddling the rebuild; src/notes.ts
  - related: ACC-PANEL-51, ACC-PANEL-58 - writing a note, listing an unanchored mark
  - evidence: Galata 'DEF-PANEL-5 keeps the note field while a script changes the page' in ui-tests/tests/panel.spec.ts red on build 0.1.5, green on 0.1.6, ACC-PANEL-58 green; build 0.1.6: jest 63 of 63, pytest 8 of 8, Galata 58 of 58
  - repro: trust a page whose script rewrites a counter every 300 ms, type in a note field
  - test-tags: FUNCTIONAL
  - root-cause: 2026-09-28T15:50:40Z @kj the page observer calls _rematch, which emitted changed on every call; sync then rebuilt the panel although no listed mark moved
  - log: 2026-09-28T15:50:40Z @kj added
  - log: 2026-09-28T15:56:30Z @kj closed: fixed: a page change emits changed only when a listed mark moved or lost its passage; src/notes.ts
  - log: 2026-09-28T16:05:02Z @kj regressed as DEF-PANEL-5-1
- [x] `DEF-PANEL-5-1` **Page script changes rebuild the note field** - MAJOR; on a trusted page whose script changes its content, every change rebuilt the whole notes panel 150 ms later, so the note field being typed in lost its undo history, an IME composition and a click straddling the rebuild; src/notes.ts
  - test-tags: FUNCTIONAL
  - repro: trust a page whose script appends a line above the marked paragraph every 300 ms, type in a note field
  - evidence: Galata 'DEF-PANEL-5-1 keeps the note field while a script grows the page above the mark' in ui-tests/tests/panel.spec.ts red on build 0.1.6, green on 0.1.7, DEF-PANEL-5 and ACC-PANEL-48 green; build 0.1.7: jest 63 of 63, pytest 8 of 8, Galata 59 of 59
  - root-cause: 2026-09-28T16:05:02Z @kj the page-change comparison in _rematch counts position, which is top over scrollHeight, so any change of page height moves every position and emits changed; only the minimap ticks read position
  - log: 2026-09-28T16:05:02Z @kj regression of DEF-PANEL-5: reported: a script that grows the page still rebuilds the note field; Galata DEF-PANEL-5-1 red on build 0.1.6
  - log: 2026-09-28T16:09:40Z @kj closed: fixed: position counts in the page-change comparison only while the minimap shows ticks; src/notes.ts
  - log: 2026-09-28T16:09:55Z @kj edited repro added "trust a page whose script appends a line above the marked paragraph every 300 ms, type in a note field"; test-tags added "FUNCTIONAL"

## Functional tests `TEST`

Defects of the Galata suite itself

- [x] `DEF-TEST-6` **Galata reads the frame before it settles** - MEDIUM; CI run 36466759448 on d82c0b4 failed 2 of 60: ACC-STORE-29 read no paint after marking; ACC-ORIGIN-17 threw TypeError reading parentElement of null after Trust
  - evidence: marks.spec ACC-STORE-29 and ACC-MARK-37 poll the paint; origin.spec ACC-ORIGIN-17 and panel.spec DEF-PANEL-5 frame reads are null-safe; changed tests 12 of 12 over --repeat-each 3; Galata 60 of 60 locally on build 0.1.8
  - repro: slow runner: CI Build Integration tests; locally 60 of 60 pass
  - test-tags: FUNCTIONAL
  - root-cause: 2026-09-28T18:48:40Z @kj painted() read once after the marker reached disk, while the paint runs one animation frame after the write returns; a poll callback threw on the blank frame document during the reload after Trust, and a throwing expect.poll callback ends the poll
  - log: 2026-09-28T18:48:40Z @kj added
  - log: 2026-09-28T18:53:27Z @kj closed: fixed

## Agent skill `AGENT`

the skill that lets an AI assistant mark, comment and watch the file on disk

- [x] `DEF-AGENT-8` **close deletes a thread the viewer only hides** - MAJOR; SKILL.md step 5 deletes both comments on the user's one word close or closed; the viewer's Close this mark button sets status=closed and keeps the thread, so the assistant destroys a thread the user meant to hide
  - evidence: SKILL.md step 5: hide, close and closed add status=closed and keep the comments; step 6 deletes only as step 5 says; adversarial review confirm round 2 (wf_099157a5-f7d) 0 findings
  - related: ACC-AGENT-68
  - repro: thread whose last user line is close; skill step 5 says delete both comments
  - test-tags: MANUAL
  - root-cause: 2026-09-29T13:06:43Z @kj the port kept the Markdown skill's word list; this viewer names hiding Close (src/notes-panel.ts Close this mark calls setClosed)
  - log: 2026-09-29T13:06:43Z @kj added
  - log: 2026-09-29T13:11:49Z @kj closed
- [x] `DEF-AGENT-9` **backslash not escaped in the one-line marker form** - MINOR; SKILL.md one-line comment rule omits writing a backslash as two; the viewer (src/marks.ts unescapeInline) and the watcher unescape backslash-n and double backslash, so C:\new reads as C: plus a line break plus ew
  - evidence: SKILL.md one-line rule: a backslash is written doubled; jest skill.spec 'a backslash in a comment on the marker line is written doubled'; Jest 75/75; review round 2 0 findings
  - related: ACC-AGENT-68
  - repro: add a comment holding C:\new to a marker with comments on its first line, as the skill says
  - test-tags: UNIT
  - root-cause: 2026-09-29T13:06:43Z @kj the port dropped the Markdown skill's escape rule together with the pipe rule HTML does not need
  - log: 2026-09-29T13:06:43Z @kj added
  - log: 2026-09-29T13:11:49Z @kj closed
- [x] `DEF-AGENT-10` **release 1.0.2 does not ship the skill** - MAJOR; the 1.0.2 wheel and sdist install carry no agent skill: pyproject.toml has no shared-data entry for .agents/skills, so an installed lab has no SKILL.md to link, as the jupyterlab-extension skill requires
  - evidence: pyproject.toml shared-data maps the skill to share/jupyter/agents/skills; 1.0.4 on PyPI carries SKILL.md and watch-marks.py there; test_pip_install_ships_the_skill guards it
  - related: ACC-AGENT-69
  - repro: pip install jupyterlab_advanced_html_viewer_extension==1.0.2; ls $(python -c 'import sys;print(sys.prefix)')/share/jupyter/agents/skills - absent
  - test-tags: UNIT
  - root-cause: 2026-09-29T20:02:36Z @kj the skill was built to the earlier rule that it stays out of the wheel; the rule now maps it as wheel shared-data
  - log: 2026-09-29T20:02:36Z @kj added
  - log: 2026-09-29T20:11:10Z @kj closed

## Storage in the file `STORE`

Writing marks and notes into the file

- [x] `DEF-STORE-11` **Comment save slow on a large file** - MAJOR; 8.9 MB file, localhost: each marker write POSTs the whole file (8,896,264 B) and parses it twice; Add Comment makes two writes, note field takes input after 1.9 s; a saved note shows after 2.5 s; slower over a slow uplink
  - evidence: 8.9 MB page of the reported shape, Chromium, build 1.0.17: Add Comment to note field 0.22-0.28 s (was 1.9), saved note shown 0.20-0.34 s (was 2.5), POST body under 400 B (was 8,896,264); by edits route and one-piece parsing; Galata 69/69, jest 102, pytest 32
  - related: ACC-ROUTE-72, ACC-STORE-73, ACC-STORE-74
  - repro: open a 9 MB .html holding one base64 image, Add Comment on a passage, save a note
  - test-tags: UNIT, INTEGRATION, FUNCTIONAL
  - root-cause: 2026-10-02T01:13:35Z @kj write route takes the whole content; _write reads the document with analyse before and after the edit, two parse5 parses each; showsSameText strips markers from both texts on every call
  - log: 2026-10-02T01:13:35Z @kj added
  - log: 2026-10-02T01:46:54Z @kj closed
  - log: 2026-10-02T02:51:28Z @kj edited evidence "copy of the 8.9 MB file in Chromium, build 1.0.11: Add Comment to note field 0.27 s (was 1.9), saved note shown 0.18 s (was 2.5), POST body 247-367 B (was 8,896,264), browser work per write 76 ms (was 1100-1700); build 1.0.12: Galata 68/68, jest 107, pytest 32" -> "8.9 MB page of the reported shape, Chromium, build 1.0.17: Add Comment to note field 0.22-0.28 s (was 1.9), saved note shown 0.20-0.34 s (was 2.5), POST body under 400 B (was 8,896,264); by edits route and one-piece parsing; Galata 69/69, jest 102, pytest 32"; reason: the carried reading was removed after measurement; final numbers
- [x] `DEF-STORE-12` **Line break a pre keeps is placed at the one it drops** - MINOR; pre or listing starting with two line breaks: the parser drops the first, the reading placed the kept one at the dropped one's offset; a marker before it went before the dropped break, which the parser then kept, adding a blank line to the page
  - evidence: jest source.spec 'DEF-STORE-12 places a line break a pre keeps after the one it drops': starts [6, 7]; green on build 1.0.12
  - repro: analyse('<pre>\n\nx</pre>'): run starts [5, 7], expected [6, 7]
  - test-tags: UNIT
  - root-cause: 2026-10-02T01:31:24Z @kj alignText matched the kept line break against the first one in the span before trying the dropped-newline rule
  - log: 2026-10-02T01:31:24Z @kj added
  - log: 2026-10-02T01:46:54Z @kj closed
- [x] `DEF-STORE-17` **A write changes every line ending of a file with mixed endings** - MEDIUM; file with CR LF on some lines and LF on others: a marker write gives every line CR LF, so the file changes outside its markers; same for a file with CR and LF and no CR LF
  - evidence: pytest test_routes 'test_write_keeps_mixed_line_endings', 3 files of mixed endings: red before the change, green after; file bytes outside the edits equal; pytest 35 green on build 1.0.29
  - repro: write bytes a CR LF b LF c, POST write one insert at 0: file reads a CR LF b CR LF c
  - test-tags: UNIT
  - root-cause: 2026-10-02T06:45:56Z @kj routes.py reads the whole text as LF, makes the edits, then puts one ending on every line
  - log: 2026-10-02T06:45:56Z @kj added
  - log: 2026-10-02T06:52:55Z @kj closed
- [x] `DEF-STORE-19` **A write that leaves a CR directly before an LF shifts every later mark by one** - MAJOR; found in review before release; file with a lone CR beside LF lines: a write whose result puts a CR directly before an LF makes a CR LF the document holds as two units and the route counts as one; the next mark lands one unit late
  - evidence: pytest test_routes 'test_write_refuses_to_join_cr_and_lf', 3 files: 400 and bytes unchanged; red before the length check, green after; the browser then writes through the document's own save, which gives that file one ending; pytest 38 green on build 1.0.30
  - repro: file doctype LF LF p CR p LF, document note after the doctype, then mark 'two': closing marker lands inside the end tag
  - test-tags: UNIT
  - root-cause: 2026-10-02T07:23:09Z @kj apply_edits maps offsets by the CR LF pairs of the file; an edit can make a new pair the document does not hold
  - log: 2026-10-02T07:23:09Z @kj added
  - log: 2026-10-02T07:32:56Z @kj closed
- [x] `DEF-STORE-20` **Panel-state write changes the last line ending of a file of mixed endings** - MINOR; file of CR LF lines whose last line ends LF: opening or closing the notes panel writes the settings marker with an edit that spans the trailing whitespace, so that LF becomes CR LF
  - evidence: jest store.spec 'DEF-STORE-20 leaves the whitespace that ends the file out of its edit': red before, green after; the edit ends where the file's trailing whitespace starts, 3 sources; jest 109 green on build 1.0.30
  - repro: file p CR LF p LF, open the notes panel: file ends CR LF marker CR LF
  - test-tags: UNIT
  - root-cause: 2026-10-02T07:23:14Z @kj settingsEdits replaces the whole trailing whitespace and writes it again, where an insertion before it is enough
  - log: 2026-10-02T07:23:14Z @kj added
  - log: 2026-10-02T07:33:00Z @kj closed

## Build and checks `BUILD`

lint, packaging and the checks CI runs

- [x] `DEF-BUILD-25` **lint:check reports 5 warnings in src/index.ts** - MINOR; four jupyter/prefer-lazy-imports on ./handle, ./icons, ./marks, ./swatch and one jupyter/incorrect-translator-usage on labTrans; exit 0, so CI passes, and every release report carries WARN
  - evidence: jlpm run lint:check exit 0 with 0 warnings (logs/lint-1.0.33-after.log); each of the 5 lines carries eslint-disable-next-line with its reason; make test: Jest 109, pytest 38
  - repro: jlpm run lint:check
  - test-tags: MANUAL
  - root-cause: 2026-10-02T08:35:26Z @kj activation uses the four modules at once and three of them load with ./notes-panel anyway; labTrans is the bundle of JupyterLab's own catalogue, named apart from trans on purpose
  - log: 2026-10-02T08:35:26Z @kj added
  - log: 2026-10-02T08:36:13Z @kj closed

