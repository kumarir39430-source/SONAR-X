from typing import Any, Dict


def calculate_risk(
    confidence: float | None,
    class_name: str | None,
    location_known: bool,
    evidence_strength: str,
    environmental_risk: str = "unknown",
) -> Dict[str, Any]:

    score = 0.0

    if confidence is not None:
        score += (
            max(0.0, min(float(confidence), 1.0))
            * 40.0
        )

    if location_known:
        score += 15.0

    evidence_points = {
        "Strong": 25.0,
        "Moderate": 15.0,
        "Limited": 5.0,
        "Insufficient": 0.0,
    }

    score += evidence_points.get(
        evidence_strength,
        0.0
    )

    environmental_points = {
        "high": 20.0,
        "moderate": 10.0,
        "low": 3.0,
        "unknown": 0.0,
    }

    score += environmental_points.get(
        environmental_risk.lower(),
        0.0
    )

    score = round(
        min(score, 100.0),
        1
    )

    if score >= 75:
        priority = "High"
    elif score >= 50:
        priority = "Medium"
    else:
        priority = "Low"

    return {
        "risk_score": score,
        "priority": priority,
        "environmental_risk": environmental_risk,
        "warning": (
            "Risk score is a decision-support indicator, "
            "not proof that the detected object is hazardous."
        ),
    }
