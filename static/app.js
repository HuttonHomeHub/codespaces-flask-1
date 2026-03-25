const map = L.map("map", {
    center: [54.5, -3.5],
    zoom: 6,
    zoomControl: true,
});

const uploadForm = document.getElementById("upload-form");
const photoInput = document.getElementById("photo-input");
const dropZone = document.getElementById("drop-zone");
const uploadStatus = document.getElementById("upload-status");
const uploadProgress = document.getElementById("upload-progress");
const uploadProgressLabel = document.getElementById("upload-progress-label");
const uploadProgressValue = document.getElementById("upload-progress-value");
const uploadProgressBar = document.getElementById("upload-progress-bar");
const cancelUploadButton = document.getElementById("cancel-upload-button");
const uploadList = document.getElementById("upload-list");
const uploadCount = document.getElementById("upload-count");
const clearUploadsButton = document.getElementById("clear-uploads-button");
const metadataDrawer = document.getElementById("metadata-drawer");
const metadataDrawerTitle = document.getElementById("metadata-drawer-title");
const metadataDrawerBody = document.getElementById("metadata-drawer-body");
const metadataDrawerClose = document.getElementById("metadata-drawer-close");
const drawerBackdrop = document.getElementById("drawer-backdrop");
const photoMarkers = L.layerGroup().addTo(map);
const fieldOfViewLayer = L.layerGroup().addTo(map);
const HEATMAP_RADIUS_PX = 36;
const HEATMAP_BLUR_PX = 28;
const HEATMAP_MIN_OPACITY = 0.18;
const HEATMAP_POINT_INTENSITY = 0.8;
const heatMapLayer =
    typeof L.heatLayer === "function"
        ? L.heatLayer([], {
              radius: HEATMAP_RADIUS_PX,
              blur: HEATMAP_BLUR_PX,
              maxZoom: 19,
              minOpacity: HEATMAP_MIN_OPACITY,
              max: 1,
              gradient: {
                  0.2: "#38bdf8",
                  0.4: "#22c55e",
                  0.65: "#f59e0b",
                  0.85: "#f97316",
                  1: "#dc2626",
              },
          })
        : null;
const maxFilesPerUpload = Number(uploadForm.dataset.maxFiles || 100);
const maxTotalUploadBytes = Number(uploadForm.dataset.maxTotalBytes || 0);
let pendingFiles = [];
let isUploading = false;
let cancelUploadRequested = false;
let activeUploadRequest = null;
let statusResetTimer = null;
let currentPhotos = [];
let activeDrawerPhotoId = null;
let lastDrawerTrigger = null;
const DEFAULT_HORIZONTAL_FOV_DEGREES = 55;
const MIN_HORIZONTAL_FOV_DEGREES = 12;
const TARGET_FRAME_WIDTH_METERS = 90;
const MIN_VIEWING_DISTANCE_METERS = 30;
const MAX_VIEWING_DISTANCE_METERS = 250;
const SUCCESS_STATUS_TIMEOUT_MS = 5000;
const RAW_METADATA_PRIORITY_KEYS = [
    "lens_model",
    "software",
    "artist",
    "copyright",
    "exposure_time",
    "f_number",
    "iso_speed_ratings",
    "white_balance",
    "flash",
];
const HIDDEN_RAW_METADATA_KEYS = new Set([
    "aperturevalue",
    "brightnessvalue",
    "componentsconfiguration",
    "compression",
    "datetime",
    "datetimedigitized",
    "datetimeoriginal",
    "dpi",
    "exiftag",
    "exifversion",
    "exposurebiasvalue",
    "exposuremode",
    "exposureprogram",
    "flashpixversion",
    "gpsaltituderef",
    "gpsdatestamp",
    "gpsdestbearingref",
    "gpsimgdirectionref",
    "gpslatitude",
    "gpslatituderef",
    "gpslongitude",
    "gpslongituderef",
    "gpsspeed",
    "gpsspeedref",
    "gpstag",
    "gpstimestamp",
    "hostcomputer",
    "icc_profile",
    "jpeginterchangeformat",
    "jpeginterchangeformatlength",
    "lensmake",
    "lensspecification",
    "makernote",
    "meteringmode",
    "offsettime",
    "offsettimedigitized",
    "offsettimeoriginal",
    "orientation",
    "pixelxdimension",
    "pixelydimension",
    "resolutionunit",
    "scenecapturetype",
    "scenetype",
    "sensingmethod",
    "shutterspeedvalue",
    "subjectarea",
    "subsectimedigitized",
    "subsectimeoriginal",
    "xresolution",
    "ycbcrpositioning",
    "yresolution",
]);
const markerByPhotoId = new Map();
const METADATA_LABEL_OVERRIDES = {
    aperturevalue: "Aperture Value",
    artist: "Artist",
    brightnessvalue: "Brightness Value",
    colorspace: "Color Space",
    componentsconfiguration: "Components Configuration",
    compression: "Compression",
    datetime: "Modified",
    datetimedigitized: "Digitized",
    datetimeoriginal: "Captured",
    dpi: "DPI",
    exiftag: "EXIF Tag Offset",
    exifversion: "EXIF Version",
    exposurebiasvalue: "Exposure Compensation",
    exposuremode: "Exposure Mode",
    exposureprogram: "Exposure Program",
    exposuretime: "Exposure Time",
    flash: "Flash",
    flashpixversion: "FlashPix Version",
    fnumber: "Aperture",
    focallength: "Focal Length",
    focallengthin35mmfilm: "35mm Equivalent",
    gpsaltitude: "Altitude",
    gpsaltituderef: "Altitude Reference",
    gpsdatestamp: "GPS Date",
    gpsdestbearing: "Destination Bearing",
    gpsdestbearingref: "Destination Bearing Reference",
    gpshpositioningerror: "GPS Accuracy",
    gpsimgdirection: "Image Direction",
    gpsimgdirectionref: "Image Direction Reference",
    gpslatitude: "Latitude (DMS)",
    gpslatituderef: "Latitude Reference",
    gpslongitude: "Longitude (DMS)",
    gpslongituderef: "Longitude Reference",
    gpsspeed: "GPS Speed",
    gpsspeedref: "GPS Speed Unit",
    gpstag: "GPS Tag Offset",
    gpstimestamp: "GPS Time",
    hostcomputer: "Host Computer",
    icc_profile: "ICC Profile",
    isospeedratings: "ISO",
    jpeginterchangeformat: "JPEG Preview Offset",
    jpeginterchangeformatlength: "JPEG Preview Length",
    lensmake: "Lens Make",
    lensmodel: "Lens Model",
    lensspecification: "Lens Specification",
    makernote: "Maker Note",
    meteringmode: "Metering Mode",
    offsettime: "Offset Time",
    offsettimedigitized: "Digitized Offset",
    offsettimeoriginal: "Capture Offset",
    orientation: "Orientation",
    pixelxdimension: "Pixel Width",
    pixelydimension: "Pixel Height",
    resolutionunit: "Resolution Unit",
    scenecapturetype: "Scene Capture Type",
    scenetype: "Scene Type",
    sensingmethod: "Sensing Method",
    shutterspeedvalue: "Shutter Speed Value",
    software: "Software",
    subjectarea: "Subject Area",
    subsectimedigitized: "Digitized Subsecond",
    subsectimeoriginal: "Capture Subsecond",
    whitebalance: "White Balance",
    xresolution: "Horizontal Resolution",
    ycbcrpositioning: "YCbCr Positioning",
    yresolution: "Vertical Resolution",
};
const METADATA_ENUM_LABELS = {
    colorspace: {
        1: "sRGB",
        65535: "Uncalibrated",
    },
    exposuremode: {
        0: "Automatic exposure",
        1: "Manual exposure",
        2: "Auto bracket",
    },
    exposureprogram: {
        0: "Undefined",
        1: "Manual",
        2: "Normal program",
        3: "Aperture priority",
        4: "Shutter priority",
        5: "Creative program",
        6: "Action program",
        7: "Portrait mode",
        8: "Landscape mode",
    },
    meteringmode: {
        0: "Unknown",
        1: "Average",
        2: "Center-weighted average",
        3: "Spot",
        4: "Multi-spot",
        5: "Pattern",
        6: "Partial",
        255: "Other",
    },
    orientation: {
        1: "Normal",
        3: "Rotated 180 degrees",
        6: "Rotated 90 degrees clockwise",
        8: "Rotated 90 degrees counter-clockwise",
    },
    resolutionunit: {
        2: "Pixels per inch",
        3: "Pixels per centimeter",
    },
    scenecapturetype: {
        0: "Standard",
        1: "Landscape",
        2: "Portrait",
        3: "Night scene",
    },
    sensingmethod: {
        1: "Not defined",
        2: "One-chip color area sensor",
        3: "Two-chip color area sensor",
        4: "Three-chip color area sensor",
        5: "Color sequential area sensor",
        7: "Trilinear sensor",
        8: "Color sequential linear sensor",
    },
    whitebalance: {
        0: "Auto",
        1: "Manual",
    },
    ycbcrpositioning: {
        1: "Centered",
        2: "Co-sited",
    },
};

