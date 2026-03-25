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

## Verify

```bash
.venv/bin/python -m unittest discover -s tests
```

## Uploads

- Supported image types: JPG, JPEG, PNG, TIFF, WEBP
- Uploads are stored in `uploads/`
- Metadata is stored in `app.db`
- Maximum upload count is 100 photos per request
- Maximum upload size is 512 MB total per request
- The browser warns the user before upload when either limit is exceeded
- Dropping or selecting photos starts uploading automatically
- Multiple selected photos are uploaded one at a time behind the scenes to avoid large single-request payloads
- The upload panel shows a percentage progress bar while the queued files are being sent
- An in-progress upload queue can be cancelled from the upload panel
- Individual photos can be deleted from the panel, which removes both the file and its database record
- Clear All Uploads removes tracked uploaded photos and their database records

## Notes

- Storage paths are configured in the Flask app config, which keeps the app easier to test without touching the default uploads directory or database.
