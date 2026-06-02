import https from "https";
import fs from "fs";
import path from "path";

const SCRIPTS_DIR = path.resolve(process.cwd(), "boomi-companion-scripts");
const BASE_URL =
  "https://raw.githubusercontent.com/OfficialBoomi/bc-integration/main/skills/boomi-integration/scripts";

const SCRIPT_FILES = [
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
];

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            file.close();
            fs.unlinkSync(dest);
            reject(new Error(`Redirect without location for ${url}`));
            return;
          }
          file.close();
          fs.unlinkSync(dest);
          downloadFile(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(
            new Error(`Failed to download ${url}: HTTP ${response.statusCode}`),
          );
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
  });
}

function scriptsExist(): boolean {
  if (!fs.existsSync(SCRIPTS_DIR)) return false;
  for (const file of SCRIPT_FILES) {
    const filePath = path.join(SCRIPTS_DIR, file);
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return false;
    if ((file.endsWith(".sh") || file.endsWith(".py")) && (stat.mode & 0o111) === 0) {
      return false;
    }
  }
  return true;
}

async function main() {
  if (scriptsExist()) {
    console.log("All vendored scripts already present. Skipping download.");
    return;
  }

  console.log(`Setting up vendored scripts in ${SCRIPTS_DIR}...`);

  if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }

  let downloaded = 0;
  const failed: string[] = [];

  for (const file of SCRIPT_FILES) {
    const url = `${BASE_URL}/${file}`;
    const dest = path.join(SCRIPTS_DIR, file);
    try {
      console.log(`  Downloading ${file}...`);
      await downloadFile(url, dest);
      if (file.endsWith(".sh") || file.endsWith(".py")) {
        fs.chmodSync(dest, 0o755);
      }
      downloaded++;
    } catch (err) {
      console.error(`  FAILED ${file}: ${err instanceof Error ? err.message : String(err)}`);
      failed.push(file);
    }
  }

  console.log(`\nDownloaded ${downloaded}/${SCRIPT_FILES.length} scripts.`);
  if (failed.length > 0) {
    console.error(`Failed files: ${failed.join(", ")}`);
    process.exit(1);
  }

  if (scriptsExist()) {
    console.log("All vendored scripts verified and executable.");
  } else {
    console.error("Verification failed — some scripts are missing or empty after download.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Script setup failed:", err.message);
  process.exit(1);
});
