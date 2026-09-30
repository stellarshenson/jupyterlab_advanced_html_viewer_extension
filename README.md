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
- **Follows the file** - a change another program writes to the file shows within a few seconds; a change to the notes alone leaves the page as it is. While changes arrive, the tab shows a half-filled circle whose filled half swaps sides, from 1 s a frame for a single change to 0.25 s a frame for a change at every look
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
