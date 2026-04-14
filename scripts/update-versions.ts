import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

async function getLatestPocketbaseVersion() {
	const url = "https://api.github.com/repos/pocketbase/pocketbase/releases/latest";
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch PocketBase version from ${url}: ${response.status} ${response.statusText}`);
	}
	const data = (await response.json()) as { tag_name: string };
	return data.tag_name.replace(/^v/, "");
}

async function getLatestN8nVersion() {
	const url = "https://registry.npmjs.org/n8n/latest";
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch n8n version from ${url}: ${response.status} ${response.statusText}`);
	}
	const data = (await response.json()) as { version: string };
	return data.version;
}

async function updatePackageJson(pbVersion: string, n8nVersion: string, dryRun: boolean) {
	const packageJsonPath = join(process.cwd(), "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

	const oldN8nVersion = packageJson.peerDependencies["n8n-workflow"];
	const newN8nVersion = `^${n8nVersion}`;
	const oldPbVersion = packageJson.pocketbaseVersion;

	let updated = false;
	if (oldN8nVersion !== newN8nVersion) {
		console.log(`package.json: peerDependencies.n8n-workflow (${oldN8nVersion} -> ${newN8nVersion})`);
		if (!dryRun) {
			packageJson.peerDependencies["n8n-workflow"] = newN8nVersion;
		}
		updated = true;
	}

	if (oldPbVersion !== pbVersion) {
		console.log(`package.json: pocketbaseVersion (${oldPbVersion} -> ${pbVersion})`);
		if (!dryRun) {
			packageJson.pocketbaseVersion = pbVersion;
		}
		updated = true;
	}

	if (updated && !dryRun) {
		writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
	}

	return { packageName: packageJson.name as string, updated };
}

async function updateReadme(pbVersion: string, n8nVersion: string, packageName: string, dryRun: boolean) {
  const readmePath = join(process.cwd(), "README.md");
  let content = readFileSync(readmePath, "utf8");
	let updated = false;

  // Replace title "# old-name" with "# new-name"
  const titleRegex = /^#\s+(.+)$/m;
  const titleMatch = content.match(titleRegex);
  if (titleMatch && titleMatch[1] !== packageName) {
		console.log(`README.md: title (# ${titleMatch[1]} -> # ${packageName})`);
    content = content.replace(titleRegex, `# ${packageName}`);
		updated = true;
  }

  // Replace "This was developed for version X of n8n and version Y of PocketBase."
  const regex =
    /This was developed for version ([\d.]+) of n8n and version ([\d.]+) of PocketBase\./;
  const replacement = `This was developed for version ${n8nVersion} of n8n and version ${pbVersion} of PocketBase.`;

	const match = content.match(regex);
	if (match) {
		if (match[0] !== replacement) {
			console.log(`README.md: compatibility (${match[0]} -> ${replacement})`);
			content = content.replace(regex, replacement);
			updated = true;
		}
	} else {
		throw new Error(`Could not find expected compatibility sentence in README.md: ${regex.source}`);
	}

	if (updated && !dryRun) {
  	writeFileSync(readmePath, content);
	}
	return updated;
}

async function updateDockerCompose(pbVersion: string, n8nVersion: string, packageName: string, dryRun: boolean) {
	const composePath = join(process.cwd(), "docker-compose.test.yml");
	let content = readFileSync(composePath, "utf8");
	let updated = false;

	const pbRegex = /image: ghcr\.io\/muchobien\/pocketbase:([\d.]+)/;
	const pbMatch = content.match(pbRegex);
	if (pbMatch) {
		const pbReplacement = `image: ghcr.io/muchobien/pocketbase:${pbVersion}`;
		if (pbMatch[0] !== pbReplacement) {
			console.log(`docker-compose.test.yml: pocketbase image (${pbMatch[0]} -> ${pbReplacement})`);
			content = content.replace(pbRegex, pbReplacement);
			updated = true;
		}
	} else {
		throw new Error(`Could not find expected pocketbase image in docker-compose.test.yml: ${pbRegex.source}`);
	}

	const n8nRegex = /image: n8nio\/n8n:([\d.]+)/;
	const n8nMatch = content.match(n8nRegex);
	if (n8nMatch) {
		const n8nReplacement = `image: n8nio/n8n:${n8nVersion}`;
		if (n8nMatch[0] !== n8nReplacement) {
			console.log(`docker-compose.test.yml: n8n image (${n8nMatch[0]} -> ${n8nReplacement})`);
			content = content.replace(n8nRegex, n8nReplacement);
			updated = true;
		}
	} else {
		throw new Error(`Could not find expected n8n image in docker-compose.test.yml: ${n8nRegex.source}`);
	}

	// Update symlink path in entrypoint: .../node_modules/old-name
	const symlinkRegex = /(ln -sf \/home\/node\/custom-nodes \/home\/node\/\.n8n\/nodes\/node_modules\/)([^\s&]+)/;
	const symlinkMatch = content.match(symlinkRegex);
	if (symlinkMatch && symlinkMatch[2] !== packageName) {
		console.log(`docker-compose.test.yml: symlink path (.../node_modules/${symlinkMatch[2]} -> .../node_modules/${packageName})`);
		content = content.replace(symlinkRegex, `$1${packageName}`);
		updated = true;
	}

	if (updated && !dryRun) {
		writeFileSync(composePath, content);
	}
	return updated;
}

async function updateIntegrationTest(packageName: string, dryRun: boolean) {
	const testPath = join(process.cwd(), "tests", "workflows", "integration_test.json");
	let content = readFileSync(testPath, "utf8");

	// Update node types: "type": "old-name.pocketbaseHttp"
	const typeRegex = /"type": "([^"]+)\.pocketbaseHttp"/g;
	const matches = Array.from(content.matchAll(typeRegex));
	let updated = false;
	for (const match of matches) {
		if (match[1] !== packageName) {
			console.log(`integration_test.json: node type (${match[1]}.pocketbaseHttp -> ${packageName}.pocketbaseHttp)`);
			content = content.replaceAll(`"type": "${match[1]}.pocketbaseHttp"`, `"type": "${packageName}.pocketbaseHttp"`);
			updated = true;
			break;
		}
	}

	if (updated && !dryRun) {
		writeFileSync(testPath, content);
	}
	return updated;
}

