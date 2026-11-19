"""Typed platform configuration read once from the environment."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY = REPOSITORY_ROOT / "protocol" / "applications" / "registry.v2.json"

# Engine origins and their dev-alpha defaults. Variable names match Pantheon's.
ENGINE_ORIGINS = {
    "frige": ("STEX_FRIGE_URL", "http://127.0.0.1:4310"),
    "seaxneat": ("STEX_SEAXNEAT_URL", "http://127.0.0.1:4320"),
}


class ConfigurationError(ValueError):
    """Raised at startup for configuration the platform refuses to run with."""


def loopback_origin(value: str, name: str) -> str:
    """Accept only a bare loopback HTTP origin, as Pantheon's proxy targets do."""
    parts = urlsplit(value.strip())
    try:
        parts.port  # noqa: B018 - raises ValueError for an out-of-range or malformed port
    except ValueError as error:
        raise ConfigurationError(f"{name} has an invalid port.") from error
    if (
        parts.scheme != "http"
        or parts.hostname not in LOOPBACK_HOSTS
        or parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        raise ConfigurationError(f"{name} must be a loopback HTTP origin.")
    return f"http://{parts.netloc}"


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 4340
    engine_origins: Mapping[str, str] = field(
        default_factory=lambda: {engine: default for engine, (_, default) in ENGINE_ORIGINS.items()}
    )
    registry_path: Path = DEFAULT_REGISTRY
    studio_timeout_seconds: float = 2.0
    max_summary_bytes: int = 2_000_000

    def __post_init__(self) -> None:
        if self.host not in LOOPBACK_HOSTS:
            raise ConfigurationError("STEX_PLATFORM_HOST must be a loopback address.")
        if not 0 < self.port < 65536:
            raise ConfigurationError("STEX_PLATFORM_PORT must be between 1 and 65535.")
        for engine, origin in self.engine_origins.items():
            loopback_origin(origin, f"{engine} origin")

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if environment is None else environment
        port_text = env.get("STEX_PLATFORM_PORT", "4340")
        if not (port_text.isascii() and port_text.isdecimal()):
            raise ConfigurationError("STEX_PLATFORM_PORT must be a number.")
        origins = {
            engine: loopback_origin(env.get(variable) or default, variable)
            for engine, (variable, default) in ENGINE_ORIGINS.items()
        }
        registry = env.get("STEX_APPLICATION_REGISTRY")
        return cls(
            host=env.get("STEX_PLATFORM_HOST", "127.0.0.1"),
            port=int(port_text),
            engine_origins=origins,
            registry_path=Path(registry) if registry else DEFAULT_REGISTRY,
        )
