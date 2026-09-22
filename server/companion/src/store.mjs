import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DELIVERY_MAX_PER_WINDOW, DELIVERY_MIN_INTERVAL_MS, DELIVERY_WINDOW_MS } from './delivery.mjs';

export class CompanionStore {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'companion.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        next_heartbeat_at INTEGER NOT NULL,
        backoff_level INTEGER NOT NULL DEFAULT 0,
        unanswered_sends INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        char_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS experiences_char_time ON experiences(char_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        char_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        acked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(status, created_at);
      CREATE TABLE IF NOT EXISTS delivery_intents (
        id TEXT PRIMARY KEY,
        char_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS delivery_intents_char_time ON delivery_intents(char_id, created_at DESC);
    `);
    const characterColumns = this.db.prepare('PRAGMA table_info(characters)').all();
    if (!characterColumns.some((column) => column.name === 'heartbeat_enabled')) {
      this.db.exec('ALTER TABLE characters ADD COLUMN heartbeat_enabled INTEGER NOT NULL DEFAULT 1');
    }
  }

  close() { this.db.close(); }

  upsertCharacter(id, snapshot, now = Date.now()) {
    this.db.prepare(`
      INSERT INTO characters (id, snapshot_json, updated_at, next_heartbeat_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json, updated_at=excluded.updated_at
    `).run(id, JSON.stringify(snapshot), now, now + 5 * 60_000);
    return this.getCharacter(id);
  }

  getCharacter(id) {
    const row = this.db.prepare('SELECT * FROM characters WHERE id=?').get(id);
    return row ? this.#character(row) : null;
  }

  dueCharacters(now = Date.now(), limit = 10) {
    return this.db.prepare('SELECT * FROM characters WHERE heartbeat_enabled=1 AND next_heartbeat_at<=? ORDER BY next_heartbeat_at LIMIT ?')
      .all(now, limit).map((row) => this.#character(row));
  }

  listCharacters() {
    return this.db.prepare('SELECT * FROM characters ORDER BY updated_at DESC').all().map((row) => this.#character(row));
  }

  setHeartbeatEnabled(id, enabled, now = Date.now()) {
    const result = this.db.prepare(`
      UPDATE characters
      SET heartbeat_enabled=?, next_heartbeat_at=CASE WHEN ?=1 THEN ? ELSE next_heartbeat_at END
      WHERE id=?
    `).run(enabled ? 1 : 0, enabled ? 1 : 0, now + 60_000, id);
    if (result.changes === 0) return null;
    return this.getCharacter(id);
  }

  schedule(id, nextAt, backoffLevel) {
    this.db.prepare('UPDATE characters SET next_heartbeat_at=?, backoff_level=? WHERE id=?')
      .run(nextAt, backoffLevel, id);
  }

  userReplied(id, now = Date.now()) {
    this.db.prepare('UPDATE characters SET unanswered_sends=0, backoff_level=0, next_heartbeat_at=? WHERE id=?')
      .run(now + 10 * 60_000, id);
    return this.getCharacter(id);
  }

  clearCharacterHistory(id, now = Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT snapshot_json FROM characters WHERE id=?').get(id);
      if (!row) {
        this.db.exec('ROLLBACK');
        return null;
      }
      const snapshot = JSON.parse(row.snapshot_json);
      snapshot.recentMessages = [];
      const deletedExperiences = this.db.prepare('DELETE FROM experiences WHERE char_id=?').run(id).changes;
      const deletedOutbox = this.db.prepare('DELETE FROM outbox WHERE char_id=?').run(id).changes;
      const deletedDeliveryIntents = this.db.prepare('DELETE FROM delivery_intents WHERE char_id=?').run(id).changes;
      this.db.prepare(`
        UPDATE characters
        SET snapshot_json=?, updated_at=?, next_heartbeat_at=?, backoff_level=0, unanswered_sends=0
        WHERE id=?
      `).run(JSON.stringify(snapshot), now, now + 10 * 60_000, id);
      this.db.exec('COMMIT');
      return { character: this.getCharacter(id), deletedExperiences, deletedOutbox, deletedDeliveryIntents };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  appendExperience(charId, kind, content, now = Date.now()) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO experiences (id,char_id,kind,content_json,created_at) VALUES (?,?,?,?,?)')
      .run(id, charId, kind, JSON.stringify(content), now);
    return { id, charId, kind, content, createdAt: now };
  }

  recentExperiences(charId, limit = 20) {
    return this.db.prepare('SELECT * FROM experiences WHERE char_id=? ORDER BY created_at DESC LIMIT ?')
      .all(charId, limit).map((row) => ({
        id: row.id, charId: row.char_id, kind: row.kind,
        content: JSON.parse(row.content_json), createdAt: row.created_at,
      })).reverse();
  }

  enqueue(charId, content, metadata = {}, now = Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const char = this.db.prepare('SELECT unanswered_sends FROM characters WHERE id=?').get(charId);
      if (!char) throw Object.assign(new Error('角色不存在'), { status: 404 });
      const id = randomUUID();
      this.db.prepare('INSERT INTO outbox (id,char_id,content,metadata_json,created_at) VALUES (?,?,?,?,?)')
        .run(id, charId, content, JSON.stringify(metadata), now);
      this.db.prepare('UPDATE characters SET unanswered_sends=unanswered_sends+1 WHERE id=?').run(charId);
      this.db.exec('COMMIT');
      return { id, charId, content, metadata, status: 'pending', createdAt: now };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  deliveryIntentsForCharacter(charId, since = 0) {
    return this.db.prepare('SELECT * FROM delivery_intents WHERE char_id=? AND created_at>=? ORDER BY created_at')
      .all(charId, since).map((row) => ({
        id: row.id, charId: row.char_id, status: row.status,
        createdAt: row.created_at, resolvedAt: row.resolved_at,
      }));
  }

  enqueueDeliveryIntent(charId, content, intent, now = Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const char = this.db.prepare('SELECT unanswered_sends FROM characters WHERE id=?').get(charId);
      if (!char) throw Object.assign(new Error('角色不存在'), { status: 404 });
      if (this.db.prepare("SELECT 1 FROM delivery_intents WHERE char_id=? AND status='pending' LIMIT 1").get(charId)) {
        throw Object.assign(new Error('该角色已有待客户端确认的点单意图'), { status: 409 });
      }
      const recentPlaced = this.db.prepare("SELECT resolved_at FROM delivery_intents WHERE char_id=? AND status='placed' AND resolved_at>=? ORDER BY resolved_at DESC")
        .all(charId, now - DELIVERY_WINDOW_MS);
      if (recentPlaced.length >= DELIVERY_MAX_PER_WINDOW) {
        throw Object.assign(new Error('该角色已达到滚动 24 小时点单上限'), { status: 409 });
      }
      if (recentPlaced[0] && now - recentPlaced[0].resolved_at < DELIVERY_MIN_INTERVAL_MS) {
        throw Object.assign(new Error('该角色距离上一单还不到 6 小时'), { status: 409 });
      }
      const id = randomUUID();
      const deliveryOrderIntent = { ...intent, intentId: id };
      this.db.prepare('INSERT INTO delivery_intents (id,char_id,status,created_at) VALUES (?,?,?,?)')
        .run(id, charId, 'pending', now);
      this.db.prepare('INSERT INTO outbox (id,char_id,content,metadata_json,created_at) VALUES (?,?,?,?,?)')
        .run(id, charId, content, JSON.stringify({ source: 'heartbeat', action: 'delivery_order', deliveryOrderIntent }), now);
      this.db.prepare('UPDATE characters SET unanswered_sends=unanswered_sends+1 WHERE id=?').run(charId);
      this.db.exec('COMMIT');
      return { id, charId, content, metadata: { source: 'heartbeat', action: 'delivery_order', deliveryOrderIntent }, status: 'pending', createdAt: now };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  resolveDeliveryIntent(id, status, now = Date.now()) {
    if (!['placed', 'rejected'].includes(status)) throw Object.assign(new Error('点单结果无效'), { status: 400 });
    const existing = this.db.prepare('SELECT * FROM delivery_intents WHERE id=?').get(id);
    if (!existing) return null;
    if (existing.status === 'pending') {
      this.db.prepare('UPDATE delivery_intents SET status=?, resolved_at=? WHERE id=? AND status=?')
        .run(status, now, id, 'pending');
    } else if (existing.status !== status) {
      throw Object.assign(new Error('点单意图已经以其他结果结束'), { status: 409 });
    }
    const row = this.db.prepare('SELECT * FROM delivery_intents WHERE id=?').get(id);
    return { id: row.id, charId: row.char_id, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at };
  }

  listOutbox(charId, limit = 50) {
    const where = charId ? 'WHERE status=\'pending\' AND char_id=?' : 'WHERE status=\'pending\'';
    const args = charId ? [charId, limit] : [limit];
    return this.db.prepare(`SELECT * FROM outbox ${where} ORDER BY created_at LIMIT ?`).all(...args)
      .map((row) => ({
        id: row.id, charId: row.char_id, content: row.content,
        metadata: JSON.parse(row.metadata_json), status: row.status, createdAt: row.created_at,
      }));
  }

  ackOutbox(id, now = Date.now()) {
    return this.db.prepare("UPDATE outbox SET status='acked', acked_at=? WHERE id=? AND status='pending'").run(now, id).changes > 0;
  }

  #character(row) {
    return {
      id: row.id,
      snapshot: JSON.parse(row.snapshot_json),
      updatedAt: row.updated_at,
      nextHeartbeatAt: row.next_heartbeat_at,
      backoffLevel: row.backoff_level,
      unansweredSends: row.unanswered_sends,
      heartbeatEnabled: row.heartbeat_enabled !== 0,
    };
  }
}
