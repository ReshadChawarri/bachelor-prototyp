from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.study import STUDY_DATA_DIR  # noqa: E402


def main() -> None:
    default_output = STUDY_DATA_DIR / "exports" / f"study-data-{datetime.now().astimezone():%Y%m%d-%H%M%S}.zip"
    parser = argparse.ArgumentParser(description="Export Remote Study Mode logs, final texts, and assignments.")
    parser.add_argument("--output", default=str(default_output), help="Destination .zip path.")
    args = parser.parse_args()

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    included = 0

    with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as archive:
        for path in sorted(STUDY_DATA_DIR.rglob("*")):
            if not path.is_file() or path == output_path or "exports" in path.relative_to(STUDY_DATA_DIR).parts:
                continue
            archive.write(path, path.relative_to(STUDY_DATA_DIR))
            included += 1

    print(f"Exported {included} study-data file(s) to {output_path}")


if __name__ == "__main__":
    main()
