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
