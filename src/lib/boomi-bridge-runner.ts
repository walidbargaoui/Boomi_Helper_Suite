import { execFile } from "child_process";
import path from "path";

const SCRIPTS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "boomi-companion-scripts");

const WHITELISTED_SCRIPTS = new Set([
  "boomi-common.sh",
  "boomi-env-check.sh",
  "boomi-folder-create.sh",
  "boomi-folder-check.sh",
  "boomi-component-create.sh",
  "boomi-component-push.sh",
  "boomi-component-pull.sh",
  "boomi-deploy.sh",
  "boomi-undeploy.sh",
  "boomi-test-execute.sh",
  "boomi-execution-query.sh",
  "boomi-wss-test.sh",
  "boomi-version-history.sh",
  "boomi-component-diff.sh",
  "boomi-component-search.sh",
  "boomi-extensions.sh",
  "boomi-branch.sh",
  "boomi-shared-server-info.sh",
  "boomi-profile-inspect.py",
  "event-streams-setup.sh",
]);

export type ScriptResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  componentId?: string;
  exitCode: number;
  durationMs: number;
};

export type EnvCheckEntry = {
  var: string;
  status: "SET" | "UNSET";
};

const SCRIPT_TIMEOUTS: Record<string, number> = {
  "boomi-env-check.sh": 5000,
  "boomi-folder-create.sh": 10000,
  "boomi-component-create.sh": 10000,
  "boomi-component-push.sh": 15000,
  "boomi-component-pull.sh": 10000,
  "boomi-deploy.sh": 30000,
  "boomi-undeploy.sh": 30000,
  "boomi-test-execute.sh": 15000,
  "boomi-execution-query.sh": 10000,
  default: 15000,
};

const CREDENTIAL_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /Basic\s+[A-Za-z0-9+/=]+/gi,
  /BOOMI_API_TOKEN\s*=\s*\S+/gi,
  /BOOMI_USERNAME\s*=\s*\S+/gi,
  /apiPassword\s*[:=]\s*\S+/gi,
  /apiToken\s*[:=]\s*\S+/gi,
  /password\s*[:=]\s*\S+/gi,
  /Authorization:.*$/gim,
];

function filterCredentials(text: string): string {
  let result = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function resolveScript(scriptName: string): string {
  if (!WHITELISTED_SCRIPTS.has(scriptName)) {
    throw new Error(`Script not whitelisted: ${scriptName}`);
  }
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  return scriptPath;
}

function isStderrError(stderr: string): boolean {
  return /^ERROR[:\s]|^\s*ERROR[:\s]/mi.test(stderr) || /unauthorized|authentication failed|access denied/i.test(stderr);
}

function getExitCode(error: Error): number {
  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === "number") return code;
  return -1;
}

export function runCompanionScript(
  scriptName: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  signal?: AbortSignal,
): Promise<ScriptResult> {
  if (!WHITELISTED_SCRIPTS.has(scriptName)) {
    return Promise.reject(new Error(`Script not whitelisted: ${scriptName}`));
  }

  const scriptPath = resolveScript(scriptName);
  const timeout = SCRIPT_TIMEOUTS[scriptName] ?? SCRIPT_TIMEOUTS.default;

  return new Promise((resolve, reject) => {
    const start = Date.now();
    let settled = false;

    const proc = execFile(
      scriptPath,
      args,
      {
        cwd,
        env: { ...process.env, ...env },
        timeout,
        maxBuffer: 1024 * 1024 * 5,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        const durationMs = Date.now() - start;

        const filteredStderr = filterCredentials(stderr);
        const filteredStdout = filterCredentials(stdout);

        const stderrHasError = isStderrError(stderr);
        const actualError = error || (stderrHasError ? new Error(filteredStderr) : null);

        if (actualError) {
          const isTimeout =
            (actualError as NodeJS.ErrnoException).code === "ETIMEDOUT" ||
            ((actualError as { killed?: boolean }).killed ?? false);

          resolve({
            ok: false,
            stdout: filteredStdout,
            stderr: isTimeout
              ? `${filteredStderr}\nScript timed out after ${timeout}ms`
              : filteredStderr,
            componentId: undefined,
            exitCode: getExitCode(actualError),
            durationMs,
          });
          return;
        }

        const componentId = extractComponentIdFromStdout(stdout);

        resolve({
          ok: true,
          stdout: filteredStdout,
          stderr: filteredStderr,
          componentId,
          exitCode: 0,
          durationMs,
        });
      },
    );

    if (signal) {
      const onAbort = () => {
        if (settled) return;
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error("Script execution aborted"));
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });
}

function extractComponentIdFromStdout(stdout: string): string | undefined {
  const patterns = [
    /(?:component|SUCCESS).*\b(?:ID|componentId|component id)[:\s]+([a-f0-9\-]{36})/i,
    /"componentId"\s*:\s*"([a-f0-9\-]{36})"/i,
    /([a-f0-9\-]{36})/i,
  ];
  for (const pattern of patterns) {
    const match = stdout.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

export function parseEnvCheckOutput(stdout: string): EnvCheckEntry[] {
  const entries: EnvCheckEntry[] = [];
  const lines = stdout.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      const setMatch = trimmed.match(/^(\w+):\s*(SET|UNSET)/i);
      if (setMatch) {
        entries.push({
          var: setMatch[1],
          status: setMatch[2].toUpperCase() as "SET" | "UNSET",
        });
      }
      continue;
    }

    const varName = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    entries.push({
      var: varName,
      status: value ? "SET" : "UNSET",
    });
  }
  return entries;
}
