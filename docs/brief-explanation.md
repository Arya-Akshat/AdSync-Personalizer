# Brief Explanation

## How the system works
The system takes two inputs: an ad creative image and a landing page URL. It first analyzes the ad creative to extract ad insights, then scrapes the landing page to collect text sections, and finally generates personalized replacements for the extracted text. After that, it renders the updated HTML so the user can compare the original and personalized versions side by side.

## Flow
1. User uploads an ad creative image and provides a landing page URL.
2. Google Gemini is used as the primary vision model for ad creative analysis.
3. Groq is used as the primary text model for generation and rewriting.
4. The scraper extracts all visible text sections from the landing page.
5. The generator rewrites the extracted text to match the ad insights.
6. The renderer applies the modifications to the page HTML.
7. The UI shows the insights, text diffs, and final preview.

## Key components / agent design
- **Frontend**: Collects inputs, triggers the pipeline, and displays insights, diffs, and the rendered page preview.
- **Backend API**: Orchestrates analyze, scrape, generate, and render steps.
- **Vision agent**: Google Gemini reads the ad creative and extracts structured ad insights.
- **Text agent**: Groq rewrites page copy in a style that matches the ad and the original section type.
- **Scraper**: Extracts page text into labeled sections so each paragraph, heading, CTA, or testimonial can be rewritten independently.
- **Renderer**: Applies the text replacements safely to the HTML.

## How we handle random changes
Random or unstable outputs are controlled by keeping the generation pipeline deterministic where possible and by filtering bad outputs before they are applied. The system also labels sections clearly so the same page structure produces consistent rewrite targets.

## How we handle broken UI
If a section cannot be matched safely in the HTML, the renderer skips that update instead of forcing a bad replacement. The app also preserves the original HTML when no valid modifications are applied, so the page does not break.

## How we handle hallucinations
The generator is instructed to rewrite existing copy only and not invent new features, claims, or sections. The system also validates the output format and rejects invalid responses before rendering them.

## How we handle inconsistent outputs
The system filters duplicate or low-quality rewrites, enforces section-specific text, and falls back to deterministic local rewrites when model output is invalid or too repetitive. This helps keep the content aligned with the ad while avoiding repeated lines across multiple sections.

## Provider split
- **Google Gemini**: primary vision analysis of the ad creative (when Gemini API key is configured).
- **Groq**: primary text rewriting for landing page sections (single generation call, then local fallback if needed).

## Notes
The demo video file `demo.mp4` is kept in the repo and is not removed.
