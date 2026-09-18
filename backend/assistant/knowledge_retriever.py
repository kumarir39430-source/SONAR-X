from pathlib import Path
import json
from typing import Any, Dict, List


KNOWLEDGE_DIR = (
    Path(__file__).resolve().parent.parent / "knowledge"
)


def load_knowledge() -> List[Dict[str, Any]]:
    """
    Load all curated SONAR-X knowledge files.
    """

    records: List[Dict[str, Any]] = []

    for path in sorted(
        KNOWLEDGE_DIR.glob("*.json")
    ):
        try:
            data = json.loads(
                path.read_text(
                    encoding="utf-8-sig"
                )
            )

            if isinstance(data, dict):
                data["source_file"] = path.name
                records.append(data)

        except (OSError, json.JSONDecodeError) as error:
            print(
                f"Could not load {path.name}: {error}"
            )

    return records


def retrieve_knowledge(
    query: str,
    limit: int = 3
) -> List[Dict[str, Any]]:
    """
    Retrieve relevant marine-sonar knowledge.
    """

    if not query:
        return []

    query_terms = {
        term.strip().lower()
        for term in query
        .replace(",", " ")
        .split()
        if term.strip()
    }

    scored = []

    for record in load_knowledge():

        searchable_text = " ".join(
            [
                str(record.get("title", "")),

                " ".join(
                    map(
                        str,
                        record.get("topics", [])
                    )
                ),

                " ".join(
                    map(
                        str,
                        record.get("keywords", [])
                    )
                ),

                " ".join(
                    map(
                        str,
                        record.get("content", [])
                    )
                ),
            ]
        ).lower()

        score = sum(
            1
            for term in query_terms
            if term in searchable_text
        )

        if score > 0:
            scored.append(
                (score, record)
            )

    scored.sort(
        key=lambda item: item[0],
        reverse=True
    )

    return [
        record
        for _, record in scored[:limit]
    ]