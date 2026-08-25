from __future__ import annotations

from dataclasses import dataclass
import os


DEFAULT_OPENAI_MODEL = "gpt-5.6-luna"

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dependency is installed in normal backend setup.
    load_dotenv = None
else:
    load_dotenv()


@dataclass(frozen=True)
class AppSettings:
    openai_api_key: str | None
    openai_model: str


def get_settings() -> AppSettings:
    return AppSettings(
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        openai_model=os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
    )
