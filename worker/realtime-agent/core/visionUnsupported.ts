// ==================== vision-unsupported error detection (shared) ====================
//
// The single "provider explicitly rejected image input" predicate.
//
// Only downgrade to non-vision behavior when the provider error *explicitly*
// says image/vision/multimodal input is not accepted. Generic failures (429,
// 5xx, network timeouts, ordinary parameter errors) never trigger a downgrade
// and are surfaced as-is, to avoid silent duplicate billing paths.
//
// Deliberately conservative: no broad `includes('unsupported')` matching —
// only full phrases clearly tied to unavailable image input, and the HTTP
// status must be 4xx (excluding 408/429) or unknown (local error objects).
// 5xx never matches.

const VISION_UNSUPPORTED_PATTERNS: readonly string[] = [
  // English provider / gateway messages
  'not support image',
  'not support vision',
  'not support multimodal',
  'image input is not supported',
  'images are not supported',
  'image is not supported',
  'image not supported',
  'image_url is not supported',
  'unsupported image',
  'unsupported content block',
  'vision not supported',
  'multimodal not supported',
  // Common Chinese gateway messages
  '不支持图片输入',
  '不支持图片',
  '不支持视觉',
  '不支持多模态',
];

export function isVisionUnsupportedError(error: {
  status?: number;
  body?: string;
  message?: string;
  type?: string;
  code?: string;
}): boolean {
  const { status } = error;
  if (typeof status === 'number' && (status < 400 || status >= 500 || status === 429 || status === 408)) {
    return false;
  }
  const text = [error.type, error.code, error.message, error.body]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .toLowerCase();
  if (!text) return false;
  return VISION_UNSUPPORTED_PATTERNS.some((pattern) => text.includes(pattern));
}

