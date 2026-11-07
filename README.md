# ContextOrbit Server

ContextOrbit Server is a self-hosted receiver for the ContextOrbit iOS app. It is a reference implementation that users may choose to run in their own environment. It validates and durably stores the original Health and Location/Motion records sent to it, exact batch bytes, and replay receipts in SQLite.

This repository does not provide hosted storage, user accounts, a public destination, certificates, backups, or an operating system image. You choose and manage the host, network, access controls, retention, deletion, backups, and any downstream use or sharing of stored records. The developer does not operate your receiver or manage its data. The receiver has no automatic deletion and no API for physically deleting stored originals. Project-authored files are MIT licensed; dependency notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

App documentation, privacy policy and app support are maintained separately in [ContextOrbit support](https://github.com/yutashx/context-orbit-support); its intended public site is [GitHub Pages](https://yutashx.github.io/context-orbit-support/). This repository covers the reference receiver, not app pricing or app distribution.

## Requirements and install

Use Node.js 24 or newer, pnpm 12.14.0, and Git on a Unix-like system. The receiver requires a local filesystem that supports Unix ownership and file modes.

```sh
pnpm install --prod --frozen-lockfile --ignore-scripts
```

## Create a private store and start

Choose a new absolute directory outside every Git repository. Its parent must already exist.

```sh
pnpm --dir server run init-store '/absolute/private/path/context-orbit-server-state'
CONTEXT_ORBIT_CONFIG='/absolute/private/path/context-orbit-server-state/config.json' pnpm --dir server start
```

Setup refuses to overwrite an existing directory. It creates a directory with mode `0700`, a config file with mode `0600`, and a random 64-character hexadecimal token at `<stateDirectory>/token` with mode `0600`. The receiver creates `receiver.sqlite` and SQLite sidecars in that directory. Keep the entire directory private and never commit it, its token, config, database, raw records, logs, or device evidence.

The default listener is `127.0.0.1:18787`. `CONTEXT_ORBIT_CONFIG` must be an absolute path to the config file. Optional environment overrides are:

- `CONTEXT_ORBIT_HOST`: one literal IPv4 address.
- `CONTEXT_ORBIT_PORT`: an integer from 1024 through 65535.
- `CONTEXT_ORBIT_ALLOW_LAN_HTTP`: exactly `0` or `1`.
- `CONTEXT_ORBIT_HEARTBEAT_MS`: an integer from 100 through 3600000; default `60000`.

For remote use, put the loopback receiver behind an HTTPS reverse proxy with a valid trusted certificate. Forward the Connect paths, `Authorization` header, and request body unchanged. Do not redirect credentialed requests to another host. The receiver does not configure certificates, firewalls, or proxies.

For a tailnet-only test, bind to the host's literal `100.64.0.0/10` address, set `CONTEXT_ORBIT_ALLOW_LAN_HTTP=1`, and restrict access with your tailnet policy. Private IPv4 HTTP is unencrypted by itself; the tunnel must provide the encryption. Public HTTP and wildcard binds are rejected. Do not forward this port to the Internet.

On the app, enter the receiver URL and the token from `<stateDirectory>/token`. Compare the discovered Server ID with the receiver you intend to use and confirm that destination. A connection check or HTTP 200 is not proof that records were durably stored. The app and receiver must use matching contract revision and schema digest; see [the generated contract metadata](server/src/generated/contract.ts).

## Backups, restore, and upgrades

Stop the receiver gracefully before copying its state. Copy the complete state directory, including SQLite sidecars; copying only a live database file can omit committed WAL data. Store backups encrypted and protected by you.

To restore into a different path, copy the complete directory, edit the copied `config.json` so `stateDirectory` names the new absolute path, then verify that the copied `token`, database, and file modes belong to the intended user. Point `CONTEXT_ORBIT_CONFIG` at the copied config and verify the persistent Server ID before reconnecting the app. Never initialize a new store over a restore, and do not reuse a different Server ID to conceal a mismatch.

Before upgrading, make a consistent backup and validate the candidate against a separate restored store. Keep exactly one intended receiver process for a given state directory. Verify a durable receipt and an exact replay after a lost response before relying on the upgrade.

## Troubleshooting

- **Cannot reach the receiver:** check the exact listener, host power state, firewall, proxy or tailnet policy, and the app's local-network permission. Loopback is reachable only on the receiver host.
- **Token rejected:** read the token from the intended private state directory and re-enter it in the app. Do not paste it into Issues, logs, screenshots, shell history, or third-party services.
- **Changed Server ID or contract mismatch:** stop and inspect which process and config serve the app's URL. Do not delete pending app data or initialize another store to bypass the mismatch.
- **Connected but not saved:** Discover only identifies the receiver. A receipt is valid only after the app validates its identity, batch ID, exact request hash, and record hashes. Replay the unchanged pending bytes when a response may have been lost.
- **Storage growth:** receiver records and replay receipts do not expire automatically. Keep enough disk space and manage retention and backups on the host you control.

The [protocol contract](server/contract.md) defines identities, authentication, limits, transaction and replay behavior, and typed failures. Source formats are in [schema/receiver.proto](schema/receiver.proto), [schema/health-records.ts](schema/health-records.ts), and [schema/health-catalog.ts](schema/health-catalog.ts).

## Data and support

The receiver stores the original record content and metadata supplied by the app, location and motion observations when supplied, exact batch JSON bytes, replay receipts, and a generated Server ID in the private state directory you choose. It does not send records to the project, advertising providers, analytics services, or an integrated AI service. It has no automatic retention or deletion and no API for physically deleting stored originals. A deletion event is stored as an event and does not erase an earlier original sample.

Use HTTPS for normal remote operation. Private HTTP is acceptable only when an encrypted network you control protects it; HTTP itself exposes the token and records to network observers. Keep the state directory outside Git with directory mode `0700` and private files mode `0600`. Never publish the token, database, raw records, logs, or device evidence.

Report reproducible receiver problems in [GitHub Issues](https://github.com/yutashx/context-orbit-server/issues). Include the receiver version, operating system, visible error code, and a redacted description of the action. Never attach Health records, location history, access tokens, device identifiers, databases, screenshots containing personal data, or unredacted logs. For a suspected security issue, do not include secrets or personal data in a public issue.

## License and notices

Project-authored files are MIT licensed. Third-party dependencies retain their licenses; the reviewed notices are included in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). If you distribute an image or bundled installation, preserve the required notices for every included component.
