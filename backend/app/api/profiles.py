from fastapi import APIRouter

from app.core.deps import get_container
from app.models.principal import PrincipalProfile, ProfileUpdate

router = APIRouter(prefix="/api/profile", tags=["profile"])


async def load_profile() -> PrincipalProfile:
    c = get_container()
    pid = c.settings.default_principal_id
    profile = await c.repo.get_profile(pid)
    if profile is None:
        profile = await c.repo.save_profile(PrincipalProfile.blank(pid))
    return profile


@router.get("", response_model=PrincipalProfile)
async def get_profile() -> PrincipalProfile:
    return await load_profile()


@router.put("", response_model=PrincipalProfile)
async def update_profile(body: ProfileUpdate) -> PrincipalProfile:
    profile = await load_profile()
    data = body.model_dump(exclude_unset=True)
    updated = profile.model_copy(update={k: v for k, v in data.items() if k != "fields"})
    if body.fields is not None:
        seen: set[str] = set()
        fields = []
        for f in body.fields:
            f.key = f.key.strip().lower().replace(" ", "_") or f.label.lower().replace(" ", "_")
            if f.key in seen:
                continue
            seen.add(f.key)
            f.value = (f.value or "").strip() or None
            fields.append(f)
        updated.fields = fields
    return await get_container().repo.save_profile(updated)
