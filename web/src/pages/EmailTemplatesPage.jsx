import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { buildSavedViewDomain } from "../utils/savedViews.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function EmailTemplatesPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilters, setClientFilters] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [selectionActionBusy, setSelectionActionBusy] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const res = await apiFetch("/email/templates");
      setItems(res.templates || []);
    } catch (err) {
      pushToast("error", err.message || t("settings.email_templates.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  async function createTemplate() {
    try {
      const payload = {
        subject: t("settings.email_templates.new_template"),
        name: t("settings.email_templates.untitled_template"),
        description: "",
        body_html: "<p>Hello</p>",
      };
      const res = await apiFetch("/email/templates", { method: "POST", body: payload });
      setItems((prev) => [res.template, ...prev]);
      if (res?.template?.id) {
        navigate(`/email/templates/${res.template.id}`);
      }
    } catch (err) {
      pushToast("error", err.message || t("settings.email_templates.create_failed"));
    }
  }

  async function updateSelectedTemplates(nextActive) {
    if (!selectedIds.length || selectionActionBusy) return;
    const actionLabel = nextActive ? "activate" : "disable";
    try {
      setSelectionActionBusy(actionLabel);
      await Promise.all(
        selectedIds.map((id) =>
          apiFetch(`/email/templates/${id}`, {
            method: "POST",
            body: { is_active: nextActive },
          })
        )
      );
      pushToast(
        "success",
        selectedIds.length === 1
          ? (nextActive ? t("settings.email_templates.activated_one") : t("settings.email_templates.disabled_one"))
          : (nextActive ? t("settings.email_templates.activated_many") : t("settings.email_templates.disabled_many"))
      );
      await load();
    } catch (err) {
      pushToast("error", err.message || (nextActive ? t("settings.email_templates.activate_failed") : t("settings.email_templates.disable_failed")));
    } finally {
      setSelectionActionBusy("");
    }
  }

  async function deleteSelectedTemplates() {
    if (!selectedIds.length || selectionActionBusy) return;
    try {
      setSelectionActionBusy("delete");
      await Promise.all(selectedIds.map((id) => apiFetch(`/email/templates/${id}`, { method: "DELETE" })));
      setSelectedIds([]);
      setShowDeleteModal(false);
      pushToast("success", selectedIds.length === 1 ? t("settings.email_templates.deleted_one") : t("settings.email_templates.deleted_many"));
      await load();
    } catch (err) {
      const detail = err?.message || t("settings.email_templates.delete_failed");
      if (err?.status === 404 || err?.status === 405) {
        pushToast("error", `${detail}. ${t("settings.email_templates.restart_api_hint")}`);
      } else {
        pushToast("error", detail);
      }
    } finally {
      setSelectionActionBusy("");
    }
  }

  const templateRows = useMemo(() => {
    return items.map((template) => ({
      id: template.id,
      name: template.name || template.id,
      description: template.description || "",
      status: template.is_active === false ? t("common.disabled") : t("common.active"),
      updated_at: template.updated_at || template.created_at || "—",
    }));
  }, [items, t]);

  const listFieldIndex = useMemo(
    () => ({
      "email.name": { id: "email.name", label: t("common.name") },
      "email.description": { id: "email.description", label: t("common.description") },
      "email.status": { id: "email.status", label: t("common.status") },
      "email.updated_at": { id: "email.updated_at", label: t("common.updated") },
    }),
    [t]
  );

  const listView = useMemo(
    () => ({
      id: "email.templates.list",
      kind: "list",
      columns: [
        { field_id: "email.name" },
        { field_id: "email.description" },
        { field_id: "email.status" },
        { field_id: "email.updated_at" },
      ],
    }),
    []
  );

  const listRecords = useMemo(() => {
    return templateRows.map((row) => ({
      record_id: row.id,
      record: {
        "email.name": row.name,
        "email.description": row.description,
        "email.status": row.status,
        "email.updated_at": row.updated_at,
      },
    }));
  }, [templateRows]);

  const listFilters = useMemo(
    () => [
      { id: "all", label: t("common.all"), domain: null },
      { id: "active", label: t("common.active"), domain: { op: "eq", field: "email.status", value: t("common.active") } },
      { id: "disabled", label: t("common.disabled"), domain: { op: "eq", field: "email.status", value: t("common.disabled") } },
    ],
    [t]
  );

  const activeListFilter = useMemo(
    () => listFilters.find((flt) => flt.id === statusFilter) || null,
    [listFilters, statusFilter]
  );
  const savedViewDomain = useMemo(
    () => buildSavedViewDomain(activeListFilter, clientFilters),
    [activeListFilter, clientFilters]
  );

  const filterableFields = useMemo(
    () => [
      { id: "email.name", label: t("common.name") },
      { id: "email.description", label: t("common.description") },
      { id: "email.status", label: t("common.status") },
      { id: "email.updated_at", label: t("common.updated") },
    ],
    [t]
  );

  useEffect(() => {
    load();
  }, []);

  const selectedTemplates = useMemo(() => {
    const selected = new Set(selectedIds);
    return items.filter((item) => selected.has(item.id));
  }, [items, selectedIds]);

  const selectedActiveCount = useMemo(
    () => selectedTemplates.filter((item) => item.is_active !== false).length,
    [selectedTemplates]
  );

  const selectedDisabledCount = useMemo(
    () => selectedTemplates.filter((item) => item.is_active === false).length,
    [selectedTemplates]
  );

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {loading ? (
              <div className="text-sm opacity-70">{t("common.loading")}</div>
            ) : (
              <div className="flex flex-col gap-4 min-w-0">
                <SystemListToolbar
                  title={t("settings.email_templates.title")}
                  createTooltip={t("settings.email_templates.new_template")}
                  onCreate={createTemplate}
                  searchValue={search}
                  onSearchChange={(v) => {
                    setSearch(v);
                    setPage(0);
                  }}
                  filters={listFilters}
                  onFilterChange={(id) => {
                    setStatusFilter(id);
                    setPage(0);
                  }}
                  filterableFields={filterableFields}
                  onAddCustomFilter={(field, value) => {
                    if (!field?.id) return;
                    setClientFilters((prev) => [
                      ...prev,
                      { field_id: field.id, label: field.label || field.id, op: "contains", value },
                    ]);
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
                  savedViewsEntityId="system.email.templates"
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
                              <button onClick={() => navigate(`/email/templates/${selectedIds[0]}`)}>
                                {t("settings.email_templates.open_template")}
                              </button>
                            </li>
                          ) : null}
                          <li>
                            <button
                              onClick={() => updateSelectedTemplates(true)}
                              disabled={!selectedDisabledCount || selectionActionBusy === "activate"}
                            >
                              {selectedIds.length === 1 ? t("settings.email_templates.activate") : t("settings.email_templates.activate_selected", { count: selectedDisabledCount ? ` (${selectedDisabledCount})` : "" })}
                            </button>
                          </li>
                          <li>
                            <button
                              onClick={() => updateSelectedTemplates(false)}
                              disabled={!selectedActiveCount || selectionActionBusy === "disable"}
                            >
                              {selectedIds.length === 1 ? t("settings.email_templates.disable") : t("settings.email_templates.disable_selected", { count: selectedActiveCount ? ` (${selectedActiveCount})` : "" })}
                            </button>
                          </li>
                          <li>
                            <button
                              className="text-error"
                              onClick={() => setShowDeleteModal(true)}
                              disabled={selectionActionBusy === "delete"}
                            >
                              {selectedIds.length === 1 ? t("common.delete") : t("settings.email_templates.delete_selected", { count: selectedIds.length })}
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
                  searchFields={["email.name", "email.description", "email.id"]}
                  filters={listFilters}
                  activeFilter={activeListFilter}
                  clientFilters={clientFilters}
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
                    const id = row?.record_id || row?.record?.["email.id"];
                    if (id) navigate(`/email/templates/${id}`);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="font-semibold text-lg">
              {selectedIds.length === 1 ? t("settings.email_templates.delete_title_one") : t("settings.email_templates.delete_title_many", { count: selectedIds.length })}
            </h3>
            <p className="mt-2 text-sm opacity-70">
              {selectedIds.length === 1 ? t("settings.email_templates.delete_body_one") : t("settings.email_templates.delete_body_many")}
            </p>
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowDeleteModal(false)}
                disabled={selectionActionBusy === "delete"}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={deleteSelectedTemplates}
                disabled={selectionActionBusy === "delete"}
              >
                {selectionActionBusy === "delete"
                  ? t("common.deleting")
                  : (selectedIds.length === 1 ? t("settings.email_templates.delete_title_one") : t("common.delete_count", { count: selectedIds.length }))}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            onClick={() => {
              if (selectionActionBusy !== "delete") setShowDeleteModal(false);
            }}
            aria-label={t("common.close")}
          />
        </div>
      ) : null}
    </div>
  );
}
