import hashlib
import json
import mimetypes
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
DATABASE_PATH = BASE_DIR / "app.db"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
MAX_FILES_PER_UPLOAD = 100
MAX_UPLOAD_TOTAL_BYTES = 512 * 1024 * 1024


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_TOTAL_BYTES


def load_image_dependencies():
    try:
        from PIL import ExifTags, Image, UnidentifiedImageError
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "Image processing dependencies are unavailable. Run the app from the project virtual environment or install requirements.txt."
        ) from error

    try:
        import piexif
    except ModuleNotFoundError:
        piexif = None

    return Image, UnidentifiedImageError, ExifTags, piexif


def get_db_connection():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_storage():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with get_db_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL UNIQUE,
                checksum TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                file_type TEXT,
                file_type_extension TEXT,
                mime_type TEXT,
                metadata_json TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                uploaded_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_photos_uploaded_at ON photos(uploaded_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_photos_checksum ON photos(checksum)"
        )


def snake_case(value):
    sanitized = []
    previous_underscore = False
    for character in value.strip():
        if character.isalnum():
            sanitized.append(character.lower())
            previous_underscore = False
        elif not previous_underscore:
            sanitized.append("_")
            previous_underscore = True
    return "".join(sanitized).strip("_")


def format_bytes(size_bytes):
    units = ["B", "KB", "MB", "GB"]
    size = float(size_bytes)
    unit_index = 0
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    if unit_index == 0:
        return f"{int(size)} {units[unit_index]}"
    return f"{size:.1f} {units[unit_index]}"


def convert_ratio(value):
    if (
        isinstance(value, tuple)
        and len(value) == 2
        and all(isinstance(item, (int, float)) for item in value)
    ):
        numerator, denominator = value
        if denominator in (0, None):
            return str(value)
        if numerator % denominator == 0:
            return numerator // denominator
        return numerator / denominator
    if hasattr(value, "numerator") and hasattr(value, "denominator"):
        if value.denominator in (0, None):
            return str(value)
        if value.numerator % value.denominator == 0:
            return value.numerator // value.denominator
        return value.numerator / value.denominator
    return value


def serialize_metadata_value(value):
    if isinstance(value, bytes):
        return f"(Binary data {len(value)} bytes)"
    if isinstance(value, tuple):
        serialized_items = [serialize_metadata_value(item) for item in value]
        if all(isinstance(item, (int, float, str, bool)) for item in serialized_items):
            return ", ".join(str(item) for item in serialized_items)
        return serialized_items
    if isinstance(value, list):
        return [serialize_metadata_value(item) for item in value]
    if hasattr(value, "values") and hasattr(value, "printable"):
        return str(value)
    converted = convert_ratio(value)
    if isinstance(converted, float):
        return round(converted, 8)
    return converted


def gps_to_decimal(values, reference):
    if not values or len(values) != 3:
        return None
    degrees = float(convert_ratio(values[0]))
    minutes = float(convert_ratio(values[1]))
    seconds = float(convert_ratio(values[2]))
    decimal = degrees + minutes / 60 + seconds / 3600
    if reference in {"S", "W"}:
        decimal *= -1
    return round(decimal, 8)


def extract_exif_metadata_with_pillow(image_path):
    Image, _, ExifTags, _ = load_image_dependencies()
    metadata = {}
    latitude = None
    longitude = None

    with Image.open(image_path) as image:
        exif = image.getexif()
        if not exif:
            return metadata, latitude, longitude

        for tag_id, raw_value in exif.items():
            tag_name = snake_case(ExifTags.TAGS.get(tag_id, str(tag_id)))
            if tag_name == "gps_info" and isinstance(raw_value, dict):
                gps_info = {
                    snake_case(ExifTags.GPSTAGS.get(gps_tag_id, str(gps_tag_id))): gps_value
                    for gps_tag_id, gps_value in raw_value.items()
                }
                for gps_key, gps_value in gps_info.items():
                    metadata[gps_key] = serialize_metadata_value(gps_value)

                latitude = gps_to_decimal(
                    gps_info.get("gps_latitude"),
                    gps_info.get("gps_latitude_ref"),
                )
                longitude = gps_to_decimal(
                    gps_info.get("gps_longitude"),
                    gps_info.get("gps_longitude_ref"),
                )
            else:
                metadata[tag_name] = serialize_metadata_value(raw_value)

    if latitude is not None:
        metadata["gps_latitude_decimal"] = latitude
    if longitude is not None:
        metadata["gps_longitude_decimal"] = longitude

    return metadata, latitude, longitude


