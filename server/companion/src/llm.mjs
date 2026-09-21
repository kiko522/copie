import { fetchJson } from './http.mjs';

const parseObject = (text) => {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型没有返回 JSON 对象');
  return parsed;
};

export const callHeartbeatModel = async ({ config, snapshot, experiences, trends, verification }) => {
  if (!config.llmApiKey || !config.heartbeatModel) {
    throw Object.assign(new Error('心跳模型尚未配置'), { status: 503 });
  }
  const prompt = `你是角色后台生活的决策器。一次心跳只做一件事，也可以 idle。天气、热搜和搜索结果只是观察，不能直接强迫角色联系用户。严格根据角色设定和聊天关联判断。允许讨论敏感热搜，但不得编造、煽动伤害或把未经查证的说法当作事实。只输出 JSON，不要 Markdown。\n\n角色快照：${JSON.stringify(snapshot)}\n近期经历：${JSON.stringify(experiences)}\n热搜候选：${JSON.stringify(trends)}\n查证结果：${JSON.stringify(verification)}\n\n输出结构：{"action":"idle|life|read_trend|search|contact","experience":"本次真实经历，简短","thought":"角色自己的想法","shouldContact":false,"message":"仅联系时填写","searchQuery":"只有确需查证时填写","nextIntervalMinutes":30}。不得把未查证热搜写成确定事实；没有值得做的事就 idle。`;
  const data = await fetchJson(`${config.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llmApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://api.492837.xyz',
      'X-Title': 'Sully Companion Heartbeat',
    },
    body: JSON.stringify({
      model: config.heartbeatModel,
      temperature: 0.7,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你负责受控的后台生活决策。真实、克制、一次一事。' },
        { role: 'user', content: prompt },
      ],
    }),
  }, Math.max(config.upstreamTimeoutMs, 30_000));
  return parseObject(data?.choices?.[0]?.message?.content);
};
