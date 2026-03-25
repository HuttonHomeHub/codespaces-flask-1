import hashlib
import json
import math
import mimetypes
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
DATABASE_PATH = BASE_DIR / "app.db"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
MAX_FILES_PER_UPLOAD = 100
MAX_UPLOAD_TOTAL_BYTES = 512 * 1024 * 1024
SUMMARY_METADATA_KEYS = (
    "file_type",
    "file_size",
    "image_size",
    "image_width",
    "image_height",
    "megapixels",
    "make",
    "model",
    "date_time_original",
    "create_date",
    "focal_length_35mm_equivalent",
    "horizontal_field_of_view_degrees",
    "direction_degrees",
    "direction_reference",
    "gps_latitude_decimal",
    "gps_longitude_decimal",
    "file_type_extension",
    "mime_type",
)
RAW_METADATA_EXCLUDED_KEYS = {
    "category",
    "checksum",
    "file_name",
    "file_size_bytes",
}


app = Flask(__name__)
app.config.update(
    MAX_CONTENT_LENGTH=MAX_UPLOAD_TOTAL_BYTES,
    DATABASE_PATH=DATABASE_PATH,
    UPLOAD_DIR=UPLOAD_DIR,
)


def get_database_path():
    return Path(app.config["DATABASE_PATH"])


def get_upload_dir():
    return Path(app.config["UPLOAD_DIR"])


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
    connection = sqlite3.connect(get_database_path())
    connection.row_factory = sqlite3.Row
    return connection


def init_storage():
    get_upload_dir().mkdir(parents=True, exist_ok=True)
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


def calculate_file_checksum(file_path, chunk_size=1024 * 1024):
    digest = hashlib.md5()
    with Path(file_path).open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def parse_numeric_value(value):
    converted = convert_ratio(value)
    if isinstance(converted, (int, float)):
        return float(converted)
    if isinstance(converted, str):
        trimmed = converted.strip()
        if not trimmed:
            return None
        if "," in trimmed or "/" in trimmed:
            parts = [part.strip() for part in trimmed.replace("/", ",").split(",")]
            if len(parts) == 2:
                try:
                    numerator = float(parts[0])
                    denominator = float(parts[1])
                except ValueError:
                    return None
                if denominator == 0:
                    return None
                return numerator / denominator
        try:
            return float(trimmed)
        except ValueError:
            return None
    return None


def decode_metadata_text(value):
    if isinstance(value, bytes):
        decoded = value.decode("utf-8", errors="ignore").replace("\x00", "").strip()
        return decoded or None
    if isinstance(value, str):
        normalized = value.replace("\x00", "").strip()
        return normalized or None
    return None


def decode_exif_bytes(value):
    decoded = decode_metadata_text(value)
    if not decoded:
        return None

    if any(ord(character) < 32 and character not in {"\t", "\n", "\r"} for character in decoded):
        return None

    if not any(character.isalnum() for character in decoded):
        return None

    return decoded


def calculate_horizontal_fov_degrees(focal_length_35mm, image_width, image_height):
    if focal_length_35mm is None or focal_length_35mm <= 0:
        return None

    if image_width and image_height and image_width > 0 and image_height > 0:
        aspect_ratio = image_width / image_height
        full_frame_diagonal = math.hypot(36.0, 24.0)
        equivalent_sensor_width = (
            full_frame_diagonal * aspect_ratio / math.sqrt(aspect_ratio * aspect_ratio + 1)
        )
    else:
        equivalent_sensor_width = 36.0

    fov_radians = 2 * math.atan(equivalent_sensor_width / (2 * focal_length_35mm))
    return round(math.degrees(fov_radians), 2)


def add_derived_camera_metadata(metadata):
    direction_degrees = parse_numeric_value(
        metadata.get("direction_degrees")
        or metadata.get("gps_img_direction")
        or metadata.get("gpsimgdirection")
        or metadata.get("gps_dest_bearing")
        or metadata.get("gpsdestbearing")
    )
    if direction_degrees is not None:
        metadata["direction_degrees"] = round(direction_degrees % 360, 2)

    direction_reference = decode_metadata_text(
        metadata.get("direction_reference")
        or metadata.get("gps_img_direction_ref")
        or metadata.get("gpsimgdirectionref")
        or metadata.get("gps_dest_bearing_ref")
        or metadata.get("gpsdestbearingref")
    )
    if direction_reference:
        metadata["direction_reference"] = direction_reference.upper()

    focal_length_35mm = parse_numeric_value(
        metadata.get("focal_length_35mm_equivalent")
        or metadata.get("focal_length_in_35mm_film")
        or metadata.get("focallengthin35mmfilm")
    )
    image_width = parse_numeric_value(metadata.get("image_width") or metadata.get("imagewidth"))
    image_height = parse_numeric_value(metadata.get("image_height") or metadata.get("imageheight"))

    horizontal_fov_degrees = calculate_horizontal_fov_degrees(
        focal_length_35mm,
        image_width,
        image_height,
    )
    if horizontal_fov_degrees is not None:
        metadata["horizontal_field_of_view_degrees"] = horizontal_fov_degrees
        metadata["focal_length_35mm_equivalent"] = round(focal_length_35mm, 2)


