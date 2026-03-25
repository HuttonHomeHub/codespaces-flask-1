import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as photo_app


class PhotoAppTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)

        self.upload_dir = Path(self.temp_dir.name) / "uploads"
        self.database_path = Path(self.temp_dir.name) / "test.db"
        self.original_config = {
            "TESTING": photo_app.app.config.get("TESTING", False),
            "DATABASE_PATH": photo_app.app.config["DATABASE_PATH"],
            "UPLOAD_DIR": photo_app.app.config["UPLOAD_DIR"],
        }

        photo_app.app.config.update(
            TESTING=True,
            DATABASE_PATH=self.database_path,
            UPLOAD_DIR=self.upload_dir,
        )
        photo_app.init_storage()
        self.client = photo_app.app.test_client()

    def tearDown(self):
        photo_app.app.config.update(self.original_config)

    def insert_photo(self, stored_filename="tracked.jpg", original_filename="tracked.jpg"):
        metadata = '{"file_type": "JPEG", "file_size": "1 B"}'
        with photo_app.get_db_connection() as connection:
            connection.execute(
                """
                INSERT INTO photos (
                    original_filename,
                    stored_filename,
                    checksum,
                    file_size_bytes,
                    file_type,
                    file_type_extension,
                    mime_type,
                    metadata_json,
                    latitude,
                    longitude,
                    uploaded_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    original_filename,
                    stored_filename,
                    "checksum",
                    1,
                    "JPEG",
                    "jpg",
                    "image/jpeg",
                    metadata,
                    None,
                    None,
                    "2026-03-25T00:00:00+00:00",
                ),
            )

    def test_list_photos_returns_empty_collection(self):
        response = self.client.get("/api/photos")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"photos": []})

    def test_upload_requires_files(self):
        response = self.client.post("/api/uploads", data={}, content_type="multipart/form-data")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "No files were uploaded."})

    def test_clear_uploaded_photos_only_removes_tracked_files(self):
        self.insert_photo()
        tracked_file = self.upload_dir / "tracked.jpg"
        orphan_file = self.upload_dir / "notes.txt"
        tracked_file.write_bytes(b"tracked")
        orphan_file.write_text("keep me", encoding="utf-8")

        result = photo_app.clear_uploaded_photos()

        self.assertEqual(result, {"deleted_records": 1, "deleted_files": 1})
        self.assertFalse(tracked_file.exists())
        self.assertTrue(orphan_file.exists())
        with photo_app.get_db_connection() as connection:
            remaining = connection.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
        self.assertEqual(remaining, 0)

    def test_delete_uploaded_photo_preserves_record_when_file_delete_fails(self):
        self.insert_photo()
        tracked_file = self.upload_dir / "tracked.jpg"
        tracked_file.write_bytes(b"tracked")

        with patch.object(Path, "unlink", side_effect=OSError("disk busy")):
            with self.assertRaises(OSError):
                photo_app.delete_uploaded_photo(1)

        with photo_app.get_db_connection() as connection:
            remaining = connection.execute(
                "SELECT id, stored_filename FROM photos WHERE id = 1"
            ).fetchone()

        self.assertIsNotNone(remaining)
        self.assertEqual(remaining["stored_filename"], "tracked.jpg")


if __name__ == "__main__":
    unittest.main()