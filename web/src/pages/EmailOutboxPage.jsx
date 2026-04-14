import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function EmailOutboxPage() {
  const { pushToast } = useToast();
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [selectionActionBusy, setSelectionActionBusy] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/email/outbox");
      setItems(res?.outbox || []);
    } catch (err) {
      setError(err?.message || t("settings.email_outbox.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(
    () => (items || []).map((o) => ({
      id: o.id,
      subject: o.subject || "",
      status: o.status === "sent" ? t("common.sent") : o.status === "failed" ? t("common.failed") : t("common.queued"),
      to: Array.isArray(o.to) ? o.to.join(", ") : "",
      created_at: o.created_at || "",
      sent_at: o.sent_at || "",
      last_error: o.last_error || "",
    })),
    [items, t],
  );

  const listFieldIndex = useMemo(
    () => ({
      "outbox.subject": { id: "outbox.subject", label: t("common.subject") },
      "outbox.status": { id: "outbox.status", label: t("common.status") },
      "outbox.to": { id: "outbox.to", label: t("common.to") },
      "outbox.created_at": { id: "outbox.created_at", label: t("common.created") },
    }),
    [t],
  );

  const listView = useMemo(
    () => ({
      id: "system.email.outbox.list",
      kind: "list",
      columns: [
        { field_id: "outbox.subject" },
        { field_id: "outbox.status" },
        { field_id: "outbox.to" },
        { field_id: "outbox.created_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "outbox.subject": row.subject,
        "outbox.status": row.status,
        "outbox.to": row.to,
        "outbox.created_at": row.sent_at || row.created_at || "",
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: t("common.all"), domain: null },
      { id: "queued", label: t("common.queued"), domain: { op: "eq", field: "outbox.status", value: t("common.queued") } },
      { id: "sent", label: t("common.sent"), domain: { op: "eq", field: "outbox.status", value: t("common.sent") } },
      { id: "failed", label: t("common.failed"), domain: { op: "eq", field: "outbox.status", value: t("common.failed") } },
    ],
    [t],
  );

  const activeFilter = useMemo(
    () => filters.find((f) => f.id === statusFilter) || null,
    [filters, statusFilter],
  );

  async function deleteSelectedOutbox() {
    if (!selectedIds.length || selectionActionBusy) return;
    try {
      setSelectionActionBusy("delete");
      await Promise.all(selectedIds.map((id) => apiFetch(`/email/outbox/${id}`, { method: "DELETE" })));
      setSelectedIds([]);
      setShowDeleteModal(false);
      pushToast("success", selectedIds.length === 1 ? t("settings.email_outbox.deleted_one") : t("settings.email_outbox.deleted_many"));
      await load();
    } catch (err) {
      const detail = err?.message || t("settings.email_outbox.delete_failed");
      if (err?.status === 404 || err?.status === 405) {
        pushToast("error", `${detail}. ${t("settings.email_outbox.restart_api_hint")}`);
      } else {
        pushToast("error", detail);
      }
    } finally {
      setSelectionActionBusy("");
    }
  }

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error && <div className="alert alert-error text-sm mb-4">{error}</div>}
            {loading ? (
              <div className="text-sm opacity-70">{t("common.loading")}</div>
            ) : (
              <div className="flex flex-col gap-4 min-w-0">
                <SystemListToolbar
                  title={t("settings.email_outbox.title")}
                  searchValue={search}
                  onSearchChange={(v) => {
                    setSearch(v);
                    setPage(0);
                  }}
                  filters={filters}
                  onFilterChange={(id) => {
                    setStatusFilter(id);
                    setPage(0);
                  }}
                  filterableFields={[]}
                  onClearFilters={() => {
                    setStatusFilter("all");
                    setPage(0);
                  }}
                  onRefresh={load}
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
                              <button
                                type="button"
                                onClick={() => navigate(`/settings/email-outbox/${selectedIds[0]}`)}
                              >
                                {t("settings.email_outbox.open_email")}
                              </button>
                            </li>
                          ) : null}
                          <li>
                            <button
                              type="button"
                              className="text-error"
                              onClick={() => setShowDeleteModal(true)}
                              disabled={selectionActionBusy === "delete"}
                            >
                              {selectedIds.length === 1 ? t("common.delete") : t("settings.email_outbox.delete_selected")}
                            </button>
                          </li>
                        </ul>
                      </div>
                    ) : null
                  }
                />

                {rows.length === 0 ? (
                  <div className="text-sm opacity-60">{t("settings.email_outbox.no_emails")}</div>
                ) : (
                  <ListViewRenderer
                    view={listView}
                    fieldIndex={listFieldIndex}
                    records={listRecords}
                    hideHeader
                    disableHorizontalScroll
                    tableClassName="w-full table-fixed min-w-0"
                    searchQuery={search}
                    searchFields={["outbox.subject", "outbox.to"]}
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
                      if (id) navigate(`/settings/email-outbox/${id}`);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {showDeleteModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-semibold text-lg">
              {selectedIds.length === 1 ? t("settings.email_outbox.delete_title_one") : t("settings.email_outbox.delete_title_many", { count: selectedIds.length })}
            </h3>
            <p className="py-3 text-sm opacity-70">
              {selectedIds.length === 1 ? t("settings.email_outbox.delete_body_one") : t("settings.email_outbox.delete_body_many")}
            </p>
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowDeleteModal(false)}
                disabled={selectionActionBusy === "delete"}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-error btn-sm"
                onClick={deleteSelectedOutbox}
                disabled={selectionActionBusy === "delete"}
              >
                {selectionActionBusy === "delete" ? t("common.deleting") : (selectedIds.length === 1 ? t("common.delete") : t("settings.email_outbox.delete_selected"))}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label={t("common.close")}
            onClick={() => {
              if (selectionActionBusy !== "delete") setShowDeleteModal(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
