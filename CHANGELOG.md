# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.0.60] - 2026-10-21

### Changed

- The unread dot on a tab takes the theme's brand colour 2 instead of brand colour 1; it follows every light and dark theme

## [1.0.58] - 2026-10-21

### Changed

- The unread dot on a tab takes the theme's brand colour, the one the theme uses for selection and focus, instead of fixed greens; it follows every light and dark theme

## [1.0.56] - 2026-10-19

### Added

- The page's scrollbar follows the JupyterLab theme, both the frame's own and any inner scrolling area, also where the page sets its own scrollbar colours; a theme switch recolours it without reloading the page
- A page wider than the frame is scaled down to the frame's width before trust as well as after; a page that fits keeps its own size, and a resize (notes panel, window, full screen) fits it again without a reload

### Fixed

- The Always trust checkbox is checked only while the page is trusted and the file's marker holds the signature; after a distrust the file cannot record, its click now trusts the page instead of doing nothing
- A read-only file's distrust survives the next settle; the trust signature written by one view is no longer lost when another view adds the first comment; a box click during a slow trust check no longer drops the render of a new change
- Fit measures the page's own zoom per document, so a page that zooms itself is fitted correctly after a reload

## [1.0.52] - 2026-10-19

### Added

- An **Always trust this page** checkbox beside the Trust HTML button remembers trust in the file: ticking it trusts the page now and writes this lab's signature of the file's path into the settings line, so the file opens trusted next time, and clearing it distrusts and removes the signature. It stays clear with trust-by-default on, on a read-only file, and for a value this lab did not sign. The Trust HTML button stays and shares the same state

### Fixed

- The notes panel no longer folds after a comment is added: the first mark now stores the expanded panel state in the settings line instead of expanding in memory only, so the note write no longer restores the stored hidden state

## [1.0.48] - 2026-10-16

### Added

- A full-screen button on the toolbar shows the page alone on the whole screen, as it is, without loading it again, and puts the keyboard on the page; Escape returns to JupyterLab

### Changed

- Right-click on a page shown on the whole screen opens the browser's own menu, since JupyterLab's menu cannot show over it

<!-- <END NEW CHANGELOG ENTRY> -->

## [1.0.45] - 2026-10-16

### Added

- Trust HTML remembers trust in the file: it writes this lab's signature of the file's path into the file's settings line, so the file opens trusted next time, also after an agent rewrites it, while that line stays. Distrust HTML takes the signature out. A signature made in another lab, or for another path, trusts nothing, so a downloaded file cannot trust itself
- This release adds a server route; restart the JupyterLab server and reload the browser after the upgrade

### Changed

- Changes that arrived while the tab was behind another now leave a green dot before the tab's name instead of the star: 7 px, #116329 on light themes and #66bb6a on dark ones, centred on the height of the name's capitals and digits, and visible in forced-colours mode
- The settings line holds the state of the notes panel only where the reader chose one

### Fixed

- Rerender HTML Document no longer stays pressed after a click

## [1.0.37] - 2026-10-13

### Added

- A star (✻) on the tab marks changes that arrived while the tab was behind another one. It stays until the tab is brought to the front
- The tooltip of the tab says what the marker on it means
- The setting **Tab marker** (`tabCue`) switches the marker off

### Changed

- The tab marker is two characters shown in turn, faster the more often changes arrive. It moves only while changes arrive
- Every view of a file shows the marker, and the views of one file share one check of the file, so the server is asked once

### Fixed

- The tab marker changed height between its two frames
- With two tabs open on the same file, a change marked only one of them

## [1.0.36] - 2026-10-02

### Fixed

- The page no longer shows a bright rim along its inside edge when the viewer's tab comes back to the front. The rim was the browser's focus outline on the box that holds the page, which went away after a click into the page; JupyterLab's own rule against that outline did not reach the box beside the notes panel

## [1.0.34] - 2026-10-02

### Changed

- The lint check reports no warning, where it reported five in `src/index.ts`; each of the five lines now states why the rule does not apply to it. The viewer behaves as in 1.0.33

## [1.0.33] - 2026-10-02

### Fixed

- Selected text inside an SVG, such as the labels of a diagram, is painted in the text colour of the selection; the browser left it in its own colour, dark on the selection's background. Selected HTML text is painted as before, and a page's own rule on SVG text wins where it is more specific than `svg ::selection`
- Adding, changing or removing a mark or a comment in a file of mixed line endings changes no line ending outside the edit; before, every line of such a file took one ending. An edit that would join a CR and an LF is saved through the document as before the upgrade to edits
- A trusted page whose script asks for the keyboard while its tab is behind another tab no longer takes your keys: the viewer gives the keyboard back to the tab in front, or to the page of a second viewer that had it
- Opening or closing the notes panel in a file that has no settings line yet no longer rewrites the whitespace that ends the file

### Changed

- This release changes the server route; restart the JupyterLab server and reload the browser after the upgrade

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
