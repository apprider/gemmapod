import type { JsonPatchOperation } from "@gemmapod/dartc";

export interface RuntimeStateStore {
  get<T = unknown>(path?: string): T;
  set(path: string, value: unknown): Promise<void>;
  replace(value: unknown): Promise<void>;
  apply(delta: JsonPatchOperation[]): Promise<void>;
  subscribe(handler: (state: unknown) => void): () => void;
}

export class LocalRuntimeStateStore implements RuntimeStateStore {
  private state: unknown = {};
  private readonly subscribers = new Set<(state: unknown) => void>();

  get<T = unknown>(path = ""): T {
    if (!path || path === "/") return this.state as T;
    return readPointer(this.state, path) as T;
  }

  async set(path: string, value: unknown): Promise<void> {
    this.state = writePointer(this.state, path, value);
    this.emit();
  }

  async replace(value: unknown): Promise<void> {
    this.state = value;
    this.emit();
  }

  async apply(delta: JsonPatchOperation[]): Promise<void> {
    let next = this.state;
    for (const op of delta) {
      if (op.op === "add" || op.op === "replace") {
        next = writePointer(next, op.path, op.value);
      } else if (op.op === "remove") {
        next = removePointer(next, op.path);
      }
    }
    this.state = next;
    this.emit();
  }

  subscribe(handler: (state: unknown) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  private emit(): void {
    for (const subscriber of [...this.subscribers]) subscriber(this.state);
  }
}

function readPointer(root: unknown, path: string): unknown {
  const parts = pointerParts(path);
  let current = root as Record<string, unknown> | unknown[] | undefined;
  for (const part of parts) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[part] as Record<string, unknown> | unknown[] | undefined;
  }
  return current;
}

function writePointer(root: unknown, path: string, value: unknown): unknown {
  if (!path || path === "/") return value;
  const parts = pointerParts(path);
  const clone = cloneContainer(root, parts[0]);
  let current = clone as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const nextPart = parts[i + 1];
    const existing = current[part];
    const next = cloneContainer(existing, nextPart);
    current[part] = next;
    current = next as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
  return clone;
}

function removePointer(root: unknown, path: string): unknown {
  if (!path || path === "/") return {};
  const parts = pointerParts(path);
  const clone = cloneContainer(root, parts[0]);
  let current = clone as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = current[part];
    if (next == null || typeof next !== "object") return clone;
    const clonedNext = Array.isArray(next) ? [...next] : { ...(next as Record<string, unknown>) };
    current[part] = clonedNext;
    current = clonedNext as Record<string, unknown>;
  }
  const last = parts[parts.length - 1]!;
  if (Array.isArray(current)) {
    current.splice(Number(last), 1);
  } else {
    delete current[last];
  }
  return clone;
}

function cloneContainer(value: unknown, nextPart?: string): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === "object") return { ...(value as Record<string, unknown>) };
  return nextPart !== undefined && /^\d+$/.test(nextPart) ? [] : {};
}

function pointerParts(path: string): string[] {
  return path
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}
