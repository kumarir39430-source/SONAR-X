import json
from pathlib import Path
from datetime import datetime, timezone


ASSISTANT_DIR = Path(__file__).resolve().parent
DATA_DIR = ASSISTANT_DIR / "data"
FEEDBACK_FILE = DATA_DIR / "expert_feedback.json"


DATA_DIR.mkdir(parents=True, exist_ok=True)


VALID_DECISIONS = {
    "correct_detection",
    "incorrect_detection",
    "correct_class",
    "incorrect_class",
    "unknown_anomaly",
    "requires_further_sonar_inspection",
}


def _load_feedback():
    if not FEEDBACK_FILE.exists():
        return []

    try:
        with open(
            FEEDBACK_FILE,
            "r",
            encoding="utf-8-sig"
        ) as file:
            data = json.load(file)

        if isinstance(data, list):
            return data

        return []

    except (json.JSONDecodeError, OSError):
        return []


def _save_feedback(feedback):
    with open(
        FEEDBACK_FILE,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            feedback,
            file,
            indent=2,
            ensure_ascii=False
        )


def save_expert_feedback(
    scan_id,
    detection,
    decision,
    expert_note="",
    corrected_class=None,
):
    if decision not in VALID_DECISIONS:
        raise ValueError(
            f"Invalid expert decision: {decision}"
        )

    feedback = _load_feedback()

    record = {
        "feedback_id": len(feedback) + 1,
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat(),
        "scan_id": scan_id,
        "detection": detection,
        "decision": decision,
        "expert_note": expert_note,
        "corrected_class": corrected_class,
    }

    feedback.append(record)
    _save_feedback(feedback)

    return record


def get_all_feedback():
    return _load_feedback()


def get_feedback_for_scan(scan_id):
    return [
        record
        for record in _load_feedback()
        if record.get("scan_id") == scan_id
    ]


def get_feedback_summary():
    feedback = _load_feedback()

    summary = {
        "total_reviews": len(feedback),
        "correct_detection": 0,
        "incorrect_detection": 0,
        "correct_class": 0,
        "incorrect_class": 0,
        "unknown_anomaly": 0,
        "requires_further_sonar_inspection": 0,
    }

    for record in feedback:
        decision = record.get("decision")

        if decision in summary:
            summary[decision] += 1

    return summary
