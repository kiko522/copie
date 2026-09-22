import { fetchJson } from './http.mjs';

const parseObject = (text) => {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型没有返回 JSON 对象');
  return parsed;
};

export const callHeartbeatModel = async ({ config, snapshot, experiences, trends, verification, deliveryEligibility, currentTime }) => {
  if (!config.llmApiKey || !config.heartbeatModel) {
    throw Object.assign(new Error('心跳模型尚未配置'), { status: 503 });
  }
  const prompt = `你是角色后台生活的决策器。一次心跳只做一件事，也可以 idle。天气、热搜和搜索结果只是观察，不能直接强迫角色联系用户。严格根据角色设定、当前生活轨迹、今日作息/活动和聊天关联判断。允许讨论敏感热搜，但不得编造、煽动伤害或把未经查证的说法当作事实。只输出 JSON，不要 Markdown。\n\n当前绝对时间：${currentTime || new Date().toISOString()}\n角色快照：${JSON.stringify(snapshot)}\n近期经历：${JSON.stringify(experiences)}\n热搜候选：${JSON.stringify(trends)}\n查证结果：${JSON.stringify(verification)}\n自主点外卖安全闸：${JSON.stringify(deliveryEligibility)}\n\n输出结构：{"action":"idle|life|read_trend|search|contact","experience":"本次真实经历，简短","thought":"角色自己的想法","shouldContact":false,"message":"仅普通联系时填写","searchQuery":"只有确需查证时填写","deliveryOrder":null,"nextIntervalMinutes":30}。deliveryOrder 仅在安全闸 allowed=true 且真的自然时填写 {"addressId":"白名单地址ID","storeId":"目录店铺ID","items":[{"productId":"目录商品ID","quantity":1}]}。它是偶发生活动作，不是每日任务；不要机械要求早餐、午饭或晚饭，早餐倾向低于夜宵。frequency=rare 表示没有非常明确动机就不点，normal 表示自然克制地偶发，often 也只是相对主动而不是每日目标。综合角色此刻的日程活动、人设、近期经历和 deliveryAutonomy.recentWishes；该列表已经过滤“算了/别点/刚吃过”等后续取消，不得从 recentMessages 里复活更早、已取消的饮食愿望。没有强动机就保持 null。点单时不要在 message 中宣称已下单、已付款或正在配送，客户端确认前都不算成功。不得把未查证热搜写成确定事实；没有值得做的事就 idle。`;
  const data = await fetchJson(`${config.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llmApiKey}`,
      'Content-Type': 'application/json',
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
