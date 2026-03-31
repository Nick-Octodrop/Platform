import { evalCondition } from "./conditions.js";

function getFieldList(fieldIndex) {
  return Object.values(fieldIndex || {}).filter((field) => field && typeof field === "object");
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveRef(ref, context) {
  if (typeof ref !== "string") return undefined;
  const current = context.current || {};
  const parent = context.parent || {};
  const record = context.record || current;
  if (ref.startsWith("$current.")) return current[ref.slice("$current.".length)];
  if (ref.startsWith("$parent.")) return parent[ref.slice("$parent.".length)];
  if (ref.startsWith("$record.")) return record[ref.slice("$record.".length)];
  if (ref in current) return current[ref];
  if (ref in record) return record[ref];
  if (ref in parent) return parent[ref];
  return undefined;
}

function evaluateExpression(expr, context) {
  if (expr === null || expr === undefined) return expr;
  if (typeof expr === "string" || typeof expr === "number" || typeof expr === "boolean") return expr;
  if (typeof expr === "object" && "ref" in expr) return resolveRef(expr.ref, context);
  if (!expr || typeof expr !== "object") return expr;

  const args = Array.isArray(expr.args) ? expr.args.map((arg) => evaluateExpression(arg, context)) : [];
  switch (expr.op) {
    case "add":
      return args.reduce((sum, arg) => sum + asNumber(arg), 0);
    case "sub":
      return args.slice(1).reduce((acc, arg) => acc - asNumber(arg), asNumber(args[0]));
    case "mul":
      return args.reduce((acc, arg) => acc * asNumber(arg), 1);
    case "div":
      return args.slice(1).reduce((acc, arg) => {
        const denom = asNumber(arg);
        return denom === 0 ? 0 : acc / denom;
      }, asNumber(args[0]));
    case "mod": {
      const left = asNumber(args[0]);
      const right = asNumber(args[1]);
      return right === 0 ? 0 : left % right;
    }
    case "min":
      return args.length ? Math.min(...args.map(asNumber)) : 0;
    case "max":
      return args.length ? Math.max(...args.map(asNumber)) : 0;
    case "abs":
      return Math.abs(asNumber(args[0]));
    case "neg":
      return -asNumber(args[0]);
    case "round": {
      const value = asNumber(args[0]);
      const precision = Math.max(0, Math.trunc(asNumber(args[1] ?? 0)));
      return Number(value.toFixed(precision));
    }
    case "ceil":
      return Math.ceil(asNumber(args[0]));
    case "floor":
      return Math.floor(asNumber(args[0]));
    case "coalesce":
      return args.find((arg) => arg !== null && arg !== undefined && arg !== "") ?? null;
    case "and":
      return args.every(Boolean);
    case "or":
      return args.some(Boolean);
    case "not":
      return !Boolean(args[0]);
    case "eq":
      return args[0] === args[1];
    case "neq":
      return args[0] !== args[1];
    case "gt":
      return asNumber(args[0]) > asNumber(args[1]);
    case "gte":
      return asNumber(args[0]) >= asNumber(args[1]);
    case "lt":
      return asNumber(args[0]) < asNumber(args[1]);
    case "lte":
      return asNumber(args[0]) <= asNumber(args[1]);
    case "if":
      return evalCondition(expr.condition, context)
        ? evaluateExpression(expr.then, context)
        : evaluateExpression(expr.else, context);
    default:
      return undefined;
  }
}

export function applyComputedFields(fieldIndex, record) {
  const fields = getFieldList(fieldIndex);
  if (!fields.length) return record;
  let next = { ...(record || {}) };
  const computedFields = fields.filter((field) => field.compute && typeof field.compute === "object" && field.compute.expression);
  if (!computedFields.length) return next;
  for (let i = 0; i < computedFields.length + 1; i += 1) {
    let changed = false;
    for (const field of computedFields) {
      const fieldId = field.id;
      if (typeof fieldId !== "string" || !fieldId) continue;
      const value = evaluateExpression(field.compute.expression, {
        record: next,
        current: next,
        parent: next,
      });
      if (value !== undefined && next[fieldId] !== value) {
        next = { ...next, [fieldId]: value };
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
}
