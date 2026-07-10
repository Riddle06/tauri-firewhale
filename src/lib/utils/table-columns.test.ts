import { describe, expect, test } from "bun:test";
import { moveTableColumn, orderTableColumns } from "$lib/utils/table-columns";

describe("orderTableColumns", () => {
  test("keeps a saved order and appends new columns", () => {
    expect(orderTableColumns(["id", "name", "email"], ["email", "id"])).toEqual([
      "email",
      "id",
      "name"
    ]);
  });

  test("ignores unavailable and duplicate saved columns", () => {
    expect(orderTableColumns(["id", "name"], ["missing", "name", "name"])).toEqual([
      "name",
      "id"
    ]);
  });
});

describe("moveTableColumn", () => {
  test("moves a column before or after a drop target", () => {
    expect(moveTableColumn(["id", "name", "email"], "email", "id", false)).toEqual([
      "email",
      "id",
      "name"
    ]);
    expect(moveTableColumn(["id", "name", "email"], "id", "name", true)).toEqual([
      "name",
      "id",
      "email"
    ]);
  });
});
