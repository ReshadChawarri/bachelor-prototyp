from __future__ import annotations

import argparse
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings  # noqa: E402
from app.study import (  # noqa: E402
    StudyCondition,
    StudyTextId,
    create_counterbalanced_study_links,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create opaque Remote Study Mode task links for one participant.")
    parser.add_argument("participant_id", help="Pseudonymous participant ID, for example P03.")
    parser.add_argument("--task1-condition", required=True, choices=["A", "B"])
    parser.add_argument("--task1-text", required=True, choices=["X", "Y"])
    parser.add_argument("--task2-condition", required=True, choices=["A", "B"])
    parser.add_argument("--task2-text", required=True, choices=["X", "Y"])
    parser.add_argument(
        "--base-url",
        default=get_settings().study_public_base_url,
        help="Public frontend base URL. Defaults to STUDY_PUBLIC_BASE_URL or http://localhost:5173.",
    )
    args = parser.parse_args()

    links = create_counterbalanced_study_links(
        participant_id=args.participant_id,
        task1_condition=args.task1_condition,  # type: ignore[arg-type]
        task1_text=args.task1_text,  # type: ignore[arg-type]
        task2_condition=args.task2_condition,  # type: ignore[arg-type]
        task2_text=args.task2_text,  # type: ignore[arg-type]
        base_url=args.base_url,
    )

    print(f"{args.participant_id} remote study links")
    for link in links:
        print(f"Task {link.taskOrder}: {link.url}")
    print()
    print("Private assignment files:")
    for link in links:
        print(link.assignmentPath)


if __name__ == "__main__":
    main()
