import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
  keepAlive: true,
});

pool.on('error', (err) => {
  console.error('[Nucleus] Unexpected PG pool error:', err.message);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params);
}

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function initDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_guest BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prd_md TEXT NOT NULL DEFAULT '',
      architecture_md TEXT NOT NULL DEFAULT '',
      schema_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      files JSONB NOT NULL DEFAULT '{}'::jsonb,
      current_version INTEGER NOT NULL DEFAULT 0,
      published_slug TEXT UNIQUE,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      agent_name TEXT NOT NULL DEFAULT 'system',
      agent_title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS project_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      agent_name TEXT NOT NULL DEFAULT 'alex',
      files JSONB NOT NULL DEFAULT '{}'::jsonb,
      prd_md TEXT NOT NULL DEFAULT '',
      architecture_md TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_versions_project_id ON project_versions(project_id, version_number DESC);

    CREATE TABLE IF NOT EXISTS app_data (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      collection TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_app_data_project_col ON app_data(project_id, collection, created_at DESC);

    CREATE TABLE IF NOT EXISTS brainstorm_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      mode TEXT NOT NULL,
      participants JSONB NOT NULL,
      snapshot JSONB NOT NULL,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      round_limit INTEGER,
      round INTEGER NOT NULL DEFAULT 1,
      cursor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      stop_requested TEXT,
      error TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      lease_token TEXT,
      lease_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_brainstorm_project ON brainstorm_sessions(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS brainstorm_turns (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES brainstorm_sessions(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      participant_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, round, participant_id)
    );

    CREATE INDEX IF NOT EXISTS idx_brainstorm_turns_session ON brainstorm_turns(session_id, id);

    CREATE TABLE IF NOT EXISTS brainstorm_minutes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES brainstorm_sessions(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL,
      markdown TEXT NOT NULL,
      confirmed_at TIMESTAMPTZ,
      handoff_status TEXT,
      handoff_token TEXT,
      handoff_started_at TIMESTAMPTZ
    );
  `);
}
