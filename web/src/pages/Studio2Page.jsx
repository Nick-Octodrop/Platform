import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../apps/AppShell.jsx";
import TemplateStudioShell from "./templates/TemplateStudioShell.jsx";
import {
  applyStudio2Patchset,
  createStudio2Module,
  deleteModule,
  deleteStudio2Draft,
  getDraft,
  getStudio2Manifest,
  installStudio2Draft,
  listStudio2Modules,
  listStudio2History,
  listSnapshots,
  rollbackStudio2Module,
  saveStudio2Draft,
  studio2AgentChat,
  studio2AgentStatus,
  studio2AiFixJson,
  studio2JsonFix,
  validateStudio2Draft,
  validateStudio2Patchset,
} from "../api";
import { useToast } from "../components/Toast.jsx";
import { startAgentStream } from "../studio2/useAgentStream.js";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import AgentChatInput from "../ui/AgentChatInput.jsx";

function nowIso() {
  return new Date().toISOString();
}

function storageKey(moduleId) {
  return `studio2_draft_${moduleId}`;
}

function stringifyPretty(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return "";
  }
}


function summarizeChanges(calls = [], opsByModule = []) {
  const summary = [];
  calls.forEach((call) => {
    if (!call || typeof call !== "object") return;
    const tool = call.tool;
    const entityId = call.entity_id || call.args?.entity_id;
    if (tool === "ensure_entity" && entityId) summary.push(`Added entity: ${entityId}`);
    if (tool === "ensure_entity_pages" && entityId) summary.push(`Ensured pages for: ${entityId}`);
    if (tool === "ensure_nav") summary.push("Ensured app navigation");
    if (tool === "ensure_relation") summary.push("Added relation");
    if (tool === "ensure_workflow") summary.push("Added workflow");
    if (tool === "ensure_ui_pattern") summary.push("Applied UI pattern");
    if (tool === "ensure_actions_for_status") summary.push("Ensured status actions");
  });
  opsByModule.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const ops = entry.ops || [];
    ops.forEach((op) => {
      if (!op || typeof op !== "object") return;
      summary.push(`Op: ${op.op} ${op.path}`);
    });
  });
  return summary;
}

function stripPatchsetFromMessage(text) {
  if (!text) return "";
  const markers = ["UPDATED_MANIFEST_JSON:", "PATCHSET_JSON:"];
  let idx = -1;
  for (const marker of markers) {
    const found = text.indexOf(marker);
    if (found !== -1) {
      idx = found;
      break;
    }
  }
  if (idx === -1) return text.trim();
  const head = text.slice(0, idx).trim();
  return head || "Draft updated.";
}

function parseJsonWithPos(text) {
  try {
    const value = JSON.parse(text);
    return { value, error: null };
  } catch (err) {
    const message = err?.message || "Invalid JSON";
    const match = message.match(/position (\d+)/i);
    let pos = null;
    if (match) {
      pos = Number(match[1]);
    }
    if (pos == null || Number.isNaN(pos)) {
      return { value: null, error: { message } };
    }
    const before = text.slice(0, pos);
    const lines = before.split("\n");
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    return { value: null, error: { message, line, col } };
  }
}

function unwrapTextManifest(value) {
  if (!value || typeof value !== "object") return { manifest: null, error: null };
  if (typeof value.text !== "string") return { manifest: null, error: null };
  try {
    const parsed = JSON.parse(value.text);
    if (parsed && typeof parsed === "object") {
      return { manifest: parsed, error: null };
    }
  } catch (err) {
    return { manifest: null, error: { message: "Invalid JSON in manifest text" } };
  }
  return { manifest: null, error: null };
}

function escapePointerToken(token) {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function buildPointerLineMap(text) {
  const map = new Map();
  let i = 0;
  let line = 1;
  let col = 1;

  function advance(ch) {
    if (ch === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
    i += 1;
  }

  function skipWs() {
    while (i < text.length) {
      const ch = text[i];
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        advance(ch);
      } else {
        break;
      }
    }
  }

  function parseString() {
    let result = "";
    advance("\"");
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\"") {
        advance(ch);
        break;
      }
      if (ch === "\\") {
        advance(ch);
        if (i < text.length) {
          advance(text[i]);
        }
        continue;
      }
      result += ch;
      advance(ch);
    }
    return result;
  }

  function parseLiteral() {
    while (i < text.length) {
      const ch = text[i];
      if (ch === "," || ch === "]" || ch === "}" || ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        break;
      }
      advance(ch);
    }
  }

  function parseValue(pointer) {
    skipWs();
    if (pointer != null) {
      map.set(pointer, { line, col });
    }
    const ch = text[i];
    if (ch === "{") {
      advance(ch);
      parseObject(pointer || "");
      return;
    }
    if (ch === "[") {
      advance(ch);
      parseArray(pointer || "");
      return;
    }
    if (ch === "\"") {
      parseString();
      return;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      parseLiteral();
      return;
    }
    if (text.startsWith("true", i) || text.startsWith("false", i) || text.startsWith("null", i)) {
      parseLiteral();
      return;
    }
    if (ch) {
      advance(ch);
    }
  }

  function parseObject(prefix) {
    skipWs();
    if (text[i] === "}") {
      advance("}");
      return;
    }
    while (i < text.length) {
      skipWs();
      if (text[i] === "}") {
        advance("}");
        break;
      }
      if (text[i] !== "\"") {
        advance(text[i]);
        continue;
      }
      const key = parseString();
      skipWs();
      if (text[i] === ":") {
        advance(":");
      }
      const pointer = `${prefix}/${escapePointerToken(key)}`;
      parseValue(pointer);
      skipWs();
      if (text[i] === ",") {
        advance(",");
        continue;
      }
      if (text[i] === "}") {
        advance("}");
        break;
      }
    }
  }

  function parseArray(prefix) {
    skipWs();
    if (text[i] === "]") {
      advance("]");
      return;
    }
    let idx = 0;
    while (i < text.length) {
      const pointer = `${prefix}/${idx}`;
      parseValue(pointer);
      idx += 1;
      skipWs();
      if (text[i] === ",") {
        advance(",");
        continue;
      }
      if (text[i] === "]") {
        advance("]");
        break;
      }
    }
  }

  skipWs();
  parseValue("");
  return map;
}

function derivePatchsetSummary(patchset) {
  if (!patchset || !Array.isArray(patchset.patches)) return "";
  const patch = patchset.patches[0] || {};
  const ops = Array.isArray(patch.ops) ? patch.ops : [];
  return patchset.summary || `${ops.length} op(s)`;
}

function decodePointer(pointer) {
  if (pointer === "") return [];
  const parts = pointer.split("/");
  if (parts[0] === "") parts.shift();
  return parts.map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function findUnsupportedBlocks(manifest) {
  const warnings = [];
  const supported = new Set([
    "view",
    "stack",
    "grid",
    "tabs",
    "text",
    "container",
    "record",
    "toolbar",
    "statusbar",
    "chatter",
    "view_modes",
  ]);

  function walkBlocks(blocks, basePath) {
    if (!Array.isArray(blocks)) return;
    blocks.forEach((block, idx) => {
      if (!block || typeof block !== "object") return;
      const kind = block.kind;
      const path = `${basePath}/${idx}`;
      if (kind && !supported.has(kind)) {
        warnings.push({
          code: "PREVIEW_UNSUPPORTED_BLOCK",
          message: `Unsupported block kind: ${kind}`,
          path,
        });
      }
      if (Array.isArray(block.content)) {
        walkBlocks(block.content, `${path}/content`);
      }
      if (Array.isArray(block.tabs)) {
        block.tabs.forEach((tab, tIdx) => {
          if (tab && Array.isArray(tab.content)) {
            walkBlocks(tab.content, `${path}/tabs/${tIdx}/content`);
          }
        });
      }
    });
  }

  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  pages.forEach((page, pIdx) => {
    if (page && Array.isArray(page.content)) {
      walkBlocks(page.content, `/pages/${pIdx}/content`);
    }
  });
  return warnings;
}

function findPreviewIssues(manifest) {
  const warnings = [];
  if (!manifest || typeof manifest !== "object") return warnings;
  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  const pageIds = new Set(pages.map((p) => (p && p.id ? p.id : null)).filter(Boolean));
  const appHome = manifest?.app?.home;
  if (appHome) {
    const id = appHome.startsWith("page:") ? appHome.slice(5) : appHome;
    if (!pageIds.has(id)) {
      warnings.push({
        code: "PREVIEW_INVALID_HOME",
        message: "app.home points to a missing page",
        path: "/app/home",
        json_pointer: "/app/home",
      });
    }
  }
  const nav = Array.isArray(manifest?.app?.nav) ? manifest.app.nav : [];
  nav.forEach((group, gIdx) => {
    const items = Array.isArray(group?.items) ? group.items : [];
    items.forEach((item, iIdx) => {
      const to = item?.to;
      if (typeof to === "string" && to.startsWith("page:")) {
        const id = to.slice(5);
        if (!pageIds.has(id)) {
          warnings.push({
            code: "PREVIEW_INVALID_NAV",
            message: `nav item points to missing page: ${id}`,
            path: `app.nav[${gIdx}].items[${iIdx}].to`,
            json_pointer: `/app/nav/${gIdx}/items/${iIdx}/to`,
          });
        }
      }
    });
  });
  return warnings;
}

function findDraftLintIssues(manifest) {
  const warnings = [];
  if (!manifest || typeof manifest !== "object") return warnings;
  if (Object.prototype.hasOwnProperty.call(manifest, "module.id")) {
    warnings.push({
      code: "MANIFEST_UNKNOWN_KEY",
      message: "Unknown key: module.id (use module.id inside module object instead)",
      path: "/module.id",
      json_pointer: "/module.id",
    });
  }
  const appHome = manifest?.app?.home;
  if (typeof appHome === "string" && appHome && !appHome.startsWith("page:") && !appHome.startsWith("view:")) {
    warnings.push({
      code: "PREVIEW_HOME_FORMAT",
      message: "app.home should be a target like page:<id> or view:<id>",
      path: "/app/home",
      json_pointer: "/app/home",
    });
  }
  return warnings;
}

function getContainerAndToken(doc, pointer) {
  const tokens = decodePointer(pointer);
  if (tokens.length === 0) return [null, ""];
  let current = doc;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (Array.isArray(current)) {
      const idx = Number(token);
      if (Number.isNaN(idx) || idx < 0 || idx >= current.length) throw new Error("Invalid list index");
      current = current[idx];
    } else if (current && typeof current === "object") {
      if (!(token in current)) throw new Error("Missing object key");
      current = current[token];
    } else {
      throw new Error("Cannot traverse into non-container");
    }
  }
  return [current, tokens[tokens.length - 1]];
}

