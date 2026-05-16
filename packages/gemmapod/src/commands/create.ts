import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  intro,
  outro,
  text,
  select,
  multiselect,
  confirm,
  spinner,
  note,
  isCancel,
  cancel,
} from "@clack/prompts";
import { detectOllama } from "../wizard/ollamaDetect.js";
import { TEMPLATES, applyTemplate, type PodTemplate } from "../wizard/templates.js";
import { buildPod, keygenToFile, type RawPodToml } from "../lib/buildPod.js";
import { cmdRun } from "./run.js";

const KNOWN_TOOLS = [
  { value: "share_contact", label: "share_contact", hint: "Share your contact info (email, GitHub, LinkedIn)" },
  { value: "show_project", label: "show_project", hint: "Display a project from your portfolio" },
  { value: "schedule_meeting", label: "schedule_meeting", hint: "Book a meeting via Calendly or similar" },
];

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "my-pod";
}

function buildPodToml(opts: {
  name: string;
  slug: string;
  persona: string;
  systemPrompt: string;
  model: string;
  signalUrl: string;
  tools: string[];
}): string {
  const toolsSection = opts.tools.length > 0
    ? opts.tools.map((t) => `\n[[tools]]\nname = "${t}"\ndescription = "See built-in tool: ${t}"`).join("\n")
    : "";
  return `name = "${opts.name}"
persona = "${opts.persona.replace(/"/g, '\\"')}"
model = "${opts.model}"

system_prompt = """
${opts.systemPrompt.trim()}
"""

[transport]
preferred = ["webrtc", "fallback"]

[transport.webrtc]
signal_url = "${opts.signalUrl}"
pod_id = "${opts.slug}"

[transport.fallback]
tier = "e2b"
${toolsSection}
`;
}

export async function cmdCreate(opts: { dir?: string }): Promise<void> {
  intro("gemmapod create");

  // 1. Agent name
  const nameRaw = await text({
    message: "Agent name",
    placeholder: "Raj's Dev Card",
    validate: (v) => (v.trim() ? undefined : "Name is required"),
  });
  if (isCancel(nameRaw)) { cancel("Cancelled."); process.exit(0); }
  const name = (nameRaw as string).trim();
  const slug = toSlug(name);

  // 2. Output directory
  const defaultDir = opts.dir ?? `./${slug}`;
  const dirRaw = await text({
    message: "Output directory",
    initialValue: defaultDir,
    placeholder: defaultDir,
  });
  if (isCancel(dirRaw)) { cancel("Cancelled."); process.exit(0); }
  const dir = path.resolve((dirRaw as string).trim() || defaultDir);

  // 3. Persona
  const personaRaw = await text({
    message: "One-sentence persona",
    placeholder: "My AI business card — introduces me and shares my projects",
    validate: (v) => (v.trim() ? undefined : "Persona is required"),
  });
  if (isCancel(personaRaw)) { cancel("Cancelled."); process.exit(0); }
  const persona = (personaRaw as string).trim();

  // 4. System prompt template
  const tplId = await select({
    message: "System prompt starting point",
    options: TEMPLATES.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
  });
  if (isCancel(tplId)) { cancel("Cancelled."); process.exit(0); }
  const tpl = TEMPLATES.find((t) => t.id === tplId) as PodTemplate;
  const systemPrompt = applyTemplate(tpl, { name, persona });

  // 5. Tools
  const toolChoices = await multiselect({
    message: "Enable built-in tools (optional — press space to toggle, enter to confirm)",
    options: KNOWN_TOOLS,
    required: false,
  });
  if (isCancel(toolChoices)) { cancel("Cancelled."); process.exit(0); }
  const tools = toolChoices as string[];

  // 6. Detect Ollama
  const s = spinner();
  s.start("Detecting Ollama...");
  const ollama = await detectOllama();
  s.stop(ollama ? `Ollama found at ${ollama.url} (${ollama.models.length} models)` : "Ollama not found");

  let model = "gemma4:e4b";
  if (ollama && ollama.models.length > 0) {
    const modelChoice = await select({
      message: "Ollama model for this agent",
      options: ollama.models.map((m) => ({
        value: m,
        label: m,
        hint: m.startsWith("gemma4") ? "recommended" : undefined,
      })),
    });
    if (isCancel(modelChoice)) { cancel("Cancelled."); process.exit(0); }
    model = modelChoice as string;
  } else if (!ollama) {
    note(
      "Ollama not found. The model field will default to 'gemma4:e4b'.\n" +
      "Install Ollama from https://ollama.com and run: ollama pull gemma4:e4b\n" +
      "Then run: gemmapod run ./" + slug,
      "Ollama optional at build time",
    );
  }

  // 7. Transport
  const transport = await select({
    message: "Where will visitors connect?",
    options: [
      { value: "cloud", label: "Cloud", hint: "https://signal.gemmapod.com/signal (recommended)" },
      { value: "local", label: "Local dev", hint: "ws://localhost:8080/signal" },
    ],
  });
  if (isCancel(transport)) { cancel("Cancelled."); process.exit(0); }
  const signalUrl = transport === "cloud"
    ? "https://signal.gemmapod.com/signal"
    : "ws://localhost:8080/signal";

  // 8. Immutability notice + confirm
  note(
    "The system prompt will be Ed25519-signed into the manifest.\n" +
    "To change it later: edit pod.toml and run `gemmapod rebuild ./" + slug + "`.",
    "Heads up",
  );

  // 9. Build
  const build = spinner();
  build.start("Building your pod...");
  try {
    await mkdir(dir, { recursive: true });

    // Write pod.toml
    const tomlContent = buildPodToml({ name, slug, persona, systemPrompt, model, signalUrl, tools });
    const tomlPath = path.join(dir, "pod.toml");
    await writeFile(tomlPath, tomlContent);

    // Write .gitignore
    await writeFile(path.join(dir, ".gitignore"), "# Owner signing keys — never commit\n*.key\nowner.key\n");

    // Keygen
    const keyPath = path.join(dir, "owner.key");
    await keygenToFile(keyPath);

    // Build signed HTML — pass in-memory object to avoid TOML roundtrip issues
    const outPath = path.join(dir, "agent.html");
    const rawToml: RawPodToml = {
      name,
      id: slug,
      persona,
      system_prompt: systemPrompt,
      transport: {
        preferred: ["webrtc", "fallback"],
        webrtc: { signal_url: signalUrl, pod_id: slug },
        fallback: { tier: "e2b" },
      },
      tools: tools.map((t) => ({ name: t, description: `Built-in tool: ${t}` })),
    };
    const result = await buildPod({ rawToml, keyPath, outPath });

    build.stop(`Built successfully (${result.sizeKB} KB)`);

    note(
      `  pod.toml   ${tomlPath}\n` +
      `  owner.key  ${keyPath}  ← keep this secret\n` +
      `  agent.html ${outPath}  ← share this file`,
      "Pod ready",
    );

    const startNow = await confirm({
      message: "Start the origin daemon now? (requires Ollama)",
      initialValue: ollama !== null,
    });

    if (!isCancel(startNow) && startNow) {
      outro("Starting daemon…");
      await cmdRun(dir, {});
    } else {
      outro(
        `To go live:\n` +
        `  gemmapod run ${dir}\n\n` +
        `To open the pod in your browser:\n` +
        `  open ${outPath}`,
      );
    }
  } catch (e) {
    build.stop("Build failed");
    cancel((e as Error).message);
    process.exit(1);
  }
}
