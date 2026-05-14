import type { DartcUiEvent } from "@gemmapod/dartc";

/**
 * [AG-UI](https://docs.ag-ui.com/concepts/events) uses PascalCase event `type` values.
 * GemmaPod's `DartcUiEvent` uses the same payload field names (`threadId`, `runId`, …)
 * but SCREAMING_SNAKE `type` strings. This helper converts the discriminator for
 * CopilotKit / AG-UI-oriented hosts. Unknown shapes fall back to `{ type: "Raw", dartc }`.
 */
export type AgUiKnownEventType =
  | "RunStarted"
  | "RunFinished"
  | "RunError"
  | "TextMessageStart"
  | "TextMessageContent"
  | "TextMessageEnd"
  | "ToolCallStart"
  | "ToolCallArgs"
  | "ToolCallEnd"
  | "ToolCallResult"
  | "StateSnapshot"
  | "StateDelta"
  | "MessagesSnapshot"
  | "ActivitySnapshot"
  | "ActivityDelta"
  | "Custom"
  | "Raw";

export type AgUiEvent = Record<string, unknown> & { type: AgUiKnownEventType };

function dartcDiscriminatorToAgUi(type: DartcUiEvent["type"]): AgUiKnownEventType {
  switch (type) {
    case "RUN_STARTED":
      return "RunStarted";
    case "RUN_FINISHED":
      return "RunFinished";
    case "RUN_ERROR":
      return "RunError";
    case "TEXT_MESSAGE_START":
      return "TextMessageStart";
    case "TEXT_MESSAGE_CONTENT":
      return "TextMessageContent";
    case "TEXT_MESSAGE_END":
      return "TextMessageEnd";
    case "TOOL_CALL_START":
      return "ToolCallStart";
    case "TOOL_CALL_ARGS":
      return "ToolCallArgs";
    case "TOOL_CALL_END":
      return "ToolCallEnd";
    case "TOOL_CALL_RESULT":
      return "ToolCallResult";
    case "STATE_SNAPSHOT":
      return "StateSnapshot";
    case "STATE_DELTA":
      return "StateDelta";
    case "MESSAGES_SNAPSHOT":
      return "MessagesSnapshot";
    case "ACTIVITY_SNAPSHOT":
      return "ActivitySnapshot";
    case "ACTIVITY_DELTA":
      return "ActivityDelta";
    case "CUSTOM":
      return "Custom";
    case "RAW":
      return "Raw";
    default: {
      const _never: never = type;
      return _never;
    }
  }
}

/** Map a `DartcUiEvent` (from `runtime.events` `ui.event`) to AG-UI-style `{ type, ...fields }`. */
export function mapDartcUiEventToAgUi(event: DartcUiEvent): AgUiEvent {
  const { type: dartcType, ...rest } = event;
  const type = dartcDiscriminatorToAgUi(dartcType);
  return { type, ...rest } as AgUiEvent;
}
