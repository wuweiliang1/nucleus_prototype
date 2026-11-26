import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/$/, ''),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'nucleus-dev-secret-change-in-production',
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || 'https://switchbase.vip/v1').replace(/\/$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gemini-4-hydrogen',
    raceModel: process.env.LLM_RACE_MODEL || 'gemini-4-neon',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 240_000),
  },
};
