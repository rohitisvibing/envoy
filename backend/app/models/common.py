from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel, ConfigDict


def new_id() -> str:
    return str(uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class Schema(BaseModel):
    model_config = ConfigDict(populate_by_name=True, use_enum_values=False)
