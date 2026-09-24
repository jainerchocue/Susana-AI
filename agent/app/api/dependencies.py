"""API dependencies — internal API key + basic rate limit."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request, status

from app.config.settings import settings

# Simple in-memory sliding window rate limiter (per API key / IP)
_hits: dict[str, deque[float]] = defaultdict(deque)


def verify_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> str:
    if not x_api_key or x_api_key != settings.internal_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key interna inválida o ausente",
        )
    return x_api_key


def rate_limit(request: Request, api_key: str = "") -> None:
    key = api_key or (request.client.host if request.client else "unknown")
    now = time.time()
    window = 60.0
    limit = settings.rate_limit_per_minute
    q = _hits[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit excedido",
        )
    q.append(now)
