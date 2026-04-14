import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createOctoAiSession, deleteOctoAiSession, ensureOctoAiSandbox, listOctoAiSessions } from "../api.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { buildSavedViewDomain } from "../utils/savedViews.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

const SESSION_STATUSES = ["draft", "planning", "waiting_input", "ready_to_apply", "applied", "failed", "archived"];
function statusLabel(value, t) {
  return t(`settings.octo_ai.status.${value || "draft"}`, {}, { defaultValue: (value || "draft").replace(/_/g, " ") });
}

export default function OctoAiSessionsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [clientFilters, setClientFilters] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    summary: "",
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await listOctoAiSessions();
      setSessions(Array.isArray(res?.sessions) ? res.sessions : []);
    } catch (err) {
      setError(err?.message || t("settings.octo_ai.load_failed"));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    const title = createForm.title.trim() || t("settings.octo_ai.new_change_request");
    const summary = createForm.summary.trim();
    let createdId = "";
    setCreating(true);
    setError("");
    try {
      const res = await createOctoAiSession({
        title,
        summary: summary || undefined,
        status: "draft",
        scope_mode: "auto",
        selected_artifact_type: "none",
        release_status: "draft",
      });
      createdId = typeof res?.session?.id === "string" ? res.session.id : "";
      setShowCreateModal(false);
      setCreateForm({
        title: "",
        summary: "",
      });
      if (createdId) {
        await ensureOctoAiSandbox(createdId);
        await load();
        navigate(`/octo-ai/sandboxes/${createdId}`);
        return;
      }
      await load();
    } catch (err) {
      if (createdId) {
        await load();
        setError(err?.message || t("settings.octo_ai.workspace_prepare_failed"));
      } else {
        setError(err?.message || t("settings.octo_ai.create_failed"));
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteSelectedSessions() {
    if (!selectedIds.length || deleting) return;
    setDeleting(true);
    setError("");
    try {
      await Promise.all(selectedIds.map((id) => deleteOctoAiSession(id)));
      setSelectedIds([]);
      setShowDeleteModal(false);
      await load();
    } catch (err) {
      setError(err?.message || t("settings.octo_ai.delete_failed"));
    } finally {
      setDeleting(false);
    }
  }

  const sessionRows = useMemo(
    () =>
      sessions.map((item) => ({
        id: item.id,
        title: item.title || item.id || "",
        summary: item.summary || "",
        status: item.status || "draft",
        sandbox_name: item.sandbox_name || "",
        release_status: item.release_status || "draft",
        created_by: item.created_by || "-",
        last_activity_at: item.last_activity_at || item.created_at || "",
      })),
    [sessions],
  );

  const sessionStats = useMemo(() => {
    const counts = { active: 0, ready: 0, promoted: 0, needsFixes: 0 };
    for (const item of sessions) {
      const status = item?.status || "draft";
      if (["draft", "planning", "waiting_input", "ready_to_apply"].includes(status)) counts.active += 1;
      if (status === "ready_to_apply") counts.ready += 1;
      if (item?.release_status === "promoted") counts.promoted += 1;
      if (status === "failed") counts.needsFixes += 1;
    }
    return counts;
  }, [sessions]);

  const listFieldIndex = useMemo(
    () => ({
      "ai_session.title": { id: "ai_session.title", label: t("settings.octo_ai.change_request"), type: "string" },
      "ai_session.status": { id: "ai_session.status", label: t("common.status"), type: "enum", options: SESSION_STATUSES.map((status) => statusLabel(status, t)) },
      "ai_session.sandbox_name": { id: "ai_session.sandbox_name", label: t("settings.octo_ai.sandbox"), type: "string" },
      "ai_session.release_status": { id: "ai_session.release_status", label: t("settings.octo_ai.release"), type: "string" },
      "ai_session.created_by": { id: "ai_session.created_by", label: t("settings.octo_ai.created_by"), type: "string" },
      "ai_session.last_activity_at": { id: "ai_session.last_activity_at", label: t("settings.octo_ai.last_activity"), type: "datetime" },
    }),
    [t],
  );

  const listView = useMemo(
    () => ({
      id: "system.octo_ai.sessions.list",
      kind: "list",
      columns: [
        { field_id: "ai_session.title" },
        { field_id: "ai_session.status" },
        { field_id: "ai_session.sandbox_name" },
        { field_id: "ai_session.release_status" },
        { field_id: "ai_session.created_by" },
        { field_id: "ai_session.last_activity_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () =>
      sessionRows.map((row) => ({
        record_id: row.id,
        record: {
          "ai_session.title": row.title,
          "ai_session.status": statusLabel(row.status, t),
          "ai_session.sandbox_name": row.sandbox_name || "-",
          "ai_session.release_status": statusLabel(row.release_status, t),
          "ai_session.created_by": row.created_by,
          "ai_session.last_activity_at": row.last_activity_at,
        },
      })),
    [sessionRows, t],
  );

  const listFilters = useMemo(
    () => [
      { id: "all", label: t("common.all"), domain: null },
      ...SESSION_STATUSES.map((status) => ({
        id: status,
        label: statusLabel(status, t),
        domain: { op: "eq", field: "ai_session.status", value: statusLabel(status, t) },
      })),
    ],
    [t],
  );

  const filterableFields = useMemo(
    () => [
      { id: "ai_session.title", label: t("settings.octo_ai.change_request") },
      { id: "ai_session.status", label: t("common.status") },
      { id: "ai_session.sandbox_name", label: t("settings.octo_ai.sandbox") },
      { id: "ai_session.release_status", label: t("settings.octo_ai.release") },
      { id: "ai_session.created_by", label: t("settings.octo_ai.created_by") },
    ],
    [t],
  );

  const effectiveClientFilters = useMemo(() => {
    const next = [...clientFilters];
    if (statusFilter !== "all") {
      next.push({ field_id: "ai_session.status", label: t("common.status"), op: "eq", value: statusLabel(statusFilter, t) });
    }
    return next;
  }, [clientFilters, statusFilter, t]);
  const activeListFilter = useMemo(() => listFilters.find((flt) => flt.id === statusFilter) || null, [listFilters, statusFilter]);
  const savedViewDomain = useMemo(
    () => buildSavedViewDomain(activeListFilter, effectiveClientFilters),
    [activeListFilter, effectiveClientFilters]
  );

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error mb-4">{error}</div> : null}
            {loading ? (
              <div className="text-sm opacity-70">{t("common.loading")}</div>
            ) : (
              <div className="flex flex-col gap-4 min-w-0">
              <SystemListToolbar
                title={t("settings.octo_ai.change_requests")}
                createTooltip={t("settings.octo_ai.new_change_request")}
                onCreate={creating ? undefined : () => setShowCreateModal(true)}
                searchValue={search}
                onSearchChange={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
                filters={listFilters}
                onFilterChange={(id) => {
                  setStatusFilter(id || "all");
                  setPage(0);
                }}
                filterableFields={filterableFields}
                onAddCustomFilter={(field, value) => {
                  if (!field?.id) return;
                  setClientFilters((prev) => [...prev, { field_id: field.id, label: field.label || field.id, op: "contains", value }]);
                  setPage(0);
                }}
                onClearFilters={() => {
                  setStatusFilter("all");
                  setClientFilters([]);
                  setPage(0);
                }}
                onRefresh={load}
                pagination={{
                  page,
                  pageSize: 25,
                  totalItems,
                  onPageChange: setPage,
                }}
                savedViewsEntityId="system.octo_ai.sessions"
                savedViewDomain={savedViewDomain}
                savedViewState={{ search, filter: statusFilter, clientFilters }}
                onApplySavedViewState={(state) => {
                  setSearch(state?.search || "");
                  setStatusFilter(state?.filter || "all");
                  setClientFilters(Array.isArray(state?.clientFilters) ? state.clientFilters : []);
                  setPage(0);
                }}
                rightActions={
                  selectedIds.length > 0 ? (
                    <button className={SOFT_BUTTON_SM} onClick={() => setShowDeleteModal(true)} disabled={deleting}>
                      {t("common.delete_count", { count: selectedIds.length })}
                    </button>
                  ) : null
                }
              />

              <ListViewRenderer
                view={listView}
                fieldIndex={listFieldIndex}
                records={listRecords}
                hideHeader
                tableClassName="w-full md:table-fixed"
                searchQuery={search}
                searchFields={["ai_session.title", "ai_session.created_by", "ai_session.sandbox_name"]}
                filters={listFilters}
                activeFilter={activeListFilter}
                clientFilters={effectiveClientFilters}
                page={page}
                pageSize={25}
                onPageChange={setPage}
                onTotalItemsChange={setTotalItems}
                showPaginationControls={false}
                selectedIds={selectedIds}
                onToggleSelect={(id, checked) => {
                  if (!id) return;
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return Array.from(next);
                  });
                }}
                onToggleAll={(checked, allIds) => {
                  setSelectedIds(checked ? allIds || [] : []);
                }}
                onSelectRow={(row) => {
                  const id = row?.record_id;
                  if (id) navigate(`/octo-ai/sandboxes/${id}`);
                }}
              />
              </div>
            )}
          </div>
        </div>
      </div>

      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-semibold text-lg">{selectedIds.length > 1 ? t("settings.octo_ai.delete_title_many") : t("settings.octo_ai.delete_title_one")}</h3>
            <div className="mt-3 text-sm">
              {t("settings.octo_ai.delete_body", { count: selectedIds.length })}
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => !deleting && setShowDeleteModal(false)} disabled={deleting}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteSelectedSessions} disabled={deleting || selectedIds.length === 0}>
                {deleting ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-semibold text-lg">{t("settings.octo_ai.new_change_request")}</h3>
            <p className="mt-2 text-sm opacity-75">
              {t("settings.octo_ai.create_description")}
            </p>
            <div className="mt-4 grid gap-4">
              <label className="form-control w-full">
                <div className="label"><span className="label-text">{t("settings.octo_ai.request_title")}</span></div>
                <input
                  className="input input-bordered w-full"
                  type="text"
                  placeholder={t("settings.octo_ai.request_title_placeholder")}
                  value={createForm.title}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, title: e.target.value }))}
                />
              </label>
              <label className="form-control w-full">
                <div className="label"><span className="label-text">{t("settings.octo_ai.optional_context")}</span></div>
                <textarea
                  className="textarea textarea-bordered min-h-24"
                  placeholder={t("settings.octo_ai.optional_context_placeholder")}
                  value={createForm.summary}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, summary: e.target.value }))}
                />
              </label>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => !creating && setShowCreateModal(false)} disabled={creating}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary btn-sm" type="button" onClick={handleCreate} disabled={creating || !createForm.title.trim()}>
                {creating ? t("settings.octo_ai.opening") : t("settings.octo_ai.open_request")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
