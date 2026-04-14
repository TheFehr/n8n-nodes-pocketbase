import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

async function getLatestPocketbaseVersion() {
  const response = await fetch(
    "https://api.github.com/repos/pocketbase/pocketbase/releases/latest",
  );
  const data = (await response.json()) as { tag_name: string };
  return data.tag_name.replace(/^v/, "");
}

async function getLatestN8nVersion() {
  const response = await fetch("https://registry.npmjs.org/n8n/latest");
  const data = (await response.json()) as { version: string };
  return data.version;
}

async function updateReadme(pbVersion: string, n8nVersion: string) {
  const readmePath = join(process.cwd(), "README.md");
  let content = readFileSync(readmePath, "utf8");

  // Replace "This was developed for version X of n8n and version Y of PocketBase."
  const regex =
    /This was developed for version ([\d.]+) of n8n and version ([\d.]+) of PocketBase\./;
  const replacement = `This was developed for version ${n8nVersion} of n8n and version ${pbVersion} of PocketBase.`;

  if (regex.test(content)) {
    content = content.replace(regex, replacement);
  } else {
    // If the sentence is different, maybe it's the first time?
    // Just append or look for another pattern.
    console.warn("Could not find exact version sentence in README.md");
  }

  writeFileSync(readmePath, content);
}

async function main() {
  try {
    const pbVersion = await getLatestPocketbaseVersion();
    const n8nVersion = await getLatestN8nVersion();

    console.log(`Latest PocketBase: ${pbVersion}`);
    console.log(`Latest n8n: ${n8nVersion}`);

    await updateReadme(pbVersion, n8nVersion);
    console.log("README.md updated successfully.");
  } catch (error) {
    console.error("Error updating versions:", error);
    process.exit(1);
  }
}

main();
