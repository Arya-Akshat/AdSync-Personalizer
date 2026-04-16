import dotenv from "dotenv";

dotenv.config();

const toBool = (v, fallback = false) => {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || "development",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  groqApiKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 45000),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  useMockAi: toBool(process.env.USE_MOCK_AI, false)
};
