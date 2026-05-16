export interface OllamaInfo {
  url: string;
  models: string[];
}

export async function detectOllama(
  candidates = ["http://localhost:11434", "http://127.0.0.1:11434"],
): Promise<OllamaInfo | null> {
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data = await res.json() as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map((m) => m.name).filter(Boolean);
      return { url, models };
    } catch {
      // try next
    }
  }
  return null;
}
