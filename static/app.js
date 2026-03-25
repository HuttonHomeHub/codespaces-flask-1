const map = L.map("map", {
    center: [54.5, -3.5],
    zoom: 6,
    zoomControl: true,
});

const uploadForm = document.getElementById("upload-form");
const photoInput = document.getElementById("photo-input");
const dropZone = document.getElementById("drop-zone");
const uploadStatus = document.getElementById("upload-status");
const uploadList = document.getElementById("upload-list");
const uploadCount = document.getElementById("upload-count");
const clearUploadsButton = document.getElementById("clear-uploads-button");
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
const DEFAULT_HORIZONTAL_FOV_DEGREES = 55;
const MIN_HORIZONTAL_FOV_DEGREES = 12;
const TARGET_FRAME_WIDTH_METERS = 90;
const MIN_VIEWING_DISTANCE_METERS = 30;
const MAX_VIEWING_DISTANCE_METERS = 250;

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
    uploadStatus.textContent = message;
    uploadStatus.className = tone ? `status-message is-${tone}` : "status-message";
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
        return { error: "Server returned an HTML error page instead of JSON." };
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

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

function getCameraLabel(metadata) {
    return [metadata.make, metadata.model].filter(Boolean).join(" ") || "Unknown";
}

function getCapturedLabel(photo) {
    return photo.metadata?.date_time_original || photo.metadata?.create_date || formatDate(photo.uploaded_at);
}

function updatePendingFiles(files) {
    pendingFiles = files;
    if (!files.length) {
        setStatus("");
        return;
    }

    setStatus(getReadyToUploadMessage(files.length));
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
            const metadata = photo.metadata || {};
            const location =
                photo.latitude !== null && photo.longitude !== null
                    ? `${photo.latitude}, ${photo.longitude}`
                    : "No GPS data";
            const camera = getCameraLabel(metadata);
            const capturedAt = metadata.date_time_original || metadata.create_date || "Unknown";

            return `
                <article class="upload-card">
                    <div class="upload-card-header">
                        <h3>${escapeHtml(photo.original_filename)}</h3>
                        <button
                            class="delete-photo-button"
                            type="button"
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
                    <div class="upload-meta">
                        <span><strong>Checksum:</strong> ${escapeHtml(photo.checksum)}</span>
                        <span><strong>Type:</strong> ${escapeHtml(metadata.file_type || "Unknown")}</span>
                        <span><strong>Size:</strong> ${escapeHtml(metadata.file_size || "Unknown")}</span>
                        <span><strong>Camera:</strong> ${escapeHtml(camera)}</span>
                        <span><strong>Captured:</strong> ${escapeHtml(capturedAt)}</span>
                        <span><strong>Location:</strong> ${escapeHtml(location)}</span>
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

function renderPhotoMarkers(photos) {
    photoMarkers.clearLayers();
    fieldOfViewLayer.clearLayers();

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
    });
}

async function loadPhotos() {
    const response = await fetch("/api/photos");
    const payload = await parseApiResponse(response);
    if (!response.ok) {
        throw new Error(payload.error || "Failed to load photos");
    }

    const photos = payload.photos || [];
    renderUploads(photos);
    renderPhotoMarkers(photos);
}

async function uploadSelectedFiles() {
    const files = pendingFiles.length ? pendingFiles : Array.from(photoInput.files);
    if (!files.length) {
        setStatus("Select one or more photos first.", "error");
        return;
    }

    if (!validateSelectedFiles(files)) {
        return;
    }

    const formData = new FormData();
    files.forEach((file) => {
        formData.append("photos", file);
    });

    setStatus(`Uploading ${formatCountLabel(files.length, "file")}...`);

    const response = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
    });
    const payload = await parseApiResponse(response);

    if (!response.ok) {
        const message = payload.error || payload.errors?.[0]?.error || "Upload failed.";
        throw new Error(message);
    }

    const uploadedCount = payload.uploaded?.length || 0;
    const errors = payload.errors || [];
    if (errors.length) {
        setStatus(
            `Uploaded ${formatCountLabel(uploadedCount, "file")}. ${errors.length} failed.`,
            uploadedCount ? "success" : "error"
        );
    } else {
        setStatus(`Uploaded ${formatCountLabel(uploadedCount, "file")}.`, "success");
    }

    updatePendingFiles([]);
    photoInput.value = "";
    await loadPhotos();
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

    updatePendingFiles([]);
    photoInput.value = "";
    await loadPhotos();
    setStatus(
        `Cleared ${formatCountLabel(payload.deleted_records || 0, "record")} and ${formatCountLabel(payload.deleted_files || 0, "file")}.`,
        "success"
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
    setStatus(`Deleted ${payload.deleted_filename || photoName}.`, "success");
}

uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        await uploadSelectedFiles();
    } catch (error) {
        setStatus(getErrorMessage(error, "Upload failed."), "error");
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
    const button = event.target.closest(".delete-photo-button");
    if (!button) {
        return;
    }

    if (button.disabled) {
        return;
    }

    button.disabled = true;

    try {
        await deletePhoto(button.dataset.photoId, button.dataset.photoName || "this photo");
    } catch (error) {
        button.disabled = false;
        setStatus(getErrorMessage(error, "Unable to delete photo."), "error");
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

    const nextFiles = Array.from(files);
    if (!validateSelectedFiles(nextFiles)) {
        updatePendingFiles([]);
        return;
    }

    updatePendingFiles(nextFiles);
});

photoInput.addEventListener("change", () => {
    const files = photoInput.files;
    if (!files.length) {
        updatePendingFiles([]);
        return;
    }

    const nextFiles = Array.from(files);
    if (!validateSelectedFiles(nextFiles)) {
        updatePendingFiles([]);
        photoInput.value = "";
        return;
    }

    updatePendingFiles(nextFiles);
});

loadPhotos().catch(() => {
    setStatus("Unable to load existing uploads.", "error");
});
