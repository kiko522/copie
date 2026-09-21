/**
 * Pure text-processing helpers for realtime call TTS.
 *
 * Phone TTS needs different text than the chat bubbles: narration cues in
 * parentheses become pronounceable interjection tags, the model's optional
 * <语音> (voice) section is preferred as the spoken line, and provider-specific
 * pause markup is inserted (MiniMax) or stripped (everyone else — a model may
 * forge the tokens and they would be read aloud verbatim).
 *
 * No React state, no fetch, no audio side effects — pure string in/out.
 */

/** Chinese stage-direction → MiniMax interjection tag mapping. */
const NARRATION_TO_INTERJECTION: Record<string, string> = {
  '轻笑': '(chuckle)', '笑': '(laughs)', '笑声': '(laughs)', '大笑': '(laughs)',
  '叹气': '(sighs)', '叹息': '(sighs)',
  '咳嗽': '(coughs)', '咳': '(coughs)',
  '清嗓': '(clear-throat)', '清嗓子': '(clear-throat)',
  '呻吟': '(groans)', '哼': '(groans)',
  '换气': '(breath)', '呼吸': '(breath)',
  '喘气': '(pant)', '喘': '(pant)',
  '吸气': '(inhale)', '深吸一口气': '(inhale)',
  '呼气': '(exhale)',
  '倒吸气': '(gasps)', '倒吸一口气': '(gasps)',
  '吸鼻子': '(sniffs)',
  '喷鼻息': '(snorts)',
  '咂嘴': '(lip-smacking)',
  '哼唱': '(humming)',
  '嘶': '(hissing)',
  '嗯': '(emm)', '呃': '(emm)',
  '啧': '(lip-smacking)', '啧啧': '(lip-smacking)',
  '咕噜': '(groans)', '咕噜咕噜': '(groans)',
  '嘟囔': '(emm)', '嘀咕': '(emm)',
  '嘘': '(hissing)', '嘘嘘': '(hissing)',
  '哇': '(gasps)', '哇哦': '(gasps)',
  '嗷': '(groans)', '嗷嗷': '(groans)',
  '呜': '(groans)', '呜呜': '(groans)',
  '嘤': '(groans)', '嘤嘤': '(groans)',
  '噗': '(snorts)', '噗嗤': '(snorts)',
  '啊': '(gasps)',
  '唔': '(emm)',
};

/** Bare onomatopoeia → interjection tag (only words TTS cannot pronounce naturally). */
const BARE_ONOMATOPOEIA: [RegExp, string][] = [
  [/啧啧啧/g, '(lip-smacking)'],
  [/啧啧/g, '(lip-smacking)'],
  [/啧/g, '(lip-smacking)'],
  [/咕噜咕噜/g, '(groans)'],
  [/咕噜/g, '(groans)'],
  [/嘤嘤嘤/g, '(groans)'],
  [/嘤嘤/g, '(groans)'],
  [/噗嗤/g, '(snorts)'],
  [/噗/g, '(snorts)'],
  [/嘁/g, '(snorts)'],
  [/嘘—*/g, '(hissing)'],
  [/哼哼/g, '(groans)'],
];

/** Interjection tags the MiniMax engine accepts — kept, never treated as stage directions. */
const VALID_INTERJECTION_TAGS = new Set([
  'chuckle', 'laughs', 'sighs', 'coughs', 'clear-throat', 'groans',
  'breath', 'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'snorts',
  'lip-smacking', 'humming', 'hissing', 'emm',
]);

/** Map a single Chinese narration cue to an interjection tag; '' when unmappable. */
const mapNarrationCue = (cue: string): string => {
  const trimmed = cue.trim();
  if (NARRATION_TO_INTERJECTION[trimmed]) return NARRATION_TO_INTERJECTION[trimmed];
  for (const [key, tag] of Object.entries(NARRATION_TO_INTERJECTION)) {
    if (trimmed.includes(key)) return tag;
  }
  return '';
};