def serialize_metadata_value(value):
    if isinstance(value, bytes):
        decoded_bytes = decode_exif_bytes(value)
        if decoded_bytes is not None:
            return decoded_bytes
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


def has_metadata_value(value):
    return value not in (None, "", [], {})


def build_curated_metadata(metadata):
    curated_metadata = {}
    for key in SUMMARY_METADATA_KEYS:
        value = metadata.get(key)
        if has_metadata_value(value):
            curated_metadata[key] = value
    return curated_metadata


def build_raw_metadata(metadata, curated_keys=None):
    curated_keys = curated_keys or set()
    raw_metadata = {}
    for key in sorted(metadata):
        if key in curated_keys or key in RAW_METADATA_EXCLUDED_KEYS:
            continue

        value = metadata.get(key)
        if has_metadata_value(value):
            raw_metadata[key] = value

    return raw_metadata


def build_metadata_payload(metadata):
    curated_metadata = build_curated_metadata(metadata)
    raw_metadata = build_raw_metadata(metadata, set(curated_metadata))
    return {
        "summary": curated_metadata,
        "raw": raw_metadata,
    }


def normalize_metadata_payload(metadata_payload):
    if not isinstance(metadata_payload, dict):
        return {"summary": {}, "raw": {}}

    if "summary" in metadata_payload or "raw" in metadata_payload:
        summary = metadata_payload.get("summary")
        raw = metadata_payload.get("raw")
        return {
            "summary": summary if isinstance(summary, dict) else {},
            "raw": raw if isinstance(raw, dict) else {},
        }

    return build_metadata_payload(metadata_payload)


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


def extract_exif_metadata_with_pillow(image_path=None, image=None):
    Image, _, ExifTags, _ = load_image_dependencies()
    metadata = {}
    latitude = None
    longitude = None

    def extract_from_image(image_handle):
        nonlocal latitude, longitude

        exif = image_handle.getexif()
        if not exif:
            return

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

                direction_value = parse_numeric_value(
                    gps_info.get("gps_img_direction")
                    or gps_info.get("gpsimgdirection")
                    or gps_info.get("gps_dest_bearing")
                    or gps_info.get("gpsdestbearing")
                )
                if direction_value is not None:
                    metadata["direction_degrees"] = round(direction_value % 360, 2)

                direction_reference = decode_metadata_text(
                    gps_info.get("gps_img_direction_ref")
                    or gps_info.get("gpsimgdirectionref")
                    or gps_info.get("gps_dest_bearing_ref")
                    or gps_info.get("gpsdestbearingref")
                )
                if direction_reference:
                    metadata["direction_reference"] = direction_reference.upper()
            else:
                metadata[tag_name] = serialize_metadata_value(raw_value)

    if image is not None:
        extract_from_image(image)
    elif image_path is not None:
        with Image.open(image_path) as opened_image:
            extract_from_image(opened_image)
    else:
        return metadata, latitude, longitude

    if latitude is not None:
        metadata["gps_latitude_decimal"] = latitude
    if longitude is not None:
        metadata["gps_longitude_decimal"] = longitude

    return metadata, latitude, longitude


def extract_exif_metadata(image_path, exif_bytes=None, image=None):
    metadata = {}
    latitude = None
    longitude = None

    _, _, _, piexif = load_image_dependencies()

    if piexif is None:
        return extract_exif_metadata_with_pillow(image_path=image_path, image=image)

    try:
        exif_data = piexif.load(exif_bytes if exif_bytes else str(image_path))
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
    gps_img_direction = gps_ifd.get(piexif.GPSIFD.GPSImgDirection)
    gps_img_direction_ref = gps_ifd.get(piexif.GPSIFD.GPSImgDirectionRef)
    gps_dest_bearing = gps_ifd.get(piexif.GPSIFD.GPSDestBearing)
    gps_dest_bearing_ref = gps_ifd.get(piexif.GPSIFD.GPSDestBearingRef)

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

    direction_value = parse_numeric_value(gps_img_direction)
    if direction_value is None:
        direction_value = parse_numeric_value(gps_dest_bearing)
    if direction_value is not None:
        metadata["direction_degrees"] = round(direction_value % 360, 2)

    direction_reference = decode_metadata_text(gps_img_direction_ref)
    if not direction_reference:
        direction_reference = decode_metadata_text(gps_dest_bearing_ref)
    if direction_reference:
        metadata["direction_reference"] = direction_reference.upper()

    return metadata, latitude, longitude


