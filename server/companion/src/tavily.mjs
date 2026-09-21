import { fetchJson } from './http.mjs';

export const searchTavily = async (input, config) => {
  if (!config.tavilyApiKey) {
    throw Object.assign(new Error('服务器尚未配置 TAVILY_API_KEY'), { status: 503 });
  }
  const query = String(input?.query ?? '').trim();
  if (!query) throw Object.assign(new Error('query 不能为空'), { status: 400 });
  const maxResults = Math.min(8, Math.max(1, Number(input?.maxResults) || 5));
  const data = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.tavilyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
  }, config.upstreamTimeoutMs);
  return {
    query,
    results: (Array.isArray(data?.results) ? data.results : []).map((item) => ({
      title: String(item?.title ?? ''),
      url: String(item?.url ?? ''),
      content: String(item?.content ?? '').slice(0, 2_000),
      score: typeof item?.score === 'number' ? item.score : undefined,
    })),
  };
};
