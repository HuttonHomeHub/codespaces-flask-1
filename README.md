# Control Panel Map

Simple Flask app with a two-pane layout:

- Left side: drag-and-drop photo upload panel
- Right side: Leaflet map
- Default basemap: satellite imagery
- Alternate basemap: street map via Leaflet's built-in layer control
- Uploaded photos are saved on the server
- Extracted image metadata is stored in SQLite
- GPS-tagged uploads are shown on the map

## Run

```bash
.venv/bin/flask --debug run
```

If you prefer activating the virtual environment first:

```bash
source .venv/bin/activate
flask --debug run
```

Open the root route in your browser after the server starts.

## Uploads

- Supported image types: JPG, JPEG, PNG, TIFF, WEBP
- Uploads are stored in `uploads/`
- Metadata is stored in `app.db`
- Maximum upload count is 100 photos per request
- Maximum upload size is 512 MB total per request
- The browser warns the user before upload when either limit is exceeded
- Individual photos can be deleted from the panel, which removes both the file and its database record
