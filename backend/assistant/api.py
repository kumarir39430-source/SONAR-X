from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.assistant.assistant_engine import answer
from backend.assistant.feedback_store import (
    save_expert_feedback,
    get_all_feedback,
    get_feedback_for_scan,
    get_feedback_summary,
)
from backend.assistant.audit import (
    record_audit_event,
    get_audit_log,
    get_audit_for_scan,
)


router = APIRouter(
    prefix="/assistant",
    tags=["AI Marine Intelligence Assistant"],
)


# ============================================================
# REQUEST MODELS
# ============================================================

class AssistantRequest(BaseModel):
    question: str = Field(..., min_length=1)
    context: Dict[str, Any] = Field(default_factory=dict)


class FeedbackRequest(BaseModel):
    scan_id: str
    detection: Dict[str, Any]
    decision: str
    expert_note: str = ""
    corrected_class: Optional[str] = None


class AuditRequest(BaseModel):
    event_type: str
    scan_id: Optional[str] = None
    detection: Optional[Dict[str, Any]] = None
    details: Dict[str, Any] = Field(default_factory=dict)


# ============================================================
# 1. ASK THE AI MARINE INTELLIGENCE ASSISTANT
# ============================================================

@router.post("/ask")
def ask_assistant(request: AssistantRequest):
    try:
        payload = {
            "question": request.question,
            **request.context,
        }

        result = answer(payload)

        return result

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Assistant processing failed: {exc}",
        )


# ============================================================
# 2. SAVE EXPERT FEEDBACK
# ============================================================

@router.post("/feedback")
def submit_expert_feedback(request: FeedbackRequest):
    try:
        feedback = save_expert_feedback(
            scan_id=request.scan_id,
            detection=request.detection,
            decision=request.decision,
            expert_note=request.expert_note,
            corrected_class=request.corrected_class,
        )

        audit = record_audit_event(
            event_type="expert_review",
            scan_id=request.scan_id,
            detection=request.detection,
            details={
                "decision": request.decision,
                "feedback_id": feedback["feedback_id"],
                "corrected_class": request.corrected_class,
            },
        )

        return {
            "success": True,
            "feedback": feedback,
            "audit": audit,
            "message": "Expert feedback recorded successfully.",
        }

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save expert feedback: {exc}",
        )


# ============================================================
# 3. GET FEEDBACK SUMMARY
# ============================================================

@router.get("/feedback/summary")
def feedback_summary():
    return {
        "success": True,
        "summary": get_feedback_summary(),
    }


# ============================================================
# 4. GET ALL FEEDBACK
# ============================================================

@router.get("/feedback")
def all_feedback():
    return {
        "success": True,
        "feedback": get_all_feedback(),
    }


# ============================================================
# 5. GET FEEDBACK FOR ONE SCAN
# ============================================================

@router.get("/feedback/{scan_id}")
def feedback_for_scan(scan_id: str):
    return {
        "success": True,
        "scan_id": scan_id,
        "feedback": get_feedback_for_scan(scan_id),
    }


# ============================================================
# 6. CREATE AUDIT EVENT
# ============================================================

@router.post("/audit")
def create_audit_event(request: AuditRequest):
    try:
        event = record_audit_event(
            event_type=request.event_type,
            scan_id=request.scan_id,
            detection=request.detection,
            details=request.details,
        )

        return {
            "success": True,
            "audit": event,
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to record audit event: {exc}",
        )


# ============================================================
# 7. GET COMPLETE AUDIT LOG
# ============================================================

@router.get("/audit")
def all_audit_events():
    return {
        "success": True,
        "audit": get_audit_log(),
    }


# ============================================================
# 8. GET AUDIT EVENTS FOR ONE SCAN
# ============================================================

@router.get("/audit/{scan_id}")
def audit_for_scan(scan_id: str):
    return {
        "success": True,
        "scan_id": scan_id,
        "audit": get_audit_for_scan(scan_id),
    }