import { WHERE_OPERATORS } from "./types";
import type {
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

function parseGet(parser: Parser): void {
  parser.expect("punct", ")");
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
    parser.expect("punct", ")");

    const ast: QueryAst = {
      collectionPath,
      where: [],
      orderBy: [],
      get: false
    };

    while (!parser.match("eof")) {
      if (parser.match("punct", ";")) {
        parser.consume();
        break;
      }
      parser.expect("punct", ".");
      const method = parser.expect("identifier").value;
      parser.expect("punct", "(");
      switch (method) {
        case "where":
          ast.where.push(parseWhere(parser));
          break;
        case "orderBy":
          ast.orderBy.push(parseOrderBy(parser));
          break;
        case "limit":
          ast.limit = parseLimit(parser);
          break;
        case "get":
          parseGet(parser);
          ast.get = true;
          break;
        default:
          throw new QueryParseError(`Unknown method: ${method}`, parser.peek().pos);
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
  if (!ast.get) {
    errors.push("Query must end with .get().");
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
