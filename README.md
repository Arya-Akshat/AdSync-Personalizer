# AI Landing Page Personalizer

A production-ready full-stack app that personalizes an existing landing page using ad-creative signal and CRO principles while preserving page structure.

## Stack

- Frontend: Next.js App Router + TailwindCSS
- Backend: Node.js + Express
- AI: OpenAI API, Gemini API, Groq API (provider fallback + heuristic safety fallback)
- Scraping: Playwright
- Parsing: Cheerio
- Storage: In-memory
- Deployment: Vercel (frontend), Render (backend)

## Features

- Upload ad creative or provide ad image URL
- Input landing page URL
- Analyze ad signal (`targetAudience`, `tone`, `valueProposition`, `keywords`)
- Scrape and structure landing page sections
- Generate constrained personalization (text-only changes)
- Safe DOM patch rendering with fallback to original HTML
- Original vs Personalized preview toggle
- Text diff panel
- Regenerate support
- API endpoint tests with mocked scraper/AI mode

## Project Structure

```bash
.
├── backend
│   ├── samples
│   │   ├── sample-ad.svg
│   │   └── sample-landing.html
│   ├── src
│   │   ├── aiClient.js
│   │   ├── app.js
│   │   ├── config.js
│   │   ├── render.js
│   │   ├── schemas.js
│   │   ├── scraper.js
│   │   ├── server.js
│   │   ├── storage.js
│   │   └── utils.js
│   └── tests
│       └── app.test.js
├── frontend
│   ├── app
│   │   ├── globals.css
│   │   ├── layout.js
│   │   └── page.js
│   ├── components
│   │   ├── DiffTable.js
│   │   ├── InsightsCard.js
│   │   └── ResultPanel.js
│   └── lib
│       └── api.js
├── .env.example
├── package.json
└── README.md
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

3. Add API keys as needed:

- `OPENAI_API_KEY` (recommended)
- `GEMINI_API_KEY` (optional)
- `GROQ_API_KEY` (optional)
- `GROQ_MODEL` (optional, default: `llama-3.3-70b-versatile`)

4. Start both apps:

```bash
npm run dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8080`

## API Endpoints

### `POST /analyze-ad`
Input:
- `multipart/form-data` with `image` file, or
- `imageUrl` field

Output:
- `insights`: `targetAudience`, `tone`, `valueProposition`, `keywords`, `confidence`

### `POST /scrape-page`
Input:
- `{ "url": "https://..." }`

Output:
- Structured page sections + raw HTML

### `POST /generate`
Input:
- `{ adInsights, scrapedPage }`

Output:
- `updatedContent` (section-level text changes)
- `patchInstructions`
- `warnings`

### `POST /render`
Input:
- `{ originalHtml, modifications }`

Output:
- `finalHtml`
- metadata about applied/skipped patches
- fallback flag when no safe patch was applied

## AI Guardrails

Prompts and validators enforce:

- Do not remove sections
- Do not invent features
- Preserve layout and DOM structure
- Text-only updates
- Strict JSON output parsing with `zod`
- Low temperature for deterministic behavior

## Edge-Case Safeguards

- Schema validation for every major AI/scrape/generate step
- Selector-based diff patching (no full-page regeneration)
- Unsafe text rejection (`<` / `>` blocked in replacements)
- Original page fallback if no valid patch applies

## Testing

Run endpoint tests:

```bash
npm test
```

Tests cover:
- `GET /health`
- `POST /analyze-ad`
- `POST /scrape-page` (mocked)
- `POST /generate`
- `POST /render`

### UI testing flow

1. Start app:

```bash
npm run dev
```

2. Open frontend URL shown in terminal (`http://localhost:3000` by default).

3. In the form:
- Enter `Landing Page URL`
- Add ad creative by URL or image upload
- Click `Generate Personalized Page`

4. Validate behavior:
- `Ad Insights` card is populated
- `Original` and `Personalized` toggle both render
- `Text Diff` shows changed copy
- If transformations fail safely, preview falls back to original HTML

### How to get all URLs quickly

1. App URLs from dev startup logs:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8080`

2. Health/provider check:

```bash
curl http://localhost:8080/health
```

3. List available backend routes by convention in this app:
- `GET /health`
- `GET /latest-run`
- `POST /analyze-ad`
- `POST /scrape-page`
- `POST /generate`
- `POST /render`

4. Full endpoint URLs (local):
- `http://localhost:8080/health`
- `http://localhost:8080/latest-run`
- `http://localhost:8080/analyze-ad`
- `http://localhost:8080/scrape-page`
- `http://localhost:8080/generate`
- `http://localhost:8080/render`

## Deployment

### Backend (Render)

- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm run start`
- Set env vars from `backend/.env.example`
- Ensure `ALLOWED_ORIGINS` includes your Vercel frontend URL

### Frontend (Vercel)

- Root directory: `frontend`
- Framework: Next.js
- Build command: `npm run build`
- Set env var:
  - `NEXT_PUBLIC_API_BASE_URL=https://<your-render-service>.onrender.com`

## Assignment Assumptions

- Ad creative analysis is approximate and dependent on visual signal quality.
- Landing page scraping may not fully capture heavily dynamic client-rendered JS.
- Personalization focuses on copy optimization, not full visual redesign.
