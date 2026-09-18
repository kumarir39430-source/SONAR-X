from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from PIL import Image, ImageStat, ImageFilter, ImageOps
from typing import Any
import io
import os
import json
import hashlib
from datetime import datetime


router = APIRouter(
    prefix="/advanced-intelligence",
    tags=["Advanced Marine Intelligence"],
)


# ============================================================
# STORAGE
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

ADVANCED_DATA_DIR = os.path.join(
    BASE_DIR,
    "advanced_intelligence_data"
)

STATE_FILE = os.path.join(
    ADVANCED_DATA_DIR,
    "state.json"
)

os.makedirs(
    ADVANCED_DATA_DIR,
    exist_ok=True
)


# ============================================================
# INITIAL STATE
# ============================================================

DEFAULT_STATE = {
    "surveys": [],
    "objects": {},
    "knowledge_graph": {
        "objects": [],
        "locations": [],
        "surveys": [],
        "relationships": []
    }
}


def load_state():
    if not os.path.exists(STATE_FILE):
        save_state(DEFAULT_STATE.copy())
        return DEFAULT_STATE.copy()

    try:
        with open(
            STATE_FILE,
            "r",
            encoding="utf-8"
        ) as file:
            data = json.load(file)

        if not isinstance(data, dict):
            return DEFAULT_STATE.copy()

        return data

    except Exception:
        return DEFAULT_STATE.copy()


def save_state(state):
    with open(
        STATE_FILE,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            state,
            file,
            indent=2
        )


# ============================================================
# GENERAL HELPERS
# ============================================================

def clamp(
    value: float,
    minimum: float = 0.0,
    maximum: float = 100.0
):
    return max(
        minimum,
        min(
            maximum,
            float(value)
        )
    )


def safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def parse_detections(detections_json: str):
    try:
        detections = json.loads(
            detections_json
        )

        if isinstance(detections, list):
            return detections

        return []

    except Exception:
        return []


def get_bbox(detection):
    bbox = (
        detection.get("bbox")
        or detection.get("bounding_box")
        or detection.get("box")
    )

    if isinstance(bbox, list) and len(bbox) >= 4:
        return [
            safe_float(bbox[0]),
            safe_float(bbox[1]),
            safe_float(bbox[2]),
            safe_float(bbox[3]),
        ]

    if isinstance(bbox, dict):
        return [
            safe_float(bbox.get("x1")),
            safe_float(bbox.get("y1")),
            safe_float(bbox.get("x2")),
            safe_float(bbox.get("y2")),
        ]

    return None


# ============================================================
# IMAGE QUALITY / RELIABILITY
# ============================================================

def analyze_image_quality(image):
    gray = ImageOps.grayscale(
        image
    )

    stat = ImageStat.Stat(
        gray
    )

    mean_intensity = (
        stat.mean[0]
        if stat.mean
        else 0
    )

    std_intensity = (
        stat.stddev[0]
        if stat.stddev
        else 0
    )

    extrema = gray.getextrema()

    dynamic_range = (
        extrema[1] - extrema[0]
        if extrema
        else 0
    )

    edge_image = gray.filter(
        ImageFilter.FIND_EDGES
    )

    edge_stat = ImageStat.Stat(
        edge_image
    )

    edge_strength = (
        edge_stat.mean[0]
        if edge_stat.mean
        else 0
    )

    quality_score = 100.0

    # Very dark image
    if mean_intensity < 30:
        quality_score -= 35

    # Very bright image
    if mean_intensity > 225:
        quality_score -= 25

    # Very low contrast
    if std_intensity < 15:
        quality_score -= 30

    # Very small dynamic range
    if dynamic_range < 50:
        quality_score -= 15

    quality_score = clamp(
        quality_score
    )

    if quality_score >= 70:
        status = "Reliable"
        recommendation = (
            "Sonar quality is sufficient "
            "for prototype inference."
        )

    elif quality_score >= 45:
        status = "Caution"
        recommendation = (
            "Inference can proceed, but "
            "expert review is recommended."
        )

    else:
        status = "Low Evidence"
        recommendation = (
            "Insufficient sonar evidence — "
            "reacquisition recommended."
        )

    return {
        "quality_score": round(
            quality_score,
            1
        ),
        "status": status,
        "recommendation": recommendation,
        "mean_intensity": round(
            mean_intensity,
            2
        ),
        "contrast_score": round(
            std_intensity,
            2
        ),
        "dynamic_range": round(
            dynamic_range,
            2
        ),
        "edge_strength": round(
            edge_strength,
            2
        )
    }


