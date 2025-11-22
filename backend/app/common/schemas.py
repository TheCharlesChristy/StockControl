"""
Common schema definitions shared across modules.
"""
from pydantic import BaseModel
from typing import Optional


class HealthResponse(BaseModel):
    """Health check response schema."""
    status: str
    version: str
    redis: Optional[str] = None


class ErrorResponse(BaseModel):
    """Standard error response schema."""
    error: bool = True
    code: str
    message: str


class PaginationMeta(BaseModel):
    """Pagination metadata schema."""
    total: int
    limit: int
    offset: int
