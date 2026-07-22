import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _now():
    return datetime.now(timezone.utc)


class Call(Base):
    __tablename__ = "calls"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    original_filename: Mapped[str | None] = mapped_column(String(255))
    audio_path: Mapped[str | None] = mapped_column(String(500))
    duration_sec: Mapped[float | None] = mapped_column(Float)

    # uploaded | transcribing | analyzing | done | error
    status: Mapped[str] = mapped_column(String(30), default="uploaded")
    error: Mapped[str | None] = mapped_column(Text)

    engine: Mapped[str | None] = mapped_column(String(50))  # faster-whisper:medium, voxtral, ...
    transcript_text: Mapped[str | None] = mapped_column(Text)
    segments: Mapped[list | None] = mapped_column(JSONB)      # [{start, end, text}]
    coherence: Mapped[dict | None] = mapped_column(JSONB)     # {score, verdetto, problemi[]}
    summary: Mapped[dict | None] = mapped_column(JSONB)       # {riassunto, punti_chiave, ...}
    ticket: Mapped[dict | None] = mapped_column(JSONB)        # CRM simulato compilato dall'operatore
    completeness: Mapped[dict | None] = mapped_column(JSONB)  # {score, presenti, mancanti, ...}

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "original_filename": self.original_filename,
            "duration_sec": self.duration_sec,
            "status": self.status,
            "error": self.error,
            "engine": self.engine,
            "transcript_text": self.transcript_text,
            "segments": self.segments,
            "coherence": self.coherence,
            "summary": self.summary,
            "ticket": self.ticket,
            "completeness": self.completeness,
        }
