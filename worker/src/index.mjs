// Hoodoo API: Claude turns a scene description into a scene JSON; the key stays in the Worker, spend is capped per day and per IP.

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM, SCENE_SCHEMA } from './prompt.mjs';

const MODEL = 'claude-opus-5-5';
const PRICE_IN = 4, PRICE_OUT = 20, PRICE_CACHE = 0.2;
const ORIGINS = [/^https:\/\/([a-z0-9-]+\.)?gzowo\.fun$/, /^https:\/\/[a-z0-9-]+\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const SCHEMA_SQL = [
  'CREATE TABLE IF NOT EXISTS spend (day TEXT PRIMARY KEY, usd REAL DEFAULT 0, calls INTEGER DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS ipday (ip TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER DEFAULT 0, PRIMARY KEY (ip, day))',
];
let ready = null;
function init(env) {
  if (!ready) ready = env.DB.batch(SCHEMA_SQL.map((q) => env.DB.prepare(q))).catch((e) => { ready = null; throw e; });
  return ready;
}

const day = () => new Date().toISOString().slice(0, 10);

function cors(req) {
  const o = req.headers.get('origin') || '';
  return {
    'access-control-allow-origin': ORIGINS.some((r) => r.test(o)) ? o : 'https://hoodoo.gzowo.fun',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}

const json = (req, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...cors(req) } });

function keysOf(env) {
  return String(env.ANTHROPIC_API_KEYS || env.ANTHROPIC_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
}

function userMessage(p) {
  const prompt = String(p.prompt || '').slice(0, 1200);
  if (p.mode === 'edit' && p.current) {
    return `Mode: edit.\nCurrent scene summary:\n${JSON.stringify(p.current).slice(0, 12000)}\n${p.previous ? `Earlier request for this scene: ${JSON.stringify(String(p.previous).slice(0, 600))}\n` : ''}Change requested: ${JSON.stringify(prompt)}`;
  }
  return `Mode: new.\nDescribe-a-scene request: ${JSON.stringify(prompt)}`;
}

async function director(env, p) {
  const keys = keysOf(env);
  let last;
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < keys.length; i++) {
      const client = new Anthropic({ apiKey: keys[i], maxRetries: 1, timeout: 90000 });
      try {
        const res = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 12000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userMessage(p) }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCENE_SCHEMA } },
        });
        if (res.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined this scene. Try describing it differently.'), { code: 'refused' });
        if (res.stop_reason === 'max_tokens') throw Object.assign(new Error('The scene came out too big. Ask for fewer objects.'), { code: 'too_big' });
        const txt = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        const u = res.usage || {};
        const usd = ((u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT + (u.cache_read_input_tokens || 0) * PRICE_CACHE + (u.cache_creation_input_tokens || 0) * PRICE_IN * 1.25) / 1e6;
        return { scene: JSON.parse(txt), usd };
      } catch (e) {
        last = e;
        if (e.code) throw e;
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.RateLimitError) continue;
        if (e instanceof Anthropic.APIError && e.status >= 500) continue;
        if (e instanceof SyntaxError) throw Object.assign(new Error('The scene came out scrambled. Try again.'), { code: 'parse' });
        throw e;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw last || new Error('AI unavailable');
}

async function scene(req, env) {
  let p;
  try { p = await req.json(); } catch (e) { return json(req, { error: 'bad json' }, 400); }
  if (!String(p.prompt || '').trim()) return json(req, { error: 'Describe the scene first.' }, 400);
  if (!keysOf(env).length) return json(req, { error: 'The AI is asleep (no key on the server).', code: 'nokey' }, 503);
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const d = day();
  await init(env);
  const spent = await env.DB.prepare('SELECT usd FROM spend WHERE day = ?').bind(d).first();
  if (spent && spent.usd >= parseFloat(env.DAILY_USD || '3')) return json(req, { error: 'The scene director is out of budget for today. Come back tomorrow.', code: 'budget' }, 429);
  const mine = await env.DB.prepare('SELECT calls FROM ipday WHERE ip = ? AND day = ?').bind(ip, d).first();
  if (mine && mine.calls >= parseInt(env.CALLS_PER_IP || '40', 10)) return json(req, { error: 'That is a lot of scenes for one day. Try again tomorrow.', code: 'ip' }, 429);
  let out;
  try { out = await director(env, p); }
  catch (e) { console.error('scene failed', e.status || '', String(e.message || e).slice(0, 600)); return json(req, { error: e.code ? e.message : 'The scene director hiccuped. Try again.', code: e.code || 'ai' }, 502); }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO spend (day, usd, calls) VALUES (?, ?, 1) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd, calls = calls + 1').bind(d, out.usd),
    env.DB.prepare('INSERT INTO ipday (ip, day, calls) VALUES (?, ?, 1) ON CONFLICT(ip, day) DO UPDATE SET calls = calls + 1').bind(ip, d),
  ]);
  return json(req, { scene: out.scene, usd: +out.usd.toFixed(4) });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const origin = req.headers.get('origin');
    if (origin && !ORIGINS.some((r) => r.test(origin))) return json(req, { error: 'origin' }, 403);
    if (req.method === 'POST' && url.pathname === '/api/scene') return scene(req, env);
    if (url.pathname === '/') return json(req, { ok: true, app: 'hoodoo-api' });
    return json(req, { error: 'not found' }, 404);
  },
};
