# LeanIX AI Catalog Assistant - Chrome Extension

## Overview

AI-powered Chrome extension that provides intelligent field recommendations for LeanIX IT component cataloging. The extension monitors form fields in real-time and suggests values based on official vendor documentation.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Chrome Extension                             │
│  ┌─────────────────┐         ┌─────────────────────────────┐   │
│  │   Side Panel    │◄───────►│      Content Script         │   │
│  │  (React UI)     │         │  (DOM Field Detection)      │   │
│  └────────┬────────┘         └─────────────────────────────┘   │
└───────────┼─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Lovable Cloud                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Edge Function                               │   │
│  │  ┌─────────────┐         ┌─────────────────────────┐   │   │
│  │  │ Perplexity  │────────►│  Lovable AI Gateway     │   │   │
│  │  │ (Web Search)│         │  (Gemini 2.5 Flash)     │   │   │
│  │  └─────────────┘         └─────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | React + TypeScript + Tailwind | Extension UI |
| Build | Vite | Fast bundling |
| Backend | Lovable Cloud (Supabase) | Edge functions |
| Web Search | Perplexity API | Real-time official source lookup |
| AI Synthesis | Gemini 2.5 Flash | Structured JSON recommendations |

### Why Two AI Services?

| Service | Role | Strengths |
|---------|------|-----------|
| **Perplexity** | Web Search | Live internet access, finds current dates/URLs |
| **Gemini** | Synthesis | Structured JSON output, instruction following |

**Flow:** Perplexity finds raw data → Gemini formats it into structured recommendations

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Lazy Loading** | Fields appear one-by-one as user focuses them |
| **Name Field Anchoring** | All recommendations tied to approved component name |
| **Auto-Generate** | Recommendations generated automatically on field focus |
| **Per-Field Refresh** | Independent refresh button for each field |
| **Manual Editing** | Override AI with custom values (Enter to save, Esc to cancel) |
| **Apply to Page** | One-click apply recommendations to LeanIX form |
| **Clickable URLs** | Source URLs in reasoning are hyperlinked |
| **Start Over** | Reset entire workflow with one button |

---

## Workflow

```
1. User opens LeanIX catalog page
          ↓
2. Extension detects "Name" field
          ↓
3. Validate format: "Provider + Product + Version"
          ↓
   ┌──────┴──────┐
   │             │
 Valid       Invalid
   │             │
   ↓             ↓
Auto-approve   Generate AI
   │          suggestion
   │             │
   └──────┬──────┘
          ↓
4. User clicks other fields
          ↓
5. Auto-generate recommendations per field
          ↓
6. User reviews, edits, or applies values
          ↓
7. Click "Apply" to update LeanIX form
```

---

## Field Types & Search Strategies

| Field Type | Search Strategy | Output Format |
|------------|-----------------|---------------|
| **Active Date** | `{product} {version} release date official` | YYYY-MM-DD |
| **End of Sale Date** | `{product} {version} end of sale date` | YYYY-MM-DD |
| **End of Standard Support** | `{product} {version} end of support date` | YYYY-MM-DD |
| **URL Fields** | Reuse URL from corresponding date search | Full URL |
| **Description** | `{product} description` (no version) | Max 250 chars |
| **Provider/Category** | Extract from component name | Text |

---

## Version Matching Rules

**Critical:** The extension matches EXACT versions only.

| Component Name | Interpreted As | NOT |
|----------------|----------------|-----|
| `Product 25.10` | `25.10.0` | `25.10.100`, `25.10.300` |
| `Product 25.10.0` | `25.10.0` | `25.10.100`, `25.10.300` |
| `Product 25.10.100` | `25.10.100` | `25.10.0`, `25.10.300` |

If exact version not found → confidence drops to 0.5 with explanation.

---

## Special Handling

### Tiptap/ProseMirror Editor (Description Field)
- Detected by `.tiptap` or `.ProseMirror` classes
- Uses contenteditable manipulation for updates
- Requires special event dispatching

### LeanIX Custom Selects
Supported components:
- `lx-single-select`
- `lx-relating-fact-sheet-select`
- `lx-fact-sheet-select`
- `lx-dropdown-with-tree-view`

**Handling:** Traverse DOM to find `data-field-name`, simulate clicks, type into `.queryInput`

### Ignored Fields
- External ID
- Product ID

### Source Prioritization
1. Official vendor domain (e.g., `google.com` for Google products)
2. Fallback to general search if official source returns nothing

---

## Secrets Configuration

| Secret | Purpose |
|--------|---------|
| `PERPLEXITY_API_KEY` | Web search API access |
| `LOVABLE_API_KEY` | Auto-configured by Lovable Cloud |

---

## Installation

1. Clone repository
2. Run `npm install && npm run build`
3. Chrome → `chrome://extensions/` → Enable Developer Mode
4. Click "Load unpacked" → Select `dist` folder
5. Navigate to LeanIX catalog page
6. Click extension icon → "Open Side Panel"

---

## Development Journey

### Phase 1: Foundation
1. Project Setup - Chrome extension with React, Vite, TypeScript, Tailwind
2. Side Panel Architecture - Persistent panel for continuous monitoring
3. Content Script - DOM interaction for LeanIX form fields

### Phase 2: AI Integration
4. Lovable Cloud Setup - Supabase backend with edge functions
5. Perplexity API - Real-time web search for official info
6. Lovable AI Gateway - Gemini 2.5 Flash for synthesis

### Phase 3: Field Detection
7. Real-time Detection - `focusin` event listeners
8. LeanIX Custom Selects - Support for dropdown components
9. Tiptap Editor - Special handling for Description field
10. Field Filtering - Excluded unnecessary fields

### Phase 4: Workflow Design
11. Name Field Entry Point - Mandatory validation gate
12. Lazy Loading - Progressive field display
13. Auto-Generate on Focus - Automatic recommendations

### Phase 5: Search Optimization
14. Field-Type Specific Search - Tailored Perplexity queries
15. Official Source Prioritization - Vendor domain filtering
16. URL Caching - Reuse URLs from date searches
17. Version Matching Precision - Exact version differentiation

### Phase 6: UX Polish
18. Per-Field Refresh - Independent refresh buttons
19. Manual Editing - Override AI recommendations
20. Keyboard Shortcuts - Enter/Escape for edits
21. Clickable URLs - Hyperlinks in reasoning
22. Start Over Button - Full workflow reset

---

## File Structure

```
├── public/
│   ├── manifest.json        # Extension config
│   ├── background.js        # Service worker
│   └── content-script.js    # DOM interaction
├── src/
│   ├── components/extension/
│   │   ├── ExtensionPopup.tsx
│   │   ├── FieldCard.tsx
│   │   ├── Header.tsx
│   │   └── RecommendationList.tsx
│   ├── lib/
│   │   └── api.ts           # Supabase calls
│   └── pages/
│       └── Index.tsx
├── supabase/
│   └── functions/
│       └── generate-recommendations/
│           └── index.ts     # Edge function
└── vite.config.ts
```

---

## Data Flow

```
User clicks field
       ↓
Content Script detects field
       ↓
Sends message to Side Panel
       ↓
Side Panel calls Edge Function
       ↓
Edge Function:
  1. Perplexity searches web
  2. Gemini synthesizes results
  3. Returns JSON recommendation
       ↓
Side Panel displays recommendation
       ↓
User clicks "Apply"
       ↓
Content Script updates DOM
```
