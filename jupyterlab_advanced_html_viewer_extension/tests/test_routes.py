"""The compare-and-write route, against a running Jupyter server."""
import json

import pytest
from tornado.httpclient import HTTPClientError

NAMESPACE = "jupyterlab-advanced-html-viewer-extension"
PAGE = "<!DOCTYPE html>\n<p>Hello world</p>\n"


async def disk_hash(jp_fetch, name):
    response = await jp_fetch("api", "contents", name, params={"content": "0", "hash": "1"})
    return json.loads(response.body)["hash"]


async def write(jp_fetch, body):
    return await jp_fetch(NAMESPACE, "write", method="POST", body=json.dumps(body))


async def test_write_matching_hash(jp_fetch, jp_root_dir):
    """ACC-ROUTE-62: the file is written while its hash matches, and the model comes back."""
    (jp_root_dir / "page.html").write_text(PAGE)
    expected = await disk_hash(jp_fetch, "page.html")
    marked = PAGE.replace("Hello", "<!-- mark:x note -->Hello")

    response = await write(jp_fetch, {"path": "page.html", "expected": expected, "content": marked})

    assert response.code == 200
    model = json.loads(response.body)
    assert (jp_root_dir / "page.html").read_text() == marked
    assert model["path"] == "page.html"
    assert model["hash"] == await disk_hash(jp_fetch, "page.html")
    assert model["hash"] != expected
    assert model["last_modified"]
    assert model["content"] is None


async def test_write_stale_hash(jp_fetch, jp_root_dir):
    """ACC-ROUTE-63: a hash that does not match answers 409 and leaves the file."""
    (jp_root_dir / "page.html").write_text(PAGE)
    current = await disk_hash(jp_fetch, "page.html")

    with pytest.raises(HTTPClientError) as error:
        await write(jp_fetch, {"path": "page.html", "expected": "0" * 64, "content": "changed"})

    assert error.value.code == 409
    assert json.loads(error.value.response.body) == {"hash": current}
    assert (jp_root_dir / "page.html").read_text() == PAGE


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"path": "page.html", "expected": "abc"},
        {"path": "page.html", "expected": 1, "content": "x"},
        {"path": ["page.html"], "expected": "abc", "content": "x"},
    ],
)
async def test_write_bad_body(jp_fetch, jp_root_dir, body):
    """ACC-ROUTE-64: a body without the three strings answers 400."""
    (jp_root_dir / "page.html").write_text(PAGE)

    with pytest.raises(HTTPClientError) as error:
        await write(jp_fetch, body)

    assert error.value.code == 400
    assert (jp_root_dir / "page.html").read_text() == PAGE


async def test_write_missing_file(jp_fetch, jp_root_dir):
    """ACC-ROUTE-64: a file that is not there answers 404 and is not created."""
    with pytest.raises(HTTPClientError) as error:
        await write(jp_fetch, {"path": "gone.html", "expected": "abc", "content": PAGE})

    assert error.value.code == 404
    assert not (jp_root_dir / "gone.html").exists()


async def test_write_needs_auth(http_server_client, jp_base_url, jp_root_dir):
    """ACC-ROUTE-65: a request without credentials is refused and writes nothing."""
    (jp_root_dir / "page.html").write_text(PAGE)
    body = json.dumps({"path": "page.html", "expected": "abc", "content": "changed"})

    response = await http_server_client.fetch(
        f"{jp_base_url}{NAMESPACE}/write", method="POST", body=body, raise_error=False
    )

    assert response.code == 403
    assert (jp_root_dir / "page.html").read_text() == PAGE
