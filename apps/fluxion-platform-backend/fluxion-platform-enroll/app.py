"""FastAPI app for the enroll Lambda — POST /v1/enroll + health. HTTP only."""

from __future__ import annotations

from datetime import UTC, datetime

from errors import AppError
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from routes.enroll import handle_enroll

app = FastAPI(title="Fluxion Enroll API", version="0.1")


@app.exception_handler(AppError)
async def app_error_handler(_request: Request, exc: AppError):
    return JSONResponse(status_code=exc.http_status, content=exc.to_dict())


@app.get("/v1/health")
async def health():
    return {"status": "ok", "service": "fluxion-enroll", "version": "0.1", "ts": _now_iso()}


@app.get("/healthz")
async def healthz():
    return await health()


@app.post("/v1/enroll")
async def enroll(request: Request):
    body = await request.json()
    return handle_enroll(body)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
