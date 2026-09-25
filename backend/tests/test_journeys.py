import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.journeys import device_properties, journey_metrics, qualified_listing_view_counts
from app.main import app
from app.models import Event, Listing


class JourneyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.previous_token = settings.admin_token
        settings.admin_token = "journey-test-token"

        def test_db():
            with Session(self.engine) as db:
                yield db

        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        app.dependency_overrides.clear()
        settings.admin_token = self.previous_token
        self.db.close()
        self.engine.dispose()

    def add_event(self, session_id: str, name: str, properties: dict, created_at: datetime) -> None:
        self.db.add(Event(session_id=session_id, event_name=name, properties=properties, created_at=created_at))
        self.db.commit()

    def test_listing_views_use_server_stand_and_exclude_own_and_legacy(self) -> None:
        listing = Listing(image_key="test.jpg", title="Lampe", description="Lampe test", category="Autre", price_eur=Decimal("5"), stand_number="A")
        self.db.add(listing)
        self.db.commit()
        self.db.refresh(listing)

        scenarios = [
            ("visitor", {"X-Device-Context": "visitor", "X-Entry-Source": "home_listing"}, False),
            ("own", {"X-Device-Context": "seller", "X-Seller-Stand": "A", "X-Entry-Source": "marketplace"}, True),
            ("other", {"X-Device-Context": "seller", "X-Seller-Stand": "B", "X-Entry-Source": "seller_dashboard"}, False),
            ("legacy", {}, None),
        ]
        for session_id, headers, own in scenarios:
            response = self.client.get(f"/api/listings/{listing.id}", headers={"X-Session-ID": session_id, **headers})
            self.assertEqual(response.status_code, 200)
            event = self.db.query(Event).filter_by(session_id=session_id, event_name="listing_viewed").one()
            self.assertEqual(event.properties["listing_stand"], "A")
            self.assertIs(event.properties["is_own_listing"], own)
            if session_id == "other":
                self.assertEqual(event.properties["entry_source"], "seller_dashboard")

        search = self.client.get("/api/listings?q=Lampe", headers={"X-Session-ID": "search", "X-Device-Context": "visitor", "X-Entry-Source": "marketplace"})
        self.assertEqual(search.status_code, 200)
        search_event = self.db.query(Event).filter_by(session_id="search", event_name="search_performed").one()
        self.assertEqual(search_event.properties["device_context"], "visitor")
        self.assertEqual(search_event.properties["entry_source"], "marketplace")

        self.assertEqual(qualified_listing_view_counts(self.db, [listing.id])[listing.id], 2)
        seller_response = self.client.get("/api/seller/listings?stand_number=A", headers={"X-Session-ID": "seller"})
        self.assertEqual(seller_response.status_code, 200)
        self.assertEqual(seller_response.json()[0]["view_count"], 2)

    def test_windows_segments_batches_and_auth(self) -> None:
        now = datetime(2026, 9, 25, 10, 0, tzinfo=timezone.utc)
        recent = now - timedelta(minutes=5)
        earlier_today = now - timedelta(hours=2)
        previous_day = now - timedelta(hours=13)
        visitor = device_properties("visitor", None, "welcome")
        seller = device_properties("seller", "A", "seller_dashboard")
        self.add_event("v", "marketplace_opened", visitor, recent)
        self.add_event("v", "marketplace_category_selected", {**visitor, "category": "Autre"}, recent)
        self.add_event("v", "search_performed", {**visitor, "query_length": 0}, recent)
        self.add_event("v", "listing_viewed", {**visitor, "listing_id": "one", "is_own_listing": False}, recent)
        self.add_event("s", "marketplace_opened", seller, earlier_today)
        self.add_event("s", "search_performed", {**seller, "query_length": 4}, recent)
        self.add_event("s", "listing_viewed", {**seller, "listing_id": "one", "is_own_listing": True}, recent)
        self.add_event("legacy", "listing_viewed", {"listing_id": "one"}, recent)
        self.add_event("s", "batch_started", {**seller, "batch_id": "batch-1", "batch_size": 2}, recent)
        self.add_event("s", "batch_completed", {**seller, "batch_id": "batch-1", "batch_size": 2, "failed_count": 1}, recent)
        self.add_event("s", "batch_published", {**seller, "batch_id": "batch-1", "batch_size": 2, "published_count": 1, "failed_count": 1}, recent)
        self.add_event("s", "batch_published", {**seller, "batch_id": "batch-1", "batch_size": 2, "published_count": 2, "failed_count": 0}, recent + timedelta(seconds=1))
        self.add_event("old", "marketplace_opened", visitor, previous_day)

        metrics = journey_metrics(self.db, now)
        self.assertEqual(metrics["recent"]["segments"]["visitor"]["sessions"]["marketplace_opened"], 1)
        self.assertEqual(metrics["recent"]["segments"]["visitor"]["sessions"]["search_performed"], 0)
        self.assertEqual(metrics["today"]["segments"]["seller"]["sessions"]["marketplace_opened"], 1)
        self.assertEqual(metrics["recent"]["segments"]["seller"]["views"]["own"], 1)
        self.assertEqual(metrics["recent"]["segments"]["unknown"]["views"]["unknown"], 1)
        self.assertEqual(metrics["recent"]["batches"]["published"], 1)
        self.assertEqual(metrics["recent"]["batches"]["published_items"], 2)
        self.assertEqual(metrics["recent"]["batches"]["failed_items"], 0)
        self.assertEqual(metrics["today"]["segments"]["visitor"]["sessions"]["marketplace_opened"], 1)

        self.assertEqual(self.client.get("/api/admin/journeys").status_code, 401)
        tracked = self.client.post("/api/events", headers={"X-Session-ID": "tracked"}, json={"event_name": "marketplace_opened", "properties": visitor})
        self.assertEqual(tracked.status_code, 204)
        authorized = self.client.get("/api/admin/journeys", headers={"X-Admin-Token": "journey-test-token"})
        self.assertEqual(authorized.status_code, 200)
        exported = self.client.get("/api/admin/export?dataset=events&format=json", headers={"X-Admin-Token": "journey-test-token"})
        self.assertEqual(exported.status_code, 200)
        self.assertTrue(any(row["properties"].get("batch_id") == "batch-1" for row in json.loads(exported.text)))


if __name__ == "__main__":
    unittest.main()
