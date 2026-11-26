import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { initDatabase, query } from './db.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { brainstormRouter } from './routes/brainstorm.js';
import { cloudDbRouter } from './routes/cloudDb.js';
import { projectsRouter } from './routes/projects.js';
import { buildRunnableHtml } from './runtime/bundler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/healthz', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', service: 'nucleus', model: config.llm.model });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err instanceof Error ? err.message : 'db error' });
  }
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/projects', chatRouter);
app.use('/api/projects/:id/brainstorms', brainstormRouter);
app.use('/api/runtime', cloudDbRouter);

// Published Apps public hosting: /p/:slug
app.get('/p/:slug', async (req, res) => {
  try {
    const result = await query<{ id: string; files: Record<string, string> }>(
      'SELECT id, files FROM projects WHERE published_slug = $1 AND is_public = TRUE',
      [req.params.slug]
    );
    if (result.rows.length === 0) {
      res.status(404).send('<h1>404 - Nucleus App Not Found</h1>');
      return;
    }
    const { id, files } = result.rows[0];
    const html = buildRunnableHtml({
      projectId: id,
      files: files || {},
      apiOrigin: '',
      enableInspector: false,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<h1>Error loading app</h1><pre>${err instanceof Error ? err.message : ''}</pre>`);
  }
});

// Serve built frontend in production
const webDistDir = path.resolve(__dirname, '../../web/dist');
app.use(express.static(webDistDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/p/')) {
    next();
    return;
  }
  res.sendFile(path.join(webDistDir, 'index.html'), (err) => {
    if (err) {
      res.status(404).json({ error: 'Frontend not built yet. Run npm run build.' });
    }
  });
});

async function start() {
  await initDatabase();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[Nucleus] Server listening on http://0.0.0.0:${config.port} (model=${config.llm.model})`);
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 65_000;
  process.once('SIGTERM', () => {
    // Stop accepting new traffic and let active SSE responses finish.
    setTimeout(() => process.exit(0), 115_000).unref();
    server.close(() => process.exit(0));
  });
}

start().catch((err) => {
  console.error('[Nucleus] Fatal startup error:', err);
  process.exit(1);
});
