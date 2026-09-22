export interface ParsedEmojiImportLine {
    name: string;
    url: string;
}

/**
 * 表情注入的首选格式是「名称：图片直链」。同时支持名称与 URL 直接拼接，
 * 旧版曾使用「名称--URL」，这里也继续兼容，避免已有清单失效。
 */
export const parseEmojiImportLine = (line: string): ParsedEmojiImportLine | null => {
    const value = line.trim();
    if (!value) return null;

    const preferredSeparator = value.indexOf('：');
    const legacySeparator = value.indexOf('--');
    const separatorIndex = preferredSeparator > 0 ? preferredSeparator : legacySeparator;
    const separatorLength = preferredSeparator > 0 ? 1 : 2;
    let name: string;
    let url: string;
    if (separatorIndex > 0) {
        name = value.slice(0, separatorIndex).trim();
        url = value.slice(separatorIndex + separatorLength).trim();
    } else {
        const directUrlMatch = value.match(/https?:\/\/|data:image\//i);
        const directUrlIndex = directUrlMatch?.index ?? -1;
        if (directUrlIndex <= 0) return null;
        name = value.slice(0, directUrlIndex).trim();
        url = value.slice(directUrlIndex).trim();
    }
    return name && url ? { name, url } : null;
};
