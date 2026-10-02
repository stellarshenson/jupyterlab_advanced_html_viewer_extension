"""HTTP route of the server extension.

One route under the namespace `jupyterlab-advanced-html-viewer-extension`: `write` makes edits in
a file only while it still carries the hash the browser holds. The viewer writes a mark into the
file through it, so a file another process rewrote meanwhile is refused rather than overwritten,
and the browser raises no File Changed dialog for a write it made itself. The browser sends the
edits and not the file, so a mark in a file of several megabytes is a request of a few hundred
bytes.
"""
import asyncio
import json

import tornado
from jupyter_client.jsonutil import json_default
from jupyter_core.utils import ensure_async
from jupyter_server.auth.decorator import authorized
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

NAMESPACE = "jupyterlab-advanced-html-viewer-extension"
LOCKS_KEY = "advanced_html_viewer_locks"


def valid_edits(edits):
    """Whether edits is a list of {"start", "end", "text"} that do not overlap."""
    if not isinstance(edits, list) or not edits:
        return False
    for edit in edits:
        if not isinstance(edit, dict) or not isinstance(edit.get("text"), str):
            return False
        if any(type(edit.get(name)) is not int for name in ("start", "end")):
            return False
        if not 0 <= edit["start"] <= edit["end"]:
            return False
    ordered = sorted(edits, key=lambda edit: edit["start"])
    return all(before["end"] <= after["start"] for before, after in zip(ordered, ordered[1:]))


def apply_edits(text, edits):
    """The text with the edits made in it, or None where one reaches past its end.

    The offsets count UTF-16 code units, as the browser that worked them out does, and they are
    made from the end backwards so the earlier ones stand.
    """
    units = text.encode("utf-16-le", "surrogatepass")
    if any(2 * edit["end"] > len(units) for edit in edits):
        return None
    for edit in sorted(edits, key=lambda edit: edit["start"], reverse=True):
        units = (
            units[: 2 * edit["start"]]
            + edit["text"].encode("utf-16-le", "surrogatepass")
            + units[2 * edit["end"] :]
        )
    return units.decode("utf-16-le", "surrogatepass")


class WriteHandler(APIHandler):
    """POST write {"path", "expected", "edits"} -> 200 contents model, or 409 {"hash"}.

    `expected` is the hash the contents API reported for the file, which the browser's document
    context holds. `edits` is a list of {"start", "end", "text"}: replacements in the file text as
    the browser's document holds it, which is the file with LF line endings. The document reads a
    file holding CR LF with those as LF, and otherwise one holding CR with those as LF; the edits
    are made in the text read the same way and the file's ending is put back.

    The file is compared and written under a lock per path, so two writes of one path from this
    server never interleave. The 200 answer is the contents model of the written file without its
    content, which the browser records as the revision on disk. 400 for a body that is not those
    three, or edits that overlap or reach past the end of the file, 404 for a file that is not
    there.
    """

    auth_resource = "contents"

    @tornado.web.authenticated
    @authorized(action="write", resource="contents")
    async def post(self):
        body = self.get_json_body() or {}
        path, expected, edits = (body.get(name) for name in ("path", "expected", "edits"))
        if not isinstance(path, str) or not isinstance(expected, str) or not valid_edits(edits):
            raise tornado.web.HTTPError(
                400, "path and expected must be strings, edits a list that does not overlap"
            )
        manager = self.contents_manager
        locks = self.settings.setdefault(LOCKS_KEY, {})
        lock = locks.setdefault(path, asyncio.Lock())
        async with lock:
            if not await ensure_async(manager.file_exists(path)):
                raise tornado.web.HTTPError(404, "no such file")
            current = await ensure_async(
                manager.get(path, content=True, type="file", format="text", require_hash=True)
            )
            if current.get("hash") != expected:
                self.set_status(409)
                self.finish(json.dumps({"hash": current.get("hash")}))
                return
            text = current["content"]
            ending = "\r\n" if "\r\n" in text else "\r" if "\r" in text else None
            written = apply_edits(text.replace(ending, "\n") if ending else text, edits)
            if written is None:
                raise tornado.web.HTTPError(400, "an edit reaches past the end of the file")
            await ensure_async(
                manager.save(
                    {
                        "type": "file",
                        "format": "text",
                        "content": written.replace("\n", ending) if ending else written,
                    },
                    path,
                )
            )
            model = await ensure_async(
                manager.get(path, content=False, type="file", require_hash=True)
            )
        self.finish(json.dumps(model, default=json_default))


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    handlers = [(url_path_join(base_url, NAMESPACE, "write"), WriteHandler)]
    web_app.add_handlers(host_pattern, handlers)
