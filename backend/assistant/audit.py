import json
from pathlib import Path
from datetime import datetime, timezone


ASSISTANT_DIR = Path(__file__).resolve().parent
DATA_DIR = ASSISTANT_DIR / "data"
AUDIT_FILE = DATA_DIR / "audit_log.json"


DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_audit():
    if not AUDIT_FILE.exists():
        return []

    try:
        with open(
            AUDIT_FILE,
            "r",
            encoding="utf-8-sig"
        ) as file:
            data = json.load(file)

        if isinstance(data, list):
            return data

        return []

    except (json.JSONDecodeError, OSError):
        return []


def _save_audit(records):
    with open(
        AUDIT_FILE,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            records,
            file,
            indent=2,
            ensure_ascii=False
        )


def record_audit_event(
    event_type,
    scan_id=None,
    detection=None,
    details=None,
):
    records = _load_audit()

    event = {
        "audit_id": len(records) + 1,
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat(),
        "event_type": event_type,
        "scan_id": scan_id,
        "detection": detection,
        "details": details or {},
    }

    records.append(event)
    _save_audit(records)

    return event


def get_audit_log():
    return _load_audit()


def get_audit_for_scan(scan_id):
    return [
        event
        for event in _load_audit()
        if event.get("scan_id") == scan_id
    ]