def extract_image_metadata(image_path, original_filename):
    Image, UnidentifiedImageError, _, _ = load_image_dependencies()
    checksum = calculate_file_checksum(image_path)
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
            exif_bytes = image.info.get("exif")

            for key, value in image.info.items():
                normalized_key = snake_case(key)
                if normalized_key == "exif":
                    continue
                metadata[normalized_key] = serialize_metadata_value(value)

            exif_metadata, latitude, longitude = extract_exif_metadata(
                image_path,
                exif_bytes=exif_bytes,
                image=image,
            )
    except UnidentifiedImageError as error:
        raise ValueError("Unsupported or corrupted image file") from error

    metadata.update(exif_metadata)
    add_derived_camera_metadata(metadata)

    return build_metadata_payload(metadata), checksum, file_size_bytes, mime_type, latitude, longitude


def serialize_photo(row):
    metadata_payload = normalize_metadata_payload(json.loads(row["metadata_json"]))
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
        "metadata": metadata_payload["summary"],
        "raw_metadata": metadata_payload["raw"],
    }


def allowed_file(filename):
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def api_error_response(message, status_code):
    return jsonify({"error": message}), status_code


def is_api_request():
    return request.path.startswith("/api/")


def build_http_error_message(error):
    if isinstance(error, RequestEntityTooLarge):
        return (
            "Upload is too large. Maximum total upload size is "
            f"{format_bytes(MAX_UPLOAD_TOTAL_BYTES)} per request."
        )
    return error.description


def clear_uploaded_photos():
    with get_db_connection() as connection:
        rows = connection.execute(
            "SELECT stored_filename FROM photos"
        ).fetchall()

    deleted_count = len(rows)
    upload_dir = get_upload_dir()
    stored_filenames = [row["stored_filename"] for row in rows]

    failed_deletions = []
    deleted_file_count = 0
    for stored_filename in stored_filenames:
        file_path = upload_dir / stored_filename
        if not file_path.exists():
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

    file_deleted = False
    file_path = get_upload_dir() / row["stored_filename"]
    if file_path.exists():
        file_path.unlink(missing_ok=True)
        file_deleted = True

    with get_db_connection() as connection:
        connection.execute("DELETE FROM photos WHERE id = ?", (photo_id,))

    return {
        "deleted_id": row["id"],
        "deleted_filename": row["original_filename"],
        "deleted_file": file_deleted,
    }


def build_upload_error(original_filename, message):
    return {"file": original_filename, "error": message}


def validate_upload_request(files):
    if not files:
        return build_upload_error("", "No files were uploaded.")
    if len(files) > MAX_FILES_PER_UPLOAD:
        return build_upload_error(
            "",
            f"Too many files selected. Maximum is {MAX_FILES_PER_UPLOAD} photos per upload.",
        )
    return None


def save_incoming_file(file_storage):
    original_filename = file_storage.filename or ""
    if not original_filename:
        return None, build_upload_error(original_filename, "Missing file name.")
    if not allowed_file(original_filename):
        return None, build_upload_error(original_filename, "Unsupported image type.")

    safe_name = secure_filename(original_filename)
    file_extension = Path(safe_name).suffix.lower()
    stored_filename = f"{uuid.uuid4().hex}{file_extension}"
    upload_dir = get_upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved_path = upload_dir / stored_filename
    file_storage.save(saved_path)
    return (original_filename, stored_filename, saved_path), None


