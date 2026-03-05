export type StableRelease = {
  releaseUrl: string;
  title: string;
  version: string;
};

type ParsedStableVersion = {
  major: number;
  minor: number;
  patch: number;
  raw: string;
};

type ParsedStableRelease = StableRelease & {
  parsedVersion: ParsedStableVersion;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const STABLE_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

function parseStableVersion(version: string): ParsedStableVersion | null {
  const match = STABLE_VERSION_PATTERN.exec(version.trim());
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1] ?? "", 10);
  const minor = Number.parseInt(match[2] ?? "", 10);
  const patch = Number.parseInt(match[3] ?? "", 10);

  if (
    Number.isNaN(major) ||
    Number.isNaN(minor) ||
    Number.isNaN(patch)
  ) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    raw: `${major}.${minor}.${patch}`
  };
}

function compareParsedStableVersions(
  left: ParsedStableVersion,
  right: ParsedStableVersion
): number {
  if (left.major !== right.major) {
    return left.major > right.major ? 1 : -1;
  }
  if (left.minor !== right.minor) {
    return left.minor > right.minor ? 1 : -1;
  }
  if (left.patch !== right.patch) {
    return left.patch > right.patch ? 1 : -1;
  }
  return 0;
}

function toParsedStableRelease(value: unknown): ParsedStableRelease | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const release = value as Record<string, unknown>;
  if (release.draft === true || release.prerelease === true) {
    return null;
  }

  const tagName = release.tag_name;
  const htmlUrl = release.html_url;
  if (typeof tagName !== "string" || typeof htmlUrl !== "string") {
    return null;
  }

  const parsedVersion = parseStableVersion(tagName);
  if (!parsedVersion) {
    return null;
  }

  const name = release.name;
  const fallbackTitle = `v${parsedVersion.raw}`;
  const title =
    typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : fallbackTitle;

  return {
    version: parsedVersion.raw,
    releaseUrl: htmlUrl,
    title,
    parsedVersion
  };
}

export function normalizeStableVersion(version: string): string | null {
  const parsed = parseStableVersion(version);
  return parsed?.raw ?? null;
}

export function compareStableVersions(left: string, right: string): number | null {
  const parsedLeft = parseStableVersion(left);
  const parsedRight = parseStableVersion(right);

  if (!parsedLeft || !parsedRight) {
    return null;
  }

  return compareParsedStableVersions(parsedLeft, parsedRight);
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const compared = compareStableVersions(candidate, current);
  return compared !== null && compared > 0;
}

export function pickLatestStableRelease(payload: unknown): StableRelease | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  let latest: ParsedStableRelease | null = null;
  for (const entry of payload) {
    const candidate = toParsedStableRelease(entry);
    if (!candidate) {
      continue;
    }
    if (
      !latest ||
      compareParsedStableVersions(candidate.parsedVersion, latest.parsedVersion) > 0
    ) {
      latest = candidate;
    }
  }

  if (!latest) {
    return null;
  }

  return {
    version: latest.version,
    releaseUrl: latest.releaseUrl,
    title: latest.title
  };
}

export async function fetchLatestStableRelease(
  owner: string,
  repo: string,
  fetcher: Fetcher = fetch
): Promise<StableRelease | null> {
  const ownerPath = encodeURIComponent(owner);
  const repoPath = encodeURIComponent(repo);
  const endpoint = `https://api.github.com/repos/${ownerPath}/${repoPath}/releases?per_page=30`;

  const response = await fetcher(endpoint, {
    headers: {
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub release request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  return pickLatestStableRelease(payload);
}
