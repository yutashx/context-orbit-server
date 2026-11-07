# Receiver API revision 2 and batch format version 1

## Transport and compatibility

[`schema/receiver.proto`](../schema/receiver.proto) defines the Connect API, Batch, Receipt, limits, and failure reasons. [`schema/health-records.ts`](../schema/health-records.ts) defines the opaque Health and Location/Motion JSON strings carried inside a batch. [`schema/health-catalog.ts`](../schema/health-catalog.ts) defines supported identifiers and units.

The receiver exposes authenticated unary Connect over HTTP/1.1:

- `/orbit.transfer.v1.Receiver/Discover` checks the client's contract identity and returns the server identity, contract identity, and limits.
- `/orbit.transfer.v1.Receiver/Commit` accepts `client_contract` and the unchanged `batch_json` bytes.

Both calls require `Authorization: Bearer <private-token>`. Discover establishes compatibility and identity; it never confirms original-data storage. The API revision, batch format, receiver database schema, and client database schema are separate version spaces.

The client and receiver must use the same contract revision and schema digest. An older revision produces `CLIENT_UPDATE_REQUIRED`, a newer one `SERVER_UPDATE_REQUIRED`, and an unequal digest `CONTRACT_MISMATCH`. This is strict matched-build compatibility, not additive negotiation.

## Identity and batch

A receiver generates a UUID when creating its database. The Server ID remains stable across URL or token changes. A new database is another server. A batch addressed to another Server ID is rejected.

The batch contains `protocolVersion`, `serverId`, `installationId`, `batchId`, and a nonempty `records` array. Each record contains `recordId` and `content`. The persisted batch is ProtoJSON and unknown envelope fields are rejected.

`content` is a JSON string, not an embedded object. Its exact decoded UTF-8 bytes are the original event representation. The receiver validates the JSON without replacing the original string with a parsed or normalized object. See the health-record schema for per-type fields and semantics.

Records preserve source identifiers, intervals, provenance, metadata, and explicit deletion events. Location and motion observations use `operation: observe`; these values are estimates and are not converted into health facts. Missing values remain null rather than being invented. The receiver retains original bytes and does not physically delete an earlier sample when a deletion event is received.

`installationId` namespaces record and batch IDs for one configured owner. It is not a hardware identifier or a multi-tenant account identifier. Multiple independent users are outside this contract.

## Limits and durable writes

The receiver validates the complete body and every record before writing. A batch supports at most 2,000 records, at most 4 MiB of immutable batch JSON bytes, and at most 64 KiB of decoded content per record. A batch cannot repeat a record ID. Connect requests support gzip and bound the expanded envelope to `ceil(bodyBytes * 4 / 3) + 8192` bytes. Legacy JSON POST remains uncompressed. All original bytes must be valid UTF-8.

SQLite uses WAL, synchronous FULL, a 2-second busy timeout, and one transaction for records, original batch bytes, and the receipt. The receiver is intended for a local disk. Connect allows four active authenticated requests, a 15-second request timeout, and a response bound derived from the record limit. The legacy HTTP handler has a 10-second body deadline.

The request hash is SHA-256 over the exact persisted batch JSON bytes. For legacy POST this is the HTTP entity body; for Connect it is the `batch_json` byte field, not the serialized Protobuf request or HTTP envelope. Protobuf serialization is not canonical.

Repeating the same installation and batch ID with identical bytes returns the saved receipt, including its original stored time. Different bytes under that ID return `identity_conflict`, even when only whitespace differs. A client must retry the unchanged bytes; it must not rebuild the JSON.

Reusing an installation and record ID with different content returns `identity_conflict`. A conflicting record or failed insert rolls back the complete batch. There is no partial success in version 1.

The receipt contains protocol version, Server ID, installation ID, batch ID, request hash, server `storedAt`, and an ordered list of record IDs with decoded-content hashes. It is returned only after the transaction commits. A client must validate every receipt field before marking records saved.

## Errors and legacy HTTP

Service errors carry a standard Connect code and one typed `FailureDetail` containing a fixed reason, random request reference, optional record index, and optional retry delay. Errors do not contain source values, record identifiers, SQL, credentials, or exception text. Unknown or malformed details fail closed.

Network timeouts, server busy, and SQLite busy can retry with the original bytes. Authentication, contract mismatch, invalid data, wrong server, identity conflict, storage full, access failure, and corruption require owner action. TLS and redirects must not disable certificate validation or forward credentials.

`GET /v1/server` and `POST /v1/batches` are legacy JSON routes using the same store, identity, transaction, and receipt semantics. They do not negotiate the contract digest.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `invalid_request` | Invalid UTF-8/JSON/schema, duplicate IDs, bounds, or interval |
| 401 | `unauthorized` | Missing or invalid Bearer token |
| 404 | `not_found` | Unknown authenticated route |
| 408 | `request_timeout` | Request body deadline exceeded |
| 409 | `identity_conflict` / `wrong_server` | Bytes, IDs, or server identity conflict |
| 413 | `body_too_large` | Request exceeds the byte limit |
| 415 | `unsupported_media_type` / `unsupported_encoding` | Requires JSON and identity encoding |
| 429 | `busy` | Active request bound reached; retry after 2 seconds |
| 503 | `storage_unavailable` / `internal_error` | No success can be established; keep data and retry |

The receiver may close a TCP connection for lower-level protocol or time-limit violations. Treat that as unconfirmed and retain the original bytes.

## Retention and durability boundary

Records, original batch bodies, and replay receipts have no automatic expiry in this implementation. The receiver has no automatic cleanup or retry-budget deletion. Physical deletion, backups, restore reconciliation, filesystem protection, and disk capacity remain operator responsibilities.

The receiver does not claim protection against storage hardware failure, disk loss, filesystem corruption, OS power failure, or every real-device collection condition. Keep independent backups of the complete private state directory.
