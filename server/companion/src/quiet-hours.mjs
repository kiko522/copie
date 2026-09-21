const minutes = (value) => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

const wallClockMinutes = (now, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
};

export const quietDelayMs = (now, timeZone, startText, endText) => {
  const current = wallClockMinutes(now, timeZone);
  const start = minutes(startText);
  const end = minutes(endText);
  const inside = start < end ? current >= start && current < end : current >= start || current < end;
  if (!inside) return 0;
  const remaining = (end - current + 24 * 60) % (24 * 60);
  return Math.max(1, remaining) * 60_000;
};
