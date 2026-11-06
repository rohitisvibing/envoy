"""FastAPI entrypoint."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import approvals, conversations, missions, profiles
from app.core.deps import get_container
from app.core.errors import AppError
from app.realtime import websocket_manager
from app.realtime.session_manager import manager

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_container()
    yield
    await manager.shutdown()


app = FastAPI(title="Envoy voice agents", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_container().settings.cors_origins.split(",")],
    allow_methods=["*"], allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(_req: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.to_dict()})


@app.get("/api/health")
async def health() -> dict:
    c = get_container()
    return {
        "ok": True,
        "demo_mode": c.demo,
        "llm": {"provider": c.llm.name, "configured": c.settings.llm_configured,
                "model": c.settings.openrouter_model},
        "speech": {"provider": "sarvam", "configured": c.voice_available,
                   "tts_model": c.settings.sarvam_tts_model,
                   "stt_model": c.settings.sarvam_stt_model},
        "database": {"provider": c.repo.name, "configured": c.settings.db_configured},
    }


app.include_router(profiles.router)
app.include_router(missions.router)
app.include_router(conversations.router)
app.include_router(approvals.router)
app.include_router(websocket_manager.router)