def extract_exif_metadata(image_path):
    metadata = {}
    latitude = None
    longitude = None

    _, _, _, piexif = load_image_dependencies()

    if piexif is None:
        return extract_exif_metadata_with_pillow(image_path)

    try:
        exif_data = piexif.load(str(image_path))
    except Exception:
        return metadata, latitude, longitude

    for ifd_name in ("0th", "Exif", "GPS", "Interop", "1st"):
        tags = exif_data.get(ifd_name, {})
        definitions = piexif.TAGS.get(ifd_name, {})
        for tag_id, raw_value in tags.items():
            tag_definition = definitions.get(tag_id, {})
            tag_name = snake_case(tag_definition.get("name", str(tag_id)))
            if not tag_name:
                continue
            metadata[tag_name] = serialize_metadata_value(raw_value)

    gps_ifd = exif_data.get("GPS", {})
    gps_latitude = gps_ifd.get(piexif.GPSIFD.GPSLatitude)
    gps_latitude_ref = gps_ifd.get(piexif.GPSIFD.GPSLatitudeRef)
    gps_longitude = gps_ifd.get(piexif.GPSIFD.GPSLongitude)
    gps_longitude_ref = gps_ifd.get(piexif.GPSIFD.GPSLongitudeRef)

    if isinstance(gps_latitude_ref, bytes):
        gps_latitude_ref = gps_latitude_ref.decode("utf-8", errors="ignore")
    if isinstance(gps_longitude_ref, bytes):
        gps_longitude_ref = gps_longitude_ref.decode("utf-8", errors="ignore")

    latitude = gps_to_decimal(gps_latitude, gps_latitude_ref)
    longitude = gps_to_decimal(gps_longitude, gps_longitude_ref)

    if latitude is not None:
        metadata["gps_latitude_decimal"] = latitude
    if longitude is not None:
        metadata["gps_longitude_decimal"] = longitude

    return metadata, latitude, longitude


def extract_image_metadata(image_path, original_filename):
    Image, UnidentifiedImageError, _, _ = load_image_dependencies()
    file_bytes = image_path.read_bytes()
    checksum = hashlib.md5(file_bytes).hexdigest()
    file_size_bytes = image_path.stat().st_size
    file_extension = image_path.suffix.lower().lstrip(".")
    mime_type, _ = mimetypes.guess_type(image_path.name)
    mime_type = mime_type or "application/octet-stream"

    metadata = {
        "checksum": checksum,
        "file_name": original_filename,
        "file_size": format_bytes(file_size_bytes),
        "file_size_bytes": file_size_bytes,
        "file_type_extension": file_extension,
        "mime_type": mime_type,
        "category": "image",
    }

    latitude = None
    longitude = None

    try:
        with Image.open(image_path) as image:
            metadata["file_type"] = image.format
            metadata["image_width"] = image.width
            metadata["image_height"] = image.height
            metadata["image_size"] = f"{image.width}x{image.height}"
            metadata["megapixels"] = round((image.width * image.height) / 1_000_000, 1)

            for key, value in image.info.items():
                normalized_key = snake_case(key)
                if normalized_key == "exif":
                    continue
                metadata[normalized_key] = serialize_metadata_value(value)
    except UnidentifiedImageError as error:
        raise ValueError("Unsupported or corrupted image file") from error

    exif_metadata, latitude, longitude = extract_exif_metadata(image_path)
    metadata.update(exif_metadata)

    return metadata, checksum, file_size_bytes, mime_type, latitude, longitude


