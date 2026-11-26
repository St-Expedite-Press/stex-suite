"""Typed platform configuration read once from the environment."""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
# Inside a container (deploy/staging-compose) the API binds every interface; its
# port is reachable only on the private compose network, never published.
ALL_INTERFACES = "0.0.0.0"  # noqa: S104 - opt-in through STEX_BIND_ALL=1 only
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY = REPOSITORY_ROOT / "protocol" / "applications" / "registry.v2.json"
ACTOR_SECRET_MIN = 32
_SERVICE_NAME = re.compile(r"^[a-z][a-z0-9-]{0,62}$")

# Engine origins and their dev-alpha defaults. Variable names match Pantheon's.
ENGINE_ORIGINS = {
    "frige": ("STEX_FRIGE_URL", "http://127.0.0.1:4310"),
    "seaxneat": ("STEX_SEAXNEAT_URL", "http://127.0.0.1:4320"),
}


class ConfigurationError(ValueError):
    """Raised at startup for configuration the platform refuses to run with."""


def internal_hosts(value: str | None) -> frozenset[str]:
    """Parse STEX_INTERNAL_HOSTS: fixed peer service names of a container deployment."""
    names = [name.strip() for name in (value or "").split(",") if name.strip()]
    for name in names:
        if not _SERVICE_NAME.fullmatch(name) or name == "localhost":
            raise ConfigurationError(f"STEX_INTERNAL_HOSTS contains an invalid service name: {name}")
    return frozenset(names)


