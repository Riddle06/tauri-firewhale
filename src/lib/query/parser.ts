import { parseFieldPath, resolveProjectionField } from "./field-path";
import { WHERE_OPERATORS } from "./types";
import type {
  JoinClause,
  OrderByClause,
  QueryAst,
  QueryParseResult,
  QueryValue,
  WhereClause,
  WhereOperator
} from "./types";

type TokenType = "identifier" | "string" | "number" | "boolean" | "null" | "punct" | "eof";
type Token = { type: TokenType; value: string; pos: number };

const PUNCT = new Set([".", "(", ")", ",", "[", "]", ";"]);

class QueryParseError extends Error {
  position: number;

  constructor(message: string, position: number) {
    super(message);
    this.position = position;
  }
}

function normalizeSmartQuotes(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
    .replace(/\uFF07/g, "'")
    .replace(/\uFF02/g, "\"");
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierChar(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (PUNCT.has(char)) {
      tokens.push({ type: "punct", value: char, pos: index });
      index += 1;
      continue;
    }

    if (char === "'" || char === "\"") {
      const quote = char;
      let value = "";
      index += 1;
      while (index < input.length) {
        const next = input[index];
        if (next === "\\") {
          const escaped = input[index + 1];
          if (escaped) {
            value += escaped;
            index += 2;
            continue;
          }
        }
        if (next === quote) {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      tokens.push({ type: "string", value, pos: index });
      continue;
    }

    if (char === "-" || /[0-9]/.test(char)) {
      const start = index;
      let hasDot = false;
      if (char === "-") index += 1;
      while (index < input.length) {
        const digit = input[index];
        if (digit === ".") {
          if (hasDot) break;
          hasDot = true;
          index += 1;
          continue;
        }
        if (!/[0-9]/.test(digit)) break;
        index += 1;
      }
      const raw = input.slice(start, index);
      tokens.push({ type: "number", value: raw, pos: start });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      let value = char;
      index += 1;
      while (index < input.length && isIdentifierChar(input[index])) {
        value += input[index];
        index += 1;
      }
      if (value === "true" || value === "false") {
        tokens.push({ type: "boolean", value, pos: start });
      } else if (value === "null") {
        tokens.push({ type: "null", value, pos: start });
      } else {
        tokens.push({ type: "identifier", value, pos: start });
      }
      continue;
    }

    throw new QueryParseError(`Unexpected character: ${char}`, index);
  }

  tokens.push({ type: "eof", value: "", pos: input.length });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private cursor = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token {
    return this.tokens[this.cursor] ?? { type: "eof", value: "", pos: 0 };
  }

  consume(): Token {
    const token = this.peek();
    this.cursor += 1;
    return token;
  }

  match(type: TokenType, value?: string): boolean {
    const token = this.peek();
    if (token.type !== type) return false;
    if (value !== undefined && token.value !== value) return false;
    return true;
  }

  expect(type: TokenType, value?: string): Token {
    const token = this.peek();
    if (!this.match(type, value)) {
      const expected = value ? `${type} '${value}'` : type;
      throw new QueryParseError(`Expected ${expected}`, token.pos);
    }
    return this.consume();
  }

  skipPunct(value: string): void {
    if (this.match("punct", value)) this.consume();
  }
}

function parseString(parser: Parser, label: string): string {
  const token = parser.expect("string");
  if (!token.value) {
    throw new QueryParseError(`${label} must be a non-empty string`, token.pos);
  }
  return token.value;
}

function parseValue(parser: Parser): QueryValue {
  const token = parser.peek();
  if (token.type === "string") return parser.consume().value;
  if (token.type === "number") return Number(parser.consume().value);
  if (token.type === "boolean") return parser.consume().value === "true";
  if (token.type === "null") {
    parser.consume();
    return null;
  }
  if (parser.match("punct", "[")) {
    parser.consume();
    const values: QueryValue[] = [];
    while (!parser.match("punct", "]")) {
      values.push(parseValue(parser));
      if (parser.match("punct", ",")) {
        parser.consume();
        if (parser.match("punct", "]")) break;
      } else {
        break;
      }
    }
    parser.expect("punct", "]");
    return values as QueryValue;
  }
  throw new QueryParseError("Expected value", token.pos);
}

function parseWhere(parser: Parser): WhereClause {
  const field = parseString(parser, "where field");
  parser.expect("punct", ",");
  const op = parseString(parser, "where operator");
  parser.expect("punct", ",");
  const value = parseValue(parser);
  parser.expect("punct", ")");
  return { field, op: op as WhereOperator, value };
}

function parseJoin(parser: Parser): JoinClause {
  const collectionPath = parseString(parser, "join collection path");
  parser.expect("punct", ",");
  const alias = parseString(parser, "join alias");
  parser.expect("punct", ",");
  const leftField = parseString(parser, "join left field").trim();
  parser.expect("punct", ",");
  const op = parseString(parser, "join operator");
  parser.expect("punct", ",");
  const rightField = parseString(parser, "join right field").trim();
  parser.expect("punct", ")");
  return { collectionPath, alias, leftField, op: op as "==", rightField };
}

function parseOrderBy(parser: Parser): OrderByClause {
  const field = parseString(parser, "orderBy field");
  let dir: OrderByClause["dir"] = "asc";
  if (parser.match("punct", ",")) {
    parser.consume();
    const dirValue = parseString(parser, "orderBy direction");
    dir = dirValue === "desc" ? "desc" : "asc";
  }
  parser.expect("punct", ")");
  return { field, dir };
}

function parseLimit(parser: Parser): number {
  const token = parser.expect("number");
  const value = Number(token.value);
  parser.expect("punct", ")");
  return value;
}

function parseSelect(parser: Parser): string[] {
  if (parser.match("punct", ")")) {
    throw new QueryParseError("select() requires at least one field.", parser.peek().pos);
  }
  const fields = [parseString(parser, "select field")];
  while (parser.match("punct", ",")) {
    parser.consume();
    if (parser.match("punct", ")")) break;
    fields.push(parseString(parser, "select field"));
  }
  parser.expect("punct", ")");
  return fields;
}

export function parseQueryChain(input: string): QueryParseResult {
  const normalizedInput = normalizeSmartQuotes(input);
  if (!normalizedInput.trim()) {
    return { ok: false, error: "Query is required." };
  }

  try {
    const tokens = lex(normalizedInput);
    const parser = new Parser(tokens);
    let sawDb = false;

    if (parser.match("identifier", "db")) {
      sawDb = true;
      parser.consume();
      parser.expect("punct", ".");
    }

    if (!parser.match("identifier", "collection")) {
      const prefix = sawDb ? "db.collection" : "collection";
      throw new QueryParseError(`Query must start with ${prefix}()`, parser.peek().pos);
    }

    parser.consume();
    parser.expect("punct", "(");
    const collectionPath = parseString(parser, "collection path");
    let collectionAlias: string | undefined;
    if (parser.match("punct", ",")) {
      parser.consume();
      collectionAlias = parseString(parser, "collection alias");
    }
    parser.expect("punct", ")");

    const ast: QueryAst = {
      collectionPath,
      collectionAlias,
      joins: [],
      where: [],
      orderBy: []
    };

    while (!parser.match("eof")) {
      if (parser.match("punct", ";")) {
        parser.consume();
        parser.expect("eof");
        break;
      }
      parser.expect("punct", ".");
      const { value: method, pos } = parser.expect("identifier");
      if (ast.operation) {
        throw new QueryParseError(`.${ast.operation}() must be the last method.`, pos);
      }
      parser.expect("punct", "(");
      switch (method) {
        case "where":
          ast.where.push(parseWhere(parser));
          break;
        case "join":
          (ast.joins ??= []).push(parseJoin(parser));
          break;
        case "orderBy":
          ast.orderBy.push(parseOrderBy(parser));
          break;
        case "limit":
          ast.limit = parseLimit(parser);
          break;
        case "select":
          if (ast.select) {
            throw new QueryParseError("Only one select() is allowed.", pos);
          }
          ast.select = parseSelect(parser);
          break;
        case "get":
        case "count":
          parser.expect("punct", ")");
          ast.operation = method;
          break;
        default:
          throw new QueryParseError(`Unknown method: ${method}`, pos);
      }
    }

    return { ok: true, ast };
  } catch (error) {
    if (error instanceof QueryParseError) {
      return { ok: false, error: error.message, position: error.position };
    }
    return { ok: false, error: "Failed to parse query." };
  }
}

export function validateQueryAst(ast: QueryAst): string[] {
  const errors: string[] = [];
  if (!ast.collectionPath) {
    errors.push("collection() requires a collection path.");
  }
  if (!ast.operation) {
    errors.push("Query must end with .get() or .count().");
  }
  const joins = ast.joins ?? [];
  if (ast.operation === "count" && joins.length > 0) {
    errors.push("count() cannot be combined with join().");
  }
  if (ast.select) {
    if (ast.operation === "count") errors.push("select() cannot be combined with count().");
    if (ast.select.length === 0) errors.push("select() requires at least one field.");
    const selectedPaths = new Set<string>();
    for (const field of ast.select) {
      const selection = resolveProjectionField(field, ast.collectionAlias, joins);
      const path = parseFieldPath(selection.field);
      if (!path) {
        errors.push(`Invalid select() field path: ${field}.`);
        continue;
      }
      const key = JSON.stringify([selection.joinAlias ?? null, ...path]);
      if (selectedPaths.has(key)) {
        errors.push(`Duplicate select() field: ${field}.`);
      }
      selectedPaths.add(key);
    }
  }
  const isAlias = (value: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
  const aliases = new Set<string>();
  if (ast.collectionAlias) {
    if (!isAlias(ast.collectionAlias)) errors.push("collection() alias must be an identifier.");
    aliases.add(ast.collectionAlias);
  }
  for (const join of joins) {
    if (!join.collectionPath) errors.push("join() requires a collection path.");
    if (!isAlias(join.alias)) errors.push("join() alias must be an identifier.");
    if (aliases.has(join.alias)) {
      errors.push(`Duplicate collection alias: ${join.alias}.`);
    }
    if (join.op !== "==") errors.push("join() supports only the == operator.");
    const targetPrefix = `${join.alias}.`;
    if (!join.leftField.startsWith(targetPrefix) || join.leftField === targetPrefix) {
      errors.push(`join() left field must reference ${join.alias}.`);
    }
    const sourceAlias = join.rightField.split(".")[0] ?? "";
    if (
      ast.collectionAlias &&
      join.rightField.includes(".") &&
      sourceAlias !== ast.collectionAlias &&
      !aliases.has(sourceAlias)
    ) {
      errors.push(`Unknown or forward join alias: ${sourceAlias}.`);
    }
    aliases.add(join.alias);
  }
  const joinedPrefixes = joins.map((join) => `${join.alias}.`);
  for (const clause of [...ast.where, ...ast.orderBy]) {
    if (joinedPrefixes.some((prefix) => clause.field.startsWith(prefix))) {
      errors.push("where() and orderBy() can only reference the main collection.");
    }
  }
  for (const clause of ast.where) {
    if (!WHERE_OPERATORS.includes(clause.op)) {
      errors.push(`Unsupported operator: ${clause.op}.`);
    }
    if ((clause.op === "in" || clause.op === "array-contains-any") && !Array.isArray(clause.value)) {
      errors.push(`${clause.op} expects an array value.`);
    }
    if (clause.op === "array-contains" && Array.isArray(clause.value)) {
      errors.push("array-contains expects a single value.");
    }
  }
  if (ast.limit !== undefined) {
    if (!Number.isFinite(ast.limit) || ast.limit <= 0 || !Number.isInteger(ast.limit)) {
      errors.push("limit() must be a positive integer.");
    }
  }
  for (const clause of ast.orderBy) {
    if (clause.dir !== "asc" && clause.dir !== "desc") {
      errors.push(`orderBy direction must be 'asc' or 'desc'.`);
    }
  }
  return errors;
}
