import { describe, expect, test } from "bun:test";
import {
  compareStableVersions,
  isVersionNewer,
  normalizeStableVersion,
  pickLatestStableRelease
} from "./releases";

describe("normalizeStableVersion", () => {
  test("normalizes versions with a leading v", () => {
    expect(normalizeStableVersion("v1.2.3")).toBe("1.2.3");
  });

  test("returns null for pre-release tags", () => {
    expect(normalizeStableVersion("v1.2.3-beta.1")).toBe(null);
  });
});

describe("compareStableVersions", () => {
  test("compares stable versions correctly", () => {
    expect(compareStableVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareStableVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareStableVersions("1.2.3", "1.2.4")).toBe(-1);
  });

  test("returns null when either side is not a stable semver", () => {
    expect(compareStableVersions("1.2.3-rc.1", "1.2.3")).toBe(null);
    expect(compareStableVersions("1.2", "1.2.3")).toBe(null);
  });
});

describe("isVersionNewer", () => {
  test("returns true only when candidate is newer", () => {
    expect(isVersionNewer("1.2.4", "1.2.3")).toBe(true);
    expect(isVersionNewer("1.2.3", "1.2.3")).toBe(false);
    expect(isVersionNewer("1.2.2", "1.2.3")).toBe(false);
  });
});

describe("pickLatestStableRelease", () => {
  test("picks highest non-draft, non-prerelease version", () => {
    const latest = pickLatestStableRelease([
      {
        tag_name: "v1.2.3",
        html_url: "https://example.com/v1.2.3",
        name: "v1.2.3",
        draft: false,
        prerelease: false
      },
      {
        tag_name: "v1.3.0-beta.1",
        html_url: "https://example.com/v1.3.0-beta.1",
        name: "v1.3.0-beta.1",
        draft: false,
        prerelease: true
      },
      {
        tag_name: "v1.4.0",
        html_url: "https://example.com/v1.4.0",
        name: "v1.4.0",
        draft: true,
        prerelease: false
      },
      {
        tag_name: "v1.2.9",
        html_url: "https://example.com/v1.2.9",
        name: "v1.2.9",
        draft: false,
        prerelease: false
      }
    ]);

    expect(latest).toEqual({
      version: "1.2.9",
      releaseUrl: "https://example.com/v1.2.9",
      title: "v1.2.9"
    });
  });

  test("returns null when payload has no stable release", () => {
    expect(
      pickLatestStableRelease([
        {
          tag_name: "v1.2.3-beta.2",
          html_url: "https://example.com/v1.2.3-beta.2",
          draft: false,
          prerelease: true
        }
      ])
    ).toBe(null);
    expect(pickLatestStableRelease({})).toBe(null);
  });
});
