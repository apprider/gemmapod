# origin-daemon-minimal

Run a GemmaPod origin daemon on your own machine in three commands. Your
pod blob — wherever it lives — phones home to this daemon over WebRTC, and
the daemon proxies chat to your local Ollama.

## Prereqs

- [Ollama](https://ollama.com) running with `gemma4:e4b` pulled:
  ```sh
  ollama pull gemma4:e4b
  ollama serve
  ```
- A signaling broker reachable from both this daemon and your visitor.
  Either:
  - the production gemmapod.com broker (`https://signal.gemmapod.com/signal`)
  - or your own (`pnpm --filter @gemmapod/example-self-host-signaling start`)

## Run

```sh
SIGNAL_URL=ws://localhost:8080/signal \
POD_ID=hello-pod \
OLLAMA_URL=http://localhost:11434 \
pnpm --filter @gemmapod/origin start
```

The daemon will:

1. Connect outbound to `SIGNAL_URL` and register `POD_ID`.
2. For each visitor offer, open a WebRTC data channel, exchange signed
   `dartc.hello` envelopes, advertise an A2A-shaped Agent Card on
   `a2a.discovery`, then accept `gemmapod.chat.request` envelopes.
3. Stream `gemmapod.chat.delta` + signed `gemmapod.ui.event` envelopes
   back as the model generates.

## Conversation memory

The daemon stores conversation state in SQLite at
`~/.gemmapod/origin.sqlite` keyed by `(podId, conversationId)`. Visitor
refreshes get a fresh WebRTC peer + ephemeral DARTC session key but the
same `conversationId`, so the daemon reattaches to the existing thread.

Override the database path with `GEMMAPOD_ORIGIN_DB`.

## Owner-key enforcement (recommended for production)

```sh
OWNER_PUBKEY=<your_public_key_hex> pnpm --filter @gemmapod/origin start
```

When set, the daemon rejects signed manifests from any other owner before
exposing any tools. Useful when you want to be sure only pods you signed
can talk to your machine.

## What's next

Want the daemon to do more than chat? See
[`restaurant-pod`](../restaurant-pod) for a worked example of emitting
`STATE_SNAPSHOT` UI events so the visitor's page can render a live cart
beside the chat — no extra DARTC topic needed.
