from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


DEFAULT_OPENAI_MODEL = "gpt-5.6-luna"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ENV_FILE = BACKEND_ROOT / ".env"
DEFAULT_STUDY_DATA_DIR = BACKEND_ROOT / "study-data"
DEFAULT_STUDY_PUBLIC_BASE_URL = "http://localhost:5173"
DEFAULT_CORS_ALLOWED_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dependency is installed in normal backend setup.
    load_dotenv = None
else:
    load_dotenv(BACKEND_ENV_FILE)


@dataclass(frozen=True)
class AppSettings:
    openai_api_key: str | None
    openai_model: str
    study_data_dir: Path = DEFAULT_STUDY_DATA_DIR
    study_public_base_url: str = DEFAULT_STUDY_PUBLIC_BASE_URL
    cors_allowed_origins: tuple[str, ...] = DEFAULT_CORS_ALLOWED_ORIGINS

    @property
    def ai_configured(self) -> bool:
        return bool(self.openai_api_key)


def get_settings() -> AppSettings:
    return AppSettings(
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        openai_model=os.getenv("OPENAI_MODEL") or DEFAULT_OPENAI_MODEL,
        study_data_dir=Path(os.getenv("STUDY_DATA_DIR") or DEFAULT_STUDY_DATA_DIR).expanduser(),
        study_public_base_url=os.getenv("STUDY_PUBLIC_BASE_URL") or DEFAULT_STUDY_PUBLIC_BASE_URL,
        cors_allowed_origins=parse_csv_env("CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ALLOWED_ORIGINS),
    )


def parse_csv_env(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.getenv(name)
    if not raw:
        return default
    values = tuple(value.strip() for value in raw.split(",") if value.strip())
    return values or default
