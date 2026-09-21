import { fetchJson } from './http.mjs';

const WMO_ZH = {
  0: '晴', 1: '大致晴朗', 2: '局部多云', 3: '阴', 45: '雾', 48: '雾凇',
  51: '轻微毛毛雨', 53: '毛毛雨', 55: '浓密毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '小阵雨', 81: '阵雨', 82: '强阵雨',
  85: '小阵雪', 86: '强阵雪', 95: '雷阵雨', 96: '雷阵雨伴小冰雹', 99: '雷阵雨伴大冰雹',
};

const geocodeCache = new Map();

const normalizeItboy = (city, data) => {
  const current = data?.cityInfo && data?.data;
  if (!current || typeof current.wendu !== 'string') throw new Error('itboy 数据结构异常');
  const today = Array.isArray(current.forecast) ? current.forecast[0] : undefined;
  const numberFromText = (value) => {
    const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : undefined;
  };
  return {
    provider: 'itboy',
    location: data.cityInfo.city || city,
    observedAt: data.time || new Date().toISOString(),
    temperatureC: numberFromText(current.wendu),
    humidity: numberFromText(current.shidu),
    condition: today?.type || '未知',
    highC: numberFromText(today?.high),
    lowC: numberFromText(today?.low),
    airQuality: current.quality || undefined,
    stale: false,
  };
};

export const fetchItboyWeather = async (city, cityCode, timeoutMs) => {
  if (!cityCode) throw new Error(`没有配置 ${city} 的 itboy 城市代码`);
  const data = await fetchJson(
    `http://t.weather.itboy.net/api/weather/city/${encodeURIComponent(cityCode)}`,
    { headers: { Accept: 'application/json' } },
    timeoutMs,
  );
  return normalizeItboy(city, data);
};

const geocode = async (city, timeoutMs) => {
  if (geocodeCache.has(city)) return geocodeCache.get(city);
  const data = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`,
    { headers: { Accept: 'application/json' } },
    timeoutMs,
  );
  const hit = data?.results?.[0];
  if (!hit) throw new Error(`Open-Meteo 找不到城市：${city}`);
  const value = { latitude: hit.latitude, longitude: hit.longitude, name: hit.name };
  geocodeCache.set(city, value);
  return value;
};

export const fetchOpenMeteoWeather = async (city, timeoutMs) => {
  const geo = await geocode(city, timeoutMs);
  const params = new URLSearchParams({
    latitude: String(geo.latitude),
    longitude: String(geo.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '1',
    timezone: 'auto',
  });
  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, {}, timeoutMs);
  const current = data?.current;
  if (!current || typeof current.temperature_2m !== 'number') throw new Error('Open-Meteo 数据结构异常');
  return {
    provider: 'open_meteo',
    location: geo.name || city,
    observedAt: current.time || new Date().toISOString(),
    temperatureC: current.temperature_2m,
    apparentTemperatureC: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    condition: WMO_ZH[current.weather_code] || '未知',
    precipitationMm: current.precipitation,
    precipitationProbability: data.daily?.precipitation_probability_max?.[0],
    highC: data.daily?.temperature_2m_max?.[0],
    lowC: data.daily?.temperature_2m_min?.[0],
    windKph: current.wind_speed_10m,
    stale: false,
  };
};

export const fetchWeather = async (city, config) => {
  const failures = [];
  try {
    return await fetchItboyWeather(city, config.itboyCityCodes[city], config.upstreamTimeoutMs);
  } catch (error) {
    failures.push({ provider: 'itboy', message: error.message });
  }
  try {
    return await fetchOpenMeteoWeather(city, config.upstreamTimeoutMs);
  } catch (error) {
    failures.push({ provider: 'open_meteo', message: error.message });
  }
  throw Object.assign(new Error('天气来源暂时都不可用'), { status: 502, failures });
};
