import { createRequire } from "node:module";

export interface ManifestTool {
  name: string;
  description: string;
}

export interface PodEventConfig {
  name: string;
  value?: unknown;
}

export interface PodEventsConfig {
  on_run_started?: PodEventConfig[];
  on_run_finished?: PodEventConfig[];
  enable_tools?: string[];
}

export interface VerifiedPodManifest {
  v: number;
  id: string;
  name: string;
  persona: string;
  system_prompt: string;
  model: string;
  owner_pubkey: string;
  transport?: {
    webrtc?: { pod_id?: string };
  };
  tools?: ManifestTool[];
  events?: PodEventsConfig;
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments?: string | Record<string, unknown>;
  };
}

export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };
  };
}

export interface ToolRuntime {
  manifest: VerifiedPodManifest | null;
  tools: OpenAiTool[];
  run(call: ToolCall): Promise<string>;
}

interface LocalTool {
  description: string;
  execute(args: Record<string, unknown>): Promise<unknown> | unknown;
}

const require = createRequire(import.meta.url);

const localTools: Record<string, LocalTool> = {
  share_contact: {
    description: "Share Raj's public contact links.",
    execute: () => {
      if (process.env.GEMMAPOD_CONTACT_JSON) {
        return JSON.parse(process.env.GEMMAPOD_CONTACT_JSON);
      }
      return {
        email: "raj.design@gmail.com",
        github: "https://github.com/apprider",
        project: "https://gemmapod.com",
      };
    },
  },
  show_project: {
    description: "Return a short project summary from Raj's portfolio.",
    execute: (args) => {
      const project = typeof args.project === "string" ? args.project : "gemmapod";
      return {
        project,
        summary:
          "GemmaPod packages a signed AI agent manifest, WASM verifier, browser shim, and transport config into one portable HTML blob.",
      };
    },
  },
  package_demo_pod: {
    description: "Explain how a visitor can package a demo pod.",
    execute: () => ({
      status: "manual_next_step",
      message:
        "Use gemmapod.com/build to generate a signed demo pod in the browser, then deploy it from gemmapod.com/deploy.",
    }),
  },
};

let core: {
  GemmaPodCore: {
    verifyManifest(bytes: Uint8Array): VerifiedPodManifest;
  };
} | null = null;

function loadCore(): NonNullable<typeof core> {
  if (!core) core = require("@gemmapod/core/node");
  return core!;
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function parseArgs(raw: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw !== "string") {
    if (!Array.isArray(raw)) return raw;
    throw new Error("tool arguments must be a JSON object");
  }
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function buildToolRuntime(
  signedManifestB64: string | undefined,
  expectedPodId: string,
  expectedOwnerPubkey = process.env.OWNER_PUBKEY,
): ToolRuntime {
  if (!signedManifestB64) {
    return {
      manifest: null,
      tools: [],
      run: async () => {
        throw new Error("tool call rejected: request did not include a signed manifest");
      },
    };
  }

  const manifest = loadCore().GemmaPodCore.verifyManifest(b64ToBytes(signedManifestB64));
  const manifestPodId = manifest.transport?.webrtc?.pod_id ?? manifest.id;
  if (manifest.id !== expectedPodId && manifestPodId !== expectedPodId) {
    throw new Error(`signed manifest pod mismatch: expected ${expectedPodId}`);
  }
  if (expectedOwnerPubkey && manifest.owner_pubkey !== expectedOwnerPubkey) {
    throw new Error("signed manifest owner mismatch");
  }

  const signedTools = new Map((manifest.tools ?? []).map((tool) => [tool.name, tool]));
  const tools: OpenAiTool[] = [];
  for (const [name, signedTool] of signedTools) {
    if (!localTools[name]) continue;
    tools.push({
      type: "function",
      function: {
        name,
        description: signedTool.description || localTools[name].description,
        parameters: {
          type: "object",
          additionalProperties: true,
          properties: {},
        },
      },
    });
  }

  return {
    manifest,
    tools,
    run: async (call) => {
      const allowed = signedTools.has(call.function.name);
      const local = localTools[call.function.name];
      if (!allowed || !local) {
        throw new Error(`tool call rejected: ${call.function.name} is not signed and locally registered`);
      }
      const result = await local.execute(parseArgs(call.function.arguments));
      return typeof result === "string" ? result : JSON.stringify(result);
    },
  };
}
