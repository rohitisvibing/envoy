"""Principal profile: the person on whose behalf agents act, with per-field disclosure policy."""

from enum import StrEnum

from pydantic import Field

from .common import Schema, new_id


class Disclosure(StrEnum):
    always = "always"          # Always share
    relevant = "relevant"      # Share when relevant
    approval = "approval"      # Ask the principal first
    never = "never"            # Never share


class ProfileField(Schema):
    id: str = Field(default_factory=new_id)
    key: str
    label: str
    value: str | None = None
    disclosure: Disclosure = Disclosure.relevant
    is_custom: bool = False


STANDARD_FIELDS: list[tuple[str, str, Disclosure]] = [
    ("full_name", "Full name", Disclosure.always),
    ("preferred_name", "Preferred name", Disclosure.always),
    ("occupation", "Occupation", Disclosure.relevant),
    ("company", "Company", Disclosure.relevant),
    ("city", "Current city", Disclosure.relevant),
    ("phone", "Phone number", Disclosure.approval),
    ("email", "Email", Disclosure.approval),
    ("salary", "Salary", Disclosure.never),
]


class PrincipalProfile(Schema):
    id: str
    preferred_languages: list[str] = Field(default_factory=lambda: ["English"])
    communication_preferences: str | None = None
    background: str | None = None
    fields: list[ProfileField] = Field(default_factory=list)

    def field(self, key: str) -> ProfileField | None:
        return next((f for f in self.fields if f.key == key), None)

    def display_name(self) -> str:
        for key in ("preferred_name", "full_name"):
            f = self.field(key)
            if f and f.value and f.disclosure != Disclosure.never:
                return f.value
        return "my principal"

    @classmethod
    def blank(cls, principal_id: str) -> "PrincipalProfile":
        return cls(
            id=principal_id,
            fields=[ProfileField(key=k, label=lbl, disclosure=d) for k, lbl, d in STANDARD_FIELDS],
        )


class ProfileUpdate(Schema):
    preferred_languages: list[str] | None = None
    communication_preferences: str | None = None
    background: str | None = None
    fields: list[ProfileField] | None = None
