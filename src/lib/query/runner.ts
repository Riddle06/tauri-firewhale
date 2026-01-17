import type { QueryAst, QueryRunResult, QueryValue, WhereClause } from "./types";

type Row = Record<string, QueryValue | string[] | number[] | boolean[] | number | string>;

const MOCK_DATA: Record<string, Row[]> = {
  users: [
    { id: "users-1", name: "Avery", status: "active", age: 24, createdAt: 1693500000000, tags: ["beta", "alpha"], score: 87, active: true },
    { id: "users-2", name: "Blake", status: "inactive", age: 17, createdAt: 1693600000000, tags: ["gamma"], score: 72, active: false },
    { id: "users-3", name: "Casey", status: "active", age: 33, createdAt: 1693700000000, tags: ["alpha", "delta"], score: 91, active: true },
    { id: "users-4", name: "Devon", status: "pending", age: 29, createdAt: 1693800000000, tags: ["beta"], score: 65, active: false },
    { id: "users-5", name: "Emerson", status: "active", age: 41, createdAt: 1693900000000, tags: ["alpha", "epsilon"], score: 95, active: true }
  ],
  orders: [
    { id: "orders-1", status: "active", amount: 120, createdAt: 1693500000000, customer: "Avery", tags: ["priority"] },
    { id: "orders-2", status: "inactive", amount: 45, createdAt: 1693525000000, customer: "Blake", tags: ["standard"] },
    { id: "orders-3", status: "active", amount: 320, createdAt: 1693575000000, customer: "Casey", tags: ["priority", "gift"] },
    { id: "orders-4", status: "pending", amount: 78, createdAt: 1693625000000, customer: "Devon", tags: ["standard"] }
  ],
  projects: [
    { id: "projects-1", status: "active", createdAt: 1693400000000, owner: "Avery", budget: 5000, tags: ["alpha"] },
    { id: "projects-2", status: "active", createdAt: 1693600000000, owner: "Casey", budget: 12000, tags: ["beta"] },
    { id: "projects-3", status: "inactive", createdAt: 1693800000000, owner: "Emerson", budget: 8000, tags: ["gamma"] }
  ]
};

function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}

function seededNumber(seed: number): number {
  const next = Math.sin(seed) * 10000;
  return next - Math.floor(next);
}

function generateMockDocs(collectionPath: string, count = 25): Row[] {
  const seed = hashString(collectionPath);
  const statuses = ["active", "inactive", "pending"] as const;
  const tags = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
  const rows: Row[] = [];

  for (let i = 0; i < count; i += 1) {
    const rand = seededNumber(seed + i);
    const age = Math.floor(18 + rand * 40);
    const status = statuses[Math.floor(rand * statuses.length)];
    const createdAt = 1693000000000 + Math.floor(rand * 1000000000);
    rows.push({
      id: `${collectionPath}-${i + 1}`,
      name: `Item ${i + 1}`,
      status,
      age,
      createdAt,
      score: Math.floor(rand * 100),
      tags: [tags[i % tags.length], tags[(i + 2) % tags.length]],
      active: status === "active"
    });
  }

  return rows;
}

function getCollectionRows(collectionPath: string): Row[] {
  if (MOCK_DATA[collectionPath]) {
    return MOCK_DATA[collectionPath].map((row) => ({ ...row }));
  }
  return generateMockDocs(collectionPath);
}

function compareValues(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function applyWhere(rows: Row[], clause: WhereClause): Row[] {
  return rows.filter((row) => {
    const value = row[clause.field];
    switch (clause.op) {
      case "==":
        return value === clause.value;
      case "!=":
        return value !== clause.value;
      case "<":
        return value < clause.value;
      case "<=":
        return value <= clause.value;
      case ">":
        return value > clause.value;
      case ">=":
        return value >= clause.value;
      case "in":
        return Array.isArray(clause.value) && clause.value.includes(value as QueryValue);
      case "array-contains":
        return Array.isArray(value) && value.includes(clause.value as QueryValue);
      case "array-contains-any":
        return (
          Array.isArray(value) &&
          Array.isArray(clause.value) &&
          clause.value.some((entry) => value.includes(entry))
        );
      default:
        return false;
    }
  });
}

export async function runQueryAst(ast: QueryAst): Promise<QueryRunResult> {
  const start = Date.now();
  let rows = getCollectionRows(ast.collectionPath);

  for (const clause of ast.where) {
    rows = applyWhere(rows, clause);
  }

  for (const order of ast.orderBy) {
    const dir = order.dir === "desc" ? -1 : 1;
    rows = [...rows].sort((left, right) => compareValues(left[order.field], right[order.field]) * dir);
  }

  if (ast.limit !== undefined) {
    rows = rows.slice(0, ast.limit);
  }

  return {
    rows,
    warnings: ["Mock data runner in use."],
    durationMs: Date.now() - start
  };
}
