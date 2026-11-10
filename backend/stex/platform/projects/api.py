"""HTTP transport for the project read model. Logic lives in ``service.py``."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from stex.platform.projects.models import PlatformProjects
from stex.platform.projects.service import ProjectSummaryService

router = APIRouter(prefix="/api/v1", tags=["projects"])


def project_service(request: Request) -> ProjectSummaryService:
    service: ProjectSummaryService = request.app.state.projects
    return service


@router.get("/projects", response_model=PlatformProjects)
async def list_projects(
    service: Annotated[ProjectSummaryService, Depends(project_service)],
) -> PlatformProjects:
    """Merged projects of every active studio; unavailable studios are named, never guessed."""
    return await service.list_projects()
