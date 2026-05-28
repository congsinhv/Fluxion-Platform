"""FastAPI app + routes. Wraps SQLAlchemy in per-request session_scope."""

from __future__ import annotations

from datetime import UTC, datetime

from errors import AppError
from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse
from routes.checkin_route import handle_checkin

app = FastAPI(title="Fluxion DPC API", version="0.2")


@app.exception_handler(AppError)
async def app_error_handler(_request: Request, exc: AppError):
    return JSONResponse(status_code=exc.http_status, content=exc.to_dict())


@app.get("/v1/health")
async def health():
    return {"status": "ok", "service": "fluxion-checkin", "version": "0.2", "ts": _now_iso()}


@app.get("/healthz")
async def healthz():
    return await health()


@app.post("/v1/checkin")
async def checkin(
    request: Request,
    authorization: str | None = Header(default=None),
    x_device_imei: str | None = Header(default=None, alias="X-Device-IMEI"),
):
    body = await request.json()
    return handle_checkin(body, authorization, x_device_imei)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
