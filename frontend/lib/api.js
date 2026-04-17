const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080").replace(/\/+$/, "");

const parseError = async (res) => {
  const data = await res.json().catch(() => ({}));
  throw new Error(data.error || data.details || `Request failed: ${res.status}`);
};

export const analyzeAd = async ({ imageUrl, file }) => {
  const formData = new FormData();
  if (imageUrl) formData.append("imageUrl", imageUrl);
  if (file) formData.append("image", file);

  const res = await fetch(`${API_BASE}/analyze-ad`, {
    method: "POST",
    body: formData
  });

  if (!res.ok) await parseError(res);
  return res.json();
};

export const scrapePage = async ({ url }) => {
  const res = await fetch(`${API_BASE}/scrape-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });

  if (!res.ok) await parseError(res);
  return res.json();
};

export const generatePersonalizedContent = async ({ adInsights, scrapedPage }) => {
  const res = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adInsights, scrapedPage })
  });

  if (!res.ok) await parseError(res);
  return res.json();
};

export const renderPersonalizedHtml = async ({ originalHtml, modifications }) => {
  const res = await fetch(`${API_BASE}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ originalHtml, modifications })
  });

  if (!res.ok) await parseError(res);
  return res.json();
};
