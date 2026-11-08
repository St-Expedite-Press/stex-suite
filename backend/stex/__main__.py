"""``python -m stex``: serve the platform API on its configured loopback address."""

from __future__ import annotations

import uvicorn

from stex.config import Settings
from stex.main import create_app


def main() -> None:
    settings = Settings.from_environment()
    # Uvicorn's own "Uvicorn running on ..." line is printed only after the socket
    # is bound; launchers wait for it. Per-request access logs stay off.
    uvicorn.run(
        create_app(settings), host=settings.host, port=settings.port, log_level="info", access_log=False
    )


if __name__ == "__main__":
    main()
