import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig, validateConfig } from './config.mjs';
import { corsHeaders, json, readJsonBody, tokenMatches } from './http.mjs';
import { searchTavily } from './tavily.mjs';
import { fetchWeather } from './weather.mjs';
import { CompanionStore } from './store.mjs';
import { HeartbeatEngine } from './heartbeat.mjs';
import { createRealtimeRoomCredentials } from './livekit-token.mjs';

export const createCompanionApp = (config = loadConfig(), store = new CompanionStore(config.dataDir)) => {
  const heartbeat = new HeartbeatEngine({ config, store });
  const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin, config.allowedOrigins);
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    if (origin && !config.allowedOrigins.has(origin)) return json(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    res.writeHead(204, cors);
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return json(res, 200, {
      ok: true,
      service: 'sully-companion-backend',
      version: '0.1.0',
      tavilyConfigured: Boolean(config.tavilyApiKey),
    }, cors);
  }

  if (origin && !config.allowedOrigins.has(origin)) {
    return json(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
  }
  if (!tokenMatches(req.headers.authorization, config.backendToken)) {
    return json(res, 401, { error: 'UNAUTHORIZED' }, cors);
  }

  try {
    if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
      return json(res, 200, {
        weather: { primary: 'itboy', fallback: 'open_meteo' },
        search: { provider: 'tavily', configured: Boolean(config.tavilyApiKey) },
        trends: { provider: 'trendradar', configured: Boolean(config.trendRadarMcpUrl) },
        heartbeat: {
          configured: Boolean(config.llmApiKey && config.heartbeatModel),
          quietHours: `${config.quietStart}-${config.quietEnd}`,
          maxUnansweredSends: config.maxUnansweredSends,
        },
        realtimeVoice: { configured: Boolean(config.livekitUrl && config.livekitApiKey && config.livekitApiSecret) },
      }, cors);
    }

    if (req.method === 'POST' && url.pathname === '/v1/realtime/token') {
      const body = await readJsonBody(req, 16 * 1024);
      return json(res, 200, createRealtimeRoomCredentials(config, {
        characterId: body.characterId,
        identity: body.identity,
      }), cors);
    }

    if (req.method === 'GET' && url.pathname === '/v1/characters') {
      const items = store.listCharacters().map((character) => ({
        id: character.id,
        name: character.snapshot.name,
        heartbeatEnabled: character.heartbeatEnabled,
        updatedAt: character.updatedAt,
        nextHeartbeatAt: character.heartbeatEnabled ? character.nextHeartbeatAt : null,
        unansweredSends: character.unansweredSends,
        recentExperiences: store.recentExperiences(character.id, 3),
      }));
      return json(res, 200, { items }, cors);
    }

    const charMatch = url.pathname.match(/^\/v1\/characters\/([^/]+)$/);
    if (req.method === 'PUT' && charMatch) {
      const id = decodeURIComponent(charMatch[1]);
      if (!id || id.length > 128) throw Object.assign(new Error('角色 ID 无效'), { status: 400 });
      const body = await readJsonBody(req, 512 * 1024);
      if (!body || typeof body !== 'object' || typeof body.name !== 'string' || !body.name.trim()) {
        throw Object.assign(new Error('角色快照至少需要非空 name'), { status: 400 });
      }
      const snapshot = {
        name: body.name.trim().slice(0, 200),
        persona: String(body.persona ?? '').slice(0, 40_000),
        interests: Array.isArray(body.interests) ? body.interests.slice(0, 100).map(String) : [],
        recentMessages: Array.isArray(body.recentMessages) ? body.recentMessages.slice(-30) : [],
        timeZone: String(body.timeZone ?? '').slice(0, 100),
      };
      return json(res, 200, store.upsertCharacter(id, snapshot), cors);
    }

    const heartbeatSettingMatch = url.pathname.match(/^\/v1\/characters\/([^/]+)\/heartbeat$/);
    if (req.method === 'PATCH' && heartbeatSettingMatch) {
      const body = await readJsonBody(req);
      if (typeof body.enabled !== 'boolean') {
        throw Object.assign(new Error('enabled 必须是布尔值'), { status: 400 });
      }
      const updated = store.setHeartbeatEnabled(decodeURIComponent(heartbeatSettingMatch[1]), body.enabled);
      if (!updated) throw Object.assign(new Error('角色不存在'), { status: 404 });
      return json(res, 200, updated, cors);
    }

    const replyMatch = url.pathname.match(/^\/v1\/characters\/([^/]+)\/user-replied$/);
    if (req.method === 'POST' && replyMatch) {
      const updated = store.userReplied(decodeURIComponent(replyMatch[1]));
      if (!updated) throw Object.assign(new Error('角色不存在'), { status: 404 });
      return json(res, 200, updated, cors);
    }

    const expMatch = url.pathname.match(/^\/v1\/characters\/([^/]+)\/experiences$/);
    if (req.method === 'GET' && expMatch) {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
      return json(res, 200, { items: store.recentExperiences(decodeURIComponent(expMatch[1]), limit) }, cors);
    }

    const heartbeatMatch = url.pathname.match(/^\/v1\/heartbeat\/([^/]+)$/);
    if (req.method === 'POST' && heartbeatMatch) {
      return json(res, 200, await heartbeat.runCharacter(decodeURIComponent(heartbeatMatch[1])), cors);
    }

    if (req.method === 'GET' && url.pathname === '/v1/outbox') {
      const charId = url.searchParams.get('charId') || undefined;
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      return json(res, 200, { items: store.listOutbox(charId, limit) }, cors);
    }

    const ackMatch = url.pathname.match(/^\/v1\/outbox\/([^/]+)\/ack$/);
    if (req.method === 'POST' && ackMatch) {
      const acked = store.ackOutbox(decodeURIComponent(ackMatch[1]));
      if (!acked) throw Object.assign(new Error('待确认消息不存在'), { status: 404 });
      return json(res, 200, { ok: true }, cors);
    }

    if (req.method === 'GET' && url.pathname === '/v1/weather') {
      const city = String(url.searchParams.get('city') ?? '').trim();
      if (!city) throw Object.assign(new Error('city 不能为空'), { status: 400 });
      return json(res, 200, await fetchWeather(city, config), cors);
    }

    if (req.method === 'POST' && url.pathname === '/v1/tools/search') {
      const body = await readJsonBody(req);
      return json(res, 200, await searchTavily(body, config), cors);
    }

    return json(res, 404, { error: 'NOT_FOUND' }, cors);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return json(res, status, {
      error: status >= 500 ? 'UPSTREAM_OR_SERVER_ERROR' : 'INVALID_REQUEST',
      message: error?.message || '未知错误',
      ...(Array.isArray(error?.failures) ? { failures: error.failures } : {}),
    }, cors);
  }
  });
  return { server, store, heartbeat };
};

export const createCompanionServer = (config = loadConfig()) => createCompanionApp(config).server;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const problems = validateConfig(config);
  if (problems.length > 0) {
    console.error(`配置错误：${problems.join('；')}`);
    process.exit(1);
  }
  const app = createCompanionApp(config);
  app.heartbeat.start();
  app.server.listen(config.port, '0.0.0.0', () => {
    console.log(`sully-companion-backend listening on :${config.port}`);
  });
  const shutdown = () => app.server.close(() => { app.heartbeat.stop(); app.store.close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
