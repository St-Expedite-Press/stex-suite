"""Typed reader for ``stex.applications.registry.v2``.

The registry declares navigation identities only; it grants no storage access
or authority over an engine.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Application(BaseModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    id: str = Field(pattern=r"^[a-z][a-z0-9-]{0,39}$")
    name: str = Field(min_length=1)
    kind: Literal["studio", "application"]
    route: str = Field(pattern=r"^/[a-z][a-z0-9-]*/$")
    state: Literal["active", "deferred"]
    reference_kinds: tuple[str, ...] = Field(alias="referenceKinds")


class Registry(BaseModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    schema_version: Literal["stex.applications.registry.v2"] = Field(alias="schemaVersion")
    applications: tuple[Application, ...]

    def active_studios(self) -> tuple[Application, ...]:
        return tuple(app for app in self.applications if app.kind == "studio" and app.state == "active")


def load_registry(path: Path) -> Registry:
    """Read and validate the registry; an invalid file stops startup."""
    return Registry.model_validate_json(path.read_bytes())
