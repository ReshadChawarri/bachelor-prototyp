from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


DEFAULT_OPENAI_MODEL = "gpt-5.6-luna"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ENV_FILE = BACKEND_ROOT / ".env"

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

    @property
    def ai_configured(self) -> bool:
        return bool(self.openai_api_key)


def get_settings() -> AppSettings:
    return AppSettings(
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        openai_model=os.getenv("OPENAI_MODEL") or DEFAULT_OPENAI_MODEL,
    )
