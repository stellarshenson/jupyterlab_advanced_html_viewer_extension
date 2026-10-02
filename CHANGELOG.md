# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.0.33] - 2026-10-02

### Fixed

- Selected text inside an SVG, such as the labels of a diagram, is painted in the text colour of the selection; the browser left it in its own colour, dark on the selection's background. Selected HTML text is painted as before, and a page's own rule on SVG text wins where it is more specific than `svg ::selection`
- Adding, changing or removing a mark or a comment in a file of mixed line endings changes no line ending outside the edit; before, every line of such a file took one ending. An edit that would join a CR and an LF is saved through the document as before the upgrade to edits
- A trusted page whose script asks for the keyboard while its tab is behind another tab no longer takes your keys: the viewer gives the keyboard back to the tab in front, or to the page of a second viewer that had it
- Opening or closing the notes panel in a file that has no settings line yet no longer rewrites the whitespace that ends the file

### Changed

- This release changes the server route; restart the JupyterLab server and reload the browser after the upgrade

<!-- <END NEW CHANGELOG ENTRY> -->

## [1.0.26] - 2026-10-02

### Fixed

- A change to the file that arrives while the viewer's tab is behind another tab no longer puts you back at the top of the page when you return; a slide deck stays on its slide. The page was loaded in a frame hidden with `display: none`, which has no size and no scroll position
- The page gets no scroll or resize event when its tab goes behind another tab or comes back, so a script of a trusted page keeps its state. The viewer is now hidden with `content-visibility`, which keeps the frame's size and scroll position

## [1.0.22] - 2026-10-02

### Changed

- Adding, changing or removing a mark or a comment sends only its edits to the server, which makes them in the file; before, each save uploaded the whole file. On an 8.9 MB page the note field is ready 0.22 to 0.28 s after Add Comment, where it took 1.9 s, and a saved note shows after 0.20 to 0.34 s, where it took 2.5 s
- A JupyterLab server started before the upgrade does not take edits, and a save then uploads the whole file as before; restart the server and reload the browser

### Fixed

- Opening a page that holds megabytes of script, style or embedded images no longer takes over a gigabyte of browser memory: a 13 MB page with a 10.5 MB script took 1357 MB of heap and showed after 3.9 s, and now takes 122 MB and shows after 0.48 s
- A mark placed at the start of a `pre` whose text begins with two line breaks no longer adds a blank line to the page

## [1.0.9] - 2026-09-30

### Fixed

- The notes badge over the page's top right corner is semi-transparent, so the page shows through it: faint while the notes panel lists no mark or note, stronger and in the strongest text colour once it lists one; it was opaque in both states

## [1.0.7] - 2026-09-30

### Added

- While changes another program writes arrive in the file, the viewer's tab shows a half-filled circle whose filled half swaps sides, ◐ and ◑; a frame lasts 1 s for a single change and down to 0.25 s for a change at every look at the file, and the marker goes from a tab in front once no change has arrived for 8 s, while a tab behind keeps it until you bring it to the front

## [1.0.5] - 2026-09-29

### Fixed

- The README now says that `pip install` puts the agent skill in `<sys.prefix>/share/jupyter/agents/skills/`, inside the Python environment, not in `~/.agents/skills`, and that you link it into `~/.agents/skills` yourself with the `ln -s` line it gives

## [1.0.4] - 2026-09-29

### Fixed

- `pip install` now puts a copy of the agent skill, `SKILL.md` and `scripts/watch-marks.py`, in `<sys.prefix>/share/jupyter/agents/skills/jupyterlab-advanced-html-viewer-extension`; 1.0.2 carried it only in the repository. pip does not put it in `~/.agents/skills`, and no agent reads the installed copy until you link it there with the `ln -s` line in the README

## [1.0.2] - 2026-09-29

### Added

- Agent skill in `.agents/skills/jupyterlab-advanced-html-viewer-extension`: an AI assistant marks text written in the HTML file in six colours, recolours or hides a mark, comments on a passage or on the whole page, and answers or closes your comments, with markers placed so the page looks the same
- The skill's `scripts/watch-marks.py` watches HTML files and reports each comment line you add, never the assistant's own lines, a hidden mark or a change of colour; the README gives the line that links the skill into Claude Code

## [1.0.1] - 2026-09-28

### Added

- HTML viewer, the default for `.html` files: Trust HTML runs the page's scripts in a sandboxed frame and Rerender HTML Document reads the file again, as in the built-in viewer
- A change another program writes to the file shows within a few seconds; a change to the notes alone leaves the page as it is
- Marks in six colours from the context menu, Add Comment to write a note at once, and Ctrl Shift M (Cmd Shift M on macOS) to mark from the keyboard
- Notes stored in the HTML file as comments around the passage, in the form the advanced Markdown viewer writes
- Notes panel beside the page: a comment and its replies per mark, with edit, delete, colour, close and a note on the whole document
- Only text written in the file takes a comment: a selection holding text a trusted page's scripts produced, or an iframe, object or embed element, is refused; the context menu then shows neither Mark nor Add Comment, and Ctrl Shift M shows a notice saying why
