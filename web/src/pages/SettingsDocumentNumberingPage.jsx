import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function SettingsDocumentNumberingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/settings/document-numbering");
      setItems(Array.isArray(response?.sequences) ? response.sequences : []);
    } catch (err) {
      setItems([]);
      setError(err?.message || t("settings.document_numbering.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function deleteSelectedSequences() {
    if (!selectedIds.length || saving) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(selectedIds.map((id) => apiFetch(`/settings/document-numbering/${encodeURIComponent(id)}`, { method: "DELETE" })));
      setSelectedIds([]);
      setShowDeleteModal(false);
      pushToast("success", selectedIds.length === 1 ? t("settings.document_numbering.deleted_one") : t("settings.document_numbering.deleted_many"));
      await load();
    } catch (err) {
      setError(err?.message || t("settings.document_numbering.delete_failed"));
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(
    () => (items || []).map((item) => ({
      id: item.id,
      name: item.name || item.code,
      code: item.code || "—",
      target_entity_id: item.target_entity_id || "—",
      assign_on: item.assign_on || "—",
      reset_policy: item.reset_policy || "—",
      assignment_count: Number(item.assignment_count || 0),
      next_value_preview: item.next_value_preview || item.preview_error || t("settings.document_numbering.preview_unavailable"),
      status: item.is_active ? "active" : "inactive",
    })),
    [items, t],
  );

  const listFieldIndex = useMemo(
    () => ({
      "seq.name": { id: "seq.name", label: t("settings.document_numbering.name") },
      "seq.code": { id: "seq.code", label: t("settings.document_numbering.code") },
      "seq.target_entity_id": { id: "seq.target_entity_id", label: t("settings.document_numbering.entity") },
      "seq.assign_on": { id: "seq.assign_on", label: t("settings.document_numbering.assign_on") },
      "seq.reset_policy": { id: "seq.reset_policy", label: t("settings.document_numbering.reset") },
      "seq.assignment_count": { id: "seq.assignment_count", label: t("settings.document_numbering.assigned"), type: "number" },
      "seq.next_value_preview": { id: "seq.next_value_preview", label: t("settings.document_numbering.preview") },
      "seq.status": { id: "seq.status", label: t("settings.document_numbering.status") },
    }),
    [t],
  );

  const listView = useMemo(
    () => ({
      id: "system.settings.document_numbering.list",
      kind: "list",
      columns: [
        { field_id: "seq.name" },
        { field_id: "seq.code" },
        { field_id: "seq.target_entity_id" },
        { field_id: "seq.assign_on" },
        { field_id: "seq.reset_policy" },
        { field_id: "seq.assignment_count" },
        { field_id: "seq.next_value_preview" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "seq.name": row.name,
        "seq.code": row.code,
        "seq.target_entity_id": row.target_entity_id,
        "seq.assign_on": row.assign_on,
        "seq.reset_policy": row.reset_policy,
        "seq.assignment_count": row.assignment_count,
        "seq.next_value_preview": row.next_value_preview,
        "seq.status": row.status,
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: t("common.all"), domain: null },
      { id: "active", label: t("common.active"), domain: { op: "eq", field: "seq.status", value: "active" } },
      { id: "inactive", label: t("common.inactive"), domain: { op: "eq", field: "seq.status", value: "inactive" } },
    ],
    [t],
  );

  const activeFilter = useMemo(() => filters.find((filter) => filter.id === statusFilter) || null, [filters, statusFilter]);

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title={t("settings.document_numbering.title")}
              createTooltip={t("settings.document_numbering.new_sequence")}
              onCreate={() => navigate("/settings/document-numbering/new")}
              searchValue={search}
              onSearchChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              filters={filters}
              onFilterChange={(id) => {
                setStatusFilter(id);
                setPage(0);
              }}
              onClearFilters={() => {
                setStatusFilter("all");
                setPage(0);
              }}
              showSavedViews={false}
              pagination={{
                page,
                pageSize: 25,
                totalItems,
                onPageChange: setPage,
              }}
              rightActions={
                selectedIds.length > 0 ? (
                  <div className="dropdown dropdown-end">
                    <button className={SOFT_BUTTON_SM} type="button" tabIndex={0} aria-label={t("settings.selection_actions")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-[200]">
                      <li className="menu-title">
                        <span>{t("settings.selection")}</span>
                      </li>
                      {selectedIds.length === 1 ? (
                        <li>
                          <button type="button" onClick={() => navigate(`/settings/document-numbering/${selectedIds[0]}`)}>
                            {t("settings.document_numbering.open_sequence")}
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button type="button" className="text-error" onClick={() => setShowDeleteModal(true)} disabled={saving}>
                          {selectedIds.length === 1 ? t("common.delete") : t("common.delete_count", { count: selectedIds.length })}
                        </button>
                      </li>
                    </ul>
                  </div>
                ) : null
              }
            />

            <div className="md:mt-4">
              {loading ? (
                <div className="text-sm opacity-70">{t("common.loading")}</div>
              ) : (
                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  disableHorizontalScroll
                  tableClassName="w-full table-fixed min-w-0"
                  searchQuery={search}
                  searchFields={["seq.name", "seq.code", "seq.target_entity_id", "seq.next_value_preview"]}
                  filters={filters}
                  activeFilter={activeFilter}
                  clientFilters={[]}
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
                    if (id) navigate(`/settings/document-numbering/${id}`);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="text-lg font-semibold">
              {selectedIds.length === 1
                ? t("settings.document_numbering.delete_title_one")
                : t("settings.document_numbering.delete_title_many", { count: selectedIds.length })}
            </h3>
            <p className="mt-2 text-sm opacity-70">
              {selectedIds.length === 1
                ? t("settings.document_numbering.delete_body_one")
                : t("settings.document_numbering.delete_body_many")}
            </p>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setShowDeleteModal(false)} disabled={saving}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn btn-error" onClick={deleteSelectedSequences} disabled={saving}>
                {saving ? t("common.deleting") : selectedIds.length === 1 ? t("common.delete") : t("common.delete_count", { count: selectedIds.length })}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label={t("common.close")}
            onClick={() => {
              if (!saving) setShowDeleteModal(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
