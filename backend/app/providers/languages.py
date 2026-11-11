"""Language name <-> BCP-47 code mapping shared by speech providers."""

LANGUAGES: dict[str, str] = {
    "English": "en-IN", "Hindi": "hi-IN", "Kannada": "kn-IN", "Tamil": "ta-IN",
    "Telugu": "te-IN", "Malayalam": "ml-IN", "Marathi": "mr-IN", "Bengali": "bn-IN",
    "Gujarati": "gu-IN", "Punjabi": "pa-IN", "Odia": "od-IN",
}
CODE_TO_NAME = {v: k for k, v in LANGUAGES.items()} | {"or-IN": "Odia"}

TTS_SUPPORTED = set(LANGUAGES.values())
STT_SUPPORTED = set(LANGUAGES.values())


def to_code(language: str | None, default: str = "en-IN") -> str:
    if not language:
        return default
    if language in CODE_TO_NAME:
        return language
    key = language.strip().split()[0].capitalize()
    return LANGUAGES.get(key, default)


def to_name(code: str | None) -> str | None:
    if not code:
        return None
    return CODE_TO_NAME.get(code, code)


# Unicode blocks of the scripts Sarvam supports, for when no language tag is known.
_SCRIPTS: list[tuple[int, int, str]] = [
    (0x0900, 0x097F, "hi-IN"),  # Devanagari (Hindi; Marathi shares it)
    (0x0980, 0x09FF, "bn-IN"),  # Bengali
    (0x0A00, 0x0A7F, "pa-IN"),  # Gurmukhi
    (0x0A80, 0x0AFF, "gu-IN"),  # Gujarati
    (0x0B00, 0x0B7F, "od-IN"),  # Odia
    (0x0B80, 0x0BFF, "ta-IN"),  # Tamil
    (0x0C00, 0x0C7F, "te-IN"),  # Telugu
    (0x0C80, 0x0CFF, "kn-IN"),  # Kannada
    (0x0D00, 0x0D7F, "ml-IN"),  # Malayalam
]


def guess_code(text: str) -> str | None:
    """The language code implied by the dominant Indic script in `text`, if any."""
    counts: dict[str, int] = {}
    for ch in text:
        o = ord(ch)
        for lo, hi, code in _SCRIPTS:
            if lo <= o <= hi:
                counts[code] = counts.get(code, 0) + 1
                break
    return max(counts, key=counts.__getitem__) if counts else None
