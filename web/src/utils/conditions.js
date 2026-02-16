export const ALLOWED_OPS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "contains",
  "exists",
  "and",
  "or",
  "not",
]);

function getByPath(data, path) {
  if (!data || typeof data !== "object") return undefined;
  if (path in data) return data[path];
  const parts = path.split(".");
  let cur = data;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function resolveRef(ref, context) {
  if (typeof ref !== "string") return undefined;
  if (ref.startsWith("$record.")) {
    return getByPath(context.record || {}, ref.slice("$record.".length));
  }
  if (ref.startsWith("$candidate.")) {
    return getByPath(context.candidate || {}, ref.slice("$candidate.".length));
  }
  return getByPath(context.record || {}, ref);
}

function resolveOperand(operand, context) {
  if (operand && typeof operand === "object" && "ref" in operand) {
    return resolveRef(operand.ref, context);
  }
  return operand;
}

export function evalCondition(condition, context) {
  if (!condition || typeof condition !== "object") return false;
  const op = condition.op;
  if (!ALLOWED_OPS.has(op)) return false;

  if (op === "and") {
    const items = Array.isArray(condition.conditions) ? condition.conditions : [];
    return items.every((c) => evalCondition(c, context));
  }
  if (op === "or") {
    const items = Array.isArray(condition.conditions) ? condition.conditions : [];
    return items.some((c) => evalCondition(c, context));
  }
  if (op === "not") {
    return !evalCondition(condition.condition, context);
  }

  let left;
  let right;
  if ("left" in condition || "right" in condition) {
    left = resolveOperand(condition.left, context);
    right = resolveOperand(condition.right, context);
  } else {
    left = resolveRef(condition.field, context);
    right = condition.value;
  }

  if (op === "exists") {
    return left !== undefined && left !== null && left !== "";
  }
  if (op === "eq") return left === right;
  if (op === "neq") return left !== right;
  if (op === "gt") return left !== undefined && right !== undefined && left > right;
  if (op === "gte") return left !== undefined && right !== undefined && left >= right;
  if (op === "lt") return left !== undefined && right !== undefined && left < right;
  if (op === "lte") return left !== undefined && right !== undefined && left <= right;
  if (op === "in") return Array.isArray(right) && right.includes(left);
  if (op === "contains") {
    if (Array.isArray(left)) return left.includes(right);
    if (typeof left === "string" && typeof right === "string") return left.includes(right);
    return false;
  }
  return false;
}
