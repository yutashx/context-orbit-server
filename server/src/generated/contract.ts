// Generated contract data.
import { Code } from '@connectrpc/connect';
import { FailureReason } from './receiver_pb.js';
export const CONTRACT = {"revision":2,"schemaHash":"660435a2d8b45f75b58c18af3ea3ca36f1061a3b4537d00603520ba18e7448a9"};
export const LIMITS = {"bodyBytes":4194304,"recordBytes":65536,"records":2000};
export const FAILURE_POLICIES = {
  [FailureReason.AUTHENTICATION_REQUIRED]: { code: Code.Unauthenticated, retry: false, title: "Update server credentials", recovery: "Enter the receiver token and reconnect. Pending records stay on this phone." },
  [FailureReason.ACCESS_DENIED]: { code: Code.PermissionDenied, retry: false, title: "Server access denied", recovery: "Check the receiver's access policy before trying again." },
  [FailureReason.CLIENT_UPDATE_REQUIRED]: { code: Code.FailedPrecondition, retry: false, title: "Update ContextOrbit", recovery: "This receiver requires a newer app. Pending records stay on this phone." },
  [FailureReason.SERVER_UPDATE_REQUIRED]: { code: Code.FailedPrecondition, retry: false, title: "Update the receiver", recovery: "The receiver does not support this app's contract. Update and restart it, then send again." },
  [FailureReason.CONTRACT_MISMATCH]: { code: Code.FailedPrecondition, retry: false, title: "App and receiver do not match", recovery: "Build the app and receiver from the same contract, then try again." },
  [FailureReason.INVALID_ENVELOPE]: { code: Code.InvalidArgument, retry: false, title: "Server rejected the transfer format", recovery: "Check app and receiver compatibility. Repeated sending will not repair this request." },
  [FailureReason.INVALID_UTF8]: { code: Code.InvalidArgument, retry: false, title: "Server rejected the text encoding", recovery: "The saved request needs investigation. Do not delete pending records." },
  [FailureReason.INVALID_JSON]: { code: Code.InvalidArgument, retry: false, title: "Server rejected the saved request", recovery: "The saved request needs investigation. Do not delete pending records." },
  [FailureReason.DUPLICATE_RECORD_ID]: { code: Code.InvalidArgument, retry: false, title: "Duplicate record identities in transfer", recovery: "The saved request needs investigation. Do not delete pending records." },
  [FailureReason.RECORD_TOO_LARGE]: { code: Code.ResourceExhausted, retry: false, title: "Transfer exceeds the receiver limit", recovery: "Check app and receiver limits. Pending records stay on this phone." },
  [FailureReason.INVALID_RECORD]: { code: Code.InvalidArgument, retry: false, title: "Server rejected a record", recovery: "Check app and receiver compatibility. The original record remains on this phone." },
  [FailureReason.INVALID_TIME_RANGE]: { code: Code.InvalidArgument, retry: false, title: "Server rejected a record's time range", recovery: "The original record needs investigation. Do not delete pending records." },
  [FailureReason.WRONG_SERVER]: { code: Code.FailedPrecondition, retry: false, title: "Server identity changed", recovery: "Reconnect and confirm the intended receiver. Previous storage confirmations are not reused." },
  [FailureReason.IDENTITY_CONFLICT]: { code: Code.AlreadyExists, retry: false, title: "Server found conflicting original data", recovery: "Investigate the saved request and receiver records. Do not reset either store." },
  [FailureReason.SERVER_BUSY]: { code: Code.ResourceExhausted, retry: true, title: "Receiver busy; waiting to retry", recovery: null },
  [FailureReason.REQUEST_TIMEOUT]: { code: Code.DeadlineExceeded, retry: true, title: "Transfer timed out; waiting to retry", recovery: null },
  [FailureReason.STORAGE_BUSY]: { code: Code.Unavailable, retry: true, title: "Server storage busy; waiting to retry", recovery: null },
  [FailureReason.STORAGE_FULL]: { code: Code.ResourceExhausted, retry: false, title: "Server storage is full", recovery: "Free space on the receiver, then try again. Do not clear phone storage." },
  [FailureReason.STORAGE_ACCESS]: { code: Code.FailedPrecondition, retry: false, title: "Server cannot access its storage", recovery: "Check the receiver's storage path and permissions, then try again." },
  [FailureReason.STORAGE_CORRUPT]: { code: Code.DataLoss, retry: false, title: "Server storage needs repair", recovery: "Inspect or restore the receiver database. Keep phone records and do not initialize a replacement store." },
  [FailureReason.STORAGE_UNAVAILABLE]: { code: Code.Unavailable, retry: true, title: "Server storage unavailable; waiting to retry", recovery: null },
  [FailureReason.INTERNAL]: { code: Code.Internal, retry: false, title: "Receiver needs investigation", recovery: "Check the receiver using the diagnostic reference. Pending records stay on this phone." },
};
