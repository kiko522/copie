const asPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseOrigins = (value) => new Set(
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const parseCityCodes = (value) => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([city, code]) => city.trim() && /^\d{9}$/.test(String(code)))
        .map(([city, code]) => [city.trim(), String(code)]),
    );
  } catch {
    return {};
  }
};

export const loadConfig = (env = process.env) => ({
  port: asPositiveInt(env.PORT, 8787),
  backendToken: String(env.BACKEND_TOKEN ?? '').trim(),
  allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
  tavilyApiKey: String(env.TAVILY_API_KEY ?? '').trim(),
  itboyCityCodes: parseCityCodes(env.ITBOY_CITY_CODES),
  upstreamTimeoutMs: asPositiveInt(env.UPSTREAM_TIMEOUT_MS, 8_000),
  llmBaseUrl: String(env.LLM_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
  llmApiKey: String(env.LLM_API_KEY ?? '').trim(),
  heartbeatModel: String(env.HEARTBEAT_MODEL ?? '').trim(),
  trendRadarMcpUrl: String(env.TRENDRADAR_MCP_URL ?? '').trim(),
  userTimeZone: String(env.USER_TIME_ZONE ?? 'Asia/Shanghai').trim(),
  quietStart: String(env.QUIET_START ?? '02:00').trim(),
  quietEnd: String(env.QUIET_END ?? '08:30').trim(),
  maxUnansweredSends: asPositiveInt(env.MAX_UNANSWERED_SENDS, 3),
  heartbeatTickMs: asPositiveInt(env.HEARTBEAT_TICK_MS, 60_000),
  dataDir: String(env.DATA_DIR ?? './data').trim(),
});

export const validateConfig = (config) => {
  const problems = [];
  if (config.backendToken.length < 32) {
    problems.push('BACKEND_TOKEN 至少需要 32 个字符');
  }
  if (config.allowedOrigins.size === 0) {
    problems.push('ALLOWED_ORIGINS 不能为空');
  }
  if (!/^\d{2}:\d{2}$/.test(config.quietStart) || !/^\d{2}:\d{2}$/.test(config.quietEnd)) {
    problems.push('QUIET_START / QUIET_END 必须是 HH:MM');
  }
  return problems;
};
