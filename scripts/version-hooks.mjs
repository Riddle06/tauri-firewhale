#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const PACKAGE_JSON_PATH = "package.json";
const TAURI_CONF_PATH = "src-tauri/tauri.conf.json";
const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readJson(filePath) {
  const content = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(filePath, content, "utf8");
}

function ensureVersion(version, filePath) {
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error(`Missing or invalid "version" in ${filePath}.`);
  }
  return version.trim();
}

function readVersions() {
  const packageJson = readJson(PACKAGE_JSON_PATH);
  const tauriConf = readJson(TAURI_CONF_PATH);

  return {
    packageVersion: ensureVersion(packageJson.version, PACKAGE_JSON_PATH),
    tauriVersion: ensureVersion(tauriConf.version, TAURI_CONF_PATH),
  };
}

function stageFiles(paths) {
  if (paths.length === 0) {
    return;
  }

  const result = spawnSync("git", ["add", ...paths], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    const detail = result.stderr?.trim() || "unknown error";
    throw new Error(`Failed to stage files with git add: ${detail}`);
  }
}

function syncVersion(targetVersion) {
  const changedPaths = [];

  const packageJson = readJson(PACKAGE_JSON_PATH);
  if (packageJson.version !== targetVersion) {
    packageJson.version = targetVersion;
    writeJson(PACKAGE_JSON_PATH, packageJson);
    changedPaths.push(PACKAGE_JSON_PATH);
  }

  const tauriConf = readJson(TAURI_CONF_PATH);
  if (tauriConf.version !== targetVersion) {
    tauriConf.version = targetVersion;
    writeJson(TAURI_CONF_PATH, tauriConf);
    changedPaths.push(TAURI_CONF_PATH);
  }

  stageFiles(changedPaths);
  return changedPaths;
}

function parseTagVersion(tagName) {
  if (VERSION_PATTERN.test(tagName)) {
    return tagName;
  }

  if (tagName.startsWith("v")) {
    const withoutPrefix = tagName.slice(1);
    if (VERSION_PATTERN.test(withoutPrefix)) {
      return withoutPrefix;
    }
  }

  return null;
}

function parseVersionTags(pushRefsInput) {
  const tags = [];
  const lines = pushRefsInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const [localRef] = line.split(/\s+/);
    if (!localRef || localRef === "(delete)") {
      continue;
    }

    if (!localRef.startsWith("refs/tags/")) {
      continue;
    }

    const tagName = localRef.slice("refs/tags/".length);
    const version = parseTagVersion(tagName);
    if (!version) {
      continue;
    }

    tags.push({ name: tagName, version });
  }

  return tags;
}

function runPreCommit() {
  const { packageVersion, tauriVersion } = readVersions();
  if (packageVersion === tauriVersion) {
    return;
  }

  const changedPaths = syncVersion(packageVersion);
  if (changedPaths.length > 0) {
    console.log(
      `[version-hook] Synced version to ${packageVersion}: ${changedPaths.join(", ")}`,
    );
  }
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return "";
  }

  let output = "";
  for await (const chunk of process.stdin) {
    output += chunk;
  }
  return output;
}

async function runPrePush() {
  const pushRefsInput = await readStdin();
  const versionTags = parseVersionTags(pushRefsInput);
  if (versionTags.length === 0) {
    return;
  }

  const uniqueVersions = [...new Set(versionTags.map((tag) => tag.version))];
  if (uniqueVersions.length > 1) {
    const versions = uniqueVersions.join(", ");
    throw new Error(
      `Multiple version tags detected in one push (${versions}). Push a single release version at a time.`,
    );
  }

  const targetVersion = uniqueVersions[0];
  const { packageVersion, tauriVersion } = readVersions();

  if (packageVersion === targetVersion && tauriVersion === targetVersion) {
    return;
  }

  const changedPaths = syncVersion(targetVersion);
  const tagList = versionTags.map((tag) => tag.name).join(", ");

  console.error(
    `[version-hook] Updated files to ${targetVersion} for tag(s): ${tagList}.`,
  );
  console.error(`[version-hook] Changed: ${changedPaths.join(", ")}.`);
  console.error(
    "[version-hook] Please commit these changes, re-point/recreate the tag, then push again.",
  );
  process.exit(1);
}

async function main() {
  const mode = process.argv[2];

  if (mode === "pre-commit") {
    runPreCommit();
    return;
  }

  if (mode === "pre-push") {
    await runPrePush();
    return;
  }

  throw new Error(`Unknown mode: ${mode}. Expected "pre-commit" or "pre-push".`);
}

main().catch((error) => {
  console.error(`[version-hook] ${error.message}`);
  process.exit(1);
});