function pointerExists(doc, pointer) {
  try {
    const tokens = decodePointer(pointer);
    let current = doc;
    for (const token of tokens) {
      if (Array.isArray(current)) {
        const idx = Number(token);
        if (Number.isNaN(idx) || idx < 0 || idx >= current.length) return false;
        current = current[idx];
      } else if (current && typeof current === "object") {
        if (!(token in current)) return false;
        current = current[token];
      } else {
        return false;
      }
    }
    return true;
  } catch (err) {
    return false;
  }
}

function applyAdd(doc, path, value) {
  if (path === "") throw new Error("Cannot add at root");
  const [container, token] = getContainerAndToken(doc, path);
  if (Array.isArray(container)) {
    if (token === "-") {
      container.push(value);
      return;
    }
    const idx = Number(token);
    if (Number.isNaN(idx) || idx < 0 || idx > container.length) throw new Error("Invalid list index");
    container.splice(idx, 0, value);
    return;
  }
  if (container && typeof container === "object") {
    container[token] = value;
    return;
  }
  throw new Error("Cannot add into non-container");
}

function applyRemove(doc, path) {
  const [container, token] = getContainerAndToken(doc, path);
  if (Array.isArray(container)) {
    const idx = Number(token);
    if (Number.isNaN(idx) || idx < 0 || idx >= container.length) throw new Error("Invalid list index");
    container.splice(idx, 1);
    return;
  }
  if (container && typeof container === "object") {
    if (!(token in container)) throw new Error("Missing object key");
    delete container[token];
    return;
  }
  throw new Error("Cannot remove from non-container");
}

function applyReplace(doc, path, value) {
  if (path === "") throw new Error("Cannot replace root");
  const [container, token] = getContainerAndToken(doc, path);
  if (Array.isArray(container)) {
    const idx = Number(token);
    if (Number.isNaN(idx) || idx < 0 || idx >= container.length) throw new Error("Invalid list index");
    container[idx] = value;
    return;
  }
  if (container && typeof container === "object") {
    if (!(token in container)) throw new Error("Missing object key");
    container[token] = value;
    return;
  }
  throw new Error("Cannot replace in non-container");
}

function applyPatchset(manifest, patchset) {
  if (!patchset || !Array.isArray(patchset.patches) || patchset.patches.length === 0) {
    return { ok: false, errors: ["PatchSet missing patches"], manifest: null };
  }
  if (patchset.patches.length !== 1) {
    return { ok: false, errors: ["Multi-module PatchSet not supported"], manifest: null };
  }
  const patch = patchset.patches[0] || {};
  const ops = Array.isArray(patch.ops) ? patch.ops : null;
  if (!ops) {
    return { ok: false, errors: ["PatchSet ops must be a list"], manifest: null };
  }
  const next = JSON.parse(JSON.stringify(manifest || {}));
  try {
    for (const op of ops) {
      if (!op || typeof op !== "object") throw new Error("Op must be object");
      const name = op.op;
      const path = op.path;
      if (!path || typeof path !== "string" || !path.startsWith("/")) {
        throw new Error("Op path must be JSON pointer");
      }
      if (name === "remove") {
        applyRemove(next, path);
        continue;
      }
      if (name === "rename_id") {
        const value = op.value;
        if (value == null) throw new Error("rename_id requires value");
        try {
          const [container, token] = getContainerAndToken(next, path);
          if (container && typeof container === "object" && container[token] && typeof container[token] === "object") {
            container[token].id = value;
          } else {
            applyReplace(next, path, value);
          }
        } catch (err) {
          applyReplace(next, path, value);
        }
        continue;
      }
      if (name === "add") {
        applyAdd(next, path, op.value);
        continue;
      }
      if (name === "set") {
        if (pointerExists(next, path)) {
          applyReplace(next, path, op.value);
        } else {
          applyAdd(next, path, op.value);
        }
        continue;
      }
      throw new Error(`Unsupported op ${name}`);
    }
  } catch (err) {
    return { ok: false, errors: [err.message || "Patch apply failed"], manifest: null };
  }
  return { ok: true, errors: [], manifest: next };
}

function applyOps(manifest, ops) {
  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, errors: ["Ops must be a non-empty list"], manifest: null };
  }
  const next = JSON.parse(JSON.stringify(manifest || {}));
  try {
    for (const op of ops) {
      if (!op || typeof op !== "object") throw new Error("Op must be object");
      const name = op.op;
      const path = op.path;
      if (!path || typeof path !== "string" || !path.startsWith("/")) {
        throw new Error("Op path must be JSON pointer");
      }
      if (name === "remove") {
        applyRemove(next, path);
        continue;
      }
      if (name === "rename_id") {
        const value = op.value;
        if (value == null) throw new Error("rename_id requires value");
        try {
          const [container, token] = getContainerAndToken(next, path);
          if (container && typeof container === "object" && container[token] && typeof container[token] === "object") {
            container[token].id = value;
          } else {
            applyReplace(next, path, value);
          }
        } catch (err) {
          applyReplace(next, path, value);
        }
        continue;
      }
      if (name === "add") {
        applyAdd(next, path, op.value);
        continue;
      }
      if (name === "set") {
        if (pointerExists(next, path)) {
          applyReplace(next, path, op.value);
        } else {
          applyAdd(next, path, op.value);
        }
        continue;
      }
      throw new Error(`Unsupported op ${name}`);
    }
  } catch (err) {
    return { ok: false, errors: [err.message || "Ops apply failed"], manifest: null };
  }
  return { ok: true, errors: [], manifest: next };
}