async function updateNodeJson(packageName: string, dryRun: boolean) {
	const nodeJsonPath = join(process.cwd(), "nodes", "PocketbaseHttp", "PocketbaseHttp.node.json");
	let content = readFileSync(nodeJsonPath, "utf8");
	const nodeJson = JSON.parse(content);

	let updated = false;
	if (nodeJson.node !== `${packageName}-http`) {
		console.log(`PocketbaseHttp.node.json: node (${nodeJson.node} -> ${packageName}-http)`);
		nodeJson.node = `${packageName}-http`;
		updated = true;
	}

	// Update URLs in documentation
	const urlRegex = /https:\/\/github\.com\/([^\/]+)\/([^\/#\s"]+)(#[^\s"]*)?/g;
	const originalContent = JSON.stringify(nodeJson, null, 2);
	const updatedContent = originalContent.replace(urlRegex, (match, org, repo, anchor) => {
		if (repo !== packageName && (repo === "n8n-nodes-pocketbase" || repo.startsWith("n8n-nodes-"))) {
			return `https://github.com/${org}/${packageName}${anchor || ""}`;
		}
		return match;
	});

	if (updatedContent !== originalContent) {
		console.log(`PocketbaseHttp.node.json: GitHub URLs updated to use ${packageName}`);
		if (!dryRun) {
			writeFileSync(nodeJsonPath, updatedContent + "\n");
		}
		return true;
	} else if (updated) {
		if (!dryRun) {
			writeFileSync(nodeJsonPath, JSON.stringify(nodeJson, null, 2) + "\n");
		}
		return true;
	}
	return false;
}

async function main() {
  try {
    const isCheck = process.argv.includes("--check");

    const pbVersion = await getLatestPocketbaseVersion();
    const n8nVersion = await getLatestN8nVersion();

    console.log(`Latest PocketBase: ${pbVersion}`);
    console.log(`Latest n8n: ${n8nVersion}`);

		const { packageName, updated: packageUpdated } = await updatePackageJson(pbVersion, n8nVersion, isCheck);
    const readmeUpdated = await updateReadme(pbVersion, n8nVersion, packageName, isCheck);
    const dockerUpdated = await updateDockerCompose(pbVersion, n8nVersion, packageName, isCheck);
    const testUpdated = await updateIntegrationTest(packageName, isCheck);
    const nodeJsonUpdated = await updateNodeJson(packageName, isCheck);

    const anyUpdated = packageUpdated || readmeUpdated || dockerUpdated || testUpdated || nodeJsonUpdated;

    if (anyUpdated) {
      if (isCheck) {
        console.log("\nDesync or updates found. Please run 'npm run version:update' to synchronize.");
        process.exit(1);
      } else {
        console.log("\nProject files updated successfully.");
      }
    } else {
      console.log("\nEverything is up to date.");
    }
  } catch (error) {
    console.error("Error updating versions:", error);
    process.exit(1);
  }
}

main();
