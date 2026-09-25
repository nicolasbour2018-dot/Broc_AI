import os
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import Event, Listing


DRAFT_KEY = "0123456789abcdef0123456789abcdef.jpg"


class SellerDraftDeletionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.uploads = tempfile.TemporaryDirectory()
        self.previous_upload_dir = settings.upload_dir
        settings.upload_dir = Path(self.uploads.name)

        def test_db():
            with Session(self.engine) as db:
                yield db

        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        app.dependency_overrides.clear()
        settings.upload_dir = self.previous_upload_dir
        self.uploads.cleanup()
        self.db.close()
        self.engine.dispose()

    def write_upload(self, key: str) -> Path:
        path = settings.upload_dir / key
        path.write_bytes(b"photo")
        return path

    def test_deletes_an_unpublished_draft_photo(self) -> None:
        path = self.write_upload(DRAFT_KEY)

        response = self.client.delete(f"/api/seller/drafts/{DRAFT_KEY}", headers={"X-Session-ID": "seller-1"})

        self.assertEqual(response.status_code, 204)
        self.assertFalse(path.exists())
        events = self.db.scalars(select(Event).where(Event.event_name == "seller_draft_deleted")).all()
        self.assertEqual(len(events), 1)

    def test_keeps_a_photo_used_by_a_listing(self) -> None:
        path = self.write_upload(DRAFT_KEY)
        self.db.add(Listing(image_key=DRAFT_KEY, title="Lampe", description="Lampe test", category="Autre", price_eur=Decimal("5"), stand_number="A"))
        self.db.commit()

        response = self.client.delete(f"/api/seller/drafts/{DRAFT_KEY}")

        self.assertEqual(response.status_code, 409)
        self.assertTrue(path.exists())

    def test_deleting_a_missing_photo_succeeds(self) -> None:
        response = self.client.delete(f"/api/seller/drafts/{DRAFT_KEY}")

        self.assertEqual(response.status_code, 204)

    def test_rejects_keys_that_are_not_draft_photos(self) -> None:
        outside = self.write_upload("notes.txt")
        for key in ["..", "notes.txt", "0123456789ABCDEF0123456789ABCDEF.jpg", "%2E%2E"]:
            with self.subTest(key=key):
                response = self.client.delete(f"/api/seller/drafts/{key}")
                self.assertIn(response.status_code, (400, 404, 405))
        self.assertTrue(outside.exists())


if __name__ == "__main__":
    unittest.main()
