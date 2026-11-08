"""``python -m stex``: serve the platform API on its configured loopback address."""

from __future__ import annotations

import uvicorn

from stex.config import Settings
from stex.main import create_app


def main() -> None:
    settings = Settings.from_environment()
    print(f"STEX platform API listening on http://{settings.host}:{settings.port}", flush=True)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
