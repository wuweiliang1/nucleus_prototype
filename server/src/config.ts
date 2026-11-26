import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/$/, ''),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'nucleus-dev-secret-change-in-production',
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'deepseek-flash',
    secondaryBaseUrl: process.env.LLM_SECONDARY_BASE_URL?.replace(/\/$/, ''),
    secondaryApiKey: process.env.LLM_SECONDARY_API_KEY,
    fallbackModel: process.env.LLM_FALLBACK_MODEL || process.env.LLM_MODEL || 'deepseek-v4-pro',
    visionProvider: process.env.LLM_VISION_PROVIDER === 'primary' ? 'primary' : 'secondary',
    visionModel: process.env.LLM_VISION_MODEL || 'deepseek-flash',
    visionFallbackModel: process.env.LLM_VISION_FALLBACK_MODEL,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 240_000),
    idleTimeoutMs: Number(process.env.LLM_STREAM_IDLE_TIMEOUT_MS || 0),
  },
};