const applyBareOnomatopoeia = (text: string): string => {
  let result = text;
  for (const [pattern, tag] of BARE_ONOMATOPOEIA) {
    result = result.replace(pattern, tag);
  }
  return result;
};

/** Clean the inside of a <语音> tag: map cues to tags, drop unrecognized bracket text. */
export const cleanVoiceTagContent = (voiceText: string): string => {
  if (!voiceText) return '';
  let result = voiceText
    .replace(/（([^（）\n]{1,48})）/g, (_match, cue: string) => mapNarrationCue(cue))
    .replace(/\(([^)]{1,80})\)/g, (_match, inner: string) => {
      const tag = inner.trim().toLowerCase();
      if (VALID_INTERJECTION_TAGS.has(tag)) return `(${tag})`;
      return '';
    });
  result = applyBareOnomatopoeia(result);
  return result.replace(/\s+/g, ' ').trim();
};

/** Convert stage directions to interjection tags in plain reply text. */
export const convertNarrationCues = (raw: string): string => {
  if (!raw) return '';
  let result = raw
    .replace(/<[语語]音>[\s\S]*?<\/[语語]音>/g, '')
    .replace(/（([^（）\n]{1,48})）/g, (_match, cue: string) => mapNarrationCue(cue));
  result = applyBareOnomatopoeia(result);
  return result.replace(/\s+/g, ' ').trim();
};

/**
 * Insert MiniMax-native pause tags <#seconds#> for natural pacing. Values are
 * kept small: large pauses interact badly with mixed voice weights.
 * MiniMax-only syntax: other providers read it aloud as plain text.
 */
export const insertSpeechBreaks = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/[…]{1,}/g, '…<#0.15#>')
    .replace(/\.{3,}/g, '...<#0.15#>')
    .replace(/。{2,}/g, '。<#0.15#>')
    .replace(/——/g, '——<#0.1#>')
    .replace(/--/g, '--<#0.1#>')
    .replace(/([。！？])/g, '$1<#0.08#>')
    .replace(/(<#[\d.]+#>[\s]*){2,}/g, (match) => {
      const times = [...match.matchAll(/<#([\d.]+)#>/g)].map((m) => parseFloat(m[1]));
      const maxTime = Math.min(Math.max(...times), 0.2);
      return `<#${maxTime}#>`;
    })
    .trim();
};

/**
 * Strictly strip MiniMax pause tokens (<#0.08#> / <#1#>). Models sometimes
 * forge this format; every provider reads the tokens aloud unless removed.
 * Only the exact token shape is matched — other <...> markup is untouched.
 */
const stripPauseTokens = (text: string): string =>
  text.replace(/<#\d+(?:\.\d+)?#>/g, '');

/** Extract the <语音>…</语音> section (traditional 語音 accepted). */
export const extractVoiceTag = (text: string): { display: string; speech: string; voiceText: string } => {
  const match = text.match(/<[语語]音>([\s\S]*?)<\/[语語]音>/);
  if (!match) return { display: text, speech: '', voiceText: '' };
  const voiceText = match[1].trim();
  const display = text.replace(/<[语語]音>[\s\S]*?<\/[语語]音>/g, '').trim();
  return { display, speech: voiceText, voiceText };
};

/**
 * Build the final spoken text from an assistant reply: prefer the <语音>
 * section (cleaned), otherwise convert stage directions across the whole text.
 * Existing pause tokens are always stripped first (models forge them); new
 * pause tags are inserted only when provider === 'minimax' — the syntax is
 * MiniMax-specific and other engines would read it aloud.
 */
export const prepareCallTtsText = (rawAssistantText: string, options?: { provider?: string }): string => {
  const provider = options?.provider?.toLowerCase();
  const withoutPauseTokens = stripPauseTokens(rawAssistantText);
  const { speech: voiceTagText } = extractVoiceTag(withoutPauseTokens);
  const cleanedVoiceTag = voiceTagText ? cleanVoiceTagContent(voiceTagText) : '';
  const base = cleanedVoiceTag || convertNarrationCues(withoutPauseTokens);
  return provider === 'minimax' ? insertSpeechBreaks(base) : base.trim();
};

