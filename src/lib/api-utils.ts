export async function extractError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown; detail?: string; issues?: unknown };
    if (data.issues) return JSON.stringify(data.issues);
    if (data.detail) return data.detail;
    if (data.error) {
      if (typeof data.error === "string") return data.error;
      return JSON.stringify(data.error);
    }
  } catch {
    /* ignore */
  }
  return `Request failed (${response.status})`;
}