# ============================================================
# SEABED-AWARE ANALYSIS
# ============================================================

def analyze_seabed(image):
    gray = ImageOps.grayscale(
        image
    )

    stat = ImageStat.Stat(
        gray
    )

    mean_intensity = (
        stat.mean[0]
        if stat.mean
        else 0
    )

    std_intensity = (
        stat.stddev[0]
        if stat.stddev
        else 0
    )

    edges = gray.filter(
        ImageFilter.FIND_EDGES
    )

    edge_stat = ImageStat.Stat(
        edges
    )

    edge_strength = (
        edge_stat.mean[0]
        if edge_stat.mean
        else 0
    )

    # Prototype rule-based seabed interpretation.
    #
    # This is NOT a trained seabed classifier.
    # It uses sonar image texture characteristics.

    if std_intensity < 18:
        seabed_type = "Muddy / Low-Texture"

    elif edge_strength > 35 and std_intensity > 45:
        seabed_type = "Rocky / High-Texture"

    elif std_intensity > 32:
        seabed_type = "Mixed"

    else:
        seabed_type = "Sandy / Moderate-Texture"

    adaptation = {
        "Muddy / Low-Texture": (
            "Use caution with weak-contrast targets."
        ),
        "Rocky / High-Texture": (
            "Increase scrutiny for seabed-generated "
            "false positives."
        ),
        "Mixed": (
            "Use balanced detection interpretation "
            "and expert verification."
        ),
        "Sandy / Moderate-Texture": (
            "Standard prototype interpretation."
        )
    }

    return {
        "seabed_type": seabed_type,
        "texture_score": round(
            std_intensity,
            2
        ),
        "edge_strength": round(
            edge_strength,
            2
        ),
        "mean_intensity": round(
            mean_intensity,
            2
        ),
        "adaptation_guidance": adaptation[
            seabed_type
        ]
    }


# ============================================================
# ACOUSTIC SHADOW INTELLIGENCE
# ============================================================

def analyze_acoustic_shadow(
    image,
    detection
):
    bbox = get_bbox(
        detection
    )

    if not bbox:
        return {
            "shadow_detected": False,
            "shadow_score": 0,
            "estimated_shadow_length_pixels": 0,
            "interpretation": (
                "Bounding box unavailable."
            )
        }

    width, height = image.size

    x1, y1, x2, y2 = [
        int(round(value))
        for value in bbox
    ]

    x1 = max(
        0,
        min(width - 1, x1)
    )

    x2 = max(
        0,
        min(width, x2)
    )

    y1 = max(
        0,
        min(height - 1, y1)
    )

    y2 = max(
        0,
        min(height, y2)
    )

    if x2 <= x1 or y2 <= y1:
        return {
            "shadow_detected": False,
            "shadow_score": 0,
            "estimated_shadow_length_pixels": 0,
            "interpretation": (
                "Invalid detection geometry."
            )
        }

    gray = ImageOps.grayscale(
        image
    )

    target_crop = gray.crop(
        (
            x1,
            y1,
            x2,
            y2
        )
    )

    target_stat = ImageStat.Stat(
        target_crop
    )

    target_mean = (
        target_stat.mean[0]
        if target_stat.mean
        else 0
    )

    object_width = max(
        1,
        x2 - x1
    )

    object_height = max(
        1,
        y2 - y1
    )

    # Search to the right of the detected target.
    # This is a prototype shadow heuristic.

    shadow_start = x2
    shadow_end = min(
        width,
        x2 + object_width * 2
    )

    shadow_crop = gray.crop(
        (
            shadow_start,
            y1,
            shadow_end,
            y2
        )
    )

    shadow_stat = ImageStat.Stat(
        shadow_crop
    )

    shadow_mean = (
        shadow_stat.mean[0]
        if shadow_stat.mean
        else 0
    )

    contrast_difference = (
        target_mean - shadow_mean
    )

    shadow_score = clamp(
        50 + contrast_difference * 2,
        0,
        100
    )

    shadow_detected = (
        contrast_difference >= 10
    )

    estimated_length = (
        max(
            0,
            shadow_end - shadow_start
        )
        if shadow_detected
        else 0
    )

    if shadow_detected:
        interpretation = (
            "Dark region adjacent to the "
            "target is consistent with a "
            "potential acoustic shadow. "
            "Geometry is reported in pixels "
            "only; physical height/orientation "
            "requires calibrated sonar metadata."
        )
    else:
        interpretation = (
            "No strong adjacent shadow signal "
            "was detected by the prototype heuristic."
        )

    return {
        "shadow_detected": shadow_detected,
        "shadow_score": round(
            shadow_score,
            1
        ),
        "estimated_shadow_length_pixels": (
            estimated_length
        ),
        "target_mean_intensity": round(
            target_mean,
            2
        ),
        "shadow_mean_intensity": round(
            shadow_mean,
            2
        ),
        "interpretation": interpretation
    }