export default function Studio2Page({ user }) {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const { moduleId: routeModuleId } = useParams();

  const rootRef = useRef(null);
  const leftPaneRef = useRef(null);
  const chatListRef = useRef(null);

  const [studioModules, setStudioModules] = useState(null);
  const [loadingModules, setLoadingModules] = useState(false);
  const [modulesError, setModulesError] = useState(null);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [listSelectedIds, setListSelectedIds] = useState([]);
  const [clientFilters, setClientFilters] = useState([]);

  const [draftText, setDraftText] = useState("");
  const [draftError, setDraftError] = useState(null);
  const [patchsetText, setPatchsetText] = useState("");
  const [patchsetError, setPatchsetError] = useState(null);
  const [patchsetSummary, setPatchsetSummary] = useState("");
  const [previewManifest, setPreviewManifest] = useState(null);
  const [validation, setValidation] = useState({
    status: "idle",
    errors: [],
    warnings: [],
    strictErrors: [],
    completenessErrors: [],
    designWarnings: [],
  });
  const [lastChanges, setLastChanges] = useState([]);
  const [applyInfo, setApplyInfo] = useState(null);
  const [rollbackTarget, setRollbackTarget] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [progressEvents, setProgressEvents] = useState([]);
  const [stopReason, setStopReason] = useState(null);
  const [streamDone, setStreamDone] = useState(false);
  const [lastValidationSummary, setLastValidationSummary] = useState(null);
  const streamCancelRef = useRef(null);
  const [agentError, setAgentError] = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const [rightTab, setRightTab] = useState("preview");
  const [fixModalOpen, setFixModalOpen] = useState(false);
  const [fixCandidate, setFixCandidate] = useState(null);
  const [fixSummary, setFixSummary] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newModuleName, setNewModuleName] = useState("");
  const [newModuleDescription, setNewModuleDescription] = useState("");
  const [newModuleBusy, setNewModuleBusy] = useState(false);
  const [listActionLoading, setListActionLoading] = useState(false);
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [rollbackTargetModule, setRollbackTargetModule] = useState("");
  const [rollbackSnapshots, setRollbackSnapshots] = useState([]);
  const [rollbackHistory, setRollbackHistory] = useState([]);
  const [rollbackSelected, setRollbackSelected] = useState("");
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackError, setRollbackError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingDeleteKind, setPendingDeleteKind] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBlocked, setDeleteBlocked] = useState(null);
  const [forceConfirm, setForceConfirm] = useState("");
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [historySnapshots, setHistorySnapshots] = useState([]);
  const [historyDrafts, setHistoryDrafts] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [installedManifest, setInstalledManifest] = useState(null);

  async function refreshModules(mounted = true) {
    setLoadingModules(true);
    try {
      const res = await listStudio2Modules();
      if (!mounted) return;
      setStudioModules(res.data || null);
      setModulesError(null);
    } catch (err) {
      if (!mounted) return;
      setModulesError(err.message || "Failed to load modules");
    } finally {
      if (mounted) setLoadingModules(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    refreshModules(mounted);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadStatus() {
      try {
        const res = await studio2AgentStatus();
        if (!mounted) return;
        setAgentStatus(res.data || null);
      } catch (err) {
        if (!mounted) return;
        setAgentStatus({ configured: false });
      }
    }
    loadStatus();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!routeModuleId) return;
    setDraftText("");
    setPatchsetText("");
    setApplyInfo(null);
    setRollbackTarget("");
    setChatMessages([]);
    const storedRaw = sessionStorage.getItem(storageKey(routeModuleId));
    if (storedRaw) {
      try {
        const parsed = JSON.parse(storedRaw);
        setDraftText(parsed.draftText || "");
        setPatchsetText(parsed.patchsetText || "");
        setApplyInfo(parsed.applyInfo || null);
        setRollbackTarget(parsed.applyInfo?.transaction_group_id || "");
        setChatMessages(parsed.chatMessages || []);
        return;
      } catch (err) {
        sessionStorage.removeItem(storageKey(routeModuleId));
      }
    }
    async function loadManifest() {
      try {
        const res = await getDraft(routeModuleId);
        const draft = res.data?.manifest;
        if (draft) {
          setDraftText(stringifyPretty(draft));
          return;
        }
      } catch (err) {
        // ignore and fallback to installed manifest
      }
      try {
        const res = await getStudio2Manifest(routeModuleId);
        const text = stringifyPretty(res.data?.manifest || {});
        setInstalledManifest(res.data?.manifest || {});
        setDraftText(text);
      } catch (err) {
        pushToast("error", err.message || "Failed to load manifest");
      }
    }
    loadManifest();
  }, [routeModuleId, pushToast]);

  useEffect(() => {
    if (!routeModuleId) return;
    const payload = {
      draftText,
      patchsetText,
      applyInfo,
      chatMessages,
    };
    sessionStorage.setItem(storageKey(routeModuleId), JSON.stringify(payload));
  }, [routeModuleId, draftText, patchsetText, applyInfo, chatMessages]);

  useEffect(() => {
    if (!routeModuleId) return;
    setPreviewManifest(null);
      setValidation({
        status: "idle",
        errors: [],
        warnings: [],
        strictErrors: [],
        completenessErrors: [],
        designWarnings: [],
      });
    setAgentError(null);
    setInstalledManifest(null);
  }, [routeModuleId]);

  useEffect(() => {
    if (!routeModuleId) return;
    let mounted = true;
    async function loadHistory() {
      setHistoryLoading(true);
      try {
        const res = await listStudio2History(routeModuleId);
        if (!mounted) return;
        setHistorySnapshots(res.data?.snapshots || []);
        setHistoryDrafts(res.data?.draft_versions || []);
      } catch (err) {
        if (!mounted) return;
        setHistorySnapshots([]);
        setHistoryDrafts([]);
      } finally {
        if (mounted) setHistoryLoading(false);
      }
    }
    loadHistory();
    return () => {
      mounted = false;
    };
  }, [routeModuleId]);

  useEffect(() => {
    const parsed = parseJsonWithPos(draftText || "");
    if (!parsed.error && parsed.value && typeof parsed.value === "object") {
      const unwrapped = unwrapTextManifest(parsed.value);
      if (unwrapped.error) {
        setDraftError(unwrapped.error);
        return;
      }
      if (unwrapped.manifest) {
        setDraftError(null);
        return;
      }
    }
    setDraftError(parsed.error);
  }, [draftText]);

  useEffect(() => {
    const parsed = parseJsonWithPos(draftText || "");
    if (parsed.error || !parsed.value || typeof parsed.value !== "object") return;
    const keys = Object.keys(parsed.value);
    if (keys.length === 0) return;
    if (!keys.every((k) => k === "text" || k === "note")) return;
    const unwrapped = unwrapTextManifest(parsed.value);
    if (!unwrapped.manifest) return;
    const normalized = stringifyPretty(unwrapped.manifest);
    if (normalized && normalized !== draftText) {
      setDraftText(normalized);
    }
  }, [draftText]);

  useEffect(() => {
    if (!routeModuleId) return;
    if (draftError) {
      setValidation({
        status: "error",
        errors: [
          {
            code: "JSON_PARSE_ERROR",
            message: draftError.message,
            line: draftError.line,
            col: draftError.col,
          },
        ],
        warnings: [],
        strictErrors: [],
        completenessErrors: [],
        designWarnings: [],
      });
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      if (!active) return;
      if (!draftText.trim()) {
        setValidation({
          status: "idle",
          errors: [],
          warnings: [],
          strictErrors: [],
          completenessErrors: [],
          designWarnings: [],
        });
        return;
      }
      try {
        const res = await validateDraftNow(draftText);
        if (!active) return;
        const errors = res.errors || [];
        const warnings = res.warnings || [];
        const strictErrors = res.strictErrors || [];
        const completenessErrors = res.completenessErrors || [];
        const designWarnings = res.designWarnings || [];
        const hasErrors = errors.length + strictErrors.length + completenessErrors.length > 0;
        setValidation({
          status: hasErrors ? "error" : "ok",
          errors,
          warnings,
          strictErrors,
          completenessErrors,
          designWarnings,
        });
      } catch (err) {
        if (!active) return;
        setValidation({
          status: "error",
          errors: [{ code: "VALIDATE_FAILED", message: err.message || "Validation failed" }],
          warnings: [],
          strictErrors: [],
          completenessErrors: [],
          designWarnings: [],
        });
      }
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [routeModuleId, draftText, draftError]);

  useEffect(() => {
    if (!patchsetText?.trim()) {
      setPatchsetError(null);
      setPatchsetSummary("");
      return;
    }
    const parsed = parseJsonWithPos(patchsetText);
    if (parsed.error) {
      setPatchsetError(parsed.error);
      setPatchsetSummary("");
    } else {
      setPatchsetError(null);
      setPatchsetSummary(derivePatchsetSummary(parsed.value));
    }
  }, [patchsetText]);

  useEffect(() => {
    if (localStorage.getItem("octo_layout_debug") !== "1") return;
    const root = rootRef.current;
    const left = leftPaneRef.current;
    const chat = chatListRef.current;
    const entries = [
      ["root", root],
      ["left", left],
      ["chat", chat],
    ];
    for (const [label, node] of entries) {
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      // eslint-disable-next-line no-console
      console.log(`[layout] ${label} height=${Math.round(rect.height)}`);
    }
  }, [routeModuleId, rightTab, chatMessages.length]);

  useEffect(() => {
    const node = chatListRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chatMessages.length, chatLoading]);

  useEffect(() => {
    const node = chatListRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    if (nearBottom) {
      node.scrollTop = node.scrollHeight;
    }
  }, [progressEvents.length]);

  const moduleRows = useMemo(() => {
    const items = studioModules?.modules || [];
    return items.map((m) => ({
      module_id: m.module_id,
      name: m.name || m.module_id,
      installed: Boolean(m.installed),
      enabled: m.enabled,
      has_draft: Boolean(m.draft),
      draft_in_sync: false,
      updated_at: m.draft?.updated_at || m.updated_at,
    }));
  }, [studioModules]);

  const listFieldIndex = useMemo(
    () => ({
      "studio.name": { id: "studio.name", label: "Name" },
      "studio.status": { id: "studio.status", label: "Status" },
      "studio.updated_at": { id: "studio.updated_at", label: "Updated" },
      "studio.module_id": { id: "studio.module_id", label: "Module ID" },
    }),
    []
  );

  const listView = useMemo(
    () => ({
      id: "studio.modules.list",
      kind: "list",
      columns: [
        { field_id: "studio.name" },
        { field_id: "studio.status" },
        { field_id: "studio.updated_at" },
        { field_id: "studio.module_id", label: "ID" },
      ],
    }),
    []
  );

  const listRecords = useMemo(() => {
    return moduleRows.map((row) => {
      const status = row.has_draft
        ? row.draft_in_sync
          ? "Draft"
          : "Dirty"
        : row.installed
          ? "Installed"
          : "—";
      return {
        record_id: row.module_id,
        record: {
          "studio.name": row.name,
          "studio.status": status,
          "studio.updated_at": row.updated_at || "—",
          "studio.module_id": row.module_id,
        },
      };
    });
  }, [moduleRows]);

  const activeModuleName = useMemo(() => {
    if (!routeModuleId) return "";
    const match = moduleRows.find((row) => row.module_id === routeModuleId);
    return match?.name || routeModuleId;
  }, [moduleRows, routeModuleId]);

  const listFilters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "drafts", label: "Drafts", domain: { op: "eq", field: "studio.status", value: "Draft" } },
      { id: "installed", label: "Installed", domain: { op: "eq", field: "studio.status", value: "Installed" } },
      { id: "dirty", label: "Dirty", domain: { op: "eq", field: "studio.status", value: "Dirty" } },
    ],
    []
  );

  const activeListFilter = useMemo(
    () => listFilters.find((flt) => flt.id === moduleFilter) || null,
    [listFilters, moduleFilter]
  );

  const filterableFields = useMemo(
    () => [
      { id: "studio.name", label: "Name" },
      { id: "studio.status", label: "Status" },
      { id: "studio.updated_at", label: "Updated" },
      { id: "studio.module_id", label: "Module ID" },
    ],
    []
  );

  const moduleById = useMemo(() => {
    const map = new Map();
    for (const row of moduleRows) {
      map.set(row.module_id, row);
    }
    return map;
  }, [moduleRows]);

  const selectedRows = useMemo(() => {
    return listSelectedIds.map((id) => moduleById.get(id)).filter(Boolean);
  }, [listSelectedIds, moduleById]);

  const singleSelected = selectedRows.length === 1 ? selectedRows[0] : null;

  const draftManifest = useMemo(() => {
    const parsed = parseJsonWithPos(draftText || "");
    if (parsed.value && typeof parsed.value === "object") {
      const unwrapped = unwrapTextManifest(parsed.value);
      if (unwrapped.manifest) {
        return unwrapped.manifest;
      }
      return parsed.value;
    }
    return null;
  }, [draftText]);

  const pointerMap = useMemo(() => {
    if (draftError) return new Map();
    if (!draftText.trim()) return new Map();
    try {
      return buildPointerLineMap(draftText);
    } catch (err) {
      return new Map();
    }
  }, [draftText, draftError]);

  const previewWarnings = useMemo(() => {
    if (!draftManifest) return [];
    return findUnsupportedBlocks(draftManifest);
  }, [draftManifest]);

  const previewIssues = useMemo(() => {
    if (!draftManifest) return [];
    return findPreviewIssues(draftManifest);
  }, [draftManifest]);

  const lintIssues = useMemo(() => {
    if (!draftManifest) return [];
    return findDraftLintIssues(draftManifest);
  }, [draftManifest]);

  const validationErrors = useMemo(() => {
    const errors = [...(validation.errors || []), ...(validation.strictErrors || []), ...(validation.completenessErrors || [])];
    return errors.map((err) => {
      const path = err.json_pointer || err.path || err.pointer || "";
      const loc = path && pointerMap.get(path);
      if (loc && !err.line && !err.col) {
        return { ...err, line: loc.line, col: loc.col };
      }
      return err;
    });
  }, [validation.errors, validation.strictErrors, validation.completenessErrors, pointerMap]);

  const baseErrors = useMemo(() => {
    const errors = validation.errors || [];
    return errors.map((err) => {
      const path = err.json_pointer || err.path || err.pointer || "";
      const loc = path && pointerMap.get(path);
      if (loc && !err.line && !err.col) {
        return { ...err, line: loc.line, col: loc.col };
      }
      return err;
    });
  }, [validation.errors, pointerMap]);

  const strictErrors = useMemo(() => {
    const errors = validation.strictErrors || [];
    return errors.map((err) => {
      const path = err.json_pointer || err.path || err.pointer || "";
      const loc = path && pointerMap.get(path);
      if (loc && !err.line && !err.col) {
        return { ...err, line: loc.line, col: loc.col };
      }
      return err;
    });
  }, [validation.strictErrors, pointerMap]);

  const completenessErrors = useMemo(() => {
    const errors = validation.completenessErrors || [];
    return errors.map((err) => {
      const path = err.json_pointer || err.path || err.pointer || "";
      const loc = path && pointerMap.get(path);
      if (loc && !err.line && !err.col) {
        return { ...err, line: loc.line, col: loc.col };
      }
      return err;
    });
  }, [validation.completenessErrors, pointerMap]);

  const designWarnings = useMemo(() => {
    const warnings = validation.designWarnings || [];
    return warnings.map((warn) => {
      const path = warn.json_pointer || warn.path || warn.pointer || "";
      const loc = path && pointerMap.get(path);
      if (loc && !warn.line && !warn.col) {
        return { ...warn, line: loc.line, col: loc.col };
      }
      return warn;
    });
  }, [validation.designWarnings, pointerMap]);

  const ignoredWarningCodes = useMemo(
    () => new Set(["WORKFLOW_DEDUPED_MULTI", "STATUSBAR_SKIPPED_NO_SINGLE_WORKFLOW"]),
    []
  );

  const validationWarnings = useMemo(() => {
    const warnings = [
      ...(validation.warnings || []),
      ...(designWarnings || []),
    ];
    previewWarnings.forEach((warn) => {
      warnings.push(warn);
    });
    previewIssues.forEach((warn) => {
      warnings.push(warn);
    });
    lintIssues.forEach((warn) => {
      warnings.push(warn);
    });
    return warnings
      .filter((warn) => !ignoredWarningCodes.has(warn?.code))
      .map((warn) => {
      const path = warn.json_pointer || warn.path || warn.pointer || "";
      const loc = path && pointerMap.get(path);
      if (loc && !warn.line && !warn.col) {
        return { ...warn, line: loc.line, col: loc.col };
      }
      return warn;
    });
  }, [validation.warnings, previewWarnings, previewIssues, lintIssues, pointerMap, ignoredWarningCodes]);

  useEffect(() => {
    if (!draftManifest) {
      setPreviewManifest(null);
      return;
    }
    setPreviewManifest(draftManifest);
  }, [draftManifest]);

