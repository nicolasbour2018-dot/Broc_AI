from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

from .config import settings


register_heif_opener()


ALLOWED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}


@dataclass(frozen=True)
class SavedImage:
    image_key: str
    original_bytes: int
    sent_bytes: int
    original_width: int
    original_height: int
    sent_width: int
    sent_height: int
    original_content_type: str
    sent_content_type: str
    resized: bool

    def telemetry(self, flow: str) -> dict[str, str | int | float | bool | None]:
        ratio = self.sent_bytes / self.original_bytes if self.original_bytes else 1.0
        return {
            "flow": flow,
            "original_bytes": self.original_bytes,
            "sent_bytes": self.sent_bytes,
            "compression_ratio": round(ratio, 4),
            "bytes_saved_percent": round((1 - ratio) * 100, 1),
            "original_width": self.original_width,
            "original_height": self.original_height,
            "sent_width": self.sent_width,
            "sent_height": self.sent_height,
            "original_content_type": self.original_content_type,
            "sent_content_type": self.sent_content_type,
            "resized": self.resized,
            "visual_tokens": None,
        }


async def save_image(upload: UploadFile) -> SavedImage:
    original_content_type = upload.content_type or ""
    if original_content_type not in ALLOWED_TYPES:
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

    try:
        with Image.open(BytesIO(content)) as source:
            source.load()
            image = ImageOps.exif_transpose(source)
            original_width, original_height = image.size

            max_edge = max(640, min(2048, settings.image_max_edge_px))
            if max(image.size) > max_edge:
                image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            sent_width, sent_height = image.size
            resized = (sent_width, sent_height) != (original_width, original_height)

            has_alpha = "A" in image.getbands() or "transparency" in image.info
            output = BytesIO()
            if has_alpha:
                if image.mode != "RGBA":
                    image = image.convert("RGBA")
                image.save(
                    output,
                    format="WEBP",
                    quality=max(60, min(95, settings.image_webp_quality)),
                    method=4,
                )
                suffix = ".webp"
                sent_content_type = "image/webp"
            else:
                if image.mode != "RGB":
                    image = image.convert("RGB")
                image.save(
                    output,
                    format="JPEG",
                    quality=max(60, min(95, settings.image_jpeg_quality)),
                    optimize=True,
                    progressive=True,
                )
                suffix = ".jpg"
                sent_content_type = "image/jpeg"
            optimized = output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="L'image est illisible ou corrompue.",
        ) from exc

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    image_key = f"{uuid4().hex}{suffix}"
    destination = settings.upload_dir / image_key
    destination.write_bytes(optimized)
    return SavedImage(
        image_key=image_key,
        original_bytes=len(content),
        sent_bytes=len(optimized),
        original_width=original_width,
        original_height=original_height,
        sent_width=sent_width,
        sent_height=sent_height,
        original_content_type=original_content_type,
        sent_content_type=sent_content_type,
        resized=resized,
    )


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