const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
        attribution:
            "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxZoom: 19,
    }
);

const streetLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
    }
);

satelliteLayer.addTo(map);

const overlayLayers = {
    "Field of View": fieldOfViewLayer,
};

if (heatMapLayer) {
    overlayLayers["Heat Map"] = heatMapLayer;
}

L.control.layers(
    {
        Satellite: satelliteLayer,
        Streets: streetLayer,
    },
    overlayLayers,
    {
        collapsed: false,
        position: "topright",
    }
).addTo(map);

L.control.scale({
    imperial: false,
    metric: true,
}).addTo(map);

function getErrorMessage(error, fallbackMessage) {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallbackMessage;
}

function formatCountLabel(count, singularLabel) {
    return `${count} ${singularLabel}${count === 1 ? "" : "s"}`;
}

function getReadyToUploadMessage(count) {
    return `${formatCountLabel(count, "file")} ready to upload.`;
}

function setStatus(message, tone = "") {
    if (statusResetTimer !== null) {
        window.clearTimeout(statusResetTimer);
        statusResetTimer = null;
    }

    uploadStatus.textContent = message;
    uploadStatus.className = tone ? `status-message is-${tone}` : "status-message";
}

function setTimedStatus(message, tone, timeoutMs) {
    setStatus(message, tone);
    if (!message || timeoutMs <= 0) {
        return;
    }

    statusResetTimer = window.setTimeout(() => {
        uploadStatus.textContent = "";
        uploadStatus.className = "status-message";
        statusResetTimer = null;
    }, timeoutMs);
}

function setUploadUiState(uploading) {
    photoInput.disabled = uploading;
    dropZone.classList.toggle("is-disabled", uploading);
    cancelUploadButton.hidden = !uploading;
    cancelUploadButton.disabled = !uploading;
    clearUploadsButton.disabled = uploading || uploadCount.textContent === "0 files";
}

function showUploadProgress() {
    uploadProgress.hidden = false;
    uploadProgress.classList.add("is-visible");
}

function hideUploadProgress() {
    uploadProgress.hidden = true;
    uploadProgress.classList.remove("is-visible");
    uploadProgressLabel.textContent = "Uploading files";
    uploadProgressValue.textContent = "0%";
    uploadProgressBar.style.width = "0%";
    uploadProgress
        .querySelector(".upload-progress-track")
        .setAttribute("aria-valuenow", "0");
}

function setUploadProgress(percentComplete, label) {
    const clampedPercent = clamp(percentComplete, 0, 100);
    const roundedPercent = Math.round(clampedPercent);
    uploadProgressLabel.textContent = label;
    uploadProgressValue.textContent = `${roundedPercent}%`;
    uploadProgressBar.style.width = `${clampedPercent}%`;
    uploadProgress
        .querySelector(".upload-progress-track")
        .setAttribute("aria-valuenow", String(roundedPercent));
}