# ============================================================
# EVIDENCE + RISK
# ============================================================

def calculate_evidence_and_risk(
    detection,
    shadow_result,
    reliability_result
):
    confidence = safe_float(
        detection.get(
            "confidence_percent",
            detection.get(
                "confidence",
                0
            )
        )
    )

    if confidence <= 1:
        confidence *= 100

    shadow_score = safe_float(
        shadow_result.get(
            "shadow_score",
            0
        )
    )

    quality_score = safe_float(
        reliability_result.get(
            "quality_score",
            0
        )
    )

    # Evidence combines model confidence,
    # image reliability and shadow evidence.
    evidence_strength = (
        confidence * 0.45
        + quality_score * 0.30
        + shadow_score * 0.25
    )

    evidence_strength = clamp(
        evidence_strength
    )

    class_name = str(
        detection.get(
            "class_name",
            "Unknown"
        )
    )

    # This is an environmental PRIORITY proxy,
    # not a measured pollution level.
    class_priority = {
        "Shipwreck": 80,
        "Aircraft": 75,
        "Rocks/Stones": 25,
        "Fish": 10
    }.get(
        class_name,
        50
    )

    anomaly_bonus = (
        20
        if detection.get(
            "is_unknown_anomaly",
            False
        )
        else 0
    )

    environmental_priority = clamp(
        class_priority
        + anomaly_bonus
    )

    # Priority is deliberately separated from
    # model confidence.
    decision_priority = clamp(
        evidence_strength * 0.55
        + environmental_priority * 0.45
    )

    if decision_priority >= 75:
        risk_level = "High Priority"

    elif decision_priority >= 50:
        risk_level = "Medium Priority"

    else:
        risk_level = "Low Priority"

    return {
        "model_confidence": round(
            confidence,
            1
        ),
        "evidence_strength": round(
            evidence_strength,
            1
        ),
        "environmental_priority_proxy": round(
            environmental_priority,
            1
        ),
        "decision_priority": round(
            decision_priority,
            1
        ),
        "risk_level": risk_level,
        "note": (
            "Prototype decision-support score. "
            "It is not a validated pollution, "
            "hazard or environmental-risk measurement."
        )
    }


# ============================================================
# OBJECT FINGERPRINT
# ============================================================

def create_object_fingerprint(
    detection,
    latitude,
    longitude
):
    class_name = str(
        detection.get(
            "class_name",
            "Unknown"
        )
    )

    bbox = get_bbox(
        detection
    ) or [0, 0, 0, 0]

    fingerprint_source = (
        f"{class_name}|"
        f"{round(latitude, 5)}|"
        f"{round(longitude, 5)}|"
        f"{[round(v) for v in bbox]}"
    )

    digest = hashlib.sha256(
        fingerprint_source.encode(
            "utf-8"
        )
    ).hexdigest()[:8].upper()

    return f"ANOMALY-{digest}"


