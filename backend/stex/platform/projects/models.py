"""``stex.platform.projects.v1``: the platform's merged, read-only project list."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

SCHEMA_VERSION: Literal["stex.platform.projects.v1"] = "stex.platform.projects.v1"

ProjectState = Literal["ready", "working", "attention", "failed"]


class _Contract(BaseModel):
    model_config = ConfigDict(frozen=True, alias_generator=to_camel, populate_by_name=True)


class ProjectStatus(_Contract):
    state: ProjectState
    label: str


class PlatformProject(_Contract):
    """One studio-published project, tagged with its studio and Pantheon link."""

    studio: str
    reference: str | None
    id: str
    title: str
    kind: str
    updated_at: str | None
    status: ProjectStatus
    open_path: str
    href: str


class StudioAvailability(_Contract):
    id: str
    state: Literal["available", "unavailable"]


class PlatformProjects(_Contract):
    schema_version: Literal["stex.platform.projects.v1"] = Field(default=SCHEMA_VERSION)
    studios: tuple[StudioAvailability, ...]
    projects: tuple[PlatformProject, ...]
