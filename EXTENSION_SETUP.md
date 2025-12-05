# LeanIX AI Recommendations - Chrome Extension Setup

## Building the Extension

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the extension:**
   ```bash
   npm run build
   ```

3. **The built extension will be in the `dist/` folder**

## Loading in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `dist/` folder from this project
5. The extension icon should appear in your toolbar

## Using the Extension

1. Navigate to any LeanIX page (https://*.leanix.net/*)
2. Click the extension icon in your toolbar
3. Click **Generate Recommendations** to analyze the page fields
4. Review AI-powered suggestions for each field
5. Click **Apply** to copy recommendations to fields

## Development

For local development with hot reload:
```bash
npm run dev
```

Then open `http://localhost:8080` in your browser to preview the popup UI.

## Notes

- The extension requires an active connection to the backend API
- Field detection works best on LeanIX catalog/factsheet pages
- The content script automatically extracts form field data from the page
