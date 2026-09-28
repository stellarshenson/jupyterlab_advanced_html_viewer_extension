# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.0.1] - 2026-09-28

### Added

- HTML viewer, the default for `.html` files: Trust HTML runs the page's scripts in a sandboxed frame and Rerender HTML Document reads the file again, as in the built-in viewer
- A change another program writes to the file shows within a few seconds; a change to the notes alone leaves the page as it is
- Marks in six colours from the context menu, Add Comment to write a note at once, and Ctrl Shift M (Cmd Shift M on macOS) to mark from the keyboard
- Notes stored in the HTML file as comments around the passage, in the form the advanced Markdown viewer writes
- Notes panel beside the page: a comment and its replies per mark, with edit, delete, colour, close and a note on the whole document
- Only text written in the file takes a comment: a selection holding text a trusted page's scripts produced, or an iframe, object or embed element, is refused; the context menu then shows neither Mark nor Add Comment, and Ctrl Shift M shows a notice saying why

<!-- <END NEW CHANGELOG ENTRY> -->
