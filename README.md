# jupyterlab_advanced_html_viewer_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_advanced_html_viewer_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_advanced_html_viewer_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_advanced_html_viewer_extension.svg)](https://www.npmjs.com/package/jupyterlab_advanced_html_viewer_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-advanced-html-viewer-extension.svg)](https://pypi.org/project/jupyterlab-advanced-html-viewer-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-advanced-html-viewer-extension)](https://pepy.tech/project/jupyterlab-advanced-html-viewer-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

Read an HTML file in JupyterLab and comment on it. The viewer trusts and refreshes a page as the built-in HTML Viewer does, and adds the marks, comments and notes panel of the advanced Markdown viewer. The comments are stored in the HTML file itself, so an AI agent reading the file reads them too and can answer in it.

## Features

- **Opens HTML files** - double-click an `.html` file; Trust HTML runs its scripts and Rerender HTML Document reads it again, as in the built-in viewer
- **Shows a page on the whole screen** - the full-screen button on the toolbar shows the page alone on the whole screen, as it is, with the keyboard on the page; Escape returns to the lab
- **Remembers trust in the file** - Trust HTML, or the Always trust this page checkbox beside it, writes this lab's signature of the file's path into the file's settings line, so the file opens trusted next time, also after an agent rewrites it, while the line stays; Distrust HTML, or clearing the checkbox, takes it out. While the checkbox is checked in an open view, a rewrite from disk that drops the settings line gets the signature written back. While the checkbox is checked, a program that holds the file open and pauses partway through writing it can get the trust line written into its page; tools that write the whole file at once are not affected. A signature made in another lab, or for another path, trusts nothing, so a downloaded file cannot trust itself
- **Says what trust allows** - More info, after the Always trust this page checkbox, opens a dialog read from the file without running it: what trust allows, the page's inline scripts and the address of each script file, the other hosts it loads from, and the browser features its inline scripts name, found by text search
- **Lets a trusted page change its address** - the scripts of a trusted page may change the part of its address after the #, as a slide deck does to record its slide; an untrusted page runs no scripts, and the Let a trusted page change its address setting switches it off
- **Scrollbar follows the lab theme** - the page's scrollbar, and any scrolling area inside it, takes the colours of the current JupyterLab theme; switching the theme recolours it without reloading the page
- **Wide pages fit the frame** - a page wider than the frame is scaled down to the frame's width before trust as well as after, and a page that fits keeps its own size; opening the notes panel, resizing the window or going full screen fits it again without a reload
- **Follows the file** - a change another program writes to the file shows within a few seconds, applied to the page in place: the page is not loaded again, so the scroll position, the part of the address after the # and the state of the page's scripts stay; a change to the notes alone leaves the page as it is. A change in the head or the doctype; in or of a script, style, link, meta, base, template, SVG, MathML, iframe, frame, frameset, object, embed, source or track; in or of an element whose text the page does not show as text (textarea, title, xmp, noembed, noframes, plaintext, and noscript on a trusted page); a rewrite of more than 1000 words, spaces and child elements inside one element; a change of the signature in the settings line of an untrusted page; a tag or attribute name the browser cannot create, such as one with a stray quote in it; and a change at a place a trusted page's scripts changed load the page again, with the added text on green, except where more than 1000 words and spaces lie between the first and the last change, which shows without a tint. On a trusted page a change in place runs no script again, so a part a script built at load from the file's text keeps its old result until Rerender HTML Document. An edit in the lab's editor renders the page again as before. The Enabled setting switches following off; the file is then read only on Rerender HTML Document and when the viewer writes a mark, a note, the panel state or the trust, and the page changes then or on an edit in the lab
- **Types changes in** - added text is typed in letter by letter; removed text stands struck through for a moment and is then deleted from its end. An element that goes loses its text first and then its tags, the innermost first; an element that comes is put in empty and its text typed in. The Animate changes setting shows a change at once
- **Highlights changes** - added text on the lab theme's success colour, removed text on its error colour and struck through, fading out a few seconds after the change, with the marks keeping their colours meanwhile; the Highlight changes setting switches it off
- **Marks the tab of a changed file** - while changes arrive, a half-filled circle before the tab's name swaps its filled half from side to side, faster the more changes arrive. Changes that arrived while the tab was behind another leave a dot in the theme's brand colour 2 until you bring the tab to the front. The tab's tooltip says what the marker means, and the Tab marker setting switches it off
- **Marks in six colours** - select text, right-click and choose a colour under Mark, or Add Comment to write a note at once; Ctrl Shift M (Cmd Shift M on macOS) marks from the keyboard
- **Only text written in the file takes a comment** - text a trusted page's scripts produce, and whatever an iframe, object or embed of the page shows, is refused
- **Notes are stored in the file** - as HTML comments around the passage, which no browser shows, in the same form the advanced Markdown viewer writes
- **Notes panel beside the page** - a comment and its replies per mark, with edit, delete, colour, close and a note on the whole document

## Agent skill

The skill in `.agents/skills/jupyterlab-advanced-html-viewer-extension` teaches an AI assistant the marks this extension stores in the HTML file. With it, the assistant can:

- mark passages in the six colours, change a mark's colour and hide a mark
- comment on a passage or on the whole page
- answer and close your comments
- watch a file for new comments, with the bundled `scripts/watch-marks.py`

`pip install` puts a copy in `<sys.prefix>/share/jupyter/agents/skills/`, inside the Python environment, not in `~/.agents/skills`. No agent reads that directory, so link the copy into `~/.agents/skills` yourself, with the Python that runs the lab:

```bash
mkdir -p ~/.agents/skills
ln -s "$(python -c 'import sys; print(sys.prefix)')/share/jupyter/agents/skills/jupyterlab-advanced-html-viewer-extension" ~/.agents/skills/jupyterlab-advanced-html-viewer-extension
```

Agents that read `.agents/skills` also find it in a clone of this repository; to make it available to Claude Code everywhere, link it into the skills directory from the root of the clone:

```bash
mkdir -p ~/.claude/skills && ln -sfn "$PWD/.agents/skills/jupyterlab-advanced-html-viewer-extension" ~/.claude/skills/jupyterlab-advanced-html-viewer-extension
```

## Requirements

- JupyterLab >= 4.6.0

## Install

To install the extension, execute:

```bash
pip install jupyterlab_advanced_html_viewer_extension
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyterlab_advanced_html_viewer_extension
```