def loopback_origin(value: str, name: str, internal: frozenset[str] = frozenset()) -> str:
    """Accept only a bare HTTP origin on loopback or on a fixed internal service name."""
    parts = urlsplit(value.strip())
    try:
        parts.port  # noqa: B018 - raises ValueError for an out-of-range or malformed port
    except ValueError as error:
        raise ConfigurationError(f"{name} has an invalid port.") from error
    if (
        parts.scheme != "http"
        or not (parts.hostname in LOOPBACK_HOSTS or parts.hostname in internal)
        or parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        raise ConfigurationError(f"{name} must be a loopback HTTP origin.")
    return f"http://{parts.netloc}"


def knowledge_engines(value: str | None) -> frozenset[str]:
    """Parse STEX_KNOWLEDGE_ENGINES (default: every engine with a context export)."""
    if value is None or not value.strip():
        return frozenset(ENGINE_ORIGINS)
    names = frozenset(name.strip() for name in value.split(",") if name.strip())
    unknown = names - frozenset(ENGINE_ORIGINS)
    if unknown:
        raise ConfigurationError(f"STEX_KNOWLEDGE_ENGINES names an unknown engine: {sorted(unknown)[0]}")
    return names


@dataclass(frozen=True)
class KnowledgeSettings:
    """Knowledge journals owned by the platform API (stex.knowledge.projections.v1).

    ``directory`` empty means knowledge is disabled, exactly as in Pantheon.
    ``hosted`` selects one journal per verified actor; it requires the actor secret.
    """

    directory: Path | None = None
    hosted: bool = False
    legacy_owner: str = ""
    actor_secret: str | None = None
    # Igor's credential for the contribution resolve route only (never the actor secret).
    igor_secret: str | None = None
    # A disposable or explicitly selected Obsidian vault, read-only (notes.py). Local mode only.
    vault: Path | None = None
    open_limit: int = 32
    # Engines the knowledge API may contact; a host that defers a studio leaves it out.
    engines: frozenset[str] = frozenset({"frige", "seaxneat"})

    def __post_init__(self) -> None:
        """Refuse hosted journals without a verifiable actor."""
        if self.actor_secret is not None and len(self.actor_secret) < ACTOR_SECRET_MIN:
            raise ConfigurationError(
                f"STEX_PLATFORM_ACTOR_SECRET must be at least {ACTOR_SECRET_MIN} characters."
            )
        if self.igor_secret is not None and len(self.igor_secret) < ACTOR_SECRET_MIN:
            raise ConfigurationError(
                f"STEX_KNOWLEDGE_IGOR_SECRET must be at least {ACTOR_SECRET_MIN} characters."
            )
        if self.igor_secret is not None and self.igor_secret == self.actor_secret:
            raise ConfigurationError(
                "STEX_KNOWLEDGE_IGOR_SECRET must differ from STEX_PLATFORM_ACTOR_SECRET."
            )
        if self.vault is not None and not self.vault.is_dir():
            raise ConfigurationError("STEX_KNOWLEDGE_VAULT_DIR must be an existing directory.")
        if self.hosted and self.actor_secret is None:
            raise ConfigurationError("STEX_KNOWLEDGE_HOSTED=1 requires STEX_PLATFORM_ACTOR_SECRET.")
        if self.open_limit < 1:
            raise ConfigurationError("The open-journal limit must be a positive integer.")


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
    knowledge: KnowledgeSettings = field(default_factory=KnowledgeSettings)
    internal_hosts: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        """Reject invalid ports, bind hosts and engine origins during construction."""
        if self.host not in LOOPBACK_HOSTS and self.host != ALL_INTERFACES:
            raise ConfigurationError("STEX_PLATFORM_HOST must be a loopback address.")
        if not 0 < self.port < 65536:
            raise ConfigurationError("STEX_PLATFORM_PORT must be between 1 and 65535.")
        for engine, origin in self.engine_origins.items():
            loopback_origin(origin, f"{engine} origin", self.internal_hosts)

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> Settings:
        """Read platform settings from the mapping or process environment."""
        env = os.environ if environment is None else environment
        port_text = env.get("STEX_PLATFORM_PORT", "4340")
        if not (port_text.isascii() and port_text.isdecimal()):
            raise ConfigurationError("STEX_PLATFORM_PORT must be a number.")
        internal = internal_hosts(env.get("STEX_INTERNAL_HOSTS"))
        origins = {
            engine: loopback_origin(env.get(variable) or default, variable, internal)
            for engine, (variable, default) in ENGINE_ORIGINS.items()
        }
        registry = env.get("STEX_APPLICATION_REGISTRY")
        bind_all = env.get("STEX_BIND_ALL", "")
        if bind_all not in ("", "0", "1"):
            raise ConfigurationError("STEX_BIND_ALL must be 1 or unset.")
        host = env.get("STEX_PLATFORM_HOST", "127.0.0.1")
        if host == ALL_INTERFACES and bind_all != "1":
            raise ConfigurationError("STEX_PLATFORM_HOST must be a loopback address.")
        hosted_text = env.get("STEX_KNOWLEDGE_HOSTED", "")
        if hosted_text not in ("", "0", "1"):
            raise ConfigurationError("STEX_KNOWLEDGE_HOSTED must be 1 or unset.")
        directory = env.get("STEX_KNOWLEDGE_DATA_DIR", "")
        knowledge = KnowledgeSettings(
            directory=Path(directory).resolve() if directory else None,
            hosted=hosted_text == "1",
            legacy_owner=env.get("STEX_KNOWLEDGE_LEGACY_OWNER", ""),
            actor_secret=env.get("STEX_PLATFORM_ACTOR_SECRET") or None,
            igor_secret=env.get("STEX_KNOWLEDGE_IGOR_SECRET") or None,
            vault=Path(env["STEX_KNOWLEDGE_VAULT_DIR"]).resolve()
            if env.get("STEX_KNOWLEDGE_VAULT_DIR")
            else None,
            engines=knowledge_engines(env.get("STEX_KNOWLEDGE_ENGINES")),
        )
        return cls(
            host=ALL_INTERFACES if bind_all == "1" else host,
            port=int(port_text),
            engine_origins=origins,
            registry_path=Path(registry) if registry else DEFAULT_REGISTRY,
            knowledge=knowledge,
            internal_hosts=internal,
        )
