import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { toJsonString } from '@bufbuild/protobuf';
import { ReceiptSchema as ReceiptDescriptor } from './generated/receiver_pb.js';
import { parseBatch, ReceiptSchema, ReceiverError, sha256, type Receipt } from './protocol.ts';

const APPLICATION_ID = 1129271888;
export class ReceiverStore {
  private readonly db: DatabaseSync;
  readonly serverId: string;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout=2000');
      const identity = z.object({ application_id: z.number() }).parse(this.db.prepare('PRAGMA application_id').get());
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      if (identity.application_id !== APPLICATION_ID && tables.length !== 0) throw new Error('foreign_database');
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const version = z.object({ user_version: z.number() }).parse(this.db.prepare('PRAGMA user_version').get());
        if (version.user_version === 0 && tables.length === 0) {
          this.db.exec(readFileSync(new URL('../migrations/001.sql', import.meta.url), 'utf8'));
          this.db.prepare('INSERT INTO server_identity (singleton, server_id) VALUES (1, ?)').run(randomUUID());
          this.db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1`);
        } else if (version.user_version !== 1 || identity.application_id !== APPLICATION_ID) {
          throw new Error('unsupported_database');
        }
        this.db.exec('COMMIT');
      } catch (error) {
        // SQLite may have already rolled back after errors like SQLITE_FULL;
        // a failed ROLLBACK must not replace the original error.
        try { this.db.exec('ROLLBACK'); } catch { /* keep original error */ }
        throw error;
      }
      this.serverId = z.object({ server_id: z.uuid() }).parse(this.db.prepare('SELECT server_id FROM server_identity WHERE singleton=1').get()).server_id;
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  ingest(bytes: Uint8Array, now = new Date()): Receipt {
    const batch = parseBatch(bytes);
    if (batch.serverId !== this.serverId) throw new ReceiverError('wrong_server');
    const requestHash = sha256(bytes);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT request_hash, receipt_json FROM batches WHERE installation_id=? AND batch_id=?').get(batch.installationId, batch.batchId);
      if (prior !== undefined) {
        const stored = z.object({ request_hash: z.string(), receipt_json: z.string() }).parse(prior);
        if (stored.request_hash !== requestHash) throw new ReceiverError('identity_conflict');
        const receipt = ReceiptSchema.parse(JSON.parse(stored.receipt_json));
        this.db.exec('COMMIT');
        return receipt;
      }
      const storedAt = now.toISOString();
      const records = batch.records.map(record => {
        const contentHash = sha256(record.content);
        const row = this.db.prepare('SELECT content_hash, content_json FROM records WHERE installation_id=? AND record_id=?').get(batch.installationId, record.recordId);
        if (row !== undefined) {
          const priorRecord = z.object({ content_hash: z.string(), content_json: z.string() }).parse(row);
          if (priorRecord.content_hash !== contentHash || priorRecord.content_json !== record.content) throw new ReceiverError('identity_conflict');
        } else {
          this.db.prepare('INSERT INTO records (installation_id, record_id, content_hash, content_json, stored_at) VALUES (?, ?, ?, ?, ?)')
            .run(batch.installationId, record.recordId, contentHash, record.content, storedAt);
        }
        return { recordId: record.recordId, contentHash };
      });
      const receipt = ReceiptSchema.parse({ protocolVersion: 1, serverId: this.serverId,
        installationId: batch.installationId, batchId: batch.batchId, requestHash, storedAt, records });
      this.db.prepare('INSERT INTO batches (installation_id, batch_id, request_hash, request_body, receipt_json) VALUES (?, ?, ?, ?, ?)')
        .run(batch.installationId, batch.batchId, requestHash, bytes, toJsonString(ReceiptDescriptor, receipt));
      this.db.exec('COMMIT');
      return receipt;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* keep original error */ }
      throw error;
    }
  }

  assertReady(): void {
    const identity = z.object({ server_id: z.uuid() }).safeParse(this.db.prepare('SELECT server_id FROM server_identity WHERE singleton=1').get());
    if (!identity.success || identity.data.server_id !== this.serverId) throw new ReceiverError('storage_corrupt');
  }
  ready(): boolean {
    try { this.assertReady(); return true; } catch { return false; }
  }
  close(): void { this.db.close(); }
}
