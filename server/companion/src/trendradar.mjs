import { randomUUID } from 'node:crypto';

const parseMcpBody = async (response) => {
  const text = await response.text();
  if (!response.ok) throw new Error(`TrendRadar MCP HTTP ${response.status}`);
  if (!text.trim()) return null;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data:'));
    if (!dataLine) throw new Error('TrendRadar MCP 返回空 SSE');
    return JSON.parse(dataLine.slice(5).trim());
  }
  return JSON.parse(text);
};

const mcpPost = async (url, body, timeoutMs, sessionId) => {
  const response = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  return { payload: await parseMcpBody(response), sessionId: response.headers.get('mcp-session-id') || sessionId };
};

const flatten = (value, output = []) => {
  if (output.length >= 30) return output;
  if (Array.isArray(value)) value.forEach((item) => flatten(item, output));
  else if (value && typeof value === 'object') {
    if (typeof value.title === 'string') {
      output.push({ title: value.title, source: value.platform || value.source, url: value.url, rank: value.rank });
    } else Object.values(value).forEach((item) => flatten(item, output));
  }
  return output;
};

export const fetchTrendRadar = async (config) => {
  if (!config.trendRadarMcpUrl) return [];
  const init = await mcpPost(config.trendRadarMcpUrl, {
    jsonrpc: '2.0', id: randomUUID(), method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sully-companion', version: '0.1.0' } },
  }, config.upstreamTimeoutMs);
  const sessionId = init.sessionId;
  await mcpPost(config.trendRadarMcpUrl, {
    jsonrpc: '2.0', method: 'notifications/initialized', params: {},
  }, config.upstreamTimeoutMs, sessionId);
  const called = await mcpPost(config.trendRadarMcpUrl, {
    jsonrpc: '2.0', id: randomUUID(), method: 'tools/call',
    params: { name: 'get_latest_news', arguments: {} },
  }, config.upstreamTimeoutMs, sessionId);
  const content = called.payload?.result?.content ?? [];
  const values = content.map((part) => {
    if (part?.type !== 'text') return null;
    try { return JSON.parse(part.text); } catch { return { title: part.text }; }
  }).filter(Boolean);
  return flatten(values).slice(0, 30);
};
