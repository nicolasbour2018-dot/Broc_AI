import os
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import Listing


PHOTO_KEY = "0123456789abcdef0123456789abcdef.jpg"
ADMIN_TOKEN = "admin-secret"


class StandPinTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.uploads = tempfile.TemporaryDirectory()
        self.previous = (settings.upload_dir, settings.admin_token, settings.stand_pin_required)
        settings.upload_dir = Path(self.uploads.name)
        settings.admin_token = ADMIN_TOKEN
        settings.stand_pin_required = True
        (settings.upload_dir / PHOTO_KEY).write_bytes(b"photo")

        def test_db():
            with Session(self.engine) as db:
                yield db

        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        app.dependency_overrides.clear()
        settings.upload_dir, settings.admin_token, settings.stand_pin_required = self.previous
        self.uploads.cleanup()
        self.engine.dispose()

    def open_stand(self, stand: str, pin: str):
        return self.client.post("/api/seller/stands/session", json={"stand_number": stand, "pin": pin})

    def publish(self, stand: str, token: str | None):
        headers = {"X-Stand-Token": token} if token else {}
        return self.client.post("/api/listings", headers=headers, json={
            "image_key": PHOTO_KEY, "title": "Lampe", "description": "Lampe en laiton", "price_eur": 5, "stand_number": stand,
        })

    def add_listing(self, stand: str) -> str:
        with Session(self.engine) as db:
            listing = Listing(image_key=PHOTO_KEY, title="Lampe", description="Lampe", category="Autre", price_eur=Decimal("5"), stand_number=stand)
            db.add(listing)
            db.commit()
            return listing.id

    def test_first_device_opens_the_stand_and_can_publish(self) -> None:
        opened = self.open_stand("12", "4821")

        self.assertEqual(opened.status_code, 200)
        self.assertTrue(opened.json()["created"])
        self.assertEqual(self.publish("12", opened.json()["token"]).status_code, 201)

    def test_writes_without_a_token_are_rejected(self) -> None:
        self.open_stand("12", "4821")
        listing_id = self.add_listing("12")

        self.assertEqual(self.publish("12", None).status_code, 403)
        sold = self.client.patch(f"/api/seller/listings/{listing_id}/status", json={"stand_number": "12", "sold": True})
        self.assertEqual(sold.status_code, 403)

    def test_a_token_only_works_for_its_own_stand(self) -> None:
        mine = self.open_stand("12", "4821").json()["token"]
        self.open_stand("13", "1111")
        other_listing = self.add_listing("13")

        edited = self.client.patch(
            f"/api/seller/listings/{other_listing}",
            headers={"X-Stand-Token": mine},
            json={"stand_number": "13", "title": "Volé", "description": "x", "price_eur": 1},
        )

        self.assertEqual(edited.status_code, 403)
        self.assertEqual(self.publish("13", mine).status_code, 403)

    def test_a_second_device_joins_with_the_same_code(self) -> None:
        first = self.open_stand("12", "4821").json()["token"]
        second = self.open_stand("12", "4821")

        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.json()["created"])
        self.assertNotEqual(second.json()["token"], first)
        self.assertEqual(self.publish("12", second.json()["token"]).status_code, 201)
        self.assertEqual(self.publish("12", first).status_code, 201)

    def test_a_wrong_code_does_not_join(self) -> None:
        self.open_stand("12", "4821")

        self.assertEqual(self.open_stand("12", "0000").status_code, 403)

    def test_the_stand_locks_after_five_wrong_codes(self) -> None:
        self.open_stand("12", "4821")
        for _ in range(5):
            self.assertEqual(self.open_stand("12", "0000").status_code, 403)

        locked = self.open_stand("12", "4821")

        self.assertEqual(locked.status_code, 429)
        self.assertIn("Réessayez dans 15 min", locked.json()["detail"])

    def test_a_right_code_resets_the_failure_count(self) -> None:
        self.open_stand("12", "4821")
        for _ in range(4):
            self.open_stand("12", "0000")
        self.assertEqual(self.open_stand("12", "4821").status_code, 200)

        for _ in range(4):
            self.open_stand("12", "0000")

        self.assertEqual(self.open_stand("12", "4821").status_code, 200)

    def test_codes_must_be_four_digits(self) -> None:
        for pin in ["123", "12345", "abcd", ""]:
            self.assertEqual(self.open_stand("12", pin).status_code, 422, pin)

    def test_admin_reset_frees_the_stand_and_revokes_devices(self) -> None:
        old = self.open_stand("12", "4821").json()["token"]

        refused = self.client.delete("/api/admin/stands/12")
        reset = self.client.delete("/api/admin/stands/12", headers={"X-Admin-Token": ADMIN_TOKEN})
        reopened = self.open_stand("12", "9999")

        self.assertEqual(refused.status_code, 401)
        self.assertEqual(reset.status_code, 204)
        self.assertTrue(reopened.json()["created"])
        self.assertEqual(self.publish("12", old).status_code, 403)
        self.assertEqual(self.publish("12", reopened.json()["token"]).status_code, 201)

    def test_kill_switch_restores_open_writes(self) -> None:
        settings.stand_pin_required = False

        self.assertEqual(self.publish("12", None).status_code, 201)


if __name__ == "__main__":
    unittest.main()
