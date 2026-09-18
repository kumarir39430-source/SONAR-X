from typing import Any, Dict, List


def build_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    detections: List[Dict[str, Any]] = payload.get("detections") or []

    location = (
        payload.get("location")
        or payload.get("geotag")
        or payload.get("gps")
    )

    return {
        "scan_id": payload.get("scan_id"),
        "filename": payload.get("filename"),
        "detections": detections,
        "detection_count": len(detections),
        "location": location,
        "hotspot": payload.get("hotspot"),
        "waste_composition": payload.get("waste_composition"),
        "historical_comparison": payload.get("historical_comparison"),
        "seabed": payload.get("seabed"),
        "environment": payload.get("environment"),
        "environmental_risk": payload.get(
            "environmental_risk", "unknown"
        ),
        "image_quality": payload.get(
            "image_quality", "unknown"
        ),
        "expert_status": payload.get(
            "expert_status", "Pending"
        ),
    }
