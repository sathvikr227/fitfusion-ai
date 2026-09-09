from fastapi import Header, HTTPException, status

from .config import settings


def require_bearer(authorization: str | None = Header(default=None)) -> None:
    if not settings.ML_SERVICE_API_KEY:
        # Unset key means the service is misconfigured. Refuse rather than allow-all.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ML_SERVICE_API_KEY not configured",
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )

    token = authorization.removeprefix("Bearer ").strip()
    if token != settings.ML_SERVICE_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bearer token",
        )
