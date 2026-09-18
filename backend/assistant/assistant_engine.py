from typing import Any, Dict

from .context_engine import build_context
from .evidence_engine import build_detection_evidence
from .knowledge_retriever import retrieve_knowledge
from .risk_engine import calculate_risk
from .uncertainty_engine import assess_uncertainty


INSUFFICIENT_EVIDENCE = (
    "Insufficient evidence — expert verification required."
)


def _location_text(location: Any) -> str:

    if location is None:
        return "Not available"

    if isinstance(location, dict):

        lat = location.get(
            "latitude",
            location.get("lat")
        )

        lon = location.get(
            "longitude",
            location.get(
                "lon",
                location.get("lng")
            )
        )

        if lat is not None and lon is not None:
            return f"{lat}, {lon}"

    return str(location)


def analyze_detection(
    detection: Dict[str, Any],
    context: Dict[str, Any],
) -> Dict[str, Any]:

    evidence_data = build_detection_evidence(
        detection=detection,
        acoustic_shadow=detection.get(
            "acoustic_shadow"
        ),
        target_shape=detection.get(
            "target_shape"
        ),
        seabed_info=(
            context.get("seabed")
            or context.get("environment")
        ),
    )

    uncertainty = assess_uncertainty(
        confidence=detection.get(
            "confidence"
        ),
        evidence=evidence_data["evidence"],
        image_quality=context.get(
            "image_quality",
            "unknown"
        ),
        expert_status=context.get(
            "expert_status",
            "Pending"
        ),
    )

    risk = calculate_risk(
        confidence=detection.get(
            "confidence"
        ),
        class_name=detection.get(
            "class_name"
        ),
        location_known=evidence_data[
            "has_location"
        ],
        evidence_strength=uncertainty[
            "evidence_strength"
        ],
        environmental_risk=context.get(
            "environmental_risk",
            "unknown"
        ),
    )

    return {
        "finding": (
            detection.get("class_name")
            or "Unclassified anomaly"
        ),

        "evidence": evidence_data[
            "evidence"
        ],

        "confidence": {
            "ai_confidence": detection.get(
                "confidence"
            ),
            "level": uncertainty[
                "confidence_level"
            ],
            "evidence_strength": uncertainty[
                "evidence_strength"
            ],
        },

        "risk": risk,

        "location": _location_text(
            detection.get(
                "location"
            )
            or context.get("location")
        ),

        "expert_status": context.get(
            "expert_status",
            "Pending"
        ),

        "uncertainty_alert": uncertainty[
            "uncertainty_alert"
        ],

        "recommendation": (
            INSUFFICIENT_EVIDENCE
            if uncertainty[
                "uncertainty_alert"
            ]
            else (
                "Review the detection with "
                "the sonar evidence and continue "
                "survey assessment."
            )
        ),
    }


def answer(
    payload: Dict[str, Any]
) -> Dict[str, Any]:

    context = build_context(
        payload
    )

    detections = context[
        "detections"
    ]

    question = str(
        payload.get(
            "question",
            ""
        )
    ).strip()

    knowledge = (
        retrieve_knowledge(
            question
        )
        if question
        else []
    )

    if not detections:

        return {
            "success": True,
            "question": question,
            "finding": (
                "No supplied detections"
            ),
            "evidence": [],
            "confidence": {
                "ai_confidence": None,
                "level": "Unknown",
                "evidence_strength": (
                    "Insufficient"
                ),
            },
            "risk": {
                "risk_score": 0,
                "priority": "Low",
                "environmental_risk": (
                    "unknown"
                ),
            },
            "location": _location_text(
                context["location"]
            ),
            "expert_status": context[
                "expert_status"
            ],
            "uncertainty_alert": True,
            "recommendation": (
                INSUFFICIENT_EVIDENCE
            ),
            "knowledge": knowledge,
        }

    analyzed = [
        analyze_detection(
            detection,
            context
        )
        for detection in detections
    ]

    highest_risk = max(
        analyzed,
        key=lambda item: float(
            item["risk"]["risk_score"]
        )
    )

    highest_confidence = max(
        analyzed,
        key=lambda item: (
            item["confidence"][
                "ai_confidence"
            ]
            if item["confidence"][
                "ai_confidence"
            ] is not None
            else -1
        )
    )

    question_lower = question.lower()

    if "highest risk" in question_lower:
        selected = highest_risk

    elif (
        "highest confidence"
        in question_lower
    ):
        selected = highest_confidence

    elif "confidence" in question_lower:
        selected = highest_confidence

    else:
        selected = analyzed[0]

    return {
        "success": True,
        "question": question,
        "finding": selected[
            "finding"
        ],
        "evidence": selected[
            "evidence"
        ],
        "confidence": selected[
            "confidence"
        ],
        "risk": selected[
            "risk"
        ],
        "location": selected[
            "location"
        ],
        "expert_status": selected[
            "expert_status"
        ],
        "uncertainty_alert": selected[
            "uncertainty_alert"
        ],
        "recommendation": selected[
            "recommendation"
        ],
        "all_findings": analyzed,
        "knowledge": knowledge,
    }
