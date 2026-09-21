import { quietDelayMs } from './quiet-hours.mjs';
import { callHeartbeatModel } from './llm.mjs';
import { searchTavily } from './tavily.mjs';
import { fetchTrendRadar } from './trendradar.mjs';

const clampMinutes = (value, fallback = 60) => Math.min(360, Math.max(15, Number(value) || fallback));
export const mayContact = (unansweredSends, limit) => unansweredSends < limit;

export class HeartbeatEngine {
  constructor({ config, store }) {
    this.config = config;
    this.store = store;
    this.running = false;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.config.heartbeatTickMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      for (const char of this.store.dueCharacters(now.getTime())) {
        await this.runCharacter(char.id, now).catch((error) => {
          this.store.appendExperience(char.id, 'heartbeat_error', { message: error.message }, now.getTime());
          this.store.schedule(char.id, now.getTime() + 60 * 60_000, Math.min(6, char.backoffLevel + 1));
        });
      }
    } finally {
      this.running = false;
    }
  }

  async runCharacter(charId, now = new Date()) {
    const char = this.store.getCharacter(charId);
    if (!char) throw Object.assign(new Error('角色不存在'), { status: 404 });
    if (!char.heartbeatEnabled) return { status: 'disabled', nextHeartbeatAt: null };
    const quietMs = quietDelayMs(now, this.config.userTimeZone, this.config.quietStart, this.config.quietEnd);
    if (quietMs > 0) {
      this.store.appendExperience(charId, 'idle', { reason: 'quiet_hours' }, now.getTime());
      this.store.schedule(charId, now.getTime() + quietMs, char.backoffLevel);
      return { status: 'quiet_hours', nextHeartbeatAt: now.getTime() + quietMs };
    }

    let trends = [];
    try { trends = await fetchTrendRadar(this.config); } catch (error) {
      this.store.appendExperience(charId, 'capability_error', { capability: 'trendradar', message: error.message }, now.getTime());
    }
    const experiences = this.store.recentExperiences(charId, 12);
    let decision = await callHeartbeatModel({ config: this.config, snapshot: char.snapshot, experiences, trends, verification: null });

    if (decision.searchQuery) {
      let verification;
      try { verification = await searchTavily({ query: decision.searchQuery, maxResults: 5 }, this.config); }
      catch (error) { verification = { error: error.message }; }
      decision = await callHeartbeatModel({ config: this.config, snapshot: char.snapshot, experiences, trends, verification });
    }

    const action = ['idle', 'life', 'read_trend', 'search', 'contact'].includes(decision.action) ? decision.action : 'idle';
    this.store.appendExperience(charId, action, {
      experience: String(decision.experience ?? '').slice(0, 2_000),
      thought: String(decision.thought ?? '').slice(0, 2_000),
    }, now.getTime());

    let contacted = false;
    const latest = this.store.getCharacter(charId);
    if (decision.shouldContact === true && String(decision.message ?? '').trim()
      && mayContact(latest.unansweredSends, this.config.maxUnansweredSends)) {
      this.store.enqueue(charId, String(decision.message).trim().slice(0, 4_000), { source: 'heartbeat', action }, now.getTime());
      contacted = true;
    } else if (decision.shouldContact === true && !mayContact(latest.unansweredSends, this.config.maxUnansweredSends)) {
      this.store.appendExperience(charId, 'contact_blocked', { reason: 'unanswered_limit', limit: this.config.maxUnansweredSends }, now.getTime());
    }

    const nextMinutes = clampMinutes(decision.nextIntervalMinutes, action === 'idle' ? 120 : 60);
    const nextLevel = contacted || action !== 'idle' ? 0 : Math.min(6, char.backoffLevel + 1);
    const adaptiveMinutes = action === 'idle' ? Math.min(360, nextMinutes * 2 ** Math.min(3, nextLevel)) : nextMinutes;
    const nextHeartbeatAt = now.getTime() + adaptiveMinutes * 60_000;
    this.store.schedule(charId, nextHeartbeatAt, nextLevel);
    return { status: contacted ? 'contact_enqueued' : action, nextHeartbeatAt };
  }
}