function buildPreviewManifest() {
    if (!previewManifest) return null;
    const target = previewManifest?.app?.home || null;
    const cloned = JSON.parse(JSON.stringify(previewManifest));
    if (!cloned.manifest_version) {
      cloned.manifest_version = "1.3";
    }
    let pages = Array.isArray(cloned.pages) ? cloned.pages : [];
    let resolvedTarget = target;
    if (resolvedTarget) {
      const isPage = resolvedTarget.startsWith("page:");
      const isView = resolvedTarget.startsWith("view:");
      const id = isPage ? resolvedTarget.slice(5) : resolvedTarget;
      const hasPage = pages.find((p) => p && p.id === id);
      if (!hasPage) {
        resolvedTarget = null;
      } else if (!isPage && !isView) {
        resolvedTarget = `page:${id}`;
      }
    }
    if (!resolvedTarget && pages.length > 0) {
      resolvedTarget = `page:${pages[0].id}`;
    }
    if (!resolvedTarget && pages.length === 0) {
      const placeholder = {
        id: "preview.placeholder",
        title: "Preview",
        layout: "single",
        content: [],
      };
      pages = [placeholder];
      resolvedTarget = "page:preview.placeholder";
    }
    const app = cloned.app && typeof cloned.app === "object" ? cloned.app : {};
    if (resolvedTarget) {
      app.home = resolvedTarget;
    }
    if (!Array.isArray(app.nav)) {
      app.nav = [];
    }
    if (pages.length > 0 && app.nav.length > 0) {
      const pageIds = new Set(pages.map((p) => p && p.id).filter(Boolean));
      app.nav = app.nav
        .map((group) => {
          const items = Array.isArray(group?.items) ? group.items : [];
          const nextItems = items.filter((item) => {
            const to = item?.to;
            if (typeof to !== "string" || !to.startsWith("page:")) return true;
            const id = to.slice(5);
            return pageIds.has(id);
          });
          return { ...group, items: nextItems };
        })
        .filter((group) => Array.isArray(group.items) && group.items.length > 0);
    }
    cloned.app = app;
    cloned.pages = pages;
    return cloned;
  }

  function parsePatchsetOrToast() {
    if (!patchsetText?.trim()) {
      pushToast("error", "PatchSet is empty");
      return null;
    }
    const parsed = parseJsonWithPos(patchsetText);
    if (parsed.error) {
      pushToast("error", "PatchSet JSON invalid");
      return null;
    }
    return parsed.value;
  }

  async function handleValidate() {
    if (!patchsetText?.trim()) {
      if (!draftManifest) {
        pushToast("error", "Draft JSON invalid; cannot validate");
        return;
      }
      setValidation({
        status: "running",
        errors: [],
        warnings: [],
        strictErrors: [],
        completenessErrors: [],
        designWarnings: [],
      });
      try {
        const result = await validateDraftNow(draftText);
        const errors = result.errors || [];
        const warnings = result.warnings || [];
        const strictErrors = result.strictErrors || [];
        const completenessErrors = result.completenessErrors || [];
        const designWarnings = result.designWarnings || [];
        const hasErrors = errors.length + strictErrors.length + completenessErrors.length > 0;
        setValidation({
          status: hasErrors ? "error" : "ok",
          errors,
          warnings,
          strictErrors,
          completenessErrors,
          designWarnings,
        });
        if (errors.length === 0) {
          setPreviewManifest(draftManifest);
          setRightTab("preview");
        }
        pushToast(errors.length ? "error" : "success", errors.length ? "Draft validation failed" : "Draft valid");
      } catch (err) {
        setValidation({
          status: "error",
          errors: [{ message: err.message || "Validation failed" }],
          warnings: [],
          strictErrors: [],
          completenessErrors: [],
          designWarnings: [],
        });
        pushToast("error", err.message || "Validation failed");
      }
      return;
    }
    const patchset = parsePatchsetOrToast();
    if (!patchset) return;
    setValidation({
      status: "running",
      errors: [],
      warnings: [],
      strictErrors: [],
      completenessErrors: [],
      designWarnings: [],
    });
    try {
      const res = await validateStudio2Patchset(patchset);
      if (res.ok === false) {
        setValidation({
          status: "error",
          errors: res.errors || [],
          warnings: res.warnings || [],
          strictErrors: res.strictErrors || [],
          completenessErrors: res.completenessErrors || [],
          designWarnings: res.designWarnings || [],
        });
        pushToast("error", "Validation failed");
        return;
      }
      const errors = res.data?.errors || res.errors || [];
      const warnings = res.data?.warnings || res.warnings || [];
      const strictErrors = res.strictErrors || [];
      const completenessErrors = res.completenessErrors || [];
      const designWarnings = res.designWarnings || [];
      const hasErrors = errors.length + strictErrors.length + completenessErrors.length > 0;
      setValidation({
        status: hasErrors ? "error" : "ok",
        errors,
        warnings,
        strictErrors,
        completenessErrors,
        designWarnings,
      });
      pushToast(errors.length ? "error" : "success", errors.length ? "Validation failed" : "Validation complete");
    } catch (err) {
      setValidation({
        status: "error",
        errors: [{ message: err.message || "Validation failed" }],
        warnings: [],
        strictErrors: [],
        completenessErrors: [],
        designWarnings: [],
      });
      pushToast("error", err.message || "Validation failed");
    }
  }

  function handlePreview() {
    if (!draftManifest) {
      pushToast("error", "Draft JSON invalid; cannot preview");
      return;
    }
    if (!patchsetText?.trim()) {
      setPreviewManifest(draftManifest);
      return;
    }
    const patchset = parsePatchsetOrToast();
    if (!patchset) return;
    const applied = applyPatchset(draftManifest, patchset);
    if (!applied.ok) {
      pushToast("error", applied.errors[0] || "Preview failed");
      setPreviewManifest(null);
      return;
    }
    setPreviewManifest(applied.manifest);
  }

  async function handleApply() {
    if (!patchsetText?.trim()) {
      if (!draftManifest) {
        pushToast("error", "Draft JSON invalid; cannot install");
        return;
      }
      if (!canInstallDraft) {
        pushToast("error", "Fix draft validation errors before install");
        return;
      }
      try {
        const res = await installStudio2Draft(routeModuleId, draftText);
        const info = { ...res.data, applied_at: nowIso() };
        setApplyInfo(info);
        setRollbackTarget(info.transaction_group_id || "");
        pushToast("success", "Draft installed");
        await refreshModules(true);
        const historyRes = await listStudio2History(routeModuleId);
        setHistorySnapshots(historyRes.data?.snapshots || []);
        setHistoryDrafts(historyRes.data?.draft_versions || []);
      } catch (err) {
        pushToast("error", err.message || "Install failed");
      }
      return;
    }
    const patchset = parsePatchsetOrToast();
    if (!patchset) return;
    if (validation.status !== "ok") {
      pushToast("error", "Validate before applying");
      return;
    }
    try {
      const res = await applyStudio2Patchset(patchset, "studio2");
      const info = { ...res.data, applied_at: nowIso() };
      setApplyInfo(info);
      setRollbackTarget(info.transaction_group_id || "");
      pushToast("success", "PatchSet applied");
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || "Apply failed");
    }
  }

  async function handleRollback() {
    if (!routeModuleId) return;
    if (!rollbackTarget?.trim()) {
      pushToast("error", "No rollback target");
      return;
    }
    const payload = rollbackTarget.startsWith("sha256:")
      ? { to_snapshot_hash: rollbackTarget }
      : { to_transaction_group_id: rollbackTarget };
    try {
      await rollbackStudio2Module(routeModuleId, payload);
      pushToast("success", "Rollback complete");
      const res = await listStudio2History(routeModuleId);
      setHistorySnapshots(res.data?.snapshots || []);
      setHistoryDrafts(res.data?.draft_versions || []);
    } catch (err) {
      pushToast("error", err.message || "Rollback failed");
    }
  }

  async function prepareFixJson() {
    if (!draftError) return;
    const payload = { message: draftError.message, line: draftError.line, col: draftError.col };
    try {
      const res = await studio2AiFixJson(draftText, payload);
      let fixed = res.data?.fixed_text || null;
      if (!fixed) {
        const fallback = await studio2JsonFix(draftText, payload);
        fixed = fallback.data?.fixed_text || null;
      }
      if (!fixed) {
        pushToast("error", "Unable to fix JSON");
        return;
      }
      const beforeLines = draftText.split("\n").length;
      const afterLines = fixed.split("\n").length;
      setFixCandidate(fixed);
      setFixSummary({ beforeLines, afterLines, beforeChars: draftText.length, afterChars: fixed.length });
      setFixModalOpen(true);
    } catch (err) {
      pushToast("error", err.message || "Fix JSON failed");
    }
  }

  function applyFixJson() {
    if (!fixCandidate) return;
    setDraftText(fixCandidate);
    setFixModalOpen(false);
    setFixCandidate(null);
    setFixSummary(null);
    pushToast("success", "JSON fixed");
  }

  async function sendAgentMessage(userMessage) {
    if (!routeModuleId || !userMessage.trim()) return;
    setChatMessages((prev) => [...prev, { role: "user", text: userMessage, ts: nowIso() }]);
    setChatLoading(true);
    setAgentError(null);
    try {
      const history = chatMessages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      const res = await studio2AgentChat(routeModuleId, userMessage, null, null, null, history);
      const payload = res.data || {};
      const assistantMessage = payload.notes || payload.assistant_message || "(no response)";
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: assistantMessage, ts: nowIso(), diagnostics: payload.diagnostics || null },
      ]);
      const drafts = payload.drafts || {};
      if (drafts && drafts[routeModuleId]) {
        setDraftText(stringifyPretty(drafts[routeModuleId]));
      }
    } catch (err) {
      if (err.code === "OPENAI_NOT_CONFIGURED" || (err.message || "").includes("OpenAI")) {
        setAgentError({ code: "OPENAI_NOT_CONFIGURED", message: err.message || "OpenAI not configured" });
      } else {
        pushToast("error", err.message || "Agent chat failed");
      }
    } finally {
      setChatLoading(false);
    }
  }

  async function handleAgentChat() {
    if (!chatInput.trim()) return;
    const userMessage = chatInput.trim();
    setChatInput("");
    await runAgentDraftFlow(userMessage);
  }

  async function handleFixPatchsetWithAgent() {
    if (!patchsetText.trim()) {
      pushToast("error", "PatchSet is empty");
      return;
    }
    const errors = validationErrors
      .map((err) => {
        const loc = err.line ? ` (line ${err.line}${err.col ? `, col ${err.col}` : ""})` : "";
        const ptr = err.json_pointer ? ` [${err.json_pointer}]` : "";
        return `${err.code || "ERR"}: ${err.message}${ptr}${loc}`;
      })
      .join("\n");
    const message = `Fix this PatchSet to satisfy validation errors.\nErrors:\n${errors}\nCurrent PatchSet JSON:\n${patchsetText}`;
    await sendAgentMessage(message);
  }

  async function generatePatchsetFromDraft() {
    if (!routeModuleId) return;
    if (draftError || !draftManifest) {
      pushToast("error", "Draft JSON invalid");
      return;
    }
    let base = installedManifest;
    if (!base) {
      try {
        const res = await getStudio2Manifest(routeModuleId);
        base = res.data?.manifest || {};
        setInstalledManifest(base);
      } catch (err) {
        base = {};
      }
    }
    const baseKeys = base && typeof base === "object" ? Object.keys(base) : [];
    const draftKeys = draftManifest && typeof draftManifest === "object" ? Object.keys(draftManifest) : [];
    const keys = Array.from(new Set([...baseKeys, ...draftKeys]));
    const ops = keys.map((key) => {
      const path = `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (!draftKeys.includes(key)) {
        return { op: "remove", path };
      }
      if (!baseKeys.includes(key)) {
        return { op: "add", path, value: draftManifest[key] };
      }
      return { op: "set", path, value: draftManifest[key] };
    });
    const patchset = {
      patchset_id: `ps_${Date.now()}`,
      summary: "Apply draft manifest",
      patches: [{ module_id: routeModuleId, ops }],
    };
    setPatchsetText(stringifyPretty(patchset));
    setRightTab("patchset");
    pushToast("success", "PatchSet generated from draft");
  }

  async function saveDraftVersion(note = null, manifestOverride = null) {
    const manifestText = manifestOverride ? stringifyPretty(manifestOverride) : draftText;
    if (!manifestText.trim()) {
      pushToast("error", "Draft is empty");
      return null;
    }
    try {
      const res = await saveStudio2Draft(routeModuleId, manifestText, note);
      await refreshModules(true);
      const historyRes = await listStudio2History(routeModuleId);
      setHistorySnapshots(historyRes.data?.snapshots || []);
      setHistoryDrafts(historyRes.data?.draft_versions || []);
      return res.data?.draft_version_id || null;
    } catch (err) {
      pushToast("error", err.message || "Save draft failed");
      return null;
    }
  }

  async function validateDraftNow(text) {
    const res = await validateStudio2Draft(routeModuleId, text);
    const errors = res.data?.errors || res.errors || [];
    const warnings = res.data?.warnings || res.warnings || [];
    const strictErrors = res.data?.strict_errors || res.strict_errors || [];
    const completenessErrors = res.data?.completeness_errors || res.completeness_errors || [];
    const designWarnings = res.data?.design_warnings || res.design_warnings || [];
    return { errors, warnings, strictErrors, completenessErrors, designWarnings };
  }

  function applyAgentPayload(payload, assistantOverride = null) {
    const assistantMessage = assistantOverride || payload.notes || payload.assistant_message || "Draft updated.";
    setChatMessages((prev) => [...prev, { role: "assistant", text: assistantMessage, ts: nowIso() }]);
    const drafts = payload.drafts || {};
    if (drafts && drafts[routeModuleId]) {
      setDraftText(stringifyPretty(drafts[routeModuleId]));
    }
    const errors = payload.validation?.errors || [];
    const warnings = payload.validation?.warnings || [];
    const strictErrors = payload.validation?.strict_errors || [];
    const completenessErrors = payload.validation?.completeness_errors || [];
    const designWarnings = payload.validation?.design_warnings || [];
    setLastChanges(summarizeChanges(payload.calls || [], payload.ops_by_module || []));
    const hasErrors = errors.length + strictErrors.length + completenessErrors.length > 0;
    setValidation({
      status: hasErrors ? "error" : "ok",
      errors,
      warnings,
      strictErrors,
      completenessErrors,
      designWarnings,
    });
    if (errors.length === 0) {
      setRightTab("preview");
    }
  }

  async function runAgentDraftFlow(userMessage) {
    if (!routeModuleId) return;
    setChatLoading(true);
    setAgentError(null);
    setChatMessages((prev) => [...prev, { role: "user", text: userMessage, ts: nowIso() }]);
    setProgressEvents([
      { event: "run_started", phase: "start", iter: null, ts_ms: Date.now(), data: { local: true } },
    ]);
    setStopReason(null);
    setLastValidationSummary(null);
    setStreamDone(false);
    let doneReceived = false;
    try {
      const history = chatMessages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      const { cancel, promise } = startAgentStream({
        moduleId: routeModuleId,
        message: userMessage,
        chatHistory: history,
        onEvent: (evt) => {
          setProgressEvents((prev) => {
            const next = [...prev, evt].slice(-200);
            return next;
          });
          if (evt.event === "stopped") {
            setStopReason(evt.data?.stop_reason || "stopped");
          }
          if (evt.event === "validate_result") {
            setLastValidationSummary(evt.data || null);
          }
          if (evt.event === "final_done" || evt.event === "done") {
            doneReceived = true;
            setStreamDone(true);
            if (evt.request_id) {
              // eslint-disable-next-line no-console
              console.debug("agent stream done received", evt.request_id);
            }
          }
        },
      });
      streamCancelRef.current = cancel;
      const finalEnvelope = await promise;
      doneReceived = true;
      setStreamDone(true);
      if (!finalEnvelope?.ok) {
        pushToast("error", finalEnvelope?.errors?.[0]?.message || "Agent stream failed");
        return;
      }
      applyAgentPayload(finalEnvelope.data || {});
      return;
    } catch (err) {
      if (doneReceived) {
        return;
      }
      try {
        const history = chatMessages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
        const res = await studio2AgentChat(routeModuleId, userMessage, null, null, null, history, true);
        const payload = res.data || {};
        if (Array.isArray(payload.progress)) {
          setProgressEvents(payload.progress.slice(-200));
        }
        applyAgentPayload(payload);
      } catch (fallbackErr) {
        if (fallbackErr.code === "OPENAI_NOT_CONFIGURED" || (fallbackErr.message || "").includes("OpenAI")) {
          setAgentError({ code: "OPENAI_NOT_CONFIGURED", message: fallbackErr.message || "OpenAI not configured" });
        } else {
          pushToast("error", fallbackErr.message || "Agent chat failed");
        }
        setStreamDone(true);
      }
    } finally {
      setChatLoading(false);
      streamCancelRef.current = null;
    }
  }

  function cancelAgentRun() {
    if (streamCancelRef.current) {
      streamCancelRef.current();
      streamCancelRef.current = null;
      setStopReason("cancelled");
      setChatLoading(false);
      setStreamDone(true);
    }
  }

  function copyText(value) {
    if (!value) return;
    try {
      navigator.clipboard?.writeText(value);
      pushToast("success", "Copied");
    } catch (err) {
      pushToast("error", "Copy failed");
    }
  }

  async function handleCreateModule() {
    try {
      setNewModuleBusy(true);
      const name = newModuleName.trim();
      if (!name) {
        pushToast("error", "Module name is required");
        return;
      }
      const res = await createStudio2Module(name, newModuleDescription.trim());
      const createdId = res.data?.module_id;
      sessionStorage.removeItem(storageKey(createdId));
      setCreateModalOpen(false);
      setNewModuleName("");
      setNewModuleDescription("");
      navigate(`/studio/${createdId}`);
      pushToast("success", "Module created");
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || "Failed to create module");
    } finally {
      setNewModuleBusy(false);
    }
  }

  function openDelete(moduleId, kind) {
    setPendingDelete(moduleId);
    setPendingDeleteKind(kind);
    setDeleteConfirm("");
    setDeleteBlocked(null);
    setForceConfirm("");
  }

  function closeDelete() {
    setPendingDelete(null);
    setPendingDeleteKind(null);
    setDeleteConfirm("");
    setDeleteBlocked(null);
    setForceConfirm("");
  }

  async function handleDeleteModule(moduleId, opts = {}) {
    setListActionLoading(true);
    try {
      await deleteModule(moduleId, opts);
      pushToast("success", "Module deleted");
      await refreshModules(true);
      return false;
    } catch (err) {
      if (err?.code === "MODULE_HAS_RECORDS" || err?.code === "MODULE_DELETE_BLOCKED") {
        setDeleteBlocked({
          moduleId,
          recordCount: err?.detail?.record_count || 0,
          entityCounts: err?.detail?.entity_counts || {},
        });
        setPendingDelete(null);
        setPendingDeleteKind(null);
        setDeleteConfirm("");
        return true;
      }
      pushToast("error", err.message || "Failed to delete module");
      return false;
    } finally {
      setListActionLoading(false);
    }
  }

  async function handleDeleteDraft(moduleId) {
    setListActionLoading(true);
    try {
      await deleteStudio2Draft(moduleId);
      pushToast("success", "Draft deleted");
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || "Failed to delete draft");
    } finally {
      setListActionLoading(false);
    }
  }

  async function handleArchiveBlocked() {
    if (!deleteBlocked?.moduleId) return;
    setListActionLoading(true);
    try {
      await deleteModule(deleteBlocked.moduleId, { archive: true });
      pushToast("success", "Module archived");
      setDeleteBlocked(null);
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || "Failed to archive module");
    } finally {
      setListActionLoading(false);
    }
  }

  async function handleForceDeleteBlocked() {
    if (!deleteBlocked?.moduleId) return;
    if (forceConfirm !== "DELETE") return;
    setListActionLoading(true);
    try {
      await deleteModule(deleteBlocked.moduleId, { force: true });
      pushToast("success", "Module deleted");
      setDeleteBlocked(null);
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || "Failed to delete module");
    } finally {
      setListActionLoading(false);
    }
  }

  const groupedProgress = useMemo(() => {
    const groups = new Map();
    progressEvents.forEach((evt) => {
      const key = evt.iter == null ? "meta" : `iter-${evt.iter + 1}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(evt);
    });
    return Array.from(groups.entries());
  }, [progressEvents]);

  function summarizeProgressEvent(evt) {
    if (!evt) return "Waiting for updates…";
    const data = evt.data || {};
    if (evt.event === "planner_result") {
      const bullets = data.build_spec_summary || [];
      return bullets.length ? `Planner: ${bullets[0]}` : "Planner finished";
    }
    if (evt.event === "run_started") {
      return "Run started";
    }
    if (evt.event === "builder_result") {
      const tools = Array.isArray(data.tools_used) && data.tools_used.length ? ` tools: ${data.tools_used.join(", ")}` : "";
      return `Builder: ops ${data.ops_count || 0}${tools}`;
    }
    if (evt.event === "apply_result") {
      const diff = data.diff_summary || {};
      return `Apply: entities ${diff.entities_added || 0}, pages ${diff.pages_added || 0}, views ${diff.views_added || 0}`;
    }
    if (evt.event === "validate_result") {
      const counts = data.error_counts || {};
      return `Validate: errors ${counts.total || 0}`;
    }
    if (evt.event === "stage_started") {
      return `Started: ${evt.phase || "stage"}`;
    }
    if (evt.event === "stage_done") {
      return `Finished: ${evt.phase || "stage"}`;
    }
    if (evt.event === "stopped") {
      return `Stopped: ${data.stop_reason || "unknown"}`;
    }
    if (evt.event === "final_done") {
      return "Finalizing";
    }
    return evt.event || "Running…";
  }

  function renderProgressEvent(evt, idx) {
    const data = evt.data || {};
    const debugEnabled = localStorage.getItem("octo_layout_debug") === "1";
    const ts = Number.isFinite(evt.ts_ms) ? new Date(evt.ts_ms).toLocaleTimeString() : "";
    const debugLine = debugEnabled ? (
      <div className="text-[10px] opacity-60">
        {evt.event} {evt.request_id ? `· ${evt.request_id}` : ""} {ts ? `· ${ts}` : ""}
      </div>
    ) : null;
    if (evt.event === "planner_result") {
      return (
        <div key={`planner-${idx}`} className="text-xs">
          {debugLine}
          <div className="font-semibold">Planner</div>
          <ul className="list-disc pl-4">
            {(data.build_spec_summary || []).slice(0, 10).map((item, i) => (
              <li key={`plan-${i}`}>{item}</li>
            ))}
          </ul>
        </div>
      );
    }
    if (evt.event === "builder_result") {
      return (
        <div key={`builder-${idx}`} className="text-xs">
          {debugLine}
          <div className="font-semibold">Builder</div>
          <div className="opacity-70">Ops: {data.ops_count || 0}</div>
          {Array.isArray(data.tools_used) && data.tools_used.length > 0 && (
            <div className="opacity-70">Tools: {data.tools_used.join(", ")}</div>
          )}
          {Array.isArray(data.plan_summary) && data.plan_summary.length > 0 && (
            <ul className="list-disc pl-4">
              {data.plan_summary.slice(0, 6).map((item, i) => (
                <li key={`plan-step-${i}`}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    if (evt.event === "apply_result") {
      const diff = data.diff_summary || {};
      return (
        <div key={`apply-${idx}`} className="text-xs">
          {debugLine}
          <div className="font-semibold">Apply</div>
          <div className="opacity-70">
            Entities: {diff.entities_added || 0}, Pages: {diff.pages_added || 0}, Views: {diff.views_added || 0}, Actions:{" "}
            {diff.actions_added || 0}
          </div>
        </div>
      );
    }
    if (evt.event === "validate_result") {
      const counts = data.error_counts || {};
      return (
        <div key={`validate-${idx}`} className="text-xs">
          {debugLine}
          <div className="font-semibold">Validate</div>
          <div className="opacity-70">
            Errors: {counts.total || 0} (schema {counts.schema || 0}, strict {counts.strict || 0}, completeness{" "}
            {counts.completeness || 0})
          </div>
          {Array.isArray(data.top_errors) && data.top_errors.length > 0 && (
            <ul className="list-disc pl-4">
              {data.top_errors.slice(0, 5).map((err, i) => (
                <li key={`err-${i}`}>{err.code || "ERR"}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    if (evt.event === "iter_timing") {
      return (
        <div key={`timing-${idx}`} className="text-xs opacity-70">
          {debugLine}
          Timing: {Math.round(data.iter_total_ms || 0)}ms (builder {Math.round(data.builder_ms || 0)}ms, apply{" "}
          {Math.round(data.apply_ms || 0)}ms, validate {Math.round(data.validate_ms || 0)}ms)
        </div>
      );
    }
    if (evt.event === "stopped") {
      return (
        <div key={`stopped-${idx}`} className="text-xs">
          {debugLine}
          <span className="badge badge-warning badge-sm">Stopped: {data.stop_reason || "unknown"}</span>
        </div>
      );
    }
    return (
      <div key={`evt-${idx}`} className="text-xs opacity-70">
        {debugLine}
        {evt.event}
      </div>
    );
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDeleteKind === "draft") {
      await handleDeleteDraft(pendingDelete);
    } else {
      const blocked = await handleDeleteModule(pendingDelete);
      if (blocked) return;
    }
    closeDelete();
  }

  async function openRollback(moduleId) {
    setRollbackTargetModule(moduleId);
    setRollbackModalOpen(true);
    setRollbackError("");
    setRollbackLoading(true);
    try {
      try {
        const res = await listSnapshots(moduleId);
        const snaps = res.data?.snapshots || [];
        setRollbackSnapshots(snaps);
        setRollbackSelected(snaps[0]?.manifest_hash || "");
      } catch (err) {
        setRollbackSnapshots([]);
        setRollbackSelected("");
      }
      const historyRes = await listStudio2History(moduleId);
      setRollbackHistory(historyRes.data?.history || []);
    } catch (err) {
      setRollbackError(err.message || "Failed to load snapshots");
    } finally {
      setRollbackLoading(false);
    }
  }

  async function handleRollbackSnapshot(snapshotHash) {
    if (!snapshotHash) return;
    try {
      await rollbackStudio2Module(routeModuleId, { to_snapshot_hash: snapshotHash });
      pushToast("success", "Rollback complete");
      await refreshModules(true);
      const res = await listStudio2History(routeModuleId);
      setHistorySnapshots(res.data?.snapshots || []);
      setHistoryDrafts(res.data?.draft_versions || []);
    } catch (err) {
      pushToast("error", err.message || "Rollback failed");
    }
  }

  async function handleRollbackDraftVersion(versionId) {
    if (!versionId) return;
    try {
      await rollbackStudio2Module(routeModuleId, { to_draft_version_id: versionId });
      pushToast("success", "Draft rolled back");
      const res = await listStudio2History(routeModuleId);
      setHistorySnapshots(res.data?.snapshots || []);
      setHistoryDrafts(res.data?.draft_versions || []);
    } catch (err) {
      pushToast("error", err.message || "Draft rollback failed");
    }
  }

  async function handleRollbackFromList() {
    if (!rollbackTargetModule || !rollbackSelected) return;
    setRollbackLoading(true);
    setRollbackError("");
    try {
      await rollbackStudio2Module(rollbackTargetModule, { to_snapshot_hash: rollbackSelected });
      pushToast("success", "Rollback complete");
      setRollbackModalOpen(false);
      await refreshModules(true);
    } catch (err) {
      setRollbackError(err.message || "Rollback failed");
    } finally {
      setRollbackLoading(false);
    }
  }

  const previewOverride = buildPreviewManifest();
  const rollbackEnabled = Boolean(rollbackTarget && rollbackTarget.trim());
  const hasValidationErrors = validationErrors.length > 0;
  const canInstallDraft = !draftError && !hasValidationErrors;
  const debugClass = localStorage.getItem("octo_layout_debug") === "1" ? "outline outline-1 outline-red-500" : "";
  const moduleTitle = useMemo(() => {
    if (!routeModuleId) return "Studio";
    return draftManifest?.module?.name || moduleById.get(routeModuleId)?.name || routeModuleId;
  }, [routeModuleId, draftManifest, moduleById]);

  const previewTab = (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-end" />
      <div className="mt-3 flex-1 min-h-0 overflow-hidden">
        {!previewOverride && (
          <div className="text-sm opacity-60">
            {draftError ? "Preview unavailable: draft JSON is invalid." : "Preview unavailable: missing app/pages configuration."}
          </div>
        )}
        {previewOverride && (
          <div className="border border-base-200 rounded-box h-full min-h-0 overflow-hidden">
            <AppShell manifestOverride={previewOverride} moduleIdOverride={routeModuleId} previewMode previewAllowNav />
          </div>
        )}
      </div>
    </div>
  );

  const draftTab = (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">Manifest</div>
        <div />
      </div>
      <div className="flex-1 min-h-0 border border-base-200 rounded-box overflow-hidden">
        <div className="flex h-full min-h-0">
          <div className="bg-base-200 text-xs text-right px-2 py-2 font-mono select-none">
            <pre style={{ transform: `translateY(-${editorScrollTop}px)` }}>
              {(draftText.split("\n").map((_, idx) => idx + 1)).join("\n")}
            </pre>
          </div>
          <textarea
            className="textarea textarea-bordered w-full h-full font-mono text-xs rounded-none border-0"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onScroll={(e) => setEditorScrollTop(e.currentTarget.scrollTop)}
          />
        </div>
      </div>
      {draftError && (
        <div className="alert alert-error text-xs mt-2">
          JSON error: {draftError.message} {draftError.line ? `(${draftError.line}:${draftError.col})` : ""}
        </div>
      )}
    </div>
  );

  const historyTab = (
    <div className="h-full min-h-0 overflow-auto">
      {historyLoading && <div className="text-sm opacity-60">Loading history…</div>}
      {!historyLoading && (
        <div className="space-y-6">
          <div>
            <div className="text-sm font-semibold mb-2">Installed snapshots</div>
            {historySnapshots.length === 0 && <div className="text-xs opacity-60">No snapshots yet.</div>}
            <div className="space-y-2">
              {historySnapshots.map((snap) => (
                <div key={`${snap.manifest_hash}-${snap.created_at}`} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-outline">{snap.action || "snapshot"}</span>
                    <span className="font-mono">{(snap.manifest_hash || "").slice(0, 12)}</span>
                    {snap.transaction_group_id && <span className="font-mono">{snap.transaction_group_id}</span>}
                    <span className="opacity-60">{snap.created_at || ""}</span>
                  </div>
                  <button
                    className="btn btn-xs btn-outline"
                    onClick={() => handleRollbackSnapshot(snap.manifest_hash)}
                  >
                    Rollback
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold mb-2">Draft versions</div>
            {historyDrafts.length === 0 && <div className="text-xs opacity-60">No draft history yet.</div>}
            <div className="space-y-2">
              {historyDrafts.map((dv) => (
                <div key={dv.draft_version_id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-outline">draft</span>
                    <span className="font-mono">{(dv.draft_version_id || "").slice(0, 8)}</span>
                    {dv.note && <span>{dv.note}</span>}
                    <span className="opacity-60">{dv.created_at || ""}</span>
                  </div>
                  <button
                    className="btn btn-xs btn-outline"
                    onClick={() => handleRollbackDraftVersion(dv.draft_version_id)}
                  >
                    Rollback draft
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const advancedTab = (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">PatchSet JSON (Advanced)</div>
          <button className="btn btn-xs btn-outline" onClick={generatePatchsetFromDraft} disabled={!routeModuleId}>
            Generate from Draft
          </button>
        </div>
        <textarea
          className="textarea textarea-bordered w-full font-mono text-xs min-h-[220px]"
          value={patchsetText}
          onChange={(e) => setPatchsetText(e.target.value)}
        />
        {patchsetError && (
          <div className="alert alert-error text-xs mt-2">PatchSet JSON error: {patchsetError.message}</div>
        )}
        {patchsetSummary && <div className="text-xs opacity-70 mt-1">Summary: {patchsetSummary}</div>}
      </div>

      <div className="mt-3">
        <div className="text-sm font-semibold">Apply / Rollback</div>
        <div className="text-xs opacity-70">Last apply: {applyInfo?.applied_at || "—"}</div>
        <div className="text-xs opacity-70 flex items-center gap-2">
          Transaction group:
          {applyInfo?.transaction_group_id ? (
            <span className="badge badge-outline cursor-pointer" onClick={() => copyText(applyInfo.transaction_group_id)}>
              {applyInfo.transaction_group_id}
            </span>
          ) : (
            "—"
          )}
        </div>
        <input
          className="input input-bordered input-sm mt-2 w-full"
          placeholder="transaction_group_id or snapshot hash"
          value={rollbackTarget}
          onChange={(e) => setRollbackTarget(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn btn-xs btn-outline" onClick={handleRollback} disabled={!rollbackTarget.trim()}>
            Rollback
          </button>
          <button className="btn btn-xs btn-outline" onClick={() => openRollback(routeModuleId)}>
            View history / rollback
          </button>
          {applyInfo?.transaction_group_id && (
            <button className="btn btn-xs btn-outline" onClick={() => setRollbackTarget(applyInfo.transaction_group_id)}>
              Rollback last apply
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0" />
    </div>
  );

  const userLabel = user?.email || "User";

  const renderLeftPane = useMemo(() => () => (
    <div ref={leftPaneRef} className="h-full min-h-0 flex flex-col overflow-hidden">
      <div ref={chatListRef} className="flex-1 min-h-0 overflow-auto space-y-4">
        {agentStatus?.configured === false && (
          <div className="alert alert-warning text-xs">OpenAI not configured. Set OPENAI_API_KEY.</div>
        )}
        {agentError?.code === "OPENAI_NOT_CONFIGURED" && (
          <div className="alert alert-warning text-xs">OpenAI not configured. Set OPENAI_API_KEY.</div>
        )}
        {chatMessages.length === 0 && (
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">assistant</div>
            <div className="chat-bubble text-sm leading-5 max-w-[85%] bg-base-200 text-base-content">
              {routeModuleId
                ? `Describe the change you want for ${activeModuleName} and I will draft an update.`
                : "Describe the module change you want and I will draft an update."}
            </div>
          </div>
        )}
        {chatMessages.map((m, idx) => (
          <div key={`${m.role}-${idx}`} className={`chat ${m.role === "user" ? "chat-end" : "chat-start"}`}>
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">
              {m.role === "user" ? userLabel : m.role}
            </div>
            <div className={`chat-bubble text-sm leading-5 max-w-[85%] ${m.role === "user" ? "bg-primary text-primary-content" : "bg-base-200 text-base-content"}`}>
              <div className="whitespace-pre-wrap text-sm">{m.text}</div>
            </div>
            {m.diagnostics?.parse_error && (
              <div className="chat-footer mt-2 text-xs text-error">
                AI parse error: {m.diagnostics.parse_error}
              </div>
            )}
          </div>
        ))}
        {(chatLoading || progressEvents.length > 0) && (
          <div className="border border-base-200 rounded-box p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold uppercase opacity-70">
              <span>Agent Progress</span>
              {stopReason && <span className="badge badge-outline badge-sm">{stopReason}</span>}
            </div>
            <div className="text-xs opacity-70">
              {summarizeProgressEvent(progressEvents[progressEvents.length - 1])}
            </div>
            {groupedProgress.map(([key, list]) => (
              <div key={key} className="collapse collapse-arrow border border-base-200 rounded-box">
                <input type="checkbox" defaultChecked={key === "meta" || chatLoading} />
                <div className="collapse-title text-xs font-semibold">
                  {key === "meta" ? "Plan" : `Iteration ${key.replace("iter-", "")}`}
                </div>
                <div className="collapse-content space-y-2">
                  {list.map((evt, idx) => renderProgressEvent(evt, idx))}
                </div>
              </div>
            ))}
            {chatLoading && !streamDone && (
              <div className="text-xs opacity-60">Running… {summarizeProgressEvent(progressEvents[progressEvents.length - 1])}</div>
            )}
            {streamDone && <div className="text-xs opacity-60">Stream complete.</div>}
          </div>
        )}
      </div>
      <div className="shrink-0">
        <div className="flex gap-2">
          <AgentChatInput
            value={chatInput}
            onChange={setChatInput}
            onSend={handleAgentChat}
            disabled={!routeModuleId || chatLoading}
            minRows={1}
          />
          {chatLoading && (
            <button className="btn btn-ghost btn-sm" onClick={cancelAgentRun}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  ), [
    activeModuleName,
    agentError,
    agentStatus?.configured,
    cancelAgentRun,
    chatInput,
    chatLoading,
    chatMessages,
    groupedProgress,
    handleAgentChat,
    progressEvents,
    routeModuleId,
    stopReason,
    streamDone,
    userLabel,
  ]);

  const renderValidationPanel = useMemo(() => () => (
    <div className="pb-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Validation</div>
        {(validation.status === "error" || validationWarnings.length > 0) && (
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              if (draftError) {
                prepareFixJson();
                return;
              }
              const errorLines = validationErrors.map((err) => {
                const loc = err.line ? ` (line ${err.line}${err.col ? `, col ${err.col}` : ""})` : "";
                const ptr = err.json_pointer ? ` [${err.json_pointer}]` : "";
                return `${err.code || "ERR"}: ${err.message}${ptr}${loc}`;
              });
              const warningLines = validationWarnings.map((warn) => {
                const loc = warn.line ? ` (line ${warn.line}${warn.col ? `, col ${warn.col}` : ""})` : "";
                const ptr = warn.json_pointer ? ` [${warn.json_pointer}]` : "";
                return `${warn.code || "WARN"}: ${warn.message}${ptr}${loc}`;
              });
              const sections = [];
              if (errorLines.length > 0) {
                sections.push(`Errors:\n${errorLines.join("\n")}`);
              }
              if (warningLines.length > 0) {
                sections.push(`Warnings:\n${warningLines.join("\n")}`);
              }
              runAgentDraftFlow(`Fix validation issues:\n${sections.join("\n")}`);
            }}
          >
            Fix with AI
          </button>
        )}
      </div>
      {draftError && (
        <div className="alert alert-error text-xs mt-2">
          JSON error: {draftError.message} {draftError.line ? `(${draftError.line}:${draftError.col})` : ""}
        </div>
      )}
      {validation.status === "idle" && !draftError && (
        <div className="text-xs opacity-60 mt-2">Validation runs automatically while you edit.</div>
      )}
      {validation.status !== "idle" && (
        <div className="mt-2">
          {baseErrors.length > 0 && (
            <div className="alert alert-error text-xs">
              <div>
                <div className="font-semibold mb-1">Schema errors</div>
                {baseErrors.map((err, idx) => (
                  <div key={`verr-${idx}`}>
                    {err.code || "ERR"}: {err.message}
                    {err.line ? ` (line ${err.line}${err.col ? `, col ${err.col}` : ""})` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
          {strictErrors.length > 0 && (
            <div className="alert alert-error text-xs mt-2">
              <div>
                <div className="font-semibold mb-1">Strict errors</div>
                {strictErrors.map((err, idx) => (
                  <div key={`vstrict-${idx}`}>
                    {err.code || "STRICT"}: {err.message}
                    {err.line ? ` (line ${err.line}${err.col ? `, col ${err.col}` : ""})` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
          {completenessErrors.length > 0 && (
            <div className="alert alert-error text-xs mt-2">
              <div>
                <div className="font-semibold mb-1">Completeness</div>
                {completenessErrors.map((err, idx) => (
                  <div key={`vcomp-${idx}`}>
                    {err.code || "INCOMPLETE"}: {err.message}
                    {err.line ? ` (line ${err.line}${err.col ? `, col ${err.col}` : ""})` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
          {validationWarnings.length > 0 && (
            <div className="alert alert-warning text-xs mt-2">
              <div>
                {validationWarnings.map((warn, idx) => (
                  <div key={`vwarn-${idx}`}>
                    {warn.code || "WARN"}: {warn.message}
                    {warn.line ? ` (line ${warn.line}${warn.col ? `, col ${warn.col}` : ""})` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
          {baseErrors.length === 0 && strictErrors.length === 0 && completenessErrors.length === 0 && validationWarnings.length === 0 && (
            <div className="alert alert-success text-xs">Draft valid</div>
          )}
        </div>
      )}
      {lastChanges.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs font-semibold cursor-pointer">What changed</summary>
          <ul className="mt-2 text-xs space-y-1">
            {lastChanges.map((item, idx) => (
              <li key={`${item}-${idx}`} className="opacity-80">
                {item}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  ), [
    baseErrors,
    completenessErrors,
    draftError,
    lastChanges,
    prepareFixJson,
    runAgentDraftFlow,
    strictErrors,
    validation,
    validationErrors,
    validationWarnings,
  ]);

  const studioProfile = useMemo(() => ({
    kind: "studio",
    defaultTabId: "preview",
    rightTabs: [
      { id: "preview", label: "Preview", render: () => previewTab },
      { id: "draft", label: "Manifest", render: () => draftTab },
      { id: "history", label: "History", render: () => historyTab },
      { id: "advanced", label: "Advanced", render: () => advancedTab },
    ],
    actions: [
      { id: "save-draft", label: "Save Draft", kind: "secondary", onClick: () => saveDraftVersion("manual save"), disabled: !routeModuleId },
      { id: "install-draft", label: "Install Draft", kind: "primary", onClick: handleApply, disabled: !canInstallDraft },
    ],
  }), [advancedTab, canInstallDraft, draftTab, handleApply, historyTab, previewTab, routeModuleId, saveDraftVersion]);

  const loadRecord = useCallback(async () => ({ id: routeModuleId || "studio" }), [routeModuleId]);

  const deleteModal = pendingDelete ? (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">
          {pendingDeleteKind === "draft" ? "Delete draft" : "Delete module"}
        </h3>
        <p className="text-sm opacity-70 mt-2">
          {pendingDeleteKind === "draft"
            ? "This will remove the draft without affecting any installed module."
            : "This will delete the module and all its data."}
        </p>
        <p className="text-sm mt-2">Type <span className="font-mono">{pendingDelete}</span> to confirm.</p>
        <input
          className="input input-bordered w-full mt-3"
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder="module id"
        />
        <div className="modal-action">
          <button className="btn" onClick={closeDelete}>Cancel</button>
          <button
            className={`btn ${pendingDeleteKind === "draft" ? "btn-warning" : "btn-error"}`}
            onClick={confirmDelete}
            disabled={deleteConfirm !== pendingDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const deleteBlockedModal = deleteBlocked ? (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Module has records</h3>
        <p className="text-sm opacity-70 mt-2">
          This module has {deleteBlocked.recordCount || 0} record(s). You can archive it, or force delete to remove all records.
        </p>
        {Object.keys(deleteBlocked.entityCounts || {}).length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase opacity-60 mb-2">Records by entity</div>
            <ul className="text-sm space-y-1">
              {Object.entries(deleteBlocked.entityCounts)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([entityId, count]) => (
                  <li key={entityId}>
                    <span className="font-mono">{entityId}</span>: {count}
                  </li>
                ))}
            </ul>
          </div>
        )}
        <div className="mt-4">
          <div className="text-sm">Type <span className="font-mono">DELETE</span> to force delete.</div>
          <input
            className="input input-bordered w-full mt-2"
            value={forceConfirm}
            onChange={(e) => setForceConfirm(e.target.value)}
            placeholder="DELETE"
          />
        </div>
        <div className="modal-action">
          <button className="btn" onClick={() => setDeleteBlocked(null)}>Cancel</button>
          <button className="btn btn-ghost" onClick={handleArchiveBlocked} disabled={listActionLoading}>
            Archive instead
          </button>
          <button className="btn btn-error" onClick={handleForceDeleteBlocked} disabled={forceConfirm !== "DELETE" || listActionLoading}>
            Force delete
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (!routeModuleId) {
    return (
      <div className={`h-full min-h-0 flex flex-col overflow-hidden ${debugClass}`} ref={rootRef}>
        <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden">
          <div className="card-body flex flex-col min-h-0">
            <div className="mt-4 flex-1 min-h-0 overflow-auto overflow-x-hidden">
              {loadingModules && <div className="text-sm opacity-60">Loading modules...</div>}
              {modulesError && <div className="text-sm text-error">{modulesError}</div>}
              {!loadingModules && !modulesError && (
                <div className="flex flex-col gap-4 min-w-0">
                  <SystemListToolbar
                    title="Module"
                    createTooltip="New Module"
                    onCreate={() => setCreateModalOpen(true)}
                    searchValue={search}
                    onSearchChange={setSearch}
                    filters={listFilters}
                    onFilterChange={setModuleFilter}
                    filterableFields={filterableFields}
                    onAddCustomFilter={(field, value) => {
                      if (!field?.id) return;
                      setClientFilters((prev) => [
                        ...prev,
                        { field_id: field.id, label: field.label || field.id, op: "contains", value },
                      ]);
                    }}
                    onClearFilters={() => {
                      setModuleFilter("all");
                      setClientFilters([]);
                    }}
                    onRefresh={() => refreshModules(true)}
                    rightActions={
                      <>
                        {listSelectedIds.length === 1 && singleSelected && (
                          <div className="flex items-center gap-2">
                            {singleSelected.installed && (
                              <button
                                className={SOFT_BUTTON_SM}
                                onClick={() => openRollback(singleSelected.module_id)}
                                disabled={listActionLoading}
                              >
                                Rollback
                              </button>
                            )}
                            <button
                              className={SOFT_BUTTON_SM}
                              onClick={() =>
                                openDelete(
                                  singleSelected.module_id,
                                  singleSelected.installed ? "installed" : "draft"
                                )
                              }
                              disabled={listActionLoading}
                            >
                              Delete (1)
                            </button>
                          </div>
                        )}
                        {listSelectedIds.length > 1 && (
                          <div className="flex items-center gap-2">
                            <button
                              className={SOFT_BUTTON_SM}
                              onClick={() => {
                                if (listActionLoading) return;
                                const ok = window.confirm(`Delete ${listSelectedIds.length} module(s)?`);
                                if (!ok) return;
                                Promise.all(
                                  selectedRows.map((row) => {
                                    if (!row) return Promise.resolve();
                                    return row.installed
                                      ? deleteModule(row.module_id)
                                      : deleteStudio2Draft(row.module_id);
                                  })
                                )
                                  .then(() => {
                                    setListSelectedIds([]);
                                    refreshModules(true);
                                  })
                                  .catch(() => {});
                              }}
                            >
                              Delete ({listSelectedIds.length})
                            </button>
                          </div>
                        )}
                      </>
                    }
                  />

                  <ListViewRenderer
                    view={listView}
                    fieldIndex={listFieldIndex}
                    records={listRecords}
                    hideHeader
                    disableHorizontalScroll
                    tableClassName="w-full table-fixed min-w-0"
                    searchQuery={search}
                    searchFields={["studio.name", "studio.module_id"]}
                    filters={listFilters}
                    activeFilter={activeListFilter}
                    clientFilters={clientFilters}
                    selectedIds={listSelectedIds}
                    onToggleSelect={(id, checked) => {
                      if (!id) return;
                      setListSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(id);
                        else next.delete(id);
                        return Array.from(next);
                      });
                    }}
                    onToggleAll={(checked, allIds) => {
                      setListSelectedIds(checked ? allIds || [] : []);
                    }}
                    onSelectRow={(row) => {
                      const id = row?.record_id || row?.record?.["studio.module_id"];
                      if (id) navigate(`/studio/${id}`);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {createModalOpen && (
          <div className="modal modal-open">
            <div className="modal-box">
              <h3 className="font-bold text-lg">Create New Module</h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs opacity-70">Module Name</label>
                  <input
                    className="input input-bordered w-full"
                    placeholder="Work Orders"
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs opacity-70">Description (optional)</label>
                  <textarea
                    className="textarea textarea-bordered w-full"
                    rows={3}
                    placeholder="Short description of this module"
                    value={newModuleDescription}
                    onChange={(e) => setNewModuleDescription(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-action">
                <button className="btn btn-ghost" onClick={() => setCreateModalOpen(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleCreateModule}>Create</button>
              </div>
            </div>
          </div>
        )}
        {rollbackModalOpen && (
          <div className="modal modal-open">
            <div className="modal-box">
              <h3 className="font-bold text-lg">Rollback Module</h3>
              <div className="mt-4 space-y-3">
                {rollbackLoading && <div className="text-sm opacity-60">Loading snapshots...</div>}
                {rollbackError && <div className="alert alert-error text-sm">{rollbackError}</div>}
                {!rollbackLoading && rollbackSnapshots.length === 0 && !rollbackError && (
                  <div className="text-sm opacity-60">No snapshots available.</div>
                )}
                {!rollbackLoading && rollbackSnapshots.length > 0 && (
                  <div className="space-y-2">
                    {rollbackSnapshots.map((snap) => (
                      <label key={snap.manifest_hash} className="flex items-center gap-2 text-xs">
                        <input
                          type="radio"
                          name="rollbackSnapshot"
                          className="radio radio-xs"
                          checked={rollbackSelected === snap.manifest_hash}
                          onChange={() => setRollbackSelected(snap.manifest_hash)}
                        />
                        <span className="font-mono">{(snap.manifest_hash || "").slice(0, 12)}</span>
                        <span className="opacity-60">{snap.created_at || ""}</span>
                      </label>
                    ))}
                  </div>
                )}
                {!rollbackLoading && rollbackHistory.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-semibold mb-2">Recent history</div>
                    <div className="space-y-2 text-xs">
                      {rollbackHistory.slice(0, 10).map((entry) => (
                        <div key={entry.audit_id || entry.at} className="flex flex-wrap items-center gap-2">
                          <span className="badge badge-outline">{entry.action || "change"}</span>
                          {entry.transaction_group_id && <span className="font-mono">{entry.transaction_group_id}</span>}
                          {entry.patch_id && <span className="font-mono">{entry.patch_id}</span>}
                          <span className="opacity-60">{entry.at || ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-action">
                <button className="btn btn-ghost" onClick={() => setRollbackModalOpen(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleRollbackFromList} disabled={rollbackLoading || !rollbackSelected}>
                  Rollback
                </button>
              </div>
            </div>
          </div>
        )}
        {deleteModal}
        {deleteBlockedModal}
      </div>
    );
  }

  return (
    <div className={`h-full min-h-0 flex flex-col overflow-hidden ${debugClass}`} ref={rootRef}>
      <TemplateStudioShell
        title={moduleTitle}
        recordId={routeModuleId}
        profile={studioProfile}
        loadRecord={loadRecord}
        enableAutosave={false}
        activeTab={rightTab}
        onTabChange={setRightTab}
        renderLeftPane={renderLeftPane}
        renderValidationPanel={renderValidationPanel}
      />

      {fixModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Apply JSON Fix?</h3>
            <p className="text-sm opacity-70 mt-2">Proposed changes summary:</p>
            <div className="mt-2 text-xs">
              <div>Lines: {fixSummary?.beforeLines} → {fixSummary?.afterLines}</div>
              <div>Chars: {fixSummary?.beforeChars} → {fixSummary?.afterChars}</div>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setFixModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyFixJson}>Apply Fix</button>
            </div>
          </div>
        </div>
      )}

      {createModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Create New Module</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs opacity-70">Module Name</label>
                <input
                  className="input input-bordered w-full"
                  placeholder="Work Orders"
                  value={newModuleName}
                  onChange={(e) => setNewModuleName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs opacity-70">Description (optional)</label>
                <textarea
                  className="textarea textarea-bordered w-full text-xs"
                  rows={3}
                  placeholder="Short description of this module"
                  value={newModuleDescription}
                  onChange={(e) => setNewModuleDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setCreateModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateModule} disabled={newModuleBusy}>
                {newModuleBusy ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
      {rollbackModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Rollback Module</h3>
            <div className="mt-4 space-y-3">
              {rollbackLoading && <div className="text-sm opacity-60">Loading snapshots...</div>}
              {rollbackError && <div className="alert alert-error text-sm">{rollbackError}</div>}
              {!rollbackLoading && rollbackSnapshots.length === 0 && !rollbackError && (
                <div className="text-sm opacity-60">No snapshots available.</div>
              )}
              {!rollbackLoading && rollbackSnapshots.length > 0 && (
                <div className="space-y-2">
                  {rollbackSnapshots.map((snap) => (
                    <label key={snap.manifest_hash} className="flex items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name="rollbackSnapshot"
                        className="radio radio-xs"
                        checked={rollbackSelected === snap.manifest_hash}
                        onChange={() => setRollbackSelected(snap.manifest_hash)}
                      />
                      <span className="font-mono">{(snap.manifest_hash || "").slice(0, 12)}</span>
                      <span className="opacity-60">{snap.created_at || ""}</span>
                    </label>
                  ))}
                </div>
              )}
              {!rollbackLoading && rollbackHistory.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold mb-2">Recent history</div>
                  <div className="space-y-2 text-xs">
                    {rollbackHistory.slice(0, 10).map((entry) => (
                      <div key={entry.audit_id || entry.at} className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-outline">{entry.action || "change"}</span>
                        {entry.transaction_group_id && <span className="font-mono">{entry.transaction_group_id}</span>}
                        {entry.patch_id && <span className="font-mono">{entry.patch_id}</span>}
                        <span className="opacity-60">{entry.at || ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setRollbackModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRollbackFromList} disabled={rollbackLoading || !rollbackSelected}>
                Rollback
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteModal}
      {deleteBlockedModal}
    </div>
  );
}
