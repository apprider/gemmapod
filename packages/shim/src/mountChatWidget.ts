import { h, render } from "preact";
import type { GemmaPodRuntime } from "./runtime/events";
import { ChatWidget } from "./ui";

export function mountChatWidget(runtime: GemmaPodRuntime, el: HTMLElement): void {
  render(h(ChatWidget, { runtime }), el);
}
