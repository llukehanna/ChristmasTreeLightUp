/**
 * LAB ONLY (career-overlay-lab branch, never merged): `AGLOW_LAB=1 npm run dev` signs the page in as Luke with his real
 * runs (.superpowers/lab/games.json, a read-only production export, git-ignored), proxies the public board to
 * production, and answers every other /api call 503 so trees fall back to offline play.
 */
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const PROD = 'https://aglow.lukeghanna.com';
const DAY_MS = 86_400_000;

interface Game {
  id: string;
  finished_at: number;
  ms: number;
  turns: number | null;
  min_turns: number | null;
  source: string;
  unranked_reason: string | null;
  daily_day: number | null;
  daily_past: number;
  has_log: number;
}

function careerBody(): string {
  const raw = JSON.parse(readFileSync('.superpowers/lab/games.json', 'utf8'));
  const games: Game[] = Array.isArray(raw) ? raw[0].results : raw;
  const board = JSON.parse(readFileSync('.superpowers/lab/board-all.json', 'utf8')) as {
    rows: { id: string; rank: number; name: string; ms: number }[];
    total: number;
  };
  const mine = board.rows.filter((r) => r.name === 'Luke');
  const top = mine[0];
  const runs = games.map((g) => [
    g.id,
    g.finished_at,
    g.ms,
    g.turns,
    g.min_turns,
    (g.source === 'import' ? 1 : 0) | (g.has_log === 1 ? 2 : 0) | (g.daily_past === 1 ? 4 : 0) | (g.daily_day !== null && !g.unranked_reason ? 8 : 0),
    g.unranked_reason,
    g.daily_day === null ? null : new Date(g.daily_day * DAY_MS).toISOString().slice(0, 10),
  ]);
  return JSON.stringify({ runs, best: top ? { id: top.id, ms: top.ms, rank: top.rank } : null, inTop: mine.length, total: board.total });
}

export function labApi(): Plugin {
  return {
    name: 'aglow-lab-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();
        const send = (status: number, body: string): void => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(body);
        };
        if (req.method === 'GET' && url === '/api/me') {
          return send(200, JSON.stringify({ user: { id: 1, name: 'Luke', isAdmin: false, starHead: false, homeAlone: false } }));
        }
        if (req.method === 'GET' && url === '/api/me/career') {
          await new Promise((r) => setTimeout(r, 250));
          return send(200, careerBody());
        }
        if (req.method === 'GET' && url.startsWith('/api/board')) {
          try {
            const r = await fetch(PROD + url);
            const body = (await r.json()) as { rows?: { name: string; mine: boolean }[] };
            for (const row of body.rows ?? []) row.mine = row.name === 'Luke';
            return send(r.status, JSON.stringify(body));
          } catch {
            return send(503, '{"error":"lab"}');
          }
        }
        return send(503, '{"error":"lab"}');
      });
    },
  };
}
