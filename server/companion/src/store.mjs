import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

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
    `);
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
    return this.db.prepare('SELECT * FROM characters WHERE next_heartbeat_at<=? ORDER BY next_heartbeat_at LIMIT ?')
      .all(now, limit).map((row) => this.#character(row));
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
    };
  }
}