# ============================================================
# KNOWLEDGE GRAPH
# ============================================================

def update_knowledge_graph(
    state,
    object_id,
    scan_id,
    class_name,
    latitude,
    longitude,
    risk_level
):
    graph = state.setdefault(
        "knowledge_graph",
        {
            "objects": [],
            "locations": [],
            "surveys": [],
            "relationships": []
        }
    )

    if object_id not in graph["objects"]:
        graph["objects"].append(
            object_id
        )

    location_id = (
        f"LOCATION-"
        f"{round(latitude, 5)}-"
        f"{round(longitude, 5)}"
    )

    if location_id not in graph["locations"]:
        graph["locations"].append(
            location_id
        )

    if scan_id not in graph["surveys"]:
        graph["surveys"].append(
            scan_id
        )

    graph["relationships"].extend([
        {
            "from": object_id,
            "relation": "DETECTED_IN",
            "to": scan_id
        },
        {
            "from": object_id,
            "relation": "LOCATED_AT",
            "to": location_id
        },
        {
            "from": object_id,
            "relation": "CLASSIFIED_AS",
            "to": class_name
        },
        {
            "from": object_id,
            "relation": "HAS_PRIORITY",
            "to": risk_level
        }
    ])

    # Remove exact duplicate relationships.
    unique = []

    for relationship in graph["relationships"]:
        if relationship not in unique:
            unique.append(
                relationship
            )

    graph["relationships"] = unique


# ============================================================
# MAIN ADVANCED ANALYSIS
# ============================================================

