export interface ParsedEmojiImportLine {
    name: string;
    url: string;
}

/**
 * 表情注入的首选格式是「名称：图片直链」。
 * 旧版曾使用「名称--URL」，这里继续兼容，避免已有清单失效。
 */
export const parseEmojiImportLine = (line: string): ParsedEmojiImportLine | null => {
    const value = line.trim();
    if (!value) return null;

    const preferredSeparator = value.indexOf('：');
    const legacySeparator = value.indexOf('--');
    const separatorIndex = preferredSeparator > 0 ? preferredSeparator : legacySeparator;
    const separatorLength = preferredSeparator > 0 ? 1 : 2;
    if (separatorIndex <= 0) return null;

    const name = value.slice(0, separatorIndex).trim();
    const url = value.slice(separatorIndex + separatorLength).trim();
    return name && url ? { name, url } : null;
};
