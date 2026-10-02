"""The compare-and-write route, against a running Jupyter server."""
import json

import pytest
from tornado.httpclient import HTTPClientError

NAMESPACE = "jupyterlab-advanced-html-viewer-extension"
PAGE = "<!DOCTYPE html>\n<p>Hello world</p>\n"
MARKER = "<!-- mark:x note -->"


def insert(text, at, new):
    """One edit that puts a text in at an offset."""
    return [{"start": at, "end": at, "text": new}]


async def disk_hash(jp_fetch, name):
    response = await jp_fetch("api", "contents", name, params={"content": "0", "hash": "1"})
    return json.loads(response.body)["hash"]


async def write(jp_fetch, body):
    return await jp_fetch(NAMESPACE, "write", method="POST", body=json.dumps(body))


async def test_write_matching_hash(jp_fetch, jp_root_dir):
    """ACC-ROUTE-62, ACC-ROUTE-72: the edits are made while the hash matches, the model comes back."""
    (jp_root_dir / "page.html").write_text(PAGE)
    expected = await disk_hash(jp_fetch, "page.html")
    marked = PAGE.replace("Hello", f"{MARKER}Hello").replace("world", "World")
    edits = [
        {"start": PAGE.index("world"), "end": PAGE.index("world") + 5, "text": "World"},
        *insert(PAGE, PAGE.index("Hello"), MARKER),
    ]

    response = await write(jp_fetch, {"path": "page.html", "expected": expected, "edits": edits})

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
        await write(
            jp_fetch, {"path": "page.html", "expected": "0" * 64, "edits": insert(PAGE, 0, "x")}
        )

    assert error.value.code == 409
    assert json.loads(error.value.response.body) == {"hash": current}
    assert (jp_root_dir / "page.html").read_text() == PAGE


async def test_write_counts_utf16_units(jp_fetch, jp_root_dir):
    """ACC-ROUTE-72: an offset counts UTF-16 units, so a character outside the BMP counts two."""
    page = "<p>\U0001f600 Hello</p>\n"
    (jp_root_dir / "page.html").write_text(page, encoding="utf-8")
    expected = await disk_hash(jp_fetch, "page.html")
    at = len("<p>\U0001f600 ".encode("utf-16-le")) // 2

    await write(
        jp_fetch, {"path": "page.html", "expected": expected, "edits": insert(page, at, MARKER)}
    )

    assert (jp_root_dir / "page.html").read_text(encoding="utf-8") == page.replace(
        "Hello", f"{MARKER}Hello"
    )


@pytest.mark.parametrize("ending", ["\r\n", "\r"])
async def test_write_keeps_line_ending(jp_fetch, jp_root_dir, ending):
    """ACC-ROUTE-72: offsets count each line ending as one LF, and the file keeps its ending."""
    marker = "<!-- mark:x note\n@kj: two lines\n-->"
    (jp_root_dir / "page.html").write_bytes(PAGE.replace("\n", ending).encode())
    expected = await disk_hash(jp_fetch, "page.html")

    await write(
        jp_fetch,
        {"path": "page.html", "expected": expected, "edits": insert(PAGE, PAGE.index("Hello"), marker)},
    )

    assert (jp_root_dir / "page.html").read_bytes() == PAGE.replace("Hello", f"{marker}Hello").replace(
        "\n", ending
    ).encode()


@pytest.mark.parametrize(
    "edits",
    [
        [{"start": 0, "end": len(PAGE) + 1, "text": ""}],
        [{"start": 4, "end": 2, "text": ""}],
        [{"start": -1, "end": 2, "text": ""}],
        [{"start": 0, "end": 5, "text": "a"}, {"start": 4, "end": 6, "text": "b"}],
        [{"start": 0, "end": 1}],
        [{"start": "0", "end": 1, "text": ""}],
        [{"start": True, "end": 1, "text": ""}],
        [],
        "x",
    ],
)
async def test_write_bad_edits(jp_fetch, jp_root_dir, edits):
    """ACC-ROUTE-72: edits out of range, overlapping or malformed answer 400 and write nothing."""
    (jp_root_dir / "page.html").write_text(PAGE)
    expected = await disk_hash(jp_fetch, "page.html")

    with pytest.raises(HTTPClientError) as error:
        await write(jp_fetch, {"path": "page.html", "expected": expected, "edits": edits})

    assert error.value.code == 400
    assert (jp_root_dir / "page.html").read_text() == PAGE


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"path": "page.html", "expected": "abc"},
        {"path": "page.html", "expected": "abc", "content": "x"},
        {"path": "page.html", "expected": 1, "edits": [{"start": 0, "end": 0, "text": "x"}]},
        {"path": ["page.html"], "expected": "abc", "edits": [{"start": 0, "end": 0, "text": "x"}]},
    ],
)
async def test_write_bad_body(jp_fetch, jp_root_dir, body):
    """ACC-ROUTE-64: a body without the two strings and the edits answers 400."""
    (jp_root_dir / "page.html").write_text(PAGE)

    with pytest.raises(HTTPClientError) as error:
        await write(jp_fetch, body)

    assert error.value.code == 400
    assert (jp_root_dir / "page.html").read_text() == PAGE


async def test_write_missing_file(jp_fetch, jp_root_dir):
    """ACC-ROUTE-64: a file that is not there answers 404 and is not created."""
    with pytest.raises(HTTPClientError) as error:
        await write(jp_fetch, {"path": "gone.html", "expected": "abc", "edits": insert("", 0, PAGE)})

    assert error.value.code == 404
    assert not (jp_root_dir / "gone.html").exists()


async def test_write_needs_auth(http_server_client, jp_base_url, jp_root_dir):
    """ACC-ROUTE-65: a request without credentials is refused and writes nothing."""
    (jp_root_dir / "page.html").write_text(PAGE)
    body = json.dumps({"path": "page.html", "expected": "abc", "edits": insert(PAGE, 0, "changed")})

    response = await http_server_client.fetch(
        f"{jp_base_url}{NAMESPACE}/write", method="POST", body=body, raise_error=False
    )

    assert response.code == 403
    assert (jp_root_dir / "page.html").read_text() == PAGE
