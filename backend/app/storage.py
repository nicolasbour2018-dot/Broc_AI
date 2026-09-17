from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

from .config import settings


ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
}


async def save_image(upload: UploadFile) -> str:
    suffix = ALLOWED_TYPES.get(upload.content_type or "")
    if suffix is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format d'image non pris en charge. Utilisez JPEG, PNG, WebP ou HEIC.",
        )

    max_bytes = settings.max_upload_mb * 1024 * 1024
    content = await upload.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image trop volumineuse (maximum {settings.max_upload_mb} Mo).",
        )
    if not content:
        raise HTTPException(status_code=400, detail="L'image est vide.")

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    image_key = f"{uuid4().hex}{suffix}"
    destination = settings.upload_dir / image_key
    destination.write_bytes(content)
    return image_key


def image_exists(image_key: str) -> bool:
    if Path(image_key).name != image_key:
        return False
    return (settings.upload_dir / image_key).is_file()


def delete_image(image_key: str) -> None:
    if Path(image_key).name != image_key:
        return
    path = settings.upload_dir / image_key
    try:
        path.unlink()
    except FileNotFoundError:
        pass
