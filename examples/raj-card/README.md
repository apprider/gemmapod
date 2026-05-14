# `examples/raj-card`

The reference pod manifest. This is what runs on gemmapod.com as the live
"product explainer" agent — the agent the judges chat with.

- `pod.toml` — manifest fed to `gemmapod build`.

## Build it

```sh
# from repo root
pnpm --filter @gemmapod/shim build
mkdir -p dist
pnpm --filter @gemmapod/pack exec tsx src/cli.ts keygen \
  --out /absolute/path/to/raj-card.key.json

pnpm --filter @gemmapod/pack exec tsx src/cli.ts build \
  /absolute/path/to/repo/examples/raj-card/pod.toml \
  --key /absolute/path/to/raj-card.key.json \
  --out /absolute/path/to/dist/raj-card.html
```

Output is a self-contained ~650 KB HTML file. Email it, drop it in
`apps/web/public/`, or `POST` to `/pods` to get a `gemmapod.com/<id>` URL.
When opened, the pod connects to the origin over DARTC v0.2 on WebRTC,
exchanges A2A Agent Cards on `a2a.discovery`, and streams chat on signed
`gemmapod.chat.*` topics.

## Tune it

Edit `pod.toml`:

- **`system_prompt`** drives persona and tone.
- **`[transport.webrtc]`** sets where the pod phones home. The pod id
  here must match the `POD_ID` your origin daemon registers under.
- **`[[tools]]`** declares an allow-list. The shim doesn't execute tools
  directly; the origin daemon re-verifies the signed manifest during the
  DARTC session and exposes only matching local tools.