@router.post("/analyze")
async def advanced_analysis(
    file: UploadFile = File(...),
    latitude: float = Form(0.0),
    longitude: float = Form(0.0),
    scan_id: str = Form(""),
    detections: str = Form("[]")
):
    try:
        contents = await file.read()

        image = Image.open(
            io.BytesIO(contents)
        ).convert("RGB")

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to read sonar image: {exc}"
        )

    if not scan_id:
        scan_id = (
            "SONAR-"
            + hashlib.sha256(
                contents
            ).hexdigest()[:8].upper()
        )

    detection_list = parse_detections(
        detections
    )

    reliability = analyze_image_quality(
        image
    )

    seabed = analyze_seabed(
        image
    )

    state = load_state()

    processed_detections = []

    high_priority = []

    for index, detection in enumerate(
        detection_list
    ):
        shadow = analyze_acoustic_shadow(
            image,
            detection
        )

        evidence = calculate_evidence_and_risk(
            detection,
            shadow,
            reliability
        )

        object_id = create_object_fingerprint(
            detection,
            latitude,
            longitude
        )

        class_name = str(
            detection.get(
                "class_name",
                "Unknown"
            )
        )

        processed = {
            "detection_index": index + 1,
            "object_id": object_id,
            "class_name": class_name,
            "confidence_percent": round(
                safe_float(
                    detection.get(
                        "confidence_percent",
                        0
                    )
                ),
                1
            ),
            "bbox": get_bbox(
                detection
            ),
            "acoustic_shadow": shadow,
            "evidence": evidence,
            "seabed_context": seabed[
                "seabed_type"
            ],
            "location": {
                "latitude": latitude,
                "longitude": longitude
            }
        }

        processed_detections.append(
            processed
        )

        if evidence[
            "decision_priority"
        ] >= 75:
            high_priority.append(
                processed
            )

        # --------------------------------------------------------
        # OBJECT MEMORY
        # --------------------------------------------------------

        objects = state.setdefault(
            "objects",
            {}
        )

        if object_id not in objects:
            objects[object_id] = {
                "object_id": object_id,
                "first_seen": scan_id,
                "class_history": [],
                "survey_history": [],
                "locations": []
            }

        object_record = objects[
            object_id
        ]

        if class_name not in object_record[
            "class_history"
        ]:
            object_record[
                "class_history"
            ].append(
                class_name
            )

        if scan_id not in object_record[
            "survey_history"
        ]:
            object_record[
                "survey_history"
            ].append(
                scan_id
            )

        location = {
            "latitude": latitude,
            "longitude": longitude
        }

        if location not in object_record[
            "locations"
        ]:
            object_record[
                "locations"
            ].append(
                location
            )

        update_knowledge_graph(
            state=state,
            object_id=object_id,
            scan_id=scan_id,
            class_name=class_name,
            latitude=latitude,
            longitude=longitude,
            risk_level=evidence[
                "risk_level"
            ]
        )

    # ========================================================
    # DIGITAL TWIN SURVEY RECORD
    # ========================================================

    survey_record = {
        "scan_id": scan_id,
        "filename": file.filename,
        "timestamp": datetime.utcnow().isoformat(),
        "location": {
            "latitude": latitude,
            "longitude": longitude
        },
        "seabed": seabed,
        "reliability": reliability,
        "objects": processed_detections
    }

    surveys = state.setdefault(
        "surveys",
        []
    )

    # Replace same scan instead of duplicating it.
    surveys[:] = [
        survey
        for survey in surveys
        if survey.get(
            "scan_id"
        ) != scan_id
    ]

    surveys.append(
        survey_record
    )

    save_state(
        state
    )

    # ========================================================
    # HOTSPOT PROXY
    # ========================================================

    detection_count = len(
        processed_detections
    )

    hotspot_score = clamp(
        detection_count * 15
        + seabed["texture_score"] * 0.5
    )

    if hotspot_score >= 70:
        hotspot_status = "High Priority Zone"

    elif hotspot_score >= 40:
        hotspot_status = "Watch Zone"

    else:
        hotspot_status = "Low Current Density"

    # ========================================================
    # NEXT SURVEY PLAN
    # ========================================================

    if reliability["quality_score"] < 45:
        next_action = (
            "Reacquire sonar data before "
            "expanding the survey."
        )

    elif high_priority:
        next_action = (
            "Prioritize high-priority detections "
            "for detailed follow-up scanning."
        )

    elif detection_count == 0:
        next_action = (
            "Prioritize nearby unexplored coverage "
            "to improve spatial confidence."
        )

    else:
        next_action = (
            "Continue coverage around the current "
            "survey region and monitor persistent targets."
        )

    next_survey_plan = {
        "priority": (
            "High"
            if high_priority
            else "Normal"
        ),
        "recommended_action": next_action,
        "high_priority_objects": len(
            high_priority
        ),
        "coverage_strategy": (
            "Targeted follow-up"
            if high_priority
            else "Coverage expansion"
        )
    }

    # ========================================================
    # CLEANUP MISSION PROTOTYPE
    # ========================================================

    cleanup_candidates = [
        item
        for item in processed_detections
        if item["class_name"]
        in {
            "Shipwreck",
            "Aircraft"
        }
        and item["evidence"][
            "decision_priority"
        ] >= 60
    ]

    cleanup_plan = {
        "mission_status": (
            "Candidate Mission"
            if cleanup_candidates
            else "No Candidate Mission"
        ),
        "candidate_count": len(
            cleanup_candidates
        ),
        "route_strategy": (
            "Prioritize highest-priority "
            "candidate locations first."
            if cleanup_candidates
            else "No candidate route generated."
        ),
        "planning_note": (
            "Prototype planning output. "
            "Distance, fuel, manpower and "
            "operational constraints require "
            "real mission data."
        )
    }

    # ========================================================
    # TIME MACHINE SUMMARY
    # ========================================================

    historical_count = len(
        surveys
    )

    time_machine = {
        "surveys_recorded": historical_count,
        "current_scan": scan_id,
        "comparison_ready": (
            historical_count >= 2
        ),
        "message": (
            "Historical comparison becomes "
            "available after multiple survey "
            "records are stored."
        )
    }

    # ========================================================
    # RESPONSE
    # ========================================================

    return {
        "success": True,
        "feature": (
            "Advanced Marine Intelligence "
            "and Decision System"
        ),
        "scan_id": scan_id,
        "filename": file.filename,

        "reliability": reliability,

        "seabed_analysis": seabed,

        "objects": processed_detections,

        "object_count": detection_count,

        "high_priority_objects": high_priority,

        "hotspot_analysis": {
            "hotspot_score": round(
                hotspot_score,
                1
            ),
            "status": hotspot_status,
            "prediction_type": (
                "Prototype density-based "
                "priority estimation"
            )
        },

        "next_survey_planner":
            next_survey_plan,

        "cleanup_mission_planner":
            cleanup_plan,

        "digital_twin": {
            "survey_id": scan_id,
            "object_count": detection_count,
            "location": {
                "latitude": latitude,
                "longitude": longitude
            }
        },

        "time_machine":
            time_machine,

        "knowledge_graph": {
            "objects": len(
                state[
                    "knowledge_graph"
                ]["objects"]
            ),
            "locations": len(
                state[
                    "knowledge_graph"
                ]["locations"]
            ),
            "surveys": len(
                state[
                    "knowledge_graph"
                ]["surveys"]
            ),
            "relationships": len(
                state[
                    "knowledge_graph"
                ]["relationships"]
            )
        },

        "object_fingerprinting": {
            "enabled": True,
            "objects": [
                item["object_id"]
                for item in processed_detections
            ]
        },

        "message": (
            "Advanced marine intelligence "
            "analysis completed."
        ),

        "prototype_notice": (
            "Acoustic shadow, seabed type, "
            "risk, hotspot prediction and "
            "planning outputs are prototype "
            "decision-support analyses. "
            "They are not validated physical, "
            "pollution or operational measurements."
        )
    }


