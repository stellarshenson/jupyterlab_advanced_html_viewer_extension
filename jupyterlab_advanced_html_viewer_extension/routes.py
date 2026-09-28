"""HTTP route of the server extension.

One route under the namespace `jupyterlab-advanced-html-viewer-extension`: `write` rewrites a
file only while it still carries the hash the browser holds. The viewer writes a mark into the
file through it, so a file another process rewrote meanwhile is refused rather than overwritten,
and the browser raises no File Changed dialog for a write it made itself.
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


class WriteHandler(APIHandler):
    """POST write {"path", "expected", "content"} -> 200 contents model, or 409 {"hash"}.

    `expected` is the hash the contents API reported for the file, which the browser's document
    context holds. The file is compared and written under a lock per path, so two writes of one
    path from this server never interleave. The 200 answer is the contents model of the written
    file without its content, which the browser records as the revision on disk. 400 for a body
    that is not those three strings, 404 for a file that is not there.
    """

    auth_resource = "contents"

    @tornado.web.authenticated
    @authorized(action="write", resource="contents")
    async def post(self):
        body = self.get_json_body() or {}
        path, expected, content = (body.get(name) for name in ("path", "expected", "content"))
        if not all(isinstance(field, str) for field in (path, expected, content)):
            raise tornado.web.HTTPError(400, "path, expected and content must be strings")
        manager = self.contents_manager
        locks = self.settings.setdefault(LOCKS_KEY, {})
        lock = locks.setdefault(path, asyncio.Lock())
        async with lock:
            if not await ensure_async(manager.file_exists(path)):
                raise tornado.web.HTTPError(404, "no such file")
            current = await ensure_async(
                manager.get(path, content=False, type="file", require_hash=True)
            )
            if current.get("hash") != expected:
                self.set_status(409)
                self.finish(json.dumps({"hash": current.get("hash")}))
                return
            await ensure_async(
                manager.save({"type": "file", "format": "text", "content": content}, path)
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
