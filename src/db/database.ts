import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type {
  IntentProjection,
  PaymentIntentRecord,
  PPOpsEvent,
  SettlementRecord,
} from "../domain.js";

type IntentRow = {
  id: string;
  external_reference: string;
  reference: string;
  chain_id: number;
  token_address: string;
  token_symbol: string;
  decimals: number;
  expected_amount_atomic: string;
  recipient_0zk: string;
  expires_at: number;
  descriptor_json: string;
  created_at: number;
};

type ProjectionRow = {
  intent_id: string;
  status: IntentProjection["status"];
  received_amount_atomic: string;
  pending_amount_atomic: string;
  overpayment_amount_atomic: string;
  revision: number;
  updated_at: number;
};

type SettlementRow = {
  id: string;
  chain_id: number;
  txid_version: string;
  tree: number;
  position: number;
  transaction_hash: string;
  railgun_txid: string | null;
  token_address: string;
  amount_atomic: string;
  block_number: number;
  block_timestamp: number;
  balance_bucket: string;
  raw_ppoi_json: string;
  chain_status: SettlementRecord["chainStatus"];
  poi_status: SettlementRecord["poiStatus"];
  match_status: SettlementRecord["matchStatus"];
  reference: string | null;
  intent_id: string | null;
  first_seen_at: number;
  last_seen_at: number;
  eligible_at: number | null;
};

export type OutboxRecord = {
  event: PPOpsEvent;
  payloadJson: string;
  attempts: number;
  nextAttemptAt: number;
};

export type OutboxStatus = {
  eventId: string;
  eventType: string;
  attempts: number;
  nextAttemptAt: number;
  deliveredAt?: number;
  deadLetteredAt?: number;
  lastError?: string;
};

const intentFromRow = (row: IntentRow): PaymentIntentRecord => ({
  id: row.id,
  externalReference: row.external_reference,
  reference: row.reference,
  chainId: row.chain_id,
  tokenAddress: row.token_address,
  tokenSymbol: row.token_symbol,
  decimals: row.decimals,
  expectedAmountAtomic: row.expected_amount_atomic,
  recipient0zk: row.recipient_0zk,
  expiresAt: row.expires_at,
  descriptor: JSON.parse(row.descriptor_json) as PaymentIntentRecord["descriptor"],
  createdAt: row.created_at,
});

const projectionFromRow = (row: ProjectionRow): IntentProjection => ({
  intentId: row.intent_id,
  status: row.status,
  receivedAmountAtomic: row.received_amount_atomic,
  pendingAmountAtomic: row.pending_amount_atomic,
  overpaymentAmountAtomic: row.overpayment_amount_atomic,
  revision: row.revision,
  updatedAt: row.updated_at,
});

const settlementFromRow = (row: SettlementRow): SettlementRecord => ({
  uniqueSettlementId: row.id,
  chainId: row.chain_id,
  txidVersion: row.txid_version,
  tree: row.tree,
  position: row.position,
  transactionHash: row.transaction_hash,
  ...(row.railgun_txid ? { railgunTxid: row.railgun_txid } : {}),
  tokenAddress: row.token_address,
  amountAtomic: row.amount_atomic,
  blockNumber: row.block_number,
  blockTimestamp: row.block_timestamp,
  balanceBucket: row.balance_bucket,
  rawPPOIStatuses: JSON.parse(row.raw_ppoi_json) as Record<string, string>,
  chainStatus: row.chain_status,
  poiStatus: row.poi_status,
  matchStatus: row.match_status,
  ...(row.reference ? { reference: row.reference } : {}),
  ...(row.intent_id ? { intentId: row.intent_id } : {}),
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  ...(row.eligible_at === null ? {} : { eligibleAt: row.eligible_at }),
});