# ============================================================
# STATE / DIGITAL TWIN API
# ============================================================

@router.get("/state")
def get_advanced_state():
    state = load_state()

    return {
        "success": True,
        "surveys": state.get(
            "surveys",
            []
        ),
        "objects": state.get(
            "objects",
            {}
        ),
        "knowledge_graph":
            state.get(
                "knowledge_graph",
                {}
            )
    }


# ============================================================
# HISTORICAL SURVEY API
# ============================================================

@router.get("/history")
def get_advanced_history():
    state = load_state()

    surveys = state.get(
        "surveys",
        []
    )

    return {
        "success": True,
        "survey_count": len(
            surveys
        ),
        "surveys": surveys
    }


# ============================================================
# OBJECT FINGERPRINT API
# ============================================================

@router.get("/objects")
def get_object_fingerprints():
    state = load_state()

    objects = state.get(
        "objects",
        {}
    )

    return {
        "success": True,
        "count": len(
            objects
        ),
        "objects": list(
            objects.values()
        )
    }


# ============================================================
# KNOWLEDGE GRAPH API
# ============================================================

@router.get("/knowledge-graph")
def get_knowledge_graph():
    state = load_state()

    return {
        "success": True,
        "graph": state.get(
            "knowledge_graph",
            {}
        )
    }


# ============================================================
# FEATURE STATUS
# ============================================================

@router.get("/status")
def advanced_feature_status():
    return {
        "success": True,
        "feature": (
            "Advanced Marine Intelligence "
            "and Decision System"
        ),
        "modules": {
            "acoustic_shadow_intelligence":
                "Prototype Active",

            "seabed_aware_analysis":
                "Prototype Active",

            "confidence_evidence_risk":
                "Prototype Active",

            "digital_twin":
                "Active",

            "ocean_time_machine":
                "Active",

            "predictive_hotspot":
                "Prototype Active",

            "next_survey_planner":
                "Prototype Active",

            "cleanup_mission_planner":
                "Prototype Active",

            "object_fingerprinting":
                "Active",

            "knowledge_graph":
                "Active",

            "evidence_based_answers":
                "Backend Data Ready",

            "self_improving_loop":
                "Expert Feedback Connected",

            "synthetic_sonar_lab":
                "Planned",

            "reliability_monitor":
                "Active"
        }
    }