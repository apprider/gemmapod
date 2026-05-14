// Wire protocol for the WebSocket signaling channel between visitor pods,
// owner-side origin daemons, and the cloud broker. Both directions send
// JSON-encoded text frames.
//
// Lifecycle:
//   origin --> cloud:  { t:"register", podId, ownerToken? }
//   cloud  --> origin: { t:"registered", podId }                              (ack)
//   visitor--> cloud:  { t:"offer",  podId, sessionId, sdp }
//   cloud  --> origin: { t:"offer",  sessionId, sdp }
//   origin --> cloud:  { t:"answer", sessionId, sdp }
//   cloud  --> visitor:{ t:"answer", sessionId, sdp }
//   *      --> cloud:  { t:"candidate", sessionId, candidate }               (trickle ICE)
//   cloud  --> peer:   { t:"candidate", sessionId, candidate }               (trickle ICE)
//   * --> cloud:       { t:"error",  sessionId?, message }                    (peer error)
//   cloud --> *:       { t:"error",  sessionId?, message }                    (broker error)
//
// Once the WebRTC DataChannel opens, the broker is out of the conversation.
// All subsequent chat / UI event traffic is signed DARTC over the data
// channel — see @gemmapod/dartc for the envelope spec.

export interface IceCandidateJson {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalMsg =
  | { t: "register"; podId: string; ownerToken?: string }
  | { t: "registered"; podId: string }
  | { t: "offer"; podId?: string; sessionId: string; sdp: string }
  | { t: "answer"; sessionId: string; sdp: string }
  | { t: "candidate"; podId?: string; sessionId: string; candidate: IceCandidateJson }
  | { t: "error"; sessionId?: string; message: string };