function formatBytes(sizeBytes) {
    const units = ["B", "KB", "MB", "GB"];
    let size = Number(sizeBytes);
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    if (unitIndex === 0) {
        return `${Math.round(size)} ${units[unitIndex]}`;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function promptLimitExceeded(message) {
    setStatus(message, "error");
    window.alert(message);
}

function validateSelectedFiles(files) {
    if (!files.length) {
        return false;
    }

    if (files.length > maxFilesPerUpload) {
        promptLimitExceeded(
            `You selected ${files.length} photos. The limit is ${maxFilesPerUpload} photos per upload.`
        );
        return false;
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (maxTotalUploadBytes > 0 && totalBytes > maxTotalUploadBytes) {
        promptLimitExceeded(
            `These files total ${formatBytes(totalBytes)}. The limit is ${formatBytes(maxTotalUploadBytes)} per upload.`
        );
        return false;
    }

    return true;
}

async function parseApiResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();

    if (contentType.includes("application/json")) {
        try {
            return JSON.parse(bodyText);
        } catch {
            return { error: "Server returned invalid JSON." };
        }
    }

    if (!bodyText) {
        return {};
    }

    if (bodyText.startsWith("<!doctype") || bodyText.startsWith("<html")) {
        if (response.status === 413) {
            return { error: "Upload is too large. Reduce the number of files or total upload size and try again." };
        }

        return { error: "Server returned an HTML error page instead of JSON." };
    }

    if (response.status === 413) {
        return { error: "Upload is too large. Reduce the number of files or total upload size and try again." };
    }

    return { error: bodyText };
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatDate(value) {
    if (!value) {
        return "Unknown";
    }

    const exifMatch = String(value).match(
        /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
    );
    if (exifMatch) {
        const [, year, month, day, hour, minute, second] = exifMatch;
        const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleString();
        }
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

function formatMetadataLabel(key) {
    if (Object.hasOwn(METADATA_LABEL_OVERRIDES, key)) {
        return METADATA_LABEL_OVERRIDES[key];
    }

    return String(key || "")
        .split("_")
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ");
}

function parseRationalString(value) {
    if (typeof value !== "string") {
        return null;
    }

    const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) {
        return null;
    }

    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return null;
    }

    return { numerator, denominator, value: numerator / denominator };
}

function parseRationalSequence(value) {
    if (typeof value !== "string") {
        return null;
    }

    const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
    if (!parts.length || parts.length % 2 !== 0) {
        return null;
    }

    const pairs = [];
    for (let index = 0; index < parts.length; index += 2) {
        const numerator = Number(parts[index]);
        const denominator = Number(parts[index + 1]);
        if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
            return null;
        }

        pairs.push({ numerator, denominator, value: numerator / denominator });
    }

    return pairs;
}

function formatNumber(value, maximumFractionDigits = 2) {
    if (!Number.isFinite(value)) {
        return "Unknown";
    }

    return new Intl.NumberFormat(undefined, {
        maximumFractionDigits,
    }).format(value);
}

function formatExifVersion(value) {
    if (typeof value !== "string" || value.length < 4) {
        return String(value);
    }

    return `${value.slice(0, 2)}.${value.slice(2)}`;
}

function formatFlashValue(value) {
    const numericValue = Number(value);
    if (!Number.isInteger(numericValue)) {
        return String(value);
    }

    const parts = [];
    parts.push(numericValue & 1 ? "Flash fired" : "Flash did not fire");

    const mode = numericValue & 24;
    if (mode === 8) {
        parts.push("Compulsory flash");
    } else if (mode === 16) {
        parts.push("Flash suppressed");
    } else if (mode === 24) {
        parts.push("Auto flash mode");
    }

    if (numericValue & 32) {
        parts.push("No flash function");
    }

    if (numericValue & 64) {
        parts.push("Red-eye reduction");
    }

    return parts.join(", ");
}

function formatCoordinateDms(value, reference) {
    const sequence = parseRationalSequence(value);
    if (!sequence || sequence.length !== 3) {
        return String(value);
    }

    const [degrees, minutes, seconds] = sequence.map((item) => item.value);
    const refLabel = reference ? ` ${reference}` : "";
    return `${formatNumber(degrees, 0)}° ${formatNumber(minutes, 0)}' ${formatNumber(seconds, 2)}\"${refLabel}`;
}

function formatGpsTimestamp(value) {
    const sequence = parseRationalSequence(value);
    if (!sequence || sequence.length !== 3) {
        return String(value);
    }

    const [hours, minutes, seconds] = sequence.map((item) => Math.round(item.value));
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} UTC`;
}

function formatRationalMetric(value, unit, maximumFractionDigits = 2) {
    const rational = parseRationalString(value);
    if (!rational) {
        return String(value);
    }

    return `${formatNumber(rational.value, maximumFractionDigits)} ${unit}`;
}

function formatExposureTime(value) {
    const rational = parseRationalString(value);
    if (!rational) {
        return String(value);
    }

    if (rational.value >= 1) {
        return `${formatNumber(rational.value, 1)} s`;
    }

    return `1/${formatNumber(rational.denominator / rational.numerator, 0)} s`;
}

function formatApertureValue(value) {
    const rational = parseRationalString(value);
    if (!rational) {
        return String(value);
    }

    return `${formatNumber(rational.value, 1)} EV`;
}

function formatFNumber(value) {
    const rational = parseRationalString(value);
    if (!rational) {
        return String(value);
    }

    return `f/${formatNumber(rational.value, 1)}`;
}

function formatShutterSpeedValue(value) {
    const rational = parseRationalString(value);
    if (!rational) {
        return String(value);
    }

    return `${formatNumber(rational.value, 2)} EV`;
}

function formatFocalLengthValue(value) {
    return formatRationalMetric(value, "mm", 1);
}

function formatAltitudeValue(value, altitudeReference) {
    const rational = parseRationalString(value);
    if (!rational) {
        return String(value);
    }

    const signedValue = String(altitudeReference) === "1" ? rational.value * -1 : rational.value;
    return `${formatNumber(signedValue, 1)} m`;
}

function formatDirectionValue(value, reference) {
    const rational = parseRationalString(value);
    if (!rational) {
        return String(value);
    }

    const refLabel = reference === "T" ? " true" : reference === "M" ? " magnetic" : "";
    return `${formatNumber(rational.value, 1)}°${refLabel}`;
}

function formatDpiValue(value) {
    const sequence = parseRationalSequence(value);
    if (!sequence || sequence.length !== 2) {
        return String(value);
    }

    return `${formatNumber(sequence[0].value, 0)} x ${formatNumber(sequence[1].value, 0)} dpi`;
}

function formatLensSpecification(value) {
    const sequence = parseRationalSequence(value);
    if (!sequence || sequence.length !== 4) {
        return String(value);
    }

    return `${formatNumber(sequence[0].value, 2)}-${formatNumber(sequence[1].value, 1)} mm, f/${formatNumber(sequence[2].value, 1)}-${formatNumber(sequence[3].value, 1)}`;
}

function formatSubjectArea(value) {
    const parts = String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    if (parts.length === 4) {
        return `Center ${parts[0]}, ${parts[1]} with size ${parts[2]} x ${parts[3]}`;
    }

    return String(value);
}

function formatBinaryText(value) {
    const match = String(value).match(/^\(Binary data (\d+) bytes\)$/);
    if (!match) {
        return String(value);
    }

    return `Binary data, ${formatNumber(Number(match[1]), 0)} bytes`;
}

function getMetadataValue(photo, keys) {
    const summary = photo.metadata || {};
    const raw = photo.raw_metadata || {};

    for (const key of keys) {
        if (summary[key] !== undefined && summary[key] !== null && summary[key] !== "") {
            return summary[key];
        }
        if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") {
            return raw[key];
        }
    }

    return null;
}

function formatMetadataValue(key, value, metadataContext = {}) {
    if (value === null || value === undefined || value === "") {
        return "Unknown";
    }

    if (Array.isArray(value)) {
        return value.map((item) => formatMetadataValue(key, item, metadataContext)).join(", ");
    }

    if (typeof value === "object") {
        return JSON.stringify(value);
    }

    if (String(value).startsWith("(Binary data")) {
        return formatBinaryText(value);
    }

    if (["date_time_original", "create_date", "datetime", "datetimedigitized", "datetimeoriginal"].includes(key)) {
        return formatDate(value);
    }

    if (["exifversion", "flashpixversion"].includes(key)) {
        return formatExifVersion(String(value));
    }

    if (["exposuretime"].includes(key)) {
        return formatExposureTime(String(value));
    }

    if (["fnumber"].includes(key)) {
        return formatFNumber(String(value));
    }

    if (["aperturevalue", "brightnessvalue", "exposurebiasvalue"].includes(key)) {
        return formatApertureValue(String(value));
    }

    if (["focallength"].includes(key)) {
        return formatFocalLengthValue(String(value));
    }

    if (["focallengthin35mmfilm"].includes(key)) {
        return `${formatNumber(Number(value), 0)} mm`;
    }

    if (["gpsaltitude"].includes(key)) {
        return formatAltitudeValue(String(value), metadataContext.gpsaltituderef);
    }

    if (["gpsdestbearing", "gpsimgdirection"].includes(key)) {
        return formatDirectionValue(String(value), metadataContext[`${key}ref`] || metadataContext.direction_reference);
    }

    if (["gpslatitude"].includes(key)) {
        return formatCoordinateDms(String(value), metadataContext.gpslatituderef);
    }

    if (["gpslongitude"].includes(key)) {
        return formatCoordinateDms(String(value), metadataContext.gpslongituderef);
    }

    if (["gpshpositioningerror", "gpsspeed"].includes(key)) {
        return formatRationalMetric(String(value), key === "gpsspeed" ? (metadataContext.gpsspeedref === "K" ? "km/h" : "m/s") : "m", 1);
    }

    if (["gpstimestamp"].includes(key)) {
        return formatGpsTimestamp(String(value));
    }

    if (["dpi"].includes(key)) {
        return formatDpiValue(String(value));
    }

    if (["lensspecification"].includes(key)) {
        return formatLensSpecification(String(value));
    }

    if (["subjectarea"].includes(key)) {
        return formatSubjectArea(String(value));
    }

    if (["shutterspeedvalue"].includes(key)) {
        return formatShutterSpeedValue(String(value));
    }

    if (["offsettime", "offsettimedigitized", "offsettimeoriginal"].includes(key)) {
        return value === "Z" ? "UTC" : String(value);
    }

    if (["flash"].includes(key)) {
        return formatFlashValue(value);
    }

    if (Object.hasOwn(METADATA_ENUM_LABELS, key)) {
        const normalizedValue = Number(value);
        if (Object.hasOwn(METADATA_ENUM_LABELS[key], normalizedValue)) {
            return METADATA_ENUM_LABELS[key][normalizedValue];
        }
    }

    return String(value);
}

function findPhotoById(photoId) {
    const numericPhotoId = Number(photoId);
    return currentPhotos.find((photo) => photo.id === numericPhotoId) || null;
}

function buildMetadataRows(photo, excludedKeys = new Set()) {
    const metadata = photo.raw_metadata || {};
    const filteredKeys = Object.keys(metadata).filter(
        (key) => !excludedKeys.has(key) && !HIDDEN_RAW_METADATA_KEYS.has(key)
    );
    const orderedKeys = [
        ...RAW_METADATA_PRIORITY_KEYS.filter(
            (key) => filteredKeys.includes(key) && Object.hasOwn(metadata, key)
        ),
        ...filteredKeys
            .filter((key) => !RAW_METADATA_PRIORITY_KEYS.includes(key))
            .sort((leftKey, rightKey) => leftKey.localeCompare(rightKey)),
    ];

    if (!orderedKeys.length) {
        return `
            <div class="metadata-row">
                <dt>Additional metadata</dt>
                <dd>No additional metadata extracted for this photo.</dd>
            </div>
        `;
    }

    return orderedKeys
        .map(
            (key) => `
                <div class="metadata-row">
                    <dt>${escapeHtml(formatMetadataLabel(key))}</dt>
                    <dd>${escapeHtml(formatMetadataValue(key, metadata[key], metadata))}</dd>
                </div>
            `
        )
        .join("");
}

function buildDetailRows(entries) {
    const visibleEntries = entries.filter((entry) => entry.value && entry.value !== "Unknown");
    if (!visibleEntries.length) {
        return `
            <div class="metadata-row">
                <dt>Details</dt>
                <dd>No additional details available.</dd>
            </div>
        `;
    }

    return visibleEntries
        .map(
            (entry) => `
                <div class="metadata-row">
                    <dt>${escapeHtml(entry.label)}</dt>
                    <dd>${escapeHtml(entry.value)}</dd>
                </div>
            `
        )
        .join("");
}

function closeMetadataDrawer({ restoreFocus = true } = {}) {
    activeDrawerPhotoId = null;
    metadataDrawer.hidden = true;
    metadataDrawer.setAttribute("aria-hidden", "true");
    drawerBackdrop.hidden = true;
    document.body.classList.remove("drawer-open");

    if (restoreFocus && lastDrawerTrigger instanceof HTMLElement) {
        lastDrawerTrigger.focus();
    }
}

function openMetadataDrawer(photo, triggerElement) {
    const metadata = photo.metadata || {};
    const rawMetadata = photo.raw_metadata || {};
    const exposedRawKeys = new Set([
        "software",
        "lensmodel",
        "lensmake",
        "isospeedratings",
        "exposuretime",
        "fnumber",
        "focallength",
        "focallengthin35mmfilm",
        "flash",
        "whitebalance",
        "gpsaltitude",
        "gpshpositioningerror",
        "gpsimgdirection",
        "gpsimgdirectionref",
        "gpsdestbearing",
        "gpsdestbearingref",
    ]);
    const summaryEntries = [
        { label: "Camera", value: getCameraLabel(metadata) },
        { label: "Captured", value: getCapturedLabel(photo) },
        {
            label: "Location",
            value:
                photo.latitude !== null && photo.longitude !== null
                    ? `${formatNumber(photo.latitude, 6)}, ${formatNumber(photo.longitude, 6)}`
                    : "No GPS data",
        },
        { label: "Type", value: metadata.file_type || "Unknown" },
        { label: "Size", value: metadata.file_size || formatBytes(photo.file_size_bytes || 0) },
        { label: "Dimensions", value: metadata.image_size || null },
    ];
    const captureEntries = [
        { label: "Lens", value: getMetadataValue(photo, ["lensmodel"]) },
        {
            label: "Focal Length",
            value: formatMetadataValue("focallength", getMetadataValue(photo, ["focallength"]), rawMetadata),
        },
        {
            label: "35mm Equivalent",
            value: formatMetadataValue(
                "focallengthin35mmfilm",
                getMetadataValue(photo, ["focal_length_35mm_equivalent", "focallengthin35mmfilm"]),
                rawMetadata
            ),
        },
        {
            label: "Aperture",
            value: formatMetadataValue("fnumber", getMetadataValue(photo, ["fnumber"]), rawMetadata),
        },
        {
            label: "Exposure",
            value: formatMetadataValue("exposuretime", getMetadataValue(photo, ["exposuretime"]), rawMetadata),
        },
        {
            label: "ISO",
            value: formatMetadataValue("isospeedratings", getMetadataValue(photo, ["isospeedratings"]), rawMetadata),
        },
        {
            label: "Flash",
            value: formatMetadataValue("flash", getMetadataValue(photo, ["flash"]), rawMetadata),
        },
        {
            label: "White Balance",
            value: formatMetadataValue("whitebalance", getMetadataValue(photo, ["whitebalance"]), rawMetadata),
        },
        {
            label: "Heading",
            value:
                metadata.direction_degrees !== undefined
                    ? `${formatNumber(Number(metadata.direction_degrees), 1)}°${metadata.direction_reference === "T" ? " true" : metadata.direction_reference === "M" ? " magnetic" : ""}`
                    : formatMetadataValue("gpsimgdirection", getMetadataValue(photo, ["gpsimgdirection", "gpsdestbearing"]), rawMetadata),
        },
        {
            label: "Field of View",
            value:
                metadata.horizontal_field_of_view_degrees !== undefined
                    ? `${formatNumber(Number(metadata.horizontal_field_of_view_degrees), 1)}°`
                    : "Unknown",
        },
        {
            label: "Altitude",
            value: formatMetadataValue("gpsaltitude", getMetadataValue(photo, ["gpsaltitude"]), rawMetadata),
        },
        {
            label: "GPS Accuracy",
            value: formatMetadataValue("gpshpositioningerror", getMetadataValue(photo, ["gpshpositioningerror"]), rawMetadata),
        },
        { label: "Software", value: getMetadataValue(photo, ["software"]) },
    ];
    const advancedFieldCount = Object.keys(rawMetadata).filter(
        (key) => !exposedRawKeys.has(key) && !HIDDEN_RAW_METADATA_KEYS.has(key)
    ).length;
    activeDrawerPhotoId = photo.id;
    lastDrawerTrigger = triggerElement || null;
    metadataDrawerTitle.textContent = photo.original_filename;
    metadataDrawerBody.innerHTML = `
        <div class="drawer-preview-shell">
            <img class="drawer-preview-image" src="${encodeURI(photo.image_url)}" alt="${escapeHtml(photo.original_filename)} preview">
        </div>
        <div class="drawer-hero-actions">
            <a class="drawer-primary-link" href="${encodeURI(photo.image_url)}" target="_blank" rel="noreferrer">Open full image</a>
            <button class="drawer-secondary-button" type="button" data-drawer-center="${photo.id}">Center on map</button>
        </div>
        <section class="metadata-section">
            <h3>Photo summary</h3>
            <dl class="metadata-summary-list">
                ${buildDetailRows(summaryEntries)}
            </dl>
        </section>
        <section class="metadata-section">
            <h3>Camera and capture</h3>
            <dl class="metadata-list">
                ${buildDetailRows(captureEntries)}
            </dl>
        </section>
        <details class="metadata-disclosure" ${advancedFieldCount ? "" : "hidden"}>
            <summary>Advanced metadata (${advancedFieldCount} fields)</summary>
            <section class="metadata-section metadata-section-advanced">
                <h3>Raw extracted metadata</h3>
                <dl class="metadata-list">
                    ${buildMetadataRows(photo, exposedRawKeys)}
                </dl>
            </section>
        </details>
        <section class="metadata-section metadata-section-note">
            <p class="metadata-note">Values are normalized for readability where possible. Some advanced EXIF fields remain approximate or vendor-specific.</p>
        </section>
    `;
    metadataDrawer.hidden = false;
    metadataDrawer.setAttribute("aria-hidden", "false");
    drawerBackdrop.hidden = false;
    document.body.classList.add("drawer-open");
    metadataDrawerClose.focus();
}

function centerPhotoOnMap(photoId) {
    const photo = findPhotoById(photoId);
    if (!photo) {
        setStatus("Photo not found.", "error");
        return;
    }

    if (typeof photo.latitude !== "number" || typeof photo.longitude !== "number") {
        setStatus("This photo does not include GPS coordinates.", "error");
        return;
    }

    const marker = markerByPhotoId.get(photo.id);
    map.flyTo([photo.latitude, photo.longitude], Math.max(map.getZoom(), 15), {
        animate: true,
        duration: 0.8,
    });

    if (marker && typeof marker.openPopup === "function") {
        window.setTimeout(() => {
            marker.openPopup();
        }, 250);
    }
}

function getCameraLabel(metadata) {
    return [metadata.make, metadata.model].filter(Boolean).join(" ") || "Unknown";
}

function getCapturedLabel(photo) {
    return photo.metadata?.date_time_original || photo.metadata?.create_date || formatDate(photo.uploaded_at);
}

function updatePendingFiles(files, { clearStatus = true } = {}) {
    pendingFiles = files;
    if (!files.length) {
        if (clearStatus) {
            setStatus("");
        }
        return;
    }

    setStatus(getReadyToUploadMessage(files.length));
}

function getUploadProgressLabel(currentIndex, totalFiles) {
    return `Uploading ${currentIndex} of ${totalFiles}`;
}

function isDuplicateUploadError(error) {
    return typeof error?.error === "string" && error.error.startsWith("Duplicate photo already imported");
}

function buildUploadSummaryMessage(uploadedCount, errors) {
    const duplicateCount = errors.filter(isDuplicateUploadError).length;
    const failureCount = errors.length - duplicateCount;
    const messageParts = [`Uploaded ${formatCountLabel(uploadedCount, "file")}.`];

    if (duplicateCount > 0) {
        messageParts.push(`${formatCountLabel(duplicateCount, "duplicate")}.`);
    }

    if (failureCount > 0) {
        messageParts.push(`${formatCountLabel(failureCount, "failed upload")}.`);
    }

    return messageParts.join(" ");
}

async function startUploadFromFiles(files, { clearInput = false } = {}) {
    if (isUploading) {
        setStatus("Upload already in progress.", "error");
        return;
    }

    const nextFiles = Array.from(files);
    if (!validateSelectedFiles(nextFiles)) {
        updatePendingFiles([]);
        if (clearInput) {
            photoInput.value = "";
        }
        return;
    }

    pendingFiles = nextFiles;

    try {
        await uploadSelectedFiles();
    } catch (error) {
        hideUploadProgress();
        setStatus(getErrorMessage(error, "Upload failed."), "error");
    }

    if (clearInput) {
        photoInput.value = "";
    }
}

function normalizeBearing(degrees) {
    const normalized = degrees % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function parseDirectionValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return normalizeBearing(value);
    }

    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const rationalMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*[,/]\s*(-?\d+(?:\.\d+)?)$/);
    if (rationalMatch) {
        const numerator = Number(rationalMatch[1]);
        const denominator = Number(rationalMatch[2]);
        if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
            return normalizeBearing(numerator / denominator);
        }
    }

    const directValue = Number.parseFloat(trimmed);
    if (Number.isFinite(directValue)) {
        return normalizeBearing(directValue);
    }

    return null;
}

function parseNumericMetadataValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const rationalMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*[,/]\s*(-?\d+(?:\.\d+)?)$/);
    if (rationalMatch) {
        const numerator = Number(rationalMatch[1]);
        const denominator = Number(rationalMatch[2]);
        if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
            return numerator / denominator;
        }
    }

    const directValue = Number.parseFloat(trimmed);
    return Number.isFinite(directValue) ? directValue : null;
}

function clamp(value, minValue, maxValue) {
    return Math.min(Math.max(value, minValue), maxValue);
}

function normalizeHorizontalFov(horizontalFovDegrees) {
    if (!Number.isFinite(horizontalFovDegrees)) {
        return null;
    }

    // Horizontal FOV must be between 0 and 180 degrees; values outside that are invalid.
    return clamp(horizontalFovDegrees, MIN_HORIZONTAL_FOV_DEGREES, 179.9);
}

function getPhotoDirection(metadata) {
    return parseDirectionValue(
        metadata.gps_img_direction ??
            metadata.direction_degrees ??
            metadata.gpsimgdirection ??
            metadata.gps_dest_bearing ??
            metadata.gpsdestbearing ??
            metadata.direction
    );
}

function getDirectionReferenceLabel(metadata) {
    const reference = String(
        metadata.direction_reference ??
            metadata.gps_img_direction_ref ??
            metadata.gpsimgdirectionref ??
            metadata.gps_dest_bearing_ref ??
            metadata.gpsdestbearingref ??
            ""
    )
        .trim()
        .toUpperCase();

    if (reference === "T") {
        return "True north";
    }

    if (reference === "M") {
        return "Magnetic north";
    }

    return null;
}

function getPhotoDimensions(metadata) {
    const width = parseNumericMetadataValue(metadata.image_width ?? metadata.imagewidth);
    const height = parseNumericMetadataValue(metadata.image_height ?? metadata.imageheight);

    if (!width || !height || width <= 0 || height <= 0) {
        return null;
    }

    return { width, height };
}

function calculateHorizontalFovFrom35mmEquivalent(focalLength35mm, dimensions) {
    if (!Number.isFinite(focalLength35mm) || focalLength35mm <= 0) {
        return null;
    }

    let equivalentSensorWidth = 36;
    if (dimensions) {
        const aspectRatio = dimensions.width / dimensions.height;
        const fullFrameDiagonal = Math.hypot(36, 24);
        equivalentSensorWidth =
            (fullFrameDiagonal * aspectRatio) / Math.sqrt(aspectRatio * aspectRatio + 1);
    }

    const fovRadians = 2 * Math.atan(equivalentSensorWidth / (2 * focalLength35mm));
    return (fovRadians * 180) / Math.PI;
}

function getPhotoHorizontalFov(metadata) {
    const normalizedFov = parseNumericMetadataValue(metadata.horizontal_field_of_view_degrees);
    if (normalizedFov !== null) {
        return normalizeHorizontalFov(normalizedFov) ?? DEFAULT_HORIZONTAL_FOV_DEGREES;
    }

    const focalLength35mm = parseNumericMetadataValue(
        metadata.focal_length_35mm_equivalent ??
            metadata.focal_length_in_35mm_film ??
            metadata.focallengthin35mmfilm
    );

    const calculatedFov = calculateHorizontalFovFrom35mmEquivalent(
        focalLength35mm,
        getPhotoDimensions(metadata)
    );

    if (calculatedFov === null) {
        return DEFAULT_HORIZONTAL_FOV_DEGREES;
    }

    return normalizeHorizontalFov(calculatedFov) ?? DEFAULT_HORIZONTAL_FOV_DEGREES;
}

function getViewingDistanceMeters(horizontalFovDegrees) {
    const halfAngleRadians = (horizontalFovDegrees * Math.PI) / 360;
    if (!Number.isFinite(halfAngleRadians) || halfAngleRadians <= 0) {
        return 60;
    }

    const distance = TARGET_FRAME_WIDTH_METERS / (2 * Math.tan(halfAngleRadians));
    return clamp(distance, MIN_VIEWING_DISTANCE_METERS, MAX_VIEWING_DISTANCE_METERS);
}

function destinationPoint(latitude, longitude, bearingDegrees, distanceMeters) {
    const earthRadiusMeters = 6371000;
    const angularDistance = distanceMeters / earthRadiusMeters;
    const bearingRadians = (bearingDegrees * Math.PI) / 180;
    const latitudeRadians = (latitude * Math.PI) / 180;
    const longitudeRadians = (longitude * Math.PI) / 180;

    const destinationLatitude = Math.asin(
        Math.sin(latitudeRadians) * Math.cos(angularDistance) +
            Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians)
    );

    const destinationLongitude =
        longitudeRadians +
        Math.atan2(
            Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
            Math.cos(angularDistance) -
                Math.sin(latitudeRadians) * Math.sin(destinationLatitude)
        );

    return [
        (destinationLatitude * 180) / Math.PI,
        (destinationLongitude * 180) / Math.PI,
    ];
}

function buildViewingCone(latitude, longitude, bearingDegrees, horizontalFovDegrees, distanceMeters) {
    const points = [[latitude, longitude]];
    const clampedFov = normalizeHorizontalFov(horizontalFovDegrees) ?? DEFAULT_HORIZONTAL_FOV_DEGREES;
    const startBearing = bearingDegrees - clampedFov / 2;
    const steps = 8;

    for (let step = 0; step <= steps; step += 1) {
        const currentBearing =
            startBearing + (clampedFov * step) / steps;
        points.push(
            destinationPoint(
                latitude,
                longitude,
                normalizeBearing(currentBearing),
                distanceMeters
            )
        );
    }

    points.push([latitude, longitude]);
    return points;
}

function createPhotoMarker(photo, directionDegrees) {
    const hasDirection = typeof directionDegrees === "number";

    if (!hasDirection) {
        return L.circleMarker([photo.latitude, photo.longitude], {
            radius: 7,
            color: "#134e4a",
            weight: 2,
            fillColor: "#f8fafc",
            fillOpacity: 0.95,
        });
    }

    return L.marker([photo.latitude, photo.longitude], {
        icon: L.divIcon({
            className: "photo-direction-marker-wrapper",
            html: `
                <span class="photo-direction-marker" style="--marker-rotation:${directionDegrees}deg;">
                    <span class="photo-direction-marker__arrow"></span>
                </span>
            `,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -12],
        }),
    });
}

function renderUploads(photos) {
    uploadCount.textContent = formatCountLabel(photos.length, "file");
    clearUploadsButton.disabled = photos.length === 0;

    if (!photos.length) {
        uploadList.innerHTML = '<p class="empty-state">No photos uploaded yet.</p>';
        return;
    }

    uploadList.innerHTML = photos
        .map((photo) => {
            const hasGps = typeof photo.latitude === "number" && typeof photo.longitude === "number";

            return `
                <article class="upload-row" data-photo-id="${photo.id}">
                    <button class="upload-row-preview" type="button" data-action="details" data-photo-id="${photo.id}" aria-label="Show details for ${escapeHtml(photo.original_filename)}">
                        <img class="upload-row-image" src="${encodeURI(photo.image_url)}" alt="${escapeHtml(photo.original_filename)} preview" loading="lazy">
                    </button>
                    <div class="upload-row-actions">
                        <a class="card-link-button" href="${encodeURI(photo.image_url)}" target="_blank" rel="noreferrer">Open</a>
                        <button class="card-secondary-button" type="button" data-action="center" data-photo-id="${photo.id}" ${hasGps ? "" : "disabled"}>
                            Map
                        </button>
                        <button class="card-secondary-button" type="button" data-action="details" data-photo-id="${photo.id}">Metadata</button>
                        <button
                            class="delete-photo-button"
                            type="button"
                            data-action="delete"
                            data-photo-id="${photo.id}"
                            data-photo-name="${escapeHtml(photo.original_filename)}"
                            aria-label="Delete ${escapeHtml(photo.original_filename)}"
                            title="Delete ${escapeHtml(photo.original_filename)}"
                        >
                            <svg class="delete-photo-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 12a2 2 0 0 1-2-2V8h12v11a2 2 0 0 1-2 2H8z"></path>
                            </svg>
                        </button>
                    </div>
                </article>
            `;
        })
        .join("");
}

function buildPhotoPopupMarkup(photo, metadata, directionDegrees, directionReferenceLabel, horizontalFovDegrees) {
    return `
        <strong>${escapeHtml(photo.original_filename)}</strong><br>
        ${escapeHtml(getCameraLabel(metadata))}<br>
        ${escapeHtml(getCapturedLabel(photo))}<br>
        Heading: ${escapeHtml(
            typeof directionDegrees === "number"
                ? `${Math.round(directionDegrees)}°`
                : "No direction data"
        )}<br>
        Direction reference: ${escapeHtml(directionReferenceLabel || "Unknown")}<br>
        Horizontal view: ${escapeHtml(`${Math.round(horizontalFovDegrees)}°`)}<br>
        <a href="${encodeURI(photo.image_url)}" target="_blank" rel="noreferrer">Open image</a>
    `;
}

function resetMapOverlays() {
    if (typeof map.closePopup === "function") {
        map.closePopup();
    }

    photoMarkers.eachLayer((layer) => {
        if (typeof layer.closePopup === "function") {
            layer.closePopup();
        }
        if (typeof layer.unbindPopup === "function") {
            layer.unbindPopup();
        }
    });

    photoMarkers.clearLayers();
    fieldOfViewLayer.clearLayers();
    markerByPhotoId.clear();
}

function renderPhotoMarkers(photos) {
    resetMapOverlays();

    const gpsPhotos = photos.filter(
        (photo) => typeof photo.latitude === "number" && typeof photo.longitude === "number"
    );

    if (heatMapLayer) {
        heatMapLayer.setLatLngs(
            gpsPhotos.map((photo) => [photo.latitude, photo.longitude, HEATMAP_POINT_INTENSITY])
        );
    }

    gpsPhotos.forEach((photo) => {
        const metadata = photo.metadata || {};
        const directionDegrees = getPhotoDirection(metadata);
        const directionReferenceLabel = getDirectionReferenceLabel(metadata);
        const horizontalFovDegrees = getPhotoHorizontalFov(metadata);
        const viewingDistanceMeters = getViewingDistanceMeters(horizontalFovDegrees);
        const marker = createPhotoMarker(photo, directionDegrees);

        if (typeof directionDegrees === "number") {
            L.polygon(
                buildViewingCone(
                    photo.latitude,
                    photo.longitude,
                    directionDegrees,
                    horizontalFovDegrees,
                    viewingDistanceMeters
                ),
                {
                    color: "#f97316",
                    weight: 1,
                    opacity: 0.9,
                    fillColor: "#fb923c",
                    fillOpacity: 0.2,
                    interactive: false,
                }
            ).addTo(fieldOfViewLayer);
        }

        marker.bindPopup(
            buildPhotoPopupMarkup(
                photo,
                metadata,
                directionDegrees,
                directionReferenceLabel,
                horizontalFovDegrees
            )
        );
        marker.addTo(photoMarkers);
        markerByPhotoId.set(photo.id, marker);
    });
}

function sortPhotosNewestFirst(photos) {
    return [...photos].sort((leftPhoto, rightPhoto) => {
        const leftUploadedAt = leftPhoto.uploaded_at || "";
        const rightUploadedAt = rightPhoto.uploaded_at || "";

        if (leftUploadedAt === rightUploadedAt) {
            return (rightPhoto.id || 0) - (leftPhoto.id || 0);
        }

        return rightUploadedAt.localeCompare(leftUploadedAt);
    });
}

function updateDisplayedPhotos(photos) {
    currentPhotos = sortPhotosNewestFirst(photos);
    renderUploads(currentPhotos);
    renderPhotoMarkers(currentPhotos);
}

function addUploadedPhotosToDisplay(uploadedPhotos) {
    if (!uploadedPhotos.length) {
        return;
    }

    updateDisplayedPhotos([...uploadedPhotos, ...currentPhotos]);
}

async function loadPhotos() {
    const response = await fetch("/api/photos");
    const payload = await parseApiResponse(response);
    if (!response.ok) {
        throw new Error(payload.error || "Failed to load photos");
    }

    updateDisplayedPhotos(payload.photos || []);
}

async function uploadSingleFile(file, onProgress) {
    const formData = new FormData();
    formData.append("photos", file);

    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        activeUploadRequest = request;
        request.open("POST", "/api/uploads");
        request.responseType = "text";

        request.upload.addEventListener("progress", (event) => {
            if (!event.lengthComputable) {
                return;
            }

            onProgress(event.loaded, event.total);
        });

        request.addEventListener("load", async () => {
            activeUploadRequest = null;
            const response = new Response(request.responseText, {
                status: request.status,
                statusText: request.statusText,
                headers: {
                    "content-type": request.getResponseHeader("content-type") || "",
                },
            });

            const payload = await parseApiResponse(response);
            if (request.status < 200 || request.status >= 300) {
                resolve({
                    uploadedCount: 0,
                    errors:
                        payload.errors ||
                        [{ file: file.name, error: payload.error || "Upload failed." }],
                });
                return;
            }

            resolve({
                uploadedCount: payload.uploaded?.length || 0,
                uploadedPhotos: payload.uploaded || [],
                errors: payload.errors || [],
            });
        });

        request.addEventListener("error", () => {
            activeUploadRequest = null;
            reject(new Error("Network error while uploading photo."));
        });

        request.addEventListener("abort", () => {
            activeUploadRequest = null;
            reject(new Error("Upload was interrupted."));
        });

        request.send(formData);
    });
}

async function uploadSelectedFiles() {
    const files = pendingFiles.length ? pendingFiles : Array.from(photoInput.files);
    if (isUploading) {
        setStatus("Upload already in progress.", "error");
        return;
    }

    if (!files.length) {
        setStatus("Select one or more photos first.", "error");
        return;
    }

    if (!validateSelectedFiles(files)) {
        return;
    }

    let uploadedCount = 0;
    const errors = [];
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let completedBytes = 0;

    isUploading = true;
    cancelUploadRequested = false;
    setStatus("");
    setUploadUiState(true);
    showUploadProgress();
    setUploadProgress(0, getUploadProgressLabel(0, files.length));

    try {
        for (const [index, file] of files.entries()) {
            if (cancelUploadRequested) {
                break;
            }

            let result;
            try {
                result = await uploadSingleFile(file, (loadedBytes) => {
                    const percentComplete = totalBytes
                        ? ((completedBytes + loadedBytes) / totalBytes) * 100
                        : 100;
                    setUploadProgress(
                        percentComplete,
                        getUploadProgressLabel(index + 1, files.length)
                    );
                });
            } catch (error) {
                if (
                    cancelUploadRequested &&
                    error instanceof Error &&
                    error.message === "Upload was interrupted."
                ) {
                    break;
                }
                throw error;
            }

            completedBytes += file.size;
            setUploadProgress(
                totalBytes ? (completedBytes / totalBytes) * 100 : 100,
                getUploadProgressLabel(Math.min(index + 1, files.length), files.length)
            );
            uploadedCount += result.uploadedCount;
            addUploadedPhotosToDisplay(result.uploadedPhotos || []);
            errors.push(...result.errors);
        }

        if (cancelUploadRequested) {
            setStatus(
                `Upload cancelled after ${formatCountLabel(uploadedCount, "file")}.`,
                uploadedCount ? "success" : "error"
            );
        } else if (errors.length) {
            setStatus(
                buildUploadSummaryMessage(uploadedCount, errors),
                uploadedCount ? "success" : "error"
            );
        } else {
            setTimedStatus(
                `Uploaded ${formatCountLabel(uploadedCount, "file")}.`,
                "success",
                SUCCESS_STATUS_TIMEOUT_MS
            );
        }

        updatePendingFiles([], { clearStatus: false });
        photoInput.value = "";
        hideUploadProgress();
        await loadPhotos();
    } finally {
        activeUploadRequest = null;
        cancelUploadRequested = false;
        isUploading = false;
        setUploadUiState(false);
    }
}

async function clearUploads() {
    const confirmed = window.confirm(
        "Delete all uploaded photos from the server and clear the database? This cannot be undone."
    );
    if (!confirmed) {
        return;
    }

    setStatus("Clearing uploaded photos...");

    const response = await fetch("/api/photos", {
        method: "DELETE",
    });
    const payload = await parseApiResponse(response);

    if (!response.ok) {
        throw new Error(payload.error || "Unable to clear uploaded photos.");
    }

    hideUploadProgress();
    updatePendingFiles([]);
    photoInput.value = "";
    await loadPhotos();
    setTimedStatus(
        `Cleared ${formatCountLabel(payload.deleted_records || 0, "record")} and ${formatCountLabel(payload.deleted_files || 0, "file")}.`,
        "success",
        SUCCESS_STATUS_TIMEOUT_MS
    );
}

async function deletePhoto(photoId, photoName) {
    const confirmed = window.confirm(
        `Delete ${photoName} from the server and remove its database record?`
    );
    if (!confirmed) {
        return;
    }

    setStatus(`Deleting ${photoName}...`);

    const response = await fetch(`/api/photos/${photoId}`, {
        method: "DELETE",
    });
    const payload = await parseApiResponse(response);

    if (!response.ok) {
        throw new Error(payload.error || "Unable to delete photo.");
    }

    await loadPhotos();
    if (activeDrawerPhotoId === Number(photoId)) {
        closeMetadataDrawer({ restoreFocus: false });
    }
    setTimedStatus(
        `Deleted ${payload.deleted_filename || photoName}.`,
        "success",
        SUCCESS_STATUS_TIMEOUT_MS
    );
}

uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await startUploadFromFiles(pendingFiles.length ? pendingFiles : Array.from(photoInput.files), {
        clearInput: true,
    });
});

cancelUploadButton.addEventListener("click", () => {
    if (!isUploading) {
        return;
    }

    cancelUploadRequested = true;
    cancelUploadButton.disabled = true;
    setStatus("Cancelling upload...", "error");
    if (activeUploadRequest) {
        activeUploadRequest.abort();
    }
});

clearUploadsButton.addEventListener("click", async () => {
    try {
        await clearUploads();
    } catch (error) {
        setStatus(getErrorMessage(error, "Unable to clear uploaded photos."), "error");
    }
});

uploadList.addEventListener("click", async (event) => {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) {
        return;
    }

    if (actionElement.disabled) {
        return;
    }

    const action = actionElement.dataset.action;
    const photoId = actionElement.dataset.photoId;

    if (action === "details") {
        const photo = findPhotoById(photoId);
        if (!photo) {
            setStatus("Photo not found.", "error");
            return;
        }
        openMetadataDrawer(photo, actionElement);
        return;
    }

    if (action === "center") {
        centerPhotoOnMap(photoId);
        return;
    }

    if (action !== "delete") {
        return;
    }

    actionElement.disabled = true;

    try {
        await deletePhoto(photoId, actionElement.dataset.photoName || "this photo");
    } catch (error) {
        actionElement.disabled = false;
        setStatus(getErrorMessage(error, "Unable to delete photo."), "error");
    }
});

metadataDrawerClose.addEventListener("click", () => {
    closeMetadataDrawer();
});

drawerBackdrop.addEventListener("click", () => {
    closeMetadataDrawer();
});

metadataDrawerBody.addEventListener("click", (event) => {
    const centerButton = event.target.closest("[data-drawer-center]");
    if (!centerButton) {
        return;
    }

    centerPhotoOnMap(centerButton.dataset.drawerCenter);
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !metadataDrawer.hidden) {
        closeMetadataDrawer();
    }
});

["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("is-dragover");
    });
});

["dragleave", "dragend", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("is-dragover");
    });
});

dropZone.addEventListener("drop", (event) => {
    const files = event.dataTransfer?.files;
    if (!files?.length) {
        return;
    }

    startUploadFromFiles(files);
});

photoInput.addEventListener("change", () => {
    const files = photoInput.files;
    if (!files.length) {
        updatePendingFiles([]);
        return;
    }

    startUploadFromFiles(files, { clearInput: true });
});

loadPhotos().catch(() => {
    setStatus("Unable to load existing uploads.", "error");
});

hideUploadProgress();
setUploadUiState(false);
