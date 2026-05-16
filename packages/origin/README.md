# `@gemmapod/origin` (owner-side daemon)

The piece that runs on the pod owner's machine. Connects to the cloud
signaling broker, registers itself for one or more pod ids, and completes
WebRTC handshakes locally with each visitor. Chat bytes flow peer-to-peer
through the resulting DARTC/WebRTC data channel — the cloud never sees
them.

## What it does

1. Opens a persistent connection to the cloud signaling broker (HTTPS →
   WebSocket upgrade) with exponential-backoff reconnect.
2. Sends `{t:"register", podId}`. From then on, the cloud routes any
   visitor offer for that pod id to this socket.
3. For each incoming `{t:"offer", sessionId, sdp}`:
   - Creates a fresh `RTCPeerConnection` (node-datachannel's W3C polyfill).
   - Completes negotiation, returns `{t:"answer", sessionId, sdp}`.
   - Waits for the visitor's data channel `dartc.v0` to open.
4. On the data channel: speaks DARTC v0.2 only. The daemon verifies the
   visitor's signed `dartc.hello`, sends its own signed `dartc.hello`,
   advertises an A2A-shaped Agent Card on `a2a.discovery`, then accepts
   signed `gemmapod.chat.request` envelopes. If a signed manifest is
   present, the daemon verifies it with the same Rust/WASM core used by
   the browser, replaces the caller-provided system prompt with the signed
   prompt, and exposes only locally-registered tools whose names appear in
   the signed manifest. It then forwards to
   `${OLLAMA_URL}/v1/chat/completions` (OpenAI-compatible) and streams the
   response back as signed `gemmapod.chat.delta` envelopes followed by
   `gemmapod.chat.done`.

The browser shim sends a stable pod-scoped `conversation_id` in
`dartc.hello` and `gemmapod.chat.request`. The daemon persists conversation
memory keyed by `podId + conversation_id` in SQLite, so a browser refresh
creates a new WebRTC peer but resumes the same logical chat. By default
the database is `~/.gemmapod/origin.sqlite`; set `GEMMAPOD_ORIGIN_DB` to
override it. If the local Node runtime does not expose `node:sqlite`, the
daemon logs a warning and falls back to process memory.

Alongside the chat delta topics, the daemon emits signed
`gemmapod.ui.event` envelopes. These are AG-UI-shaped DARTC-native
events for run lifecycle (`RUN_*`), assistant text streaming
(`TEXT_MESSAGE_*`), tool-call visibility (`TOOL_CALL_*`), state
snapshots/deltas (`STATE_*` — RFC 6902 JSON Patch), chat history
rehydration (`MESSAGES_SNAPSHOT`, used after a reconnect to the same
`conversation_id`), activity panels (`ACTIVITY_*`), and custom UI actions
(`CUSTOM`).

The protocol uses Ollama's OpenAI-compat path so the same code works
against local Ollama, Ollama Cloud proxied models, or any other
OpenAI-shaped server.

## DARTC + A2A discovery

Each WebRTC peer gets an ephemeral Ed25519 DARTC session key. DARTC
signatures cover the canonical JSON envelope; the signed pod manifest
remains the authority for pod identity, system prompt, transport config,
and tool allow-list.

Supported topics today:

| topic | purpose |
|-------|---------|
| `dartc.hello` | Session-key and topic negotiation. |
| `dartc.ack` | Acknowledge control messages. |
| `dartc.error` | Signed protocol/application errors. |
| `a2a.discovery` | Exchange A2A-shaped Agent Cards. |
| `gemmapod.chat.request` | Browser-to-origin chat request. |
| `gemmapod.chat.delta` | Origin-to-browser streamed text/reasoning delta. |
| `gemmapod.chat.done` | End of chat stream. |
| `gemmapod.ui.event` | Signed frontend/runtime event stream (schema `dartc.ui.event/0.1`). |

The origin Agent Card is derived from the verified signed manifest: pod
name, persona, signed tools as skills, DARTC extension metadata, pod id,
and owner public key.

Conversation continuity is intentionally separate from WebRTC identity:
each refresh gets a fresh peer connection and ephemeral DARTC key, while
the signed payload carries the stable `conversation_id`.

## Start the origin

There is no separate "start with Agent Card" command. A2A Agent Card
exchange happens automatically after a visitor pod connects:

1. The daemon registers `POD_ID` with the cloud signaling broker.
2. The browser pod opens WebRTC and the `dartc.v0` data channel.
3. Both sides exchange signed `dartc.hello` envelopes.
4. The daemon sends its A2A-shaped Agent Card on `a2a.discovery`.
5. Chat continues on signed `gemmapod.chat.*` topics.

The command must be run through pnpm's workspace filter:

```sh
SIGNAL_URL=https://signal.gemmapod.com/signal \
POD_ID=raj-card \
pnpm --filter @gemmapod/origin start
```

If Ollama is not at the default URL:

```sh
SIGNAL_URL=https://signal.gemmapod.com/signal \
POD_ID=raj-card \
OLLAMA_URL=http://localhost:11434 \
pnpm --filter @gemmapod/origin start
```

To place the conversation database somewhere explicit:

```sh
SIGNAL_URL=https://signal.gemmapod.com/signal \
POD_ID=raj-card \
GEMMAPOD_ORIGIN_DB=/Users/raj/.gemmapod/raj-card.sqlite \
pnpm --filter @gemmapod/origin start
```

For stricter signed-manifest/tool enforcement, set the owner public key:

```sh
SIGNAL_URL=https://signal.gemmapod.com/signal \
POD_ID=raj-card \
OWNER_PUBKEY=<owner_public_key_hex> \
pnpm --filter @gemmapod/origin start
```

`OWNER_PUBKEY` is optional, but recommended for production. When set, the
origin rejects signed manifests from any other owner before tools are
exposed.

Common command mistakes:

- `@gemmapod/origin start` is not a shell command. Use
  `pnpm --filter @gemmapod/origin start`.
- Do not leave a trailing space after a line-continuation backslash.
  `POD_ID=raj-card \` is valid; `POD_ID=raj-card \ ` is not.
- Build after DARTC/core changes if you are not using the root build:
  `pnpm --filter @gemmapod/dartc build && pnpm --filter @gemmapod/origin build`.
- If startup fails with
  `Cannot find module '../../../build/Release/node_datachannel.node'`, rebuild
  the native WebRTC binding:
  `pnpm --filter @gemmapod/origin rebuild node-datachannel`. If pnpm reports
  an unexpected store location, rerun the rebuild with the store shown in that
  error, for example
  `pnpm --filter @gemmapod/origin --store-dir /Users/raj/Library/pnpm/store/v3 rebuild node-datachannel`.

## Local development

```sh
ollama serve                                # if not already
ollama pull gemma4:e4b                      # one-time
pnpm dev:cloud                              # in another shell
pnpm dev:origin                             # this package
```

## Configuration

| env             | default                              | meaning                                  |
|-----------------|--------------------------------------|------------------------------------------|
| `OLLAMA_URL`    | `http://localhost:11434`             | Where to proxy chat requests.            |
| `SIGNAL_URL`    | `ws://localhost:8080/signal`         | Signaling endpoint. Use `https://` for production (`wss://` also accepted). |
| `POD_ID`        | `raj-card`                           | Pod id to register for.                  |
| `OWNER_PUBKEY`  | unset                                | Optional Ed25519 owner key the signed manifest must match before tools run. |
| `GEMMAPOD_CONTACT_JSON` | unset                         | Optional JSON returned by the built-in `share_contact` tool. |

## Signed tool runtime

Packed pods carry the signed manifest inside DARTC hello/chat payloads.
The origin daemon verifies that manifest, checks it is for the registered
`POD_ID`, optionally checks `OWNER_PUBKEY`, and intersects the signed
`[[tools]]` allow-list with the local tool registry.

The built-in local tools are:

| tool               | behavior |
|--------------------|----------|
| `share_contact`    | Returns `GEMMAPOD_CONTACT_JSON`, or Raj's default public contact payload. |
| `show_project`     | Returns a short project summary. |
| `package_demo_pod` | Returns instructions for building/deploying a demo pod. |

Unsigned widget mounts still work, but they do not expose tools. A tool
call is rejected unless the name is both signed into the manifest and
implemented locally by the origin daemon.

Production uses the same command shape:

```sh
SIGNAL_URL=https://signal.gemmapod.com/signal \
POD_ID=raj-card \
pnpm --filter @gemmapod/origin start
```


## End-to-end smoke test

`scripts/e2e.ts` plays the visitor side over the cloud-mediated path:

```sh
# requires cloud + origin + ollama all running
pnpm --filter @gemmapod/origin exec tsx scripts/e2e.ts
```

A green run streams a Gemma 4 reply over a real DARTC/WebRTC data
channel.

## Deploy

The owner runs this on their own machine — that's the entire point. There
is no managed deploy target. Typical setups:

- **Mac mini at home.** `pnpm --filter @gemmapod/origin start` under
  `launchd` or `pm2`.
- **Raspberry Pi.** Same, with Ollama serving smaller Gemma variants.
- **VPS / Cloud Run.** Works too — the daemon only needs outbound HTTPS
  (WebSocket) and an Ollama endpoint to proxy to.
