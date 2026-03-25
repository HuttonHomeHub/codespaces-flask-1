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
const maxFilesPerUpload = Number(uploadForm.dataset.maxFiles || 100);
const maxTotalUploadBytes = Number(uploadForm.dataset.maxTotalBytes || 0);
let pendingFiles = [];

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

L.control.layers(
    {
        Satellite: satelliteLayer,
        Streets: streetLayer,
    },
    {},
    {
        collapsed: false,
        position: "topright",
    }
).addTo(map);

L.control.scale({
    imperial: false,
    metric: true,
}).addTo(map);

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

function renderUploads(photos) {
    uploadCount.textContent = `${photos.length} file${photos.length === 1 ? "" : "s"}`;

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
                        <span><strong>Camera:</strong> ${escapeHtml(metadata.make || "Unknown")} ${escapeHtml(metadata.model || "")}</span>
                        <span><strong>Captured:</strong> ${escapeHtml(metadata.date_time_original || metadata.create_date || "Unknown")}</span>
                        <span><strong>Location:</strong> ${escapeHtml(location)}</span>
                    </div>
                </article>
            `;
        })
        .join("");
}

function renderPhotoMarkers(photos) {
    photoMarkers.clearLayers();

    const gpsPhotos = photos.filter(
        (photo) => typeof photo.latitude === "number" && typeof photo.longitude === "number"
    );

    gpsPhotos.forEach((photo) => {
        const metadata = photo.metadata || {};
        const marker = L.marker([photo.latitude, photo.longitude]);
        marker.bindPopup(`
            <strong>${escapeHtml(photo.original_filename)}</strong><br>
            ${escapeHtml(metadata.make || "Unknown")} ${escapeHtml(metadata.model || "")}<br>
            ${escapeHtml(metadata.date_time_original || metadata.create_date || formatDate(photo.uploaded_at))}<br>
            <a href="${encodeURI(photo.image_url)}" target="_blank" rel="noreferrer">Open image</a>
        `);
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

    setStatus(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}...`);

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
            `Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"}. ${errors.length} failed.`,
            uploadedCount ? "success" : "error"
        );
    } else {
        setStatus(`Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"}.`, "success");
    }

    pendingFiles = [];
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

    pendingFiles = [];
    photoInput.value = "";
    await loadPhotos();
    setStatus(
        `Cleared ${payload.deleted_records || 0} record${payload.deleted_records === 1 ? "" : "s"} and ${payload.deleted_files || 0} file${payload.deleted_files === 1 ? "" : "s"}.`,
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
        setStatus(error.message, "error");
    }
});

clearUploadsButton.addEventListener("click", async () => {
    try {
        await clearUploads();
    } catch (error) {
        setStatus(error.message, "error");
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
        setStatus(error.message, "error");
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
        pendingFiles = [];
        return;
    }

    pendingFiles = nextFiles;
    setStatus(`${files.length} file${files.length === 1 ? "" : "s"} ready to upload.`);
});

photoInput.addEventListener("change", () => {
    const files = photoInput.files;
    if (!files.length) {
        pendingFiles = [];
        setStatus("");
        return;
    }

    const nextFiles = Array.from(files);
    if (!validateSelectedFiles(nextFiles)) {
        pendingFiles = [];
        photoInput.value = "";
        return;
    }

    pendingFiles = nextFiles;
    setStatus(`${files.length} file${files.length === 1 ? "" : "s"} ready to upload.`);
});

loadPhotos().catch(() => {
    setStatus("Unable to load existing uploads.", "error");
});