def serialize_photo(row):
    metadata = json.loads(row["metadata_json"])
    return {
        "id": row["id"],
        "original_filename": row["original_filename"],
        "stored_filename": row["stored_filename"],
        "checksum": row["checksum"],
        "file_size_bytes": row["file_size_bytes"],
        "mime_type": row["mime_type"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "uploaded_at": row["uploaded_at"],
        "image_url": f"/uploads/{row['stored_filename']}",
        "metadata": metadata,
    }


def allowed_file(filename):
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def api_error_response(message, status_code):
    return jsonify({"error": message}), status_code


def clear_uploaded_photos():
    with get_db_connection() as connection:
        deleted_count = connection.execute("SELECT COUNT(*) FROM photos").fetchone()[0]

    failed_deletions = []
    deleted_file_count = 0
    for file_path in UPLOAD_DIR.iterdir():
        if not file_path.is_file():
            continue
        try:
            file_path.unlink(missing_ok=True)
            deleted_file_count += 1
        except OSError:
            failed_deletions.append(file_path.name)

    if failed_deletions:
        raise OSError(
            "Failed to delete one or more uploaded files: " + ", ".join(failed_deletions)
        )

    with get_db_connection() as connection:
        connection.execute("DELETE FROM photos")

    return {"deleted_records": deleted_count, "deleted_files": deleted_file_count}


def delete_uploaded_photo(photo_id):
    with get_db_connection() as connection:
        row = connection.execute(
            """
            SELECT id, original_filename, stored_filename
            FROM photos
            WHERE id = ?
            """,
            (photo_id,),
        ).fetchone()

        if row is None:
            return None

        connection.execute("DELETE FROM photos WHERE id = ?", (photo_id,))

    file_deleted = False
    file_path = UPLOAD_DIR / row["stored_filename"]
    if file_path.exists():
        file_path.unlink(missing_ok=True)
        file_deleted = True

    return {
        "deleted_id": row["id"],
        "deleted_filename": row["original_filename"],
        "deleted_file": file_deleted,
    }


@app.route("/")
def index():
    return render_template(
        "index.html",
        title="Control Panel Map",
        max_files_per_upload=MAX_FILES_PER_UPLOAD,
        max_upload_total_bytes=MAX_UPLOAD_TOTAL_BYTES,
        max_upload_total_label=format_bytes(MAX_UPLOAD_TOTAL_BYTES),
    )


@app.errorhandler(413)
def payload_too_large(_error):
    return api_error_response(
        f"Upload is too large. Maximum total upload size is {format_bytes(MAX_UPLOAD_TOTAL_BYTES)} per request.",
        413,
    )


@app.errorhandler(Exception)
def handle_application_error(error):
    if not request.path.startswith("/api/"):
        raise error

    if isinstance(error, HTTPException):
        return api_error_response(error.description, error.code or 500)

    app.logger.exception("Unhandled API error", exc_info=error)
    return api_error_response("Unexpected server error while processing the request.", 500)


@app.get("/api/photos")
def list_photos():
    try:
        with get_db_connection() as connection:
            rows = connection.execute(
                """
                SELECT id, original_filename, stored_filename, checksum, file_size_bytes,
                       mime_type, latitude, longitude, uploaded_at, metadata_json
                FROM photos
                ORDER BY uploaded_at DESC, id DESC
                """
            ).fetchall()
        return jsonify({"photos": [serialize_photo(row) for row in rows]})
    except Exception as error:
        app.logger.exception("Failed to list photos", exc_info=error)
        return api_error_response("Unable to load uploaded photos.", 500)


@app.delete("/api/photos")
def delete_photos():
    try:
        result = clear_uploaded_photos()
        return jsonify(result)
    except Exception as error:
        app.logger.exception("Failed to clear uploaded photos", exc_info=error)
        return api_error_response("Unable to clear uploaded photos.", 500)


@app.delete("/api/photos/<int:photo_id>")
def delete_photo(photo_id):
    try:
        result = delete_uploaded_photo(photo_id)
        if result is None:
            return api_error_response("Photo not found.", 404)
        return jsonify(result)
    except Exception as error:
        app.logger.exception("Failed to delete uploaded photo", exc_info=error)
        return api_error_response("Unable to delete uploaded photo.", 500)


@app.post("/api/uploads")
def upload_photos():
    try:
        files = request.files.getlist("photos")
        if not files:
            return jsonify({"error": "No files were uploaded."}), 400
        if len(files) > MAX_FILES_PER_UPLOAD:
            return api_error_response(
                f"Too many files selected. Maximum is {MAX_FILES_PER_UPLOAD} photos per upload.",
                400,
            )

        uploaded = []
        errors = []

        for file_storage in files:
            original_filename = file_storage.filename or ""
            if not original_filename:
                errors.append({"file": original_filename, "error": "Missing file name."})
                continue
            if not allowed_file(original_filename):
                errors.append({"file": original_filename, "error": "Unsupported image type."})
                continue

            safe_name = secure_filename(original_filename)
            file_extension = Path(safe_name).suffix.lower()
            stored_filename = f"{uuid.uuid4().hex}{file_extension}"
            saved_path = UPLOAD_DIR / stored_filename
            file_storage.save(saved_path)

            try:
                metadata, checksum, file_size_bytes, mime_type, latitude, longitude = extract_image_metadata(
                    saved_path,
                    original_filename,
                )
            except RuntimeError as error:
                saved_path.unlink(missing_ok=True)
                errors.append({"file": original_filename, "error": str(error)})
                continue
            except ValueError as error:
                saved_path.unlink(missing_ok=True)
                errors.append({"file": original_filename, "error": str(error)})
                continue
            except Exception:
                saved_path.unlink(missing_ok=True)
                errors.append({"file": original_filename, "error": "Unable to extract metadata from this image."})
                continue

            uploaded_at = datetime.now(timezone.utc).isoformat()

            try:
                with get_db_connection() as connection:
                    existing_photo = connection.execute(
                        """
                        SELECT original_filename, uploaded_at
                        FROM photos
                        WHERE checksum = ?
                        LIMIT 1
                        """,
                        (checksum,),
                    ).fetchone()

                    if existing_photo is not None:
                        saved_path.unlink(missing_ok=True)
                        errors.append(
                            {
                                "file": original_filename,
                                "error": (
                                    "Duplicate photo already imported "
                                    f"as {existing_photo['original_filename']} on {existing_photo['uploaded_at']}."
                                ),
                            }
                        )
                        continue

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
                            checksum,
                            file_size_bytes,
                            metadata.get("file_type"),
                            metadata.get("file_type_extension"),
                            mime_type,
                            json.dumps(metadata, ensure_ascii=True, sort_keys=True),
                            latitude,
                            longitude,
                            uploaded_at,
                        ),
                    )
                    row = connection.execute(
                        """
                        SELECT id, original_filename, stored_filename, checksum, file_size_bytes,
                               mime_type, latitude, longitude, uploaded_at, metadata_json
                        FROM photos
                        WHERE stored_filename = ?
                        """,
                        (stored_filename,),
                    ).fetchone()
            except Exception:
                saved_path.unlink(missing_ok=True)
                errors.append({"file": original_filename, "error": "Server error while storing image metadata."})
                continue

            uploaded.append(serialize_photo(row))

        status_code = 200 if uploaded else 400
        return jsonify({"uploaded": uploaded, "errors": errors}), status_code
    except Exception as error:
        app.logger.exception("Failed to upload photos", exc_info=error)
        return api_error_response("Unexpected server error while uploading photos.", 500)


@app.get("/uploads/<path:filename>")
def serve_uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


init_storage()