export class PPOpsDatabase {
  readonly sqlite: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.sqlite = new Database(path);
    if (process.platform !== "win32") chmodSync(path, 0o600);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("synchronous = FULL");
    this.migrate();
  }

  close(): void {
    this.sqlite.close();
  }

  transaction<T>(operation: () => T): T {
    return this.sqlite.transaction(operation)();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS payment_intents (
        id TEXT PRIMARY KEY,
        external_reference TEXT NOT NULL,
        reference TEXT NOT NULL UNIQUE,
        chain_id INTEGER NOT NULL,
        token_address TEXT NOT NULL,
        token_symbol TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        expected_amount_atomic TEXT NOT NULL,
        recipient_0zk TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        descriptor_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS intent_projections (
        intent_id TEXT PRIMARY KEY REFERENCES payment_intents(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('OPEN','PARTIAL','PAID','EXPIRED','PAID_LATE')),
        received_amount_atomic TEXT NOT NULL,
        pending_amount_atomic TEXT NOT NULL,
        overpayment_amount_atomic TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS settlements (
        id TEXT PRIMARY KEY,
        chain_id INTEGER NOT NULL,
        txid_version TEXT NOT NULL,
        tree INTEGER NOT NULL,
        position INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        railgun_txid TEXT,
        token_address TEXT NOT NULL,
        amount_atomic TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        block_timestamp INTEGER NOT NULL,
        balance_bucket TEXT NOT NULL,
        raw_ppoi_json TEXT NOT NULL,
        chain_status TEXT NOT NULL CHECK(chain_status IN ('OBSERVED','CONFIRMED','FINALIZED','REVERTED')),
        poi_status TEXT NOT NULL CHECK(poi_status IN ('UNKNOWN','PENDING','SPENDABLE','BLOCKED')),
        match_status TEXT NOT NULL CHECK(match_status IN ('UNMATCHED','MATCHED','CONFLICT')),
        reference TEXT,
        intent_id TEXT REFERENCES payment_intents(id) ON DELETE SET NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        eligible_at INTEGER,
        UNIQUE(chain_id, txid_version, transaction_hash, tree, position)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS settlements_intent_id_idx ON settlements(intent_id);
      CREATE INDEX IF NOT EXISTS settlements_reference_idx ON settlements(reference);
      CREATE INDEX IF NOT EXISTS settlements_finality_idx ON settlements(chain_status, block_number);

      CREATE TABLE IF NOT EXISTS outbox_events (
        event_id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        intent_id TEXT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
        settlement_id TEXT REFERENCES settlements(id) ON DELETE SET NULL,
        payload_json TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        delivered_at INTEGER,
        dead_lettered_at INTEGER,
        last_error TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS outbox_pending_idx
        ON outbox_events(delivered_at, next_attempt_at);

      INSERT OR IGNORE INTO schema_meta(version, applied_at)
      VALUES (1, unixepoch());
    `);
    const versions = this.sqlite
      .prepare("SELECT version FROM schema_meta ORDER BY version")
      .all() as Array<{ version: number }>;
    if (versions.length !== 1 || versions[0]?.version !== 1) {
      throw new Error("Unsupported PPOps database schema version");
    }
  }

  insertIntent(intent: PaymentIntentRecord): void {
    this.sqlite
      .prepare(`
        INSERT INTO payment_intents (
          id, external_reference, reference, chain_id, token_address,
          token_symbol, decimals, expected_amount_atomic, recipient_0zk,
          expires_at, descriptor_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        intent.id,
        intent.externalReference,
        intent.reference,
        intent.chainId,
        intent.tokenAddress,
        intent.tokenSymbol,
        intent.decimals,
        intent.expectedAmountAtomic,
        intent.recipient0zk,
        intent.expiresAt,
        JSON.stringify(intent.descriptor),
        intent.createdAt,
      );
    this.sqlite
      .prepare(`
        INSERT INTO intent_projections (
          intent_id, status, received_amount_atomic, pending_amount_atomic,
          overpayment_amount_atomic, revision, updated_at
        ) VALUES (?, 'OPEN', '0', '0', '0', 0, ?)
      `)
      .run(intent.id, intent.createdAt);
  }

  getIntent(id: string): PaymentIntentRecord | undefined {
    const row = this.sqlite
      .prepare("SELECT * FROM payment_intents WHERE id = ?")
      .get(id) as IntentRow | undefined;
    return row ? intentFromRow(row) : undefined;
  }

  findIntentByReference(reference: string): PaymentIntentRecord | undefined {
    const row = this.sqlite
      .prepare("SELECT * FROM payment_intents WHERE reference = ?")
      .get(reference) as IntentRow | undefined;
    return row ? intentFromRow(row) : undefined;
  }

  listIntents(limit = 100, offset = 0): PaymentIntentRecord[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM payment_intents ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as IntentRow[];
    return rows.map(intentFromRow);
  }

  getProjection(intentId: string): IntentProjection | undefined {
    const row = this.sqlite
      .prepare("SELECT * FROM intent_projections WHERE intent_id = ?")
      .get(intentId) as ProjectionRow | undefined;
    return row ? projectionFromRow(row) : undefined;
  }

  updateProjection(projection: IntentProjection): void {
    this.sqlite
      .prepare(`
        UPDATE intent_projections
        SET status = ?, received_amount_atomic = ?, pending_amount_atomic = ?,
            overpayment_amount_atomic = ?, revision = ?, updated_at = ?
        WHERE intent_id = ?
      `)
      .run(
        projection.status,
        projection.receivedAmountAtomic,
        projection.pendingAmountAtomic,
        projection.overpaymentAmountAtomic,
        projection.revision,
        projection.updatedAt,
        projection.intentId,
      );
  }

  upsertSettlement(settlement: SettlementRecord): SettlementRecord {
    this.sqlite
      .prepare(`
        INSERT INTO settlements (
          id, chain_id, txid_version, tree, position, transaction_hash,
          railgun_txid, token_address, amount_atomic, block_number,
          block_timestamp, balance_bucket, raw_ppoi_json, chain_status,
          poi_status, match_status, reference, intent_id, first_seen_at,
          last_seen_at, eligible_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          railgun_txid = excluded.railgun_txid,
          block_number = excluded.block_number,
          block_timestamp = excluded.block_timestamp,
          balance_bucket = excluded.balance_bucket,
          raw_ppoi_json = excluded.raw_ppoi_json,
          chain_status = excluded.chain_status,
          poi_status = excluded.poi_status,
          match_status = excluded.match_status,
          reference = excluded.reference,
          intent_id = excluded.intent_id,
          last_seen_at = excluded.last_seen_at,
          eligible_at = COALESCE(settlements.eligible_at, excluded.eligible_at)
      `)
      .run(
        settlement.uniqueSettlementId,
        settlement.chainId,
        settlement.txidVersion,
        settlement.tree,
        settlement.position,
        settlement.transactionHash,
        settlement.railgunTxid ?? null,
        settlement.tokenAddress,
        settlement.amountAtomic,
        settlement.blockNumber,
        settlement.blockTimestamp,
        settlement.balanceBucket,
        JSON.stringify(settlement.rawPPOIStatuses),
        settlement.chainStatus,
        settlement.poiStatus,
        settlement.matchStatus,
        settlement.reference ?? null,
        settlement.intentId ?? null,
        settlement.firstSeenAt,
        settlement.lastSeenAt,
        settlement.eligibleAt ?? null,
      );
    const stored = this.getSettlement(settlement.uniqueSettlementId);
    if (!stored) throw new Error("Settlement disappeared after upsert");
    return stored;
  }

  getSettlement(id: string): SettlementRecord | undefined {
    const row = this.sqlite
      .prepare("SELECT * FROM settlements WHERE id = ?")
      .get(id) as SettlementRow | undefined;
    return row ? settlementFromRow(row) : undefined;
  }

  listSettlementsForIntent(intentId: string): SettlementRecord[] {
    const rows = this.sqlite
      .prepare(
        "SELECT * FROM settlements WHERE intent_id = ? ORDER BY block_number, tree, position",
      )
      .all(intentId) as SettlementRow[];
    return rows.map(settlementFromRow);
  }

  listSettlements(limit = 100, offset = 0): SettlementRecord[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM settlements ORDER BY first_seen_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as SettlementRow[];
    return rows.map(settlementFromRow);
  }

  listNonFinalizedSettlements(): SettlementRecord[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM settlements WHERE chain_status != 'FINALIZED'")
      .all() as SettlementRow[];
    return rows.map(settlementFromRow);
  }

  insertEvent(event: PPOpsEvent, dedupeKey: string): boolean {
    const result = this.sqlite
      .prepare(`
        INSERT OR IGNORE INTO outbox_events (
          event_id, dedupe_key, event_type, intent_id, settlement_id,
          payload_json, occurred_at, next_attempt_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.eventId,
        dedupeKey,
        event.type,
        event.intentId,
        event.settlementId ?? null,
        JSON.stringify(event),
        event.occurredAt,
        event.occurredAt,
      );
    return result.changes === 1;
  }

  listPendingEvents(now: number, limit = 25): OutboxRecord[] {
    const rows = this.sqlite
      .prepare(`
        SELECT payload_json, attempts, next_attempt_at
        FROM outbox_events
        WHERE delivered_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= ?
        ORDER BY occurred_at, rowid
        LIMIT ?
      `)
      .all(now, limit) as Array<{
      payload_json: string;
      attempts: number;
      next_attempt_at: number;
    }>;
    return rows.map((row) => ({
      event: JSON.parse(row.payload_json) as PPOpsEvent,
      payloadJson: row.payload_json,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
    }));
  }

  markEventDelivered(eventId: string, deliveredAt: number): void {
    this.sqlite
      .prepare(
        "UPDATE outbox_events SET delivered_at = ?, attempts = attempts + 1, last_error = NULL WHERE event_id = ?",
      )
      .run(deliveredAt, eventId);
  }

  markEventFailed(eventId: string, nextAttemptAt: number, error: string): void {
    this.sqlite
      .prepare(`
        UPDATE outbox_events
        SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?
        WHERE event_id = ?
      `)
      .run(nextAttemptAt, error.slice(0, 500), eventId);
  }

  markEventDeadLettered(eventId: string, failedAt: number, error: string): void {
    this.sqlite
      .prepare(`
        UPDATE outbox_events
        SET attempts = attempts + 1, dead_lettered_at = ?, last_error = ?
        WHERE event_id = ?
      `)
      .run(failedAt, error.slice(0, 500), eventId);
  }

  countUndeliveredEvents(): number {
    const row = this.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM outbox_events WHERE delivered_at IS NULL AND dead_lettered_at IS NULL",
      )
      .get() as { count: number };
    return row.count;
  }

  listEvents(limit = 100, offset = 0): PPOpsEvent[] {
    const rows = this.sqlite
      .prepare(
        "SELECT payload_json FROM outbox_events ORDER BY occurred_at, rowid LIMIT ? OFFSET ?",
      )
      .all(limit, offset) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as PPOpsEvent);
  }

  listOutboxStatus(limit = 100, offset = 0): OutboxStatus[] {
    const rows = this.sqlite
      .prepare(`
        SELECT event_id, event_type, attempts, next_attempt_at,
               delivered_at, dead_lettered_at, last_error
        FROM outbox_events
        ORDER BY occurred_at, rowid
        LIMIT ? OFFSET ?
      `)
      .all(limit, offset) as Array<{
      event_id: string;
      event_type: string;
      attempts: number;
      next_attempt_at: number;
      delivered_at: number | null;
      dead_lettered_at: number | null;
      last_error: string | null;
    }>;
    return rows.map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      ...(row.delivered_at === null ? {} : { deliveredAt: row.delivered_at }),
      ...(row.dead_lettered_at === null
        ? {}
        : { deadLetteredAt: row.dead_lettered_at }),
      ...(row.last_error === null ? {} : { lastError: row.last_error }),
    }));
  }
}
