"""FastAPI application factory for the STEX platform API."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

import httpx2
from fastapi import FastAPI
from pydantic import BaseModel

from stex import __version__
from stex.config import Settings
from stex.knowledge import contributions_api  # noqa: F401 - registers the contribution routes
from stex.knowledge.api import router as knowledge_router
from stex.knowledge.engine import OwnerClient
from stex.knowledge.library import KnowledgeLibrary
from stex.platform.projects.api import router as projects_router
from stex.platform.projects.service import ProjectSummaryService
from stex.platform.registry import load_registry


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["stex-platform"] = "stex-platform"
    version: str = __version__


def create_app(
    settings: Settings | None = None,
    *,
    transport: httpx2.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Build the app. ``transport`` replaces the network in tests only."""
    resolved = settings or Settings.from_environment()
    registry = load_registry(resolved.registry_path)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # trust_env=False: engine calls are loopback-only and never go through a proxy.
        """Make the validated application dependencies available for the server lifetime."""
        async with httpx2.AsyncClient(transport=transport, follow_redirects=False, trust_env=False) as client:
            app.state.projects = ProjectSummaryService(
                registry,
                resolved.engine_origins,
                client,
                timeout_seconds=resolved.studio_timeout_seconds,
                max_bytes=resolved.max_summary_bytes,
            )
            # Knowledge journals (stex.knowledge.projections.v1). Local mode opens the single
            # journal eagerly, so a held writer lock stops startup exactly as Pantheon's did.
            knowledge = resolved.knowledge
            app.state.knowledge = KnowledgeLibrary(
                knowledge.directory,
                hosted=knowledge.hosted,
                legacy_owner=knowledge.legacy_owner,
                limit=knowledge.open_limit,
            )
            app.state.knowledge_secret = knowledge.actor_secret
            app.state.knowledge_igor_secret = knowledge.igor_secret
            app.state.knowledge_owners = OwnerClient(
                client,
                {
                    engine: origin
                    for engine, origin in resolved.engine_origins.items()
                    if engine in knowledge.engines
                },
                actor_secret=knowledge.actor_secret,
            )
            try:
                yield
            finally:
                await app.state.knowledge.close()

    # No interactive docs: they load third-party assets. The OpenAPI document stays.
    app = FastAPI(
        title="STEX Platform API",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
    )

    @app.get("/health", response_model=Health, tags=["health"])
    # Report process readiness independently of engine availability.
    async def health() -> Health:
        return Health()

    app.include_router(projects_router)
    app.include_router(knowledge_router)
    return app
