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
  publishMarketplaceApp,
  rollbackStudio2Module,
  saveStudio2Draft,
  studio2AgentChat,
  studio2AiFixJson,
  studio2JsonFix,
  validateStudio2Draft,
  validateStudio2Patchset,
} from "../api";
import { useToast } from "../components/Toast.jsx";
import CodeTextarea from "../components/CodeTextarea.jsx";
import { startAgentStream } from "../studio2/useAgentStream.js";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { useAccessContext } from "../access.js";
import { formatDateTime } from "../utils/dateTime.js";
import { DESKTOP_PAGE_SHELL } from "../ui/pageShell.js";
import { MoreHorizontal } from "lucide-react";
import useWorkspaceProviderStatus from "../hooks/useWorkspaceProviderStatus.js";
import ProviderSecretModal from "../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../components/ProviderUnavailableState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import ArtifactAiStageCard from "../components/ArtifactAiStageCard.jsx";
import ScopedAiAssistantPane from "../components/ScopedAiAssistantPane.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { writeStudioPreviewManifest } from "./studio/studioPreviewStore.js";

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


function summarizeChanges(calls = [], opsByModule = [], t = null) {
  const translate = (key, values, fallback) => (typeof t === "function" ? t(key, values) : fallback);
  const summary = [];
  calls.forEach((call) => {
    if (!call || typeof call !== "object") return;
    const tool = call.tool;
    const entityId = call.entity_id || call.args?.entity_id;
    if (tool === "ensure_entity" && entityId) summary.push(translate("settings.studio.change_log.added_entity", { entityId }, `Added entity: ${entityId}`));
    if (tool === "ensure_entity_pages" && entityId) summary.push(translate("settings.studio.change_log.ensured_pages_for", { entityId }, `Ensured pages for: ${entityId}`));
    if (tool === "ensure_nav") summary.push(translate("settings.studio.change_log.ensured_app_navigation", null, "Ensured app navigation"));
    if (tool === "ensure_relation") summary.push(translate("settings.studio.change_log.added_relation", null, "Added relation"));
    if (tool === "ensure_workflow") summary.push(translate("settings.studio.change_log.added_workflow", null, "Added workflow"));
    if (tool === "ensure_ui_pattern") summary.push(translate("settings.studio.change_log.applied_ui_pattern", null, "Applied UI pattern"));
    if (tool === "ensure_actions_for_status") summary.push(translate("settings.studio.change_log.ensured_status_actions", null, "Ensured status actions"));
  });
  opsByModule.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const ops = entry.ops || [];
    ops.forEach((op) => {
      if (!op || typeof op !== "object") return;
      summary.push(translate("settings.studio.change_log.operation", { op: op.op, path: op.path }, `Op: ${op.op} ${op.path}`));
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
    "stat_cards",
    "tabs",
    "text",
    "container",
    "record",
    "toolbar",
    "statusbar",
    "chatter",
    "view_modes",
    "related_list",
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
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { pushToast } = useToast();
  const { t, formatDateTime: formatLocalizedDateTime } = useI18n();
  const navigate = useNavigate();
  const { moduleId: routeModuleId } = useParams();
  const { isSuperadmin, hasCapability } = useAccessContext();
  const { providers: aiProviders, loading: providerStatusLoading, reload: reloadProviderStatus } = useWorkspaceProviderStatus(["openai"]);
  const studioAiEnabled = isSuperadmin && Boolean(aiProviders?.openai?.connected);
  const canManageSettings = hasCapability("workspace.manage_settings");

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
  const [pendingAgentPlan, setPendingAgentPlan] = useState(null);
  const [openAiModalOpen, setOpenAiModalOpen] = useState(false);
  const [progressEvents, setProgressEvents] = useState([]);
  const streamCancelRef = useRef(null);
  const [rightTab, setRightTab] = useState("preview");
  const previewFrameRef = useRef(null);
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
  const [deleteMode, setDeleteMode] = useState("keep_records"); // keep_records | delete_records
  const [deleteBlocked, setDeleteBlocked] = useState(null);
  const [forceConfirm, setForceConfirm] = useState("");
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishModuleId, setPublishModuleId] = useState("");
  const [publishTitle, setPublishTitle] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishSlug, setPublishSlug] = useState("");
  const [publishCategory, setPublishCategory] = useState("");
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
      setModulesError(err.message || t("settings.studio.errors.load_modules_failed"));
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
        pushToast("error", err.message || t("settings.studio.errors.load_manifest_failed"));
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
    setInstalledManifest(null);
  }, [routeModuleId]);

  useEffect(() => {
    setPendingAgentPlan(null);
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
          errors: [{ code: "VALIDATE_FAILED", message: err.message || t("settings.studio.errors.validation_failed") }],
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
      module_key: m.module_key || m.module_id,
      name: m.name || m.module_id,
      installed: Boolean(m.installed),
      enabled: m.enabled,
      has_draft: Boolean(m.draft),
      draft_in_sync:
        typeof m.draft_in_sync === "boolean"
          ? m.draft_in_sync
          : Boolean(m.draft_hash && m.current_hash && m.draft_hash === m.current_hash),
      updated_at: m.draft?.updated_at || m.updated_at,
    }));
  }, [studioModules]);

  const listFieldIndex = useMemo(
    () => ({
      "studio.name": { id: "studio.name", label: t("common.name") },
      "studio.status": { id: "studio.status", label: t("common.status") },
      "studio.updated_at": { id: "studio.updated_at", label: t("common.updated") },
      "studio.module_key": { id: "studio.module_key", label: t("settings.key") },
      "studio.module_id": { id: "studio.module_id", label: t("settings.module_id") },
    }),
    [t]
  );

  const listView = useMemo(
    () => ({
      id: "studio.modules.list",
      kind: "list",
      columns: [
        { field_id: "studio.name" },
        { field_id: "studio.status" },
        { field_id: "studio.updated_at" },
        { field_id: "studio.module_key", label: t("settings.key") },
        { field_id: "studio.module_id", label: t("common.id") },
      ],
    }),
    [t]
  );

  const listRecords = useMemo(() => {
    return moduleRows.map((row) => {
      const status = row.installed
        ? row.has_draft
          ? row.draft_in_sync
            ? t("settings.studio.list_status.installed")
            : t("settings.studio.list_status.dirty")
          : t("settings.studio.list_status.installed")
        : row.has_draft
          ? t("common.draft")
          : "—";
      return {
        record_id: row.module_id,
        record: {
          "studio.name": row.name,
          "studio.status": status,
          "studio.updated_at": row.updated_at || "—",
          "studio.module_key": row.module_key || "—",
          "studio.module_id": row.module_id,
        },
      };
    });
  }, [moduleRows, t]);

  const activeModuleName = useMemo(() => {
    if (!routeModuleId) return "";
    const match = moduleRows.find((row) => row.module_id === routeModuleId);
    return match?.name || routeModuleId;
  }, [moduleRows, routeModuleId]);

  const listFilters = useMemo(
    () => [
      { id: "all", label: t("common.all"), domain: null },
      { id: "drafts", label: t("settings.studio.list_filters.drafts"), domain: { op: "eq", field: "studio.status", value: t("common.draft") } },
      { id: "installed", label: t("settings.studio.list_status.installed"), domain: { op: "eq", field: "studio.status", value: t("settings.studio.list_status.installed") } },
      { id: "dirty", label: t("settings.studio.list_status.dirty"), domain: { op: "eq", field: "studio.status", value: t("settings.studio.list_status.dirty") } },
    ],
    [t]
  );

  const activeListFilter = useMemo(
    () => listFilters.find((flt) => flt.id === moduleFilter) || null,
    [listFilters, moduleFilter]
  );

  const filterableFields = useMemo(
    () => [
      { id: "studio.name", label: t("common.name") },
      { id: "studio.status", label: t("common.status") },
      { id: "studio.updated_at", label: t("common.updated") },
      { id: "studio.module_key", label: t("settings.key") },
      { id: "studio.module_id", label: t("settings.module_id") },
    ],
    [t]
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
        title: t("common.preview"),
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
      pushToast("error", t("settings.studio.errors.patchset_empty"));
      return null;
    }
    const parsed = parseJsonWithPos(patchsetText);
    if (parsed.error) {
      pushToast("error", t("settings.studio.errors.patchset_json_invalid"));
      return null;
    }
    return parsed.value;
  }

  async function handleValidate() {
    if (!patchsetText?.trim()) {
      if (!draftManifest) {
        pushToast("error", t("settings.studio.errors.draft_json_invalid_validate"));
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
        pushToast(
          errors.length ? "error" : "success",
          errors.length ? t("settings.studio.errors.draft_validation_failed") : t("validation.draft_valid")
        );
      } catch (err) {
        setValidation({
          status: "error",
          errors: [{ message: err.message || t("settings.studio.errors.validation_failed") }],
          warnings: [],
          strictErrors: [],
          completenessErrors: [],
          designWarnings: [],
        });
        pushToast("error", err.message || t("settings.studio.errors.validation_failed"));
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
        pushToast("error", t("settings.studio.errors.validation_failed"));
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
      pushToast(
        errors.length ? "error" : "success",
        errors.length ? t("settings.studio.errors.validation_failed") : t("settings.studio.notices.validation_complete")
      );
    } catch (err) {
      setValidation({
        status: "error",
        errors: [{ message: err.message || t("settings.studio.errors.validation_failed") }],
        warnings: [],
        strictErrors: [],
        completenessErrors: [],
        designWarnings: [],
      });
      pushToast("error", err.message || t("settings.studio.errors.validation_failed"));
    }
  }

  function handlePreview() {
    if (!draftManifest) {
      pushToast("error", t("settings.studio.errors.draft_json_invalid_preview"));
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
      pushToast("error", applied.errors[0] || t("settings.studio.errors.preview_failed"));
      setPreviewManifest(null);
      return;
    }
    setPreviewManifest(applied.manifest);
  }

  async function handleApply() {
    if (!patchsetText?.trim()) {
      if (!draftManifest) {
        pushToast("error", t("settings.studio.errors.draft_json_invalid_install"));
        return;
      }
      if (!canInstallDraft) {
        pushToast("error", t("settings.studio.errors.fix_validation_before_install"));
        return;
      }
      try {
        const res = await installStudio2Draft(routeModuleId, draftText);
        if (res?.ok === false) {
          setValidation({
            status: "ok",
            errors: Array.isArray(res?.errors) ? res.errors : [{ message: t("settings.studio.errors.install_blocked_by_validation") }],
            warnings: Array.isArray(res?.warnings) ? res.warnings : [],
            strictErrors: [],
            completenessErrors: [],
            designWarnings: [],
          });
          pushToast("error", res?.errors?.[0]?.message || t("settings.studio.errors.install_blocked_by_validation"));
          return;
        }
        const info = { ...res.data, applied_at: nowIso() };
        setApplyInfo(info);
        setRollbackTarget(info.transaction_group_id || "");
        pushToast("success", t("settings.studio.notices.draft_installed"));
        await refreshModules(true);
        const historyRes = await listStudio2History(routeModuleId);
        setHistorySnapshots(historyRes.data?.snapshots || []);
        setHistoryDrafts(historyRes.data?.draft_versions || []);
      } catch (err) {
        if (Array.isArray(err?.errors)) {
          setValidation({
            status: "ok",
            errors: err.errors,
            warnings: Array.isArray(err?.warnings) ? err.warnings : [],
            strictErrors: [],
            completenessErrors: [],
            designWarnings: [],
          });
        }
        pushToast("error", err.message || t("settings.studio.errors.install_failed"));
      }
      return;
    }
    const patchset = parsePatchsetOrToast();
    if (!patchset) return;
    if (validation.status !== "ok") {
      pushToast("error", t("settings.studio.errors.validate_before_apply"));
      return;
    }
    try {
      const res = await applyStudio2Patchset(patchset, "studio2");
      const info = { ...res.data, applied_at: nowIso() };
      setApplyInfo(info);
      setRollbackTarget(info.transaction_group_id || "");
      pushToast("success", t("settings.studio.notices.patchset_applied"));
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || t("settings.studio.errors.apply_failed"));
    }
  }

  async function handleRollback() {
    if (!routeModuleId) return;
    if (!rollbackTarget?.trim()) {
      pushToast("error", t("settings.studio.errors.no_rollback_target"));
      return;
    }
    const payload = rollbackTarget.startsWith("sha256:")
      ? { to_snapshot_hash: rollbackTarget }
      : { to_transaction_group_id: rollbackTarget };
    try {
      await rollbackStudio2Module(routeModuleId, payload);
      pushToast("success", t("settings.studio.notices.rollback_complete"));
      const res = await listStudio2History(routeModuleId);
      setHistorySnapshots(res.data?.snapshots || []);
      setHistoryDrafts(res.data?.draft_versions || []);
    } catch (err) {
      pushToast("error", err.message || t("settings.studio.errors.rollback_failed"));
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
        pushToast("error", t("settings.studio.errors.unable_to_fix_json"));
        return;
      }
      const beforeLines = draftText.split("\n").length;
      const afterLines = fixed.split("\n").length;
      setFixCandidate(fixed);
      setFixSummary({ beforeLines, afterLines, beforeChars: draftText.length, afterChars: fixed.length });
      setFixModalOpen(true);
    } catch (err) {
      pushToast("error", err.message || t("settings.studio.errors.fix_json_failed"));
    }
  }

  function applyFixJson() {
    if (!fixCandidate) return;
    setDraftText(fixCandidate);
    setFixModalOpen(false);
    setFixCandidate(null);
    setFixSummary(null);
    pushToast("success", t("settings.studio.notices.json_fixed"));
  }

  async function sendAgentMessage(userMessage) {
    if (!routeModuleId || !userMessage.trim()) return;
    setPendingAgentPlan(null);
    setChatMessages((prev) => [...prev, { role: "user", text: userMessage, ts: nowIso() }]);
    setChatLoading(true);
    try {
      const history = chatMessages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      const res = await studio2AgentChat(routeModuleId, userMessage, null, null, null, history);
      const payload = res.data || {};
      applyAgentPayload(payload, null, payload.diagnostics || null);
    } catch (err) {
      if (err.code === "OPENAI_NOT_CONFIGURED" || (err.message || "").includes("OpenAI")) {
        if (canManageSettings) {
          setOpenAiModalOpen(true);
        } else {
          pushToast("error", t("settings.studio.agent.openai_not_connected"));
        }
      } else {
        pushToast("error", err.message || t("settings.studio.errors.agent_chat_failed"));
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
      pushToast("error", t("settings.studio.errors.patchset_empty"));
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
      pushToast("error", t("settings.studio.errors.draft_json_invalid"));
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
    pushToast("success", t("settings.studio.notices.patchset_generated_from_draft"));
  }

  async function saveDraftVersion(note = null, manifestOverride = null) {
    const manifestText = manifestOverride ? stringifyPretty(manifestOverride) : draftText;
    if (!manifestText.trim()) {
      pushToast("error", t("settings.studio.errors.draft_empty"));
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
      pushToast("error", err.message || t("settings.studio.errors.save_draft_failed"));
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

  function applyAgentPayload(payload, assistantOverride = null, diagnostics = null) {
    const assistantMessage = assistantOverride || payload.notes || payload.assistant_message || t("settings.studio.agent.draft_updated");
    setChatMessages((prev) => [...prev, { role: "assistant", text: assistantMessage, ts: nowIso(), diagnostics }]);
    const drafts = payload.drafts || {};
    const nextDraftText = drafts && drafts[routeModuleId] ? stringifyPretty(drafts[routeModuleId]) : "";
    const errors = payload.validation?.errors || [];
    const warnings = payload.validation?.warnings || [];
    const strictErrors = payload.validation?.strict_errors || [];
    const completenessErrors = payload.validation?.completeness_errors || [];
    const designWarnings = payload.validation?.design_warnings || [];
    const changeSummary = summarizeChanges(payload.calls || [], payload.ops_by_module || [], t);
    const hasErrors = errors.length + strictErrors.length + completenessErrors.length > 0;
    setPendingAgentPlan({
      draftText: nextDraftText,
      summary: assistantMessage,
      changes: changeSummary,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      validation: payload.validation
        ? {
            status: hasErrors ? "error" : "ok",
            errors,
            warnings,
            strictErrors,
            completenessErrors,
            designWarnings,
          }
        : null,
    });
  }

  function applyPendingAgentPlan({ openPreview = false } = {}) {
    if (!pendingAgentPlan?.draftText) return;
    setDraftText(pendingAgentPlan.draftText);
    if (Array.isArray(pendingAgentPlan.changes)) {
      setLastChanges(pendingAgentPlan.changes);
    }
    if (pendingAgentPlan.validation) {
      setValidation(pendingAgentPlan.validation);
    }
    if (openPreview || pendingAgentPlan.validation?.status !== "error") {
      setRightTab("preview");
    }
    setChatMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        ts: nowIso(),
        card: {
          title: "Studio Plan",
          summary: pendingAgentPlan.summary,
          stageLabel: openPreview ? "Applied + Preview" : "Applied",
          stageTone: "success",
          detailsTitle: "Planned Changes",
          details: pendingAgentPlan.changes || [],
          warnings: pendingAgentPlan.warnings || [],
          validation: pendingAgentPlan.validation,
        },
      },
    ]);
    setPendingAgentPlan(null);
  }

  function discardPendingAgentPlan() {
    if (pendingAgentPlan) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          ts: nowIso(),
          card: {
            title: "Studio Plan",
            summary: pendingAgentPlan.summary,
            stageLabel: "Discarded",
            stageTone: "ghost",
            detailsTitle: "Planned Changes",
            details: pendingAgentPlan.changes || [],
            warnings: pendingAgentPlan.warnings || [],
            validation: pendingAgentPlan.validation,
          },
        },
      ]);
    }
    setPendingAgentPlan(null);
  }

  async function runAgentDraftFlow(userMessage) {
    if (!routeModuleId) return;
    setPendingAgentPlan(null);
    setChatLoading(true);
    setChatMessages((prev) => [...prev, { role: "user", text: userMessage, ts: nowIso() }]);
    setProgressEvents([
      { event: "run_started", phase: "start", iter: null, ts_ms: Date.now(), data: { local: true } },
    ]);
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
          if (evt.event === "final_done" || evt.event === "done") {
            doneReceived = true;
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
      if (!finalEnvelope?.ok) {
        pushToast("error", finalEnvelope?.errors?.[0]?.message || t("settings.studio.errors.agent_stream_failed"));
        return;
      }
      applyAgentPayload(finalEnvelope.data || {}, null, finalEnvelope.data?.diagnostics || null);
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
        applyAgentPayload(payload, null, payload.diagnostics || null);
      } catch (fallbackErr) {
        if (fallbackErr.code === "OPENAI_NOT_CONFIGURED" || (fallbackErr.message || "").includes("OpenAI")) {
          if (canManageSettings) {
            setOpenAiModalOpen(true);
          } else {
            pushToast("error", t("settings.studio.agent.openai_not_connected"));
          }
        } else {
          pushToast("error", fallbackErr.message || t("settings.studio.errors.agent_chat_failed"));
        }
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
      setChatLoading(false);
    }
  }

  function copyText(value) {
    if (!value) return;
    try {
      navigator.clipboard?.writeText(value);
      pushToast("success", t("settings.external_api_docs.copied"));
    } catch (err) {
      pushToast("error", t("settings.external_api_docs.copy_failed"));
    }
  }

  async function handleCreateModule() {
    try {
      setNewModuleBusy(true);
      const name = newModuleName.trim();
      if (!name) {
        pushToast("error", t("settings.studio.errors.module_name_required"));
        return;
      }
      const res = await createStudio2Module(name, newModuleDescription.trim());
      const createdId = res.data?.module_id;
      sessionStorage.removeItem(storageKey(createdId));
      setCreateModalOpen(false);
      setNewModuleName("");
      setNewModuleDescription("");
      navigate(`/studio/${createdId}`);
      pushToast("success", t("settings.studio.notices.module_created"));
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || t("settings.studio.errors.create_module_failed"));
    } finally {
      setNewModuleBusy(false);
    }
  }

  function openDelete(moduleId, kind) {
    setPendingDelete(moduleId);
    setPendingDeleteKind(kind);
    setDeleteConfirm("");
    setDeleteMode("keep_records");
    setDeleteBlocked(null);
    setForceConfirm("");
  }

  function closeDelete() {
    setPendingDelete(null);
    setPendingDeleteKind(null);
    setDeleteConfirm("");
    setDeleteMode("keep_records");
    setDeleteBlocked(null);
    setForceConfirm("");
  }

  function openPublish(moduleRow) {
    if (!moduleRow?.module_id) return;
    setPublishModuleId(moduleRow.module_id);
    setPublishTitle(moduleRow.name || moduleRow.module_id);
    setPublishDescription("");
    setPublishSlug("");
    setPublishCategory("");
    setPublishModalOpen(true);
  }

  async function confirmPublish() {
    if (!publishModuleId || publishBusy) return;
    setPublishBusy(true);
    try {
      const payload = { module_id: publishModuleId };
      if (publishTitle.trim()) payload.title = publishTitle.trim();
      if (publishDescription.trim()) payload.description = publishDescription.trim();
      if (publishSlug.trim()) payload.slug = publishSlug.trim();
      if (publishCategory.trim()) payload.category = publishCategory.trim();
      await publishMarketplaceApp(payload);
      pushToast("success", t("settings.studio.notices.published_to_marketplace"));
      setPublishModalOpen(false);
    } catch (err) {
      pushToast("error", err?.message || t("settings.studio.publish_failed"));
    } finally {
      setPublishBusy(false);
    }
  }

  async function handleDeleteModule(moduleId, opts = {}) {
    setListActionLoading(true);
    try {
      await deleteModule(moduleId, opts);
      pushToast("success", t("settings.studio.notices.module_deleted"));
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
      pushToast("error", err.message || t("settings.studio.errors.delete_module_failed"));
      return false;
    } finally {
      setListActionLoading(false);
    }
  }

  async function handleDeleteDraft(moduleId) {
    setListActionLoading(true);
    try {
      await deleteStudio2Draft(moduleId);
      pushToast("success", t("settings.studio.notices.draft_deleted"));
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || t("settings.studio.errors.delete_draft_failed"));
    } finally {
      setListActionLoading(false);
    }
  }

  async function handleArchiveBlocked() {
    if (!deleteBlocked?.moduleId) return;
    setListActionLoading(true);
    try {
      await deleteModule(deleteBlocked.moduleId, { archive: true });
      pushToast("success", t("settings.studio.notices.module_archived"));
      setDeleteBlocked(null);
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || t("settings.studio.errors.archive_module_failed"));
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
      pushToast("success", t("settings.studio.notices.module_deleted"));
      setDeleteBlocked(null);
      await refreshModules(true);
    } catch (err) {
      pushToast("error", err.message || t("settings.studio.errors.delete_module_failed"));
    } finally {
      setListActionLoading(false);
    }
  }

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

  const studioPlanProgressItems = useMemo(() => {
    const items = [];
    const seen = new Set();
    for (const evt of progressEvents) {
      if (!evt || typeof evt !== "object") continue;
      const data = evt.data || {};
      if (evt.event === "planner_result" && Array.isArray(data.build_spec_summary)) {
        for (const item of data.build_spec_summary.slice(0, 4)) {
          const line = typeof item === "string" ? item.trim() : "";
          if (line && !seen.has(line)) {
            seen.add(line);
            items.push(line);
          }
        }
        continue;
      }
      if (evt.event === "builder_result") {
        if (Array.isArray(data.plan_summary)) {
          for (const item of data.plan_summary.slice(0, 4)) {
            const line = typeof item === "string" ? item.trim() : "";
            if (line && !seen.has(line)) {
              seen.add(line);
              items.push(line);
            }
          }
        }
        const tools = Array.isArray(data.tools_used) ? data.tools_used.filter(Boolean) : [];
        if (tools.length > 0) {
          const line = `Using tools: ${tools.join(", ")}`;
          if (!seen.has(line)) {
            seen.add(line);
            items.push(line);
          }
        }
        continue;
      }
      if (evt.event === "apply_result") {
        const diff = data.diff_summary || {};
        const line = `Draft changes: ${diff.entities_added || 0} entities, ${diff.pages_added || 0} pages, ${diff.views_added || 0} views`;
        if (!seen.has(line)) {
          seen.add(line);
          items.push(line);
        }
        continue;
      }
      if (evt.event === "validate_result") {
        const counts = data.error_counts || {};
        const line = `Validation check: ${counts.total || 0} errors`;
        if (!seen.has(line)) {
          seen.add(line);
          items.push(line);
        }
        continue;
      }
      const summary = summarizeProgressEvent(evt);
      if (summary && !seen.has(summary) && evt.event !== "run_started" && evt.event !== "final_done") {
        seen.add(summary);
        items.push(summary);
      }
    }
    return items.slice(-6);
  }, [progressEvents]);

  const studioPlanningStatusItems = useMemo(() => {
    if (studioPlanProgressItems.length > 0) return [];
    return [
      `Reviewing ${activeModuleName || "the current module"} and the current draft`,
      "Planning manifest changes, pages, and data updates",
      "Preparing a validated proposal for review",
    ];
  }, [activeModuleName, studioPlanProgressItems]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDeleteKind === "draft") {
      await handleDeleteDraft(pendingDelete);
    } else {
      const opts = deleteMode === "delete_records" ? { force: true } : { archive: true };
      const blocked = await handleDeleteModule(pendingDelete, opts);
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
      setRollbackError(err.message || t("settings.studio.errors.load_snapshots_failed"));
    } finally {
      setRollbackLoading(false);
    }
  }

  async function handleRollbackSnapshot(snapshotHash) {
    if (!snapshotHash) return;
    try {
      await rollbackStudio2Module(routeModuleId, { to_snapshot_hash: snapshotHash });
      pushToast("success", t("settings.studio.notices.rollback_complete"));
      await refreshModules(true);
      const res = await listStudio2History(routeModuleId);
      setHistorySnapshots(res.data?.snapshots || []);
      setHistoryDrafts(res.data?.draft_versions || []);
    } catch (err) {
      pushToast("error", err.message || t("settings.studio.errors.rollback_failed"));
    }
  }

  async function handleRollbackDraftVersion(versionId) {
    if (!versionId) return;
    try {
      await rollbackStudio2Module(routeModuleId, { to_draft_version_id: versionId });
      pushToast("success", t("settings.studio.notices.draft_rolled_back"));
      const res = await listStudio2History(routeModuleId);
      setHistorySnapshots(res.data?.snapshots || []);
      setHistoryDrafts(res.data?.draft_versions || []);
    } catch (err) {
      pushToast("error", err.message || t("settings.studio.errors.draft_rollback_failed"));
    }
  }

  async function handleRollbackFromList() {
    if (!rollbackTargetModule || !rollbackSelected) return;
    setRollbackLoading(true);
    setRollbackError("");
    try {
      await rollbackStudio2Module(rollbackTargetModule, { to_snapshot_hash: rollbackSelected });
      pushToast("success", t("settings.studio.notices.rollback_complete"));
      setRollbackModalOpen(false);
      await refreshModules(true);
    } catch (err) {
      setRollbackError(err.message || t("settings.studio.errors.rollback_failed"));
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
    if (!routeModuleId) return t("settings.index.blocks.studio.title");
    return draftManifest?.module?.name || moduleById.get(routeModuleId)?.name || routeModuleId;
  }, [routeModuleId, draftManifest, moduleById, t]);

  useEffect(() => {
    if (!routeModuleId) return;
    writeStudioPreviewManifest(routeModuleId, previewOverride || null);
    try {
      previewFrameRef.current?.contentWindow?.postMessage(
        {
          type: "octo:studio-preview-manifest",
          moduleId: routeModuleId,
          manifest: previewOverride || null,
        },
        window.location.origin,
      );
    } catch {
      // ignore iframe sync failures
    }
  }, [routeModuleId, previewOverride]);

  const previewTab = (
    <div className="h-full min-h-0 flex flex-col">
      <div className="mt-3 flex-1 min-h-0 overflow-hidden md:mt-0">
        {!previewOverride && (
          <div className="text-sm opacity-60">
            {draftError ? t("settings.studio.preview.invalid_draft_json") : t("settings.studio.preview.missing_configuration")}
          </div>
        )}
        {previewOverride && (
          <div className={`h-full min-h-0 overflow-hidden ${isMobile ? "bg-base-100" : DESKTOP_PAGE_SHELL}`}>
            <div className={`h-full min-h-0 overflow-hidden ${isMobile ? "" : "md:p-0"}`}>
              <div className="h-full min-h-0 overflow-hidden bg-base-200">
                <iframe
                  ref={previewFrameRef}
                  title={t("settings.studio.preview.frame_title")}
                  src={`/studio/preview/${routeModuleId}?octo_ai_frame=1`}
                  className="block h-full w-full border-0 bg-transparent"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const draftTab = (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">{t("settings.studio.tabs.manifest")}</div>
        <div />
      </div>
      <CodeTextarea
        value={draftText}
        onChange={(e) => setDraftText(e.target.value)}
        fill
        className="flex-1 min-h-0"
      />
      {draftError && (
        <div className="alert alert-error text-xs mt-2">
          {t("settings.studio.errors.json_error")}: {draftError.message} {draftError.line ? `(${draftError.line}:${draftError.col})` : ""}
        </div>
      )}
    </div>
  );

  const historyTab = (
    <div className="h-full min-h-0 overflow-auto">
      {historyLoading && <div className="text-sm opacity-60">{t("settings.studio.history.loading")}</div>}
      {!historyLoading && (
        <div className="space-y-6">
          <div>
            <div className="text-sm font-semibold mb-2">{t("settings.studio.history.installed_snapshots")}</div>
            {historySnapshots.length === 0 && <div className="text-xs opacity-60">{t("settings.studio.history.no_snapshots")}</div>}
            <div className="space-y-2">
              {historySnapshots.map((snap) => (
                <div key={`${snap.manifest_hash}-${snap.created_at}`} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-outline">{snap.action || t("settings.studio.history.snapshot")}</span>
                    <span className="font-mono">{(snap.manifest_hash || "").slice(0, 12)}</span>
                    {snap.transaction_group_id && <span className="font-mono">{snap.transaction_group_id}</span>}
                    <span className="opacity-60">{formatLocalizedDateTime(snap.created_at) || "—"}</span>
                  </div>
                  <button
                    className="btn btn-xs btn-outline"
                    onClick={() => handleRollbackSnapshot(snap.manifest_hash)}
                  >
                    {t("settings.studio.actions.rollback")}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold mb-2">{t("settings.studio.history.draft_versions")}</div>
            {historyDrafts.length === 0 && <div className="text-xs opacity-60">{t("settings.studio.history.no_draft_history")}</div>}
            <div className="space-y-2">
              {historyDrafts.map((dv) => (
                <div key={dv.draft_version_id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-outline">{t("common.draft")}</span>
                    <span className="font-mono">{(dv.draft_version_id || "").slice(0, 8)}</span>
                    {dv.note && <span>{dv.note}</span>}
                    <span className="opacity-60">{formatLocalizedDateTime(dv.created_at) || "—"}</span>
                  </div>
                  <button
                    className="btn btn-xs btn-outline"
                    onClick={() => handleRollbackDraftVersion(dv.draft_version_id)}
                  >
                    {t("settings.studio.actions.rollback_draft")}
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
          <div className="text-sm font-semibold">{t("settings.studio.advanced.patchset_json")}</div>
          <button className="btn btn-xs btn-outline" onClick={generatePatchsetFromDraft} disabled={!routeModuleId}>
            {t("settings.studio.actions.generate_from_draft")}
          </button>
        </div>
        <CodeTextarea
          value={patchsetText}
          onChange={(e) => setPatchsetText(e.target.value)}
          minHeight="220px"
        />
        {patchsetError && (
          <div className="alert alert-error text-xs mt-2">{t("settings.studio.errors.patchset_json_error")}: {patchsetError.message}</div>
        )}
        {patchsetSummary && <div className="text-xs opacity-70 mt-1">{t("settings.studio.summary")}: {patchsetSummary}</div>}
      </div>

      <div className="mt-3">
        <div className="text-sm font-semibold">{t("settings.studio.advanced.apply_rollback")}</div>
        <div className="text-xs opacity-70">{t("settings.studio.advanced.last_apply")}: {formatLocalizedDateTime(applyInfo?.applied_at) || "—"}</div>
        <div className="text-xs opacity-70 flex items-center gap-2">
          {t("settings.studio.advanced.transaction_group")}:
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
          placeholder={t("settings.studio.advanced.rollback_target_placeholder")}
          value={rollbackTarget}
          onChange={(e) => setRollbackTarget(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn btn-xs btn-outline" onClick={handleRollback} disabled={!rollbackTarget.trim()}>
            {t("settings.studio.actions.rollback")}
          </button>
          <button className="btn btn-xs btn-outline" onClick={() => openRollback(routeModuleId)}>
            {t("settings.studio.actions.view_history_rollback")}
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

  const renderLeftPane = useMemo(() => () => {
    if (providerStatusLoading) {
      return (
        <div ref={leftPaneRef} className="h-full min-h-0 flex flex-col overflow-hidden">
          <LoadingSpinner className="min-h-0 h-full" />
        </div>
      );
    }
    if (!isSuperadmin) {
      return (
        <div ref={leftPaneRef} className="h-full min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto space-y-4">
            <div className="chat chat-start">
              <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{t("common.assistant")}</div>
              <div className="chat-bubble text-sm leading-5 max-w-[85%] bg-base-200 text-base-content">
                Studio AI is currently limited to superadmins.
              </div>
            </div>
          </div>
        </div>
      );
    }
    if (!studioAiEnabled) {
      return (
        <div ref={leftPaneRef} className="h-full min-h-0 flex flex-col overflow-hidden">
          <ProviderUnavailableState
            title={t("settings.studio.agent.openai_not_connected")}
            description={t("settings.studio.agent.openai_not_connected_description")}
            actionLabel={t("settings.studio.agent.connect_openai")}
            canManageSettings={canManageSettings}
            loading={providerStatusLoading}
            onAction={() => setOpenAiModalOpen(true)}
          />
        </div>
      );
    }
    return (
      <div ref={leftPaneRef} className="h-full min-h-0 overflow-hidden">
        <div className="h-full min-h-0">
          <ScopedAiAssistantPane
            introMessage={routeModuleId
              ? t("settings.studio.agent.describe_change_for_module", { moduleName: activeModuleName })
              : t("settings.studio.agent.intro")}
            assistantLabel={t("common.assistant")}
            userLabel={userLabel}
            messages={chatMessages}
            scrollRef={chatListRef}
            autoScrollKey={`${chatMessages.length}:${chatLoading ? progressEvents.length : "idle"}:${pendingAgentPlan ? "proposal" : "none"}`}
            stageCard={chatLoading ? (
              <ArtifactAiStageCard
                title="Studio Plan"
                summary={summarizeProgressEvent(progressEvents[progressEvents.length - 1])}
                stageLabel="Planning"
                stageTone="warning"
                statusItems={studioPlanningStatusItems}
                detailsTitle={studioPlanProgressItems.length > 0 ? "Plan Progress" : ""}
                details={studioPlanProgressItems}
                busy
                actions={[
                  { label: "Cancel", onClick: cancelAgentRun, allowWhileBusy: true },
                ]}
              />
            ) : (!chatLoading && pendingAgentPlan ? (
              <ArtifactAiStageCard
                title="Studio Plan"
                summary={pendingAgentPlan.summary}
                stageLabel="Ready to Apply"
                stageTone="primary"
                detailsTitle="Planned Changes"
                details={pendingAgentPlan.changes?.length ? pendingAgentPlan.changes : studioPlanProgressItems}
                warnings={pendingAgentPlan.warnings}
                validation={pendingAgentPlan.validation}
                actions={[
                  { label: "Apply draft", onClick: () => applyPendingAgentPlan(), primary: true, disabled: !pendingAgentPlan?.draftText },
                  { label: "Apply + Preview", onClick: () => applyPendingAgentPlan({ openPreview: true }), disabled: !pendingAgentPlan?.draftText },
                  { label: "Discard", onClick: discardPendingAgentPlan },
                ]}
              />
            ) : null)}
            inputValue={chatInput}
            onInputChange={setChatInput}
            onSend={handleAgentChat}
            inputDisabled={!routeModuleId || chatLoading}
            inputPlaceholder={routeModuleId ? t("settings.studio.agent.placeholder") : t("settings.studio.agent.select_module_first")}
            minRows={4}
          />
        </div>
      </div>
    );
  }, [
    activeModuleName,
    applyPendingAgentPlan,
    cancelAgentRun,
    chatInput,
    chatLoading,
    chatMessages,
    discardPendingAgentPlan,
    handleAgentChat,
    pendingAgentPlan,
    progressEvents,
    studioPlanningStatusItems,
    studioPlanProgressItems,
    routeModuleId,
    canManageSettings,
    isSuperadmin,
    providerStatusLoading,
    studioAiEnabled,
    userLabel,
  ]);

  const renderValidationPanel = useMemo(() => () => (
    <div className="pb-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Validation</div>
        {studioAiEnabled && (validation.status === "error" || validationWarnings.length > 0) && (
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
      {!studioAiEnabled && (
        <div className="text-xs opacity-60 mt-2">
          {isSuperadmin
            ? "Connect OpenAI for this workspace to enable AI actions."
            : "Studio AI is currently limited to superadmins."}
        </div>
      )}
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
            <div className="alert alert-success text-xs">{t("validation.draft_valid")}</div>
          )}
        </div>
      )}
      {lastChanges.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs font-semibold cursor-pointer">{t("settings.studio.change_log.title")}</summary>
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
    isSuperadmin,
    lastChanges,
    prepareFixJson,
    runAgentDraftFlow,
    strictErrors,
    validation,
    validationErrors,
    validationWarnings,
    studioAiEnabled,
  ]);

  const studioProfile = useMemo(() => ({
    kind: "studio",
    defaultTabId: "preview",
    rightTabs: [
      { id: "preview", label: t("settings.studio.tabs.preview"), render: () => previewTab },
      { id: "draft", label: t("settings.studio.tabs.manifest"), render: () => draftTab },
      { id: "history", label: t("settings.studio.tabs.history"), render: () => historyTab },
      { id: "advanced", label: t("settings.studio.tabs.advanced"), render: () => advancedTab },
    ],
    actions: [
      { id: "save-draft", label: t("settings.studio.actions.save_draft"), kind: "secondary", onClick: () => saveDraftVersion("manual save"), disabled: !routeModuleId },
      { id: "install-draft", label: t("settings.studio.actions.install_draft"), kind: "primary", onClick: handleApply, disabled: !canInstallDraft },
    ],
  }), [advancedTab, canInstallDraft, draftTab, handleApply, historyTab, previewTab, routeModuleId, saveDraftVersion, t]);

  const loadRecord = useCallback(async () => ({ id: routeModuleId || "studio" }), [routeModuleId]);

  const deleteModal = pendingDelete ? (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">
          {pendingDeleteKind === "draft" ? t("settings.studio.delete_modal.draft_title") : t("settings.studio.actions.delete_module")}
        </h3>
        <p className="text-sm opacity-70 mt-2">
          {pendingDeleteKind === "draft"
            ? t("settings.studio.delete_modal.draft_body")
            : t("apps_page.delete_body")}
        </p>
        {pendingDeleteKind !== "draft" && (
          <div className="mt-4 space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="delete-mode"
                className="radio radio-sm mt-1"
                checked={deleteMode === "keep_records"}
                onChange={() => setDeleteMode("keep_records")}
              />
              <div>
                <div className="font-semibold">{t("settings.studio.delete_modal.remove_keep_records")}</div>
                <div className="text-xs opacity-70">
                  {t("settings.studio.delete_modal.remove_keep_records_help")}
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="delete-mode"
                className="radio radio-sm mt-1"
                checked={deleteMode === "delete_records"}
                onChange={() => setDeleteMode("delete_records")}
              />
              <div>
                <div className="font-semibold text-error">{t("settings.studio.delete_modal.delete_module_records")}</div>
                <div className="text-xs opacity-70">
                  {t("settings.studio.delete_modal.delete_module_records_help")}
                </div>
              </div>
            </label>
          </div>
        )}
        <p className="text-sm mt-2">{t("settings.studio.delete_modal.type_value_to_confirm", { value: pendingDelete })}</p>
        <input
          className="input input-bordered input-sm w-full mt-3"
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder={t("settings.studio.delete_modal.module_id_placeholder")}
        />
        {pendingDeleteKind !== "draft" && deleteMode === "delete_records" && (
          <div className="mt-3">
            <div className="text-sm">{t("settings.studio.delete_modal.also_type_delete_to_confirm")}</div>
            <input
              className="input input-bordered input-sm w-full mt-2"
              value={forceConfirm}
              onChange={(e) => setForceConfirm(e.target.value)}
              placeholder={t("settings.studio.delete_modal.delete_keyword_placeholder")}
            />
          </div>
        )}
        <div className="modal-action">
          <button className="btn" onClick={closeDelete}>Cancel</button>
          <button
            className={`btn ${
              pendingDeleteKind === "draft"
                ? "btn-warning"
                : deleteMode === "delete_records"
                  ? "btn-error"
                  : "btn-warning"
            }`}
            onClick={confirmDelete}
            disabled={
              deleteConfirm !== pendingDelete ||
              (pendingDeleteKind !== "draft" && deleteMode === "delete_records" && forceConfirm !== "DELETE")
            }
          >
            {pendingDeleteKind === "draft"
              ? t("common.delete")
              : deleteMode === "delete_records"
                ? t("common.delete")
                : t("common.remove")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const deleteBlockedModal = deleteBlocked ? (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">{t("settings.studio.delete_blocked.title")}</h3>
        <p className="text-sm opacity-70 mt-2">
          {t("settings.studio.delete_blocked.body", { count: deleteBlocked.recordCount || 0 })}
        </p>
        {Object.keys(deleteBlocked.entityCounts || {}).length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase opacity-60 mb-2">{t("settings.studio.delete_blocked.records_by_entity")}</div>
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
          <div className="text-sm">{t("settings.studio.delete_blocked.type_delete_to_force")}</div>
          <input
            className="input input-bordered input-sm w-full mt-2"
            value={forceConfirm}
            onChange={(e) => setForceConfirm(e.target.value)}
            placeholder={t("settings.studio.delete_modal.delete_keyword_placeholder")}
          />
        </div>
        <div className="modal-action">
          <button className="btn" onClick={() => setDeleteBlocked(null)}>Cancel</button>
          <button className="btn btn-ghost" onClick={handleArchiveBlocked} disabled={listActionLoading}>
            {t("settings.studio.delete_blocked.archive_instead")}
          </button>
          <button className="btn btn-error" onClick={handleForceDeleteBlocked} disabled={forceConfirm !== "DELETE" || listActionLoading}>
            {t("settings.studio.delete_blocked.force_delete")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const publishModal = publishModalOpen ? (
    <div className="modal modal-open">
      <div className="modal-box max-w-xl">
        <h3 className="font-bold text-lg">{t("settings.studio.publish_modal.title")}</h3>
        <div className="text-sm opacity-70 mt-1">
          {t("settings.studio.publish_modal.description", { moduleId: publishModuleId })}
        </div>
        <div className="mt-4 grid gap-3">
          <label className="form-control">
            <div className="label">
              <span className="label-text">{t("settings.studio.publish_modal.title_label")}</span>
            </div>
            <input
              className="input input-bordered input-sm w-full"
              value={publishTitle}
              onChange={(e) => setPublishTitle(e.target.value)}
              placeholder={t("settings.studio.publish_modal.title_placeholder")}
            />
          </label>
          <label className="form-control">
            <div className="label">
              <span className="label-text">{t("common.description")}</span>
            </div>
            <textarea
              className="textarea textarea-bordered textarea-sm w-full min-h-[92px]"
              value={publishDescription}
              onChange={(e) => setPublishDescription(e.target.value)}
              placeholder={t("settings.studio.publish_modal.description_placeholder")}
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="form-control">
              <div className="label">
                <span className="label-text">{t("settings.studio.publish_modal.slug_optional")}</span>
              </div>
              <input
                className="input input-bordered input-sm w-full"
                value={publishSlug}
                onChange={(e) => setPublishSlug(e.target.value)}
                placeholder={t("settings.studio.publish_modal.slug_placeholder")}
              />
            </label>
            <label className="form-control">
              <div className="label">
                <span className="label-text">{t("settings.studio.publish_modal.category_optional")}</span>
              </div>
              <input
                className="input input-bordered input-sm w-full"
                value={publishCategory}
                onChange={(e) => setPublishCategory(e.target.value)}
                placeholder={t("settings.studio.publish_modal.category_placeholder")}
              />
            </label>
          </div>
        </div>
        <div className="modal-action">
          <button className="btn" onClick={() => setPublishModalOpen(false)} disabled={publishBusy}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={confirmPublish} disabled={publishBusy}>
            {publishBusy ? t("settings.studio.publish_modal.publishing_action") : t("settings.studio.actions.publish")}
          </button>
        </div>
      </div>
      <div
        className="modal-backdrop"
        onClick={() => {
          if (!publishBusy) setPublishModalOpen(false);
        }}
      />
    </div>
  ) : null;

  if (!routeModuleId) {
    return (
      <div className={`${isMobile ? "min-h-full bg-base-100 flex flex-col" : "h-full min-h-0 flex flex-col overflow-hidden"} ${debugClass}`} ref={rootRef}>
        <div className={isMobile ? "h-full min-h-0 flex flex-col bg-base-100 overflow-hidden" : "card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden"}>
          <div className={isMobile ? "h-full min-h-0 p-4 flex flex-col" : "card-body flex flex-col min-h-0"}>
            <div className={`${isMobile ? "flex-1 min-h-0 overflow-auto overflow-x-hidden" : "mt-4 flex-1 min-h-0 overflow-auto overflow-x-hidden"}`}>
              {loadingModules && <div className="text-sm opacity-60">{t("settings.studio.loading_modules")}</div>}
              {modulesError && <div className="text-sm text-error">{modulesError}</div>}
              {!loadingModules && !modulesError && (
                <div className="flex flex-col gap-4 min-w-0">
                  <SystemListToolbar
                    title={t("common.module")}
                    createTooltip={t("settings.studio.new_module_tooltip")}
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
                      listSelectedIds.length > 0 ? (
                        <div className="dropdown dropdown-end">
                          <button className={SOFT_BUTTON_SM} type="button" tabIndex={0} aria-label={t("settings.selection_actions")}>
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-[200]">
                            <li className="menu-title">
                              <span>{t("settings.selection")}</span>
                            </li>
                            {listSelectedIds.length === 1 && singleSelected ? (
                              <>
                                <li>
                                  <button onClick={() => navigate(`/studio/${singleSelected.module_id}`)}>
                                    {t("settings.studio.actions.open_module")}
                                  </button>
                                </li>
                                {isSuperadmin && singleSelected.installed ? (
                                  <li>
                                    <button onClick={() => openPublish(singleSelected)} disabled={listActionLoading}>
                                      {t("settings.studio.actions.publish")}
                                    </button>
                                  </li>
                                ) : null}
                                {singleSelected.installed ? (
                                  <li>
                                    <button onClick={() => openRollback(singleSelected.module_id)} disabled={listActionLoading}>
                                      {t("settings.studio.actions.rollback")}
                                    </button>
                                  </li>
                                ) : null}
                              </>
                            ) : null}
                            <li>
                              <button
                                className="text-error"
                                onClick={() => {
                                  if (listSelectedIds.length === 1 && singleSelected) {
                                    openDelete(
                                      singleSelected.module_id,
                                      singleSelected.installed ? "installed" : "draft"
                                    );
                                    return;
                                  }
                                  if (listActionLoading) return;
                                  const ok = window.confirm(t("settings.studio.delete_selected_modules_confirm", { count: listSelectedIds.length }));
                                  if (!ok) return;
                                  Promise.all(
                                    selectedRows.map((row) => {
                                      if (!row) return Promise.resolve();
                                      return row.installed
                                        ? deleteModule(row.module_id, { archive: true })
                                        : deleteStudio2Draft(row.module_id);
                                    })
                                  )
                                    .then(() => {
                                      setListSelectedIds([]);
                                      refreshModules(true);
                                    })
                                    .catch(() => {});
                                }}
                                disabled={listActionLoading}
                              >
                                {listSelectedIds.length === 1 ? t("common.delete") : t("settings.studio.actions.delete_selected", { count: listSelectedIds.length })}
                              </button>
                            </li>
                          </ul>
                        </div>
                      ) : null
                    }
                  />

                  <ListViewRenderer
                    view={listView}
                    fieldIndex={listFieldIndex}
                    records={listRecords}
                    hideHeader
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
              <h3 className="font-bold text-lg">{t("settings.studio.create_new_module")}</h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs opacity-70">{t("settings.studio.module_name")}</label>
                  <input
                    className="input input-bordered input-sm w-full"
                    placeholder={t("settings.studio.module_name_placeholder")}
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs opacity-70">{t("settings.studio.description_optional")}</label>
                  <textarea
                    className="textarea textarea-bordered textarea-sm w-full"
                    rows={3}
                    placeholder={t("settings.studio.description_placeholder")}
                    value={newModuleDescription}
                    onChange={(e) => setNewModuleDescription(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-action">
                <button className="btn btn-ghost" onClick={() => setCreateModalOpen(false)}>{t("common.cancel")}</button>
                <button className="btn btn-primary" onClick={handleCreateModule}>{t("common.create")}</button>
              </div>
            </div>
          </div>
        )}
        {rollbackModalOpen && (
          <div className="modal modal-open">
            <div className="modal-box">
              <h3 className="font-bold text-lg">{t("settings.studio.rollback_module")}</h3>
              <div className="mt-4 space-y-3">
                {rollbackLoading && <div className="text-sm opacity-60">{t("settings.studio.loading_snapshots")}</div>}
                {rollbackError && <div className="alert alert-error text-sm">{rollbackError}</div>}
                {!rollbackLoading && rollbackSnapshots.length === 0 && !rollbackError && (
                  <div className="text-sm opacity-60">{t("settings.studio.no_snapshots_available")}</div>
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
                        <span className="opacity-60">{formatDateTime(snap.created_at, "")}</span>
                      </label>
                    ))}
                  </div>
                )}
                {!rollbackLoading && rollbackHistory.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-semibold mb-2">{t("settings.studio.recent_history")}</div>
                    <div className="space-y-2 text-xs">
                      {rollbackHistory.slice(0, 10).map((entry) => (
                        <div key={entry.audit_id || entry.at} className="flex flex-wrap items-center gap-2">
                          <span className="badge badge-outline">{entry.action || t("settings.studio.change")}</span>
                          {entry.transaction_group_id && <span className="font-mono">{entry.transaction_group_id}</span>}
                          {entry.patch_id && <span className="font-mono">{entry.patch_id}</span>}
                          <span className="opacity-60">{formatLocalizedDateTime(entry.at) || "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-action">
                <button className="btn btn-ghost" onClick={() => setRollbackModalOpen(false)}>{t("common.cancel")}</button>
                <button className="btn btn-primary" onClick={handleRollbackFromList} disabled={rollbackLoading || !rollbackSelected}>
                  {t("settings.studio.actions.rollback")}
                </button>
              </div>
            </div>
          </div>
        )}
        {publishModal}
        {deleteModal}
        {deleteBlockedModal}
      </div>
    );
  }

  return (
    <div className={`${isMobile ? "h-[calc(100dvh-2.5rem)] min-h-0 bg-base-100 flex flex-col overflow-hidden" : "h-full min-h-0 flex flex-col overflow-hidden"} ${debugClass}`} ref={rootRef}>
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
            <h3 className="font-bold text-lg">{t("settings.studio.apply_json_fix_title")}</h3>
            <p className="text-sm opacity-70 mt-2">{t("settings.studio.proposed_changes_summary")}</p>
            <div className="mt-2 text-xs">
              <div>{t("settings.studio.lines")}: {fixSummary?.beforeLines} → {fixSummary?.afterLines}</div>
              <div>{t("settings.studio.chars")}: {fixSummary?.beforeChars} → {fixSummary?.afterChars}</div>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setFixModalOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-primary" onClick={applyFixJson}>{t("settings.studio.actions.apply_fix")}</button>
            </div>
          </div>
        </div>
      )}

      {createModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">{t("settings.studio.create_new_module")}</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs opacity-70">{t("settings.studio.module_name")}</label>
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder={t("settings.studio.module_name_placeholder")}
                  value={newModuleName}
                  onChange={(e) => setNewModuleName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs opacity-70">{t("settings.studio.description_optional")}</label>
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full text-xs"
                  rows={3}
                  placeholder={t("settings.studio.description_placeholder")}
                  value={newModuleDescription}
                  onChange={(e) => setNewModuleDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setCreateModalOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-primary" onClick={handleCreateModule} disabled={newModuleBusy}>
                {newModuleBusy ? t("settings.studio.creating") : t("common.create")}
              </button>
            </div>
          </div>
        </div>
      )}
      {rollbackModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">{t("settings.studio.rollback_module")}</h3>
            <div className="mt-4 space-y-3">
              {rollbackLoading && <div className="text-sm opacity-60">{t("settings.studio.loading_snapshots")}</div>}
              {rollbackError && <div className="alert alert-error text-sm">{rollbackError}</div>}
              {!rollbackLoading && rollbackSnapshots.length === 0 && !rollbackError && (
                <div className="text-sm opacity-60">{t("settings.studio.no_snapshots_available")}</div>
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
                      <span className="opacity-60">{formatDateTime(snap.created_at, "")}</span>
                    </label>
                  ))}
                </div>
              )}
              {!rollbackLoading && rollbackHistory.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold mb-2">{t("settings.studio.recent_history")}</div>
                  <div className="space-y-2 text-xs">
                    {rollbackHistory.slice(0, 10).map((entry) => (
                      <div key={entry.audit_id || entry.at} className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-outline">{entry.action || t("settings.studio.change")}</span>
                        {entry.transaction_group_id && <span className="font-mono">{entry.transaction_group_id}</span>}
                        {entry.patch_id && <span className="font-mono">{entry.patch_id}</span>}
                        <span className="opacity-60">{formatLocalizedDateTime(entry.at) || "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setRollbackModalOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-primary" onClick={handleRollbackFromList} disabled={rollbackLoading || !rollbackSelected}>
                {t("settings.studio.actions.rollback")}
              </button>
            </div>
          </div>
        </div>
      )}
      <ProviderSecretModal
        open={openAiModalOpen}
        providerKey="openai"
        canManageSettings={canManageSettings}
        onClose={() => setOpenAiModalOpen(false)}
        onSaved={async () => {
          setOpenAiModalOpen(false);
          await reloadProviderStatus();
        }}
      />
      {publishModal}
      {deleteModal}
      {deleteBlockedModal}
    </div>
  );
}
