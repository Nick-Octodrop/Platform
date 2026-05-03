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

function asText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeEntityId(entityId) {
  if (typeof entityId !== "string" || !entityId) return "";
  return entityId.startsWith("entity.") ? entityId : `entity.${entityId}`;
}

function getByPath(data, path) {
  if (!data || typeof data !== "object" || typeof path !== "string" || !path) return undefined;
  if (path in data) return data[path];
  let cur = data;
  for (const part of path.split(".")) {
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
  const current = context.current || {};
  const parent = context.parent || {};
  const record = context.record || current;
  if (ref.startsWith("$current.")) return getByPath(current, ref.slice("$current.".length));
  if (ref.startsWith("$parent.")) return getByPath(parent, ref.slice("$parent.".length));
  if (ref.startsWith("$record.")) return getByPath(record, ref.slice("$record.".length));
  if (ref in current) return current[ref];
  if (ref in record) return record[ref];
  if (ref in parent) return parent[ref];
  const currentValue = getByPath(current, ref);
  if (currentValue !== undefined) return currentValue;
  const recordValue = getByPath(record, ref);
  if (recordValue !== undefined) return recordValue;
  const parentValue = getByPath(parent, ref);
  if (parentValue !== undefined) return parentValue;
  return undefined;
}

function simpleParentEqField(where) {
  if (!where || typeof where !== "object") return "";
  if (String(where.op || "").trim().toLowerCase() !== "eq") return "";
  const fieldId = typeof where.field === "string" ? where.field.trim() : "";
  const value = where.value;
  if (!fieldId || !value || typeof value !== "object" || String(value.ref || "").trim() !== "$parent.id") return "";
  return fieldId;
}

function rowMatchesAggregateWhere(where, row, parentRecord, parentField) {
  if (!where || typeof where !== "object") return true;
  const simpleParentField = simpleParentEqField(where);
  if (simpleParentField && parentField && simpleParentField === parentField) {
    const rowParent = getByPath(row, simpleParentField);
    const parentId = parentRecord?.id;
    if (rowParent === undefined || rowParent === null || rowParent === "" || parentId === undefined || parentId === null || parentId === "") {
      return true;
    }
    return String(rowParent) === String(parentId);
  }
  return evalCondition(where, { record: row, current: row, parent: parentRecord });
}

function computeAggregateValue(aggregate, rows, parentRecord) {
  const op = String(aggregate?.op || aggregate?.measure || "sum").trim().toLowerCase();
  const fieldId = typeof aggregate?.field === "string" ? aggregate.field : "";
  if (op === "count") return rows.length;
  if (!fieldId) return undefined;
  const numeric = rows.map((row) => asNumber(resolveRef(fieldId, { record: row, current: row, parent: parentRecord })));
  if (op === "sum") return numeric.reduce((sum, value) => sum + value, 0);
  if (op === "avg") return numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : 0;
  if (op === "min") return numeric.length ? Math.min(...numeric) : 0;
  if (op === "max") return numeric.length ? Math.max(...numeric) : 0;
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
    case "concat":
      return args.map(asText).join("");
    case "join": {
      const separator = typeof expr.separator === "string" ? expr.separator : " ";
      const skipEmpty = expr.skip_empty !== false;
      const parts = args.map(asText).filter((part) => !skipEmpty || part);
      return parts.join(separator);
    }
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

export function computeAggregateFieldPatchFromRows(fieldIndex, parentRecord, childEntityId, rows, options = {}) {
  const fields = getFieldList(fieldIndex);
  const normalizedChildEntityId = normalizeEntityId(childEntityId);
  if (!fields.length || !normalizedChildEntityId) return {};
  const parentField = typeof options.parentField === "string" ? options.parentField.trim() : "";
  const rowRecords = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === "object");
  const patch = {};
  for (const field of fields) {
    const fieldId = typeof field?.id === "string" ? field.id : "";
    const aggregate = field?.compute && typeof field.compute === "object" ? field.compute.aggregate : null;
    if (!fieldId || !aggregate || typeof aggregate !== "object") continue;
    if (normalizeEntityId(aggregate.entity) !== normalizedChildEntityId) continue;
    const simpleParentField = simpleParentEqField(aggregate.where);
    if (parentField && simpleParentField && simpleParentField !== parentField) continue;
    const matchingRows = rowRecords.filter((row) => rowMatchesAggregateWhere(aggregate.where, row, parentRecord || {}, parentField));
    const value = computeAggregateValue(aggregate, matchingRows, parentRecord || {});
    if (value !== undefined) patch[fieldId] = value;
  }
  return patch;
}
