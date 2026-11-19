"""``python -m stex.openapi``: regenerate the committed OpenAPI contract document."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx2

from stex.config import REPOSITORY_ROOT, Settings
from stex.main import create_app

DOCUMENT = REPOSITORY_ROOT / "protocol" / "platform" / "openapi.v1.json"


def generate() -> dict[str, Any]:
    # Generation is offline: no engine is contacted.
    offline = httpx2.MockTransport(lambda request: httpx2.Response(503))
    return create_app(Settings(), transport=offline).openapi()


def render(document: dict[str, Any]) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def main(path: Path = DOCUMENT) -> None:
    path.write_text(render(generate()), encoding="utf-8", newline="\n")
    print(f"wrote {path.relative_to(REPOSITORY_ROOT).as_posix()}")


if __name__ == "__main__":
    main()
