"""REST fallback for approvals (the live workspace normally uses the WebSocket)."""

from fastapi import APIRouter

from app.core.deps import get_container
from app.core.errors import AppError, ErrorKind
from app.models.conversation import ApprovalDecision
from app.realtime.session_manager import manager

router = APIRouter(prefix="/api/conversations/{conversation_id}/approvals", tags=["approvals"])


@router.post("/{approval_id}")
async def decide(conversation_id: str, approval_id: str, body: ApprovalDecision) -> dict:
    session = await manager.get(get_container(), conversation_id)
    if approval_id not in session.approvals:
        raise AppError(ErrorKind.not_found, "Approval not found.")
    await session.decide(approval_id, body)
    return session.approvals[approval_id].model_dump(mode="json")
