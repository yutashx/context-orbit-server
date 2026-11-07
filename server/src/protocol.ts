import { createHash } from 'node:crypto';
import { fromJson } from '@bufbuild/protobuf';
import type { DescMessage, MessageShape } from '@bufbuild/protobuf';
import { createValidator } from '@bufbuild/protovalidate';
import { z } from 'zod';
import { RecordContentSchema } from '@context-orbit/schema/health';
import { BatchSchema as BatchDescriptor, ReceiptSchema as ReceiptDescriptor } from './generated/receiver_pb.js';
import type { FailureReason } from './generated/receiver_pb.js';
import { LIMITS } from './generated/contract.ts';

export { RecordContentSchema } from '@context-orbit/schema/health';
export const MAX_BODY_BYTES = LIMITS.bodyBytes;
export const MAX_RECORD_BYTES = LIMITS.recordBytes;
export const MAX_RECORDS = LIMITS.records;
const validator = createValidator();

// Legacy JSON bytes and new RPC both use the same Proto descriptor and constraints.
// Zod is only an adapter here, never a second definition of Batch or Receipt.
function protoJSON<T extends DescMessage>(schema: T) {
  return z.unknown().transform((value, context): MessageShape<T> => {
    try {
      const message = fromJson(schema, z.json().parse(value));
      if (validator.validate(schema, message).kind !== 'valid') throw new Error('invalid_proto');
      return message;
    } catch {
      context.addIssue({ code: 'custom', message: 'invalid_proto_json' });
      return z.NEVER;
    }
  });
}
export const BatchSchema = protoJSON(BatchDescriptor);
export const ReceiptSchema = protoJSON(ReceiptDescriptor);
export type Batch = z.infer<typeof BatchSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type ReceiverFailureCode = Lowercase<Exclude<keyof typeof FailureReason, 'UNSPECIFIED'>>;
export class ReceiverError extends Error {
  readonly code: ReceiverFailureCode;
  readonly recordIndex: number | undefined;
  constructor(code: ReceiverFailureCode, recordIndex?: number) {
    super(code); this.code = code; this.recordIndex = recordIndex;
  }
}
export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
// Date.parse resolves to milliseconds; contract timestamps carry finer fractions.
const fraction = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/;
function timestampBefore(later: string, earlier: string): boolean {
  const a = Date.parse(earlier.replace(fraction, '')), b = Date.parse(later.replace(fraction, ''));
  const fa = earlier.match(fraction)?.[1] ?? '', fb = later.match(fraction)?.[1] ?? '';
  const length = Math.max(fa.length, fb.length);
  return b < a || (b === a && fb.padEnd(length, '0') < fa.padEnd(length, '0'));
}
export function parseBatch(bytes: Uint8Array): Batch {
  if (bytes.byteLength > MAX_BODY_BYTES) throw new ReceiverError('record_too_large');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ReceiverError('invalid_utf8'); }
  let json: unknown;
  try { json = JSON.parse(text); }
  catch { throw new ReceiverError('invalid_json'); }
  let batch: Batch;
  try { batch = fromJson(BatchDescriptor, z.json().parse(json)); }
  catch { throw new ReceiverError('invalid_envelope'); }
  // Report an individual oversized original before the generic descriptor rejection.
  if (batch.records.length <= MAX_RECORDS) for (const [index, record] of batch.records.entries()) {
    if (Buffer.byteLength(record.content) > MAX_RECORD_BYTES) throw new ReceiverError('record_too_large', index);
  }
  if (validator.validate(BatchDescriptor, batch).kind !== 'valid') throw new ReceiverError('invalid_envelope');
  const ids = new Set<string>();
  for (const [index, record] of batch.records.entries()) {
    if (ids.has(record.recordId)) throw new ReceiverError('duplicate_record_id', index);
    ids.add(record.recordId);
    let contentJSON: unknown;
    try { contentJSON = JSON.parse(record.content); }
    catch { throw new ReceiverError('invalid_record', index); }
    const parsed = RecordContentSchema.safeParse(contentJSON);
    if (!parsed.success) throw new ReceiverError('invalid_record', index);
    const content = parsed.data;
    if (content.operation === 'upsert' && 'startAt' in content && timestampBefore(content.endAt, content.startAt)) throw new ReceiverError('invalid_time_range', index);
    const details = 'quantityDetails' in content ? content.quantityDetails : undefined;
    if (details !== null && typeof details === 'object' && 'mostRecentStartAt' in details && 'mostRecentEndAt' in details
        && typeof details.mostRecentStartAt === 'string' && typeof details.mostRecentEndAt === 'string'
        && timestampBefore(details.mostRecentEndAt, details.mostRecentStartAt)) throw new ReceiverError('invalid_time_range', index);
  }
  return batch;
}