def persist_uploaded_photo(
    original_filename,
    stored_filename,
    checksum,
    file_size_bytes,
    mime_type,
    metadata_payload,
    latitude,
    longitude,
):
    uploaded_at = datetime.now(timezone.utc).isoformat()
    normalized_metadata_payload = normalize_metadata_payload(metadata_payload)
    summary_metadata = normalized_metadata_payload["summary"]

    with get_db_connection() as connection:
        insert_cursor = connection.execute(
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
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
                SELECT 1
                FROM photos
                WHERE checksum = ?
            )
            """,
            (
                original_filename,
                stored_filename,
                checksum,
                file_size_bytes,
                summary_metadata.get("file_type"),
                summary_metadata.get("file_type_extension"),
                mime_type,
                json.dumps(normalized_metadata_payload, ensure_ascii=True, sort_keys=True),
                latitude,
                longitude,
                uploaded_at,
                checksum,
            ),
        )

        if insert_cursor.rowcount == 0:
            existing_photo = connection.execute(
                """
                SELECT original_filename, uploaded_at
                FROM photos
                WHERE checksum = ?
                LIMIT 1
                """,
                (checksum,),
            ).fetchone()
            return None, build_upload_error(
                original_filename,
                "Duplicate photo already imported "
                f"as {existing_photo['original_filename']} on {existing_photo['uploaded_at']}.",
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

    return serialize_photo(row), None


def process_upload(file_storage):
    saved_file, upload_error = save_incoming_file(file_storage)
    if upload_error is not None:
        return None, upload_error

    original_filename, stored_filename, saved_path = saved_file

    try:
        metadata, checksum, file_size_bytes, mime_type, latitude, longitude = extract_image_metadata(
            saved_path,
            original_filename,
        )
    except RuntimeError as error:
        saved_path.unlink(missing_ok=True)
        return None, build_upload_error(original_filename, str(error))
    except ValueError as error:
        saved_path.unlink(missing_ok=True)
        return None, build_upload_error(original_filename, str(error))
    except Exception as error:
        app.logger.exception("Failed to extract image metadata", exc_info=error)
        saved_path.unlink(missing_ok=True)
        return None, build_upload_error(
            original_filename,
            "Unable to extract metadata from this image.",
        )

    try:
        uploaded_photo, upload_error = persist_uploaded_photo(
            original_filename,
            stored_filename,
            checksum,
            file_size_bytes,
            mime_type,
            metadata,
            latitude,
            longitude,
        )
        if upload_error is not None:
            saved_path.unlink(missing_ok=True)
            return None, upload_error
        return uploaded_photo, None
    except Exception as error:
        app.logger.exception("Failed to store uploaded photo metadata", exc_info=error)
        saved_path.unlink(missing_ok=True)
        return None, build_upload_error(
            original_filename,
            "Server error while storing image metadata.",
        )


@app.route("/")
def index():
    return render_template(
        "index.html",
        title="Control Panel Map",
        max_files_per_upload=MAX_FILES_PER_UPLOAD,
        max_upload_total_bytes=MAX_UPLOAD_TOTAL_BYTES,
        max_upload_total_label=format_bytes(MAX_UPLOAD_TOTAL_BYTES),
    )


@app.errorhandler(HTTPException)
def handle_http_error(error):
    if not is_api_request():
        return error

    return api_error_response(build_http_error_message(error), error.code or 500)


@app.errorhandler(Exception)
def handle_application_error(error):
    if not is_api_request():
        raise error

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
    except HTTPException:
        raise
    except Exception as error:
        app.logger.exception("Failed to list photos", exc_info=error)
        return api_error_response("Unable to load uploaded photos.", 500)


@app.delete("/api/photos")
def delete_photos():
    try:
        result = clear_uploaded_photos()
        return jsonify(result)
    except HTTPException:
        raise
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
    except HTTPException:
        raise
    except Exception as error:
        app.logger.exception("Failed to delete uploaded photo", exc_info=error)
        return api_error_response("Unable to delete uploaded photo.", 500)


@app.post("/api/uploads")
def upload_photos():
    try:
        files = request.files.getlist("photos")
        validation_error = validate_upload_request(files)
        if validation_error is not None:
            return api_error_response(validation_error["error"], 400)

        uploaded = []
        errors = []

        for file_storage in files:
            uploaded_photo, upload_error = process_upload(file_storage)
            if upload_error is not None:
                errors.append(upload_error)
                continue

            uploaded.append(uploaded_photo)

        status_code = 200 if uploaded else 400
        return jsonify({"uploaded": uploaded, "errors": errors}), status_code
    except HTTPException:
        raise
    except Exception as error:
        app.logger.exception("Failed to upload photos", exc_info=error)
        return api_error_response("Unexpected server error while uploading photos.", 500)


@app.get("/uploads/<path:filename>")
def serve_uploaded_file(filename):
    return send_from_directory(get_upload_dir(), filename)


init_storage()
