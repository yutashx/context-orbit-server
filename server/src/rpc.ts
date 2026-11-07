import { timingSafeEqual, randomUUID } from 'node:crypto';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { connectNodeAdapter, compressionGzip } from '@connectrpc/connect-node';
import { createValidator } from '@bufbuild/protovalidate';
import { createValidateInterceptor } from '@connectrpc/validate';
import { z } from 'zod';
import { Receiver, FailureReason, FailureDetailSchema } from './generated/receiver_pb.js';
import type { ContractIdentity, FailureDetail } from './generated/receiver_pb.js';
import { CONTRACT, LIMITS, FAILURE_POLICIES } from './generated/contract.ts';
import { ReceiverError } from './protocol.ts';
import type { ReceiverStore } from './store.ts';

export function failure(reason: FailureReason, recordIndex?: number): ConnectError {
  const known = reason === FailureReason.UNSPECIFIED ? FailureReason.INTERNAL : reason;
  const policy = FAILURE_POLICIES[known];
  const detail = create(FailureDetailSchema, { reason: known, requestId: randomUUID(),
    ...(recordIndex === undefined ? {} : { recordIndex }), ...(policy.retry ? { retryAfterSeconds: 30 } : {}) });
  return new ConnectError(policy.title, policy.code, {}, [{ desc: FailureDetailSchema, value: detail }]);
}
function assertContract(contract: ContractIdentity | undefined): void {
  if (!contract) throw failure(FailureReason.CLIENT_UPDATE_REQUIRED);
  if (contract.revision < CONTRACT.revision) throw failure(FailureReason.CLIENT_UPDATE_REQUIRED);
  if (contract.revision > CONTRACT.revision) throw failure(FailureReason.SERVER_UPDATE_REQUIRED);
  if (contract.schemaHash !== CONTRACT.schemaHash) throw failure(FailureReason.CONTRACT_MISMATCH);
}
export type RpcFailureDiagnostic = Readonly<Pick<FailureDetail, 'requestId' | 'recordIndex'> & {
  event: 'receiver_rpc_failure'; method: string; reason: string; sqlitePrimaryCode?: number;
}>;
function sqlitePrimaryCode(error: unknown): number | undefined {
  const parsed = z.object({ errcode: z.number().int().min(0).max(2_147_483_647) }).safeParse(error);
  return parsed.success ? parsed.data.errcode & 255 : undefined;
}
function rpcFailure(error: unknown): ConnectError {
  if (error instanceof ConnectError) {
    if (error.findDetails(FailureDetailSchema).length > 0) return error;
    if (error.code === Code.InvalidArgument) return failure(FailureReason.INVALID_ENVELOPE);
    if (error.code === Code.DeadlineExceeded) return failure(FailureReason.REQUEST_TIMEOUT);
    return failure(FailureReason.INTERNAL);
  }
  return storageFailure(error);
}
export function storageFailure(error: unknown): ConnectError {
  if (error instanceof ReceiverError) {
    for (const reason of Object.values(FailureReason)) {
      if (typeof reason === 'number' && FailureReason[reason]?.toLowerCase() === error.code) return failure(reason, error.recordIndex);
    }
  }
  switch (sqlitePrimaryCode(error)) {
    case 5: case 6: return failure(FailureReason.STORAGE_BUSY);
    case 13: return failure(FailureReason.STORAGE_FULL);
    case 8: case 14: return failure(FailureReason.STORAGE_ACCESS);
    case 11: case 26: return failure(FailureReason.STORAGE_CORRUPT);
  }
  return failure(FailureReason.INTERNAL);
}
export function createRpcHandler(store: ReceiverStore, token: string, onFailure?: (entry: RpcFailureDiagnostic) => void) {
  const validator = createValidator();
  let active = 0;
  const expected = Buffer.from(`Bearer ${token}`);
  return connectNodeAdapter({
    readMaxBytes: Math.ceil(LIMITS.bodyBytes * 4 / 3) + 8192, writeMaxBytes: LIMITS.records * 256 + 8192,
    acceptCompression: [compressionGzip], maxTimeoutMs: 15_000,
    interceptors: [next => async request => {
      try { return await next(request); }
      catch (error) {
        const typed = rpcFailure(error);
        const [detail] = typed.findDetails(FailureDetailSchema);
        if (detail && onFailure) {
          const sqlite = sqlitePrimaryCode(error);
          try {
            onFailure({ event: 'receiver_rpc_failure', method: request.method.name, requestId: detail.requestId,
              reason: FailureReason[detail.reason] ?? 'INTERNAL',
              ...(detail.recordIndex === undefined ? {} : { recordIndex: detail.recordIndex }),
              ...(sqlite === undefined ? {} : { sqlitePrimaryCode: sqlite }) });
          } catch { /* Logging failure must not replace the original transfer failure. */ }
        }
        throw typed;
      }
    }, next => async request => {
      const presented = Buffer.from(request.header.get('authorization') ?? '');
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) throw failure(FailureReason.AUTHENTICATION_REQUIRED);
      if (active >= 4) throw failure(FailureReason.SERVER_BUSY);
      active++;
      try {
        const response = await next(request);
        if (!response.stream && validator.validate(request.method.output, response.message).kind !== 'valid') throw failure(FailureReason.INTERNAL);
        return response;
      } finally { active--; }
    }, createValidateInterceptor()],
    routes(router) {
      router.service(Receiver, {
        discover(request) {
          assertContract(request.clientContract);
          store.assertReady();
          return { serverId: store.serverId, contract: CONTRACT, limits: LIMITS };
        },
        commit(request) {
          assertContract(request.clientContract);
          return store.ingest(request.batchJson);
        },
      });
    },
  });
}
