import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCompanionScript, parseEnvCheckOutput } from "@/lib/boomi-bridge-runner";

let mockExecFileResult: {
  stdout: string;
  stderr: string;
  error?: Error & { code?: string; killed?: boolean };
} | null = null;

vi.mock("child_process", () => ({
  execFile: vi.fn(
    (
      _scriptPath: string,
      _args: string[],
      _opts: Record<string, unknown>,
      callback: (
        error: (Error & { code?: string; killed?: boolean }) | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) => {
      const result = mockExecFileResult;
      if (!result) {
        callback(null, "", "");
        return { kill: vi.fn(), on: vi.fn() } as unknown as ReturnType<typeof import("child_process").execFile>;
      }
      const proc = { kill: vi.fn(), on: vi.fn() } as unknown as ReturnType<typeof import("child_process").execFile>;
      setTimeout(() => {
        callback(result.error ?? null, result.stdout, result.stderr);
      }, 10);
      return proc;
    },
  ),
}));

beforeEach(() => {
  mockExecFileResult = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCompanionScript", () => {
  it("rejects non-whitelisted scripts", async () => {
    await expect(
      runCompanionScript("nonexistent.sh", [], "/tmp/test", {}),
    ).rejects.toThrow("Script not whitelisted");
  });

  it("runs a whitelisted script and returns ok result", async () => {
    mockExecFileResult = {
      stdout: "Environment check passed\nAll variables set",
      stderr: "",
    };

    const result = await runCompanionScript(
      "boomi-env-check.sh",
      [],
      "/tmp/test",
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("Environment check passed");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("returns failed result when script errors", async () => {
    mockExecFileResult = {
      stdout: "",
      stderr: "BOOMI_API_TOKEN not set",
      error: Object.assign(new Error("Command failed"), { code: 1 }),
    };

    const result = await runCompanionScript(
      "boomi-folder-create.sh",
      ["/test"],
      "/tmp/test",
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("filters credentials from stderr", async () => {
    mockExecFileResult = {
      stdout: "",
      stderr:
        "Using BOOMI_API_TOKEN=abc123secret456 for auth\nAuthorization: Bearer xyz789",
    };

    const result = await runCompanionScript(
      "boomi-env-check.sh",
      [],
      "/tmp/test",
      {},
    );

    expect(result.stderr).not.toContain("abc123secret456");
    expect(result.stderr).not.toContain("xyz789");
    expect(result.stderr).toContain("[REDACTED]");
  });

  it("filters credentials from stdout", async () => {
    mockExecFileResult = {
      stdout: "BOOMI_USERNAME=admin, apiPassword=mysecret",
      stderr: "",
    };

    const result = await runCompanionScript(
      "boomi-env-check.sh",
      [],
      "/tmp/test",
      {},
    );

    expect(result.stdout).not.toContain("mysecret");
    expect(result.stdout).toContain("[REDACTED]");
  });

  it("extracts componentId from stdout", async () => {
    mockExecFileResult = {
      stdout:
        "Created component successfully\ncomponent id: 550e8400-e29b-41d4-a716-446655440000",
      stderr: "",
    };

    const result = await runCompanionScript(
      "boomi-component-create.sh",
      ["somefile.xml"],
      "/tmp/test",
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.componentId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("handles timeout error code", async () => {
    mockExecFileResult = {
      stdout: "",
      stderr: "",
      error: Object.assign(new Error("ETIMEDOUT"), {
        code: "ETIMEDOUT" as const,
        killed: true,
      }),
    };

    const result = await runCompanionScript(
      "boomi-env-check.sh",
      [],
      "/tmp/test",
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("timed out");
  });
});

describe("parseEnvCheckOutput", () => {
  it("parses SET/UNSET format from colon-separated output", () => {
    const stdout = "BOOMI_API_URL: SET\nBOOMI_USERNAME: SET\nBOOMI_TEST_ATOM_ID: UNSET";
    const entries = parseEnvCheckOutput(stdout);

    expect(entries).toEqual([
      { var: "BOOMI_API_URL", status: "SET" },
      { var: "BOOMI_USERNAME", status: "SET" },
      { var: "BOOMI_TEST_ATOM_ID", status: "UNSET" },
    ]);
  });

  it("parses equals format", () => {
    const stdout =
      "BOOMI_API_URL=https://api.boomi.com\nBOOMI_USERNAME=admin\nBOOMI_VERIFY_SSL=";
    const entries = parseEnvCheckOutput(stdout);

    expect(entries).toEqual([
      { var: "BOOMI_API_URL", status: "SET" },
      { var: "BOOMI_USERNAME", status: "SET" },
      { var: "BOOMI_VERIFY_SSL", status: "UNSET" },
    ]);
  });

  it("handles empty output", () => {
    const entries = parseEnvCheckOutput("");
    expect(entries).toEqual([]);
  });

  it("skips blank lines", () => {
    const stdout = "\nBOOMI_ACCOUNT_ID: SET\n\nBOOMI_FOLDER: UNSET\n";
    const entries = parseEnvCheckOutput(stdout);
    expect(entries).toHaveLength(2);
  });
});
