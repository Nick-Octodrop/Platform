import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { apiFetch } from "../api";
import { useNavigate } from "react-router-dom";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import CodeTextarea from "../components/CodeTextarea.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { buildSavedViewDomain } from "../utils/savedViews.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";

const DEFAULT_TRIGGER = {
  kind: "event",
  event_types: ["record.created"],
  filters: [],
};

const DEFAULT_STEPS = [
  { id: "step_notify", kind: "action", action_id: "system.notify", inputs: { recipient_user_ids: [], title: "Automation", body: "" } },
];

export default function AutomationsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [clientFilters, setClientFilters] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [selectionActionBusy, setSelectionActionBusy] = useState("");
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/automations");
      setItems(data?.automations || []);
    } catch (err) {
      setError(err?.message || "Failed to load automations");
    }
    setLoading(false);
  }

  async function createAutomation() {
    try {
      const data = await apiFetch("/automations", {
        method: "POST",
        body: { name: "New Automation", description: "", status: "draft", trigger: DEFAULT_TRIGGER, steps: DEFAULT_STEPS },
      });
      navigate(`/automations/${data.automation.id}`);
    } catch (err) {
      setError(err?.message || "Failed to create automation");
    }
  }

  async function importAutomation() {
    const text = importJsonText.trim();
    if (!text) {
      setImportError("Paste automation JSON to import.");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      setImportError("Invalid JSON");
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      const data = await apiFetch("/automations/import", { method: "POST", body: parsed });
      setImportModalOpen(false);
      setImportJsonText("");
      setImportError("");
      navigate(`/automations/${data.automation.id}`);
    } catch (err) {
      setImportError(err?.message || "Import failed");
    }
    setImporting(false);
  }

  async function publish(id) {
    try {
      await apiFetch(`/automations/${id}/publish`, { method: "POST" });
      load();
    } catch (err) {
      setError(err?.message || "Publish failed");
    }
  }

  async function disable(id) {
    try {
      await apiFetch(`/automations/${id}/disable`, { method: "POST" });
      load();
    } catch (err) {
      setError(err?.message || "Disable failed");
    }
  }

  async function removeAutomation(id) {
    const ok = window.confirm("Delete this automation? This cannot be undone.");
    if (!ok) return;
    try {
      await apiFetch(`/automations/${id}`, { method: "DELETE" });
      setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
      load();
    } catch (err) {
      setError(err?.message || "Delete failed");
    }
  }

  async function disableSelectedAutomations() {
    const publishedIds = selectedRows.filter((row) => row.status === "published").map((row) => row.id);
    if (!publishedIds.length || selectionActionBusy) return;
    setSelectionActionBusy("disable");
    setError("");
    try {
      await Promise.all(publishedIds.map((id) => apiFetch(`/automations/${id}/disable`, { method: "POST" })));
      setSelectedIds([]);
      await load();
    } catch (err) {
      setError(err?.message || "Disable failed");
    }
    setSelectionActionBusy("");
  }

  async function deleteSelectedAutomations() {
    if (!selectedIds.length || selectionActionBusy) return;
    const ok = window.confirm(`Delete ${selectedIds.length} automation(s)? This cannot be undone.`);
    if (!ok) return;
    setSelectionActionBusy("delete");
    setError("");
    try {
      await Promise.all(selectedIds.map((id) => apiFetch(`/automations/${id}`, { method: "DELETE" })));
      setSelectedIds([]);
      await load();
    } catch (err) {
      setError(err?.message || "Delete failed");
    }
    setSelectionActionBusy("");
  }

  const automationRows = useMemo(
    () => items.map((item) => ({
      id: item.id,
      name: item.name || "",
      status: item.status || "draft",
      updated_at: item.updated_at || "—",
      description: item.description || "",
    })),
    [items]
  );

  const listFieldIndex = useMemo(
    () => ({
      "automation.name": { id: "automation.name", label: "Name" },
      "automation.status": { id: "automation.status", label: "Status" },
      "automation.updated_at": { id: "automation.updated_at", label: "Updated" },
      "automation.description": { id: "automation.description", label: "Description" },
    }),
    []
  );

  const listView = useMemo(
    () => ({
      id: "system.automations.list",
      kind: "list",
      columns: [
        { field_id: "automation.name" },
        { field_id: "automation.description" },
        { field_id: "automation.status" },
        { field_id: "automation.updated_at" },
      ],
    }),
    []
  );

  const listRecords = useMemo(() => automationRows.map((row) => ({
    record_id: row.id,
    record: {
      "automation.name": row.name,
      "automation.status": row.status,
      "automation.updated_at": row.updated_at,
      "automation.description": row.description,
    },
  })), [automationRows]);

  const listFilters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "draft", label: "Draft", domain: { op: "eq", field: "automation.status", value: "draft" } },
      { id: "published", label: "Published", domain: { op: "eq", field: "automation.status", value: "published" } },
      { id: "disabled", label: "Disabled", domain: { op: "eq", field: "automation.status", value: "disabled" } },
    ],
    []
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
      { id: "automation.name", label: "Name" },
      { id: "automation.status", label: "Status" },
      { id: "automation.updated_at", label: "Updated" },
    ],
    []
  );

  const selectedRows = useMemo(() => {
    const map = new Map(automationRows.map((row) => [row.id, row]));
    return selectedIds.map((id) => map.get(id)).filter(Boolean);
  }, [automationRows, selectedIds]);

  const singleSelected = selectedRows.length === 1 ? selectedRows[0] : null;
  const selectedPublishedCount = useMemo(
    () => selectedRows.filter((row) => row.status === "published").length,
    [selectedRows]
  );

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error && <div className="alert alert-error">{error}</div>}
            {loading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : (
              <div className="flex flex-col gap-4 min-w-0">
                <SystemListToolbar
                  title="Automation"
                  createTooltip="New Automation"
                  onCreate={createAutomation}
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
                  savedViewsEntityId="system.automations"
                  savedViewDomain={savedViewDomain}
                  savedViewState={{ search, filter: statusFilter, clientFilters }}
                  onApplySavedViewState={(state) => {
                    setSearch(state?.search || "");
                    setStatusFilter(state?.filter || "all");
                    setClientFilters(Array.isArray(state?.clientFilters) ? state.clientFilters : []);
                    setPage(0);
                  }}
                  rightActions={
                    <>
                      {selectedIds.length > 0 && (
                        <div className="dropdown dropdown-end">
                          <button className={SOFT_BUTTON_SM} type="button" tabIndex={0} aria-label="Selection actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-[200]">
                            <li className="menu-title">
                              <span>Selection</span>
                            </li>
                            {selectedIds.length === 1 && singleSelected && (
                              <>
                                <li>
                                  <button onClick={() => navigate(`/automations/${singleSelected.id}`)}>
                                    Open automation
                                  </button>
                                </li>
                                <li>
                                  <button onClick={() => navigate(`/automations/${singleSelected.id}/runs`)}>
                                    View runs
                                  </button>
                                </li>
                                {singleSelected.status !== "published" && (
                                  <li>
                                    <button onClick={() => publish(singleSelected.id)}>
                                      Publish
                                    </button>
                                  </li>
                                )}
                              </>
                            )}
                            <li>
                              <button
                                onClick={disableSelectedAutomations}
                                disabled={!selectedPublishedCount || selectionActionBusy === "disable"}
                              >
                                {selectedIds.length === 1 ? "Disable" : `Disable selected${selectedPublishedCount ? ` (${selectedPublishedCount})` : ""}`}
                              </button>
                            </li>
                            <li>
                              <button
                                className="text-error"
                                onClick={selectedIds.length === 1 && singleSelected
                                  ? () => removeAutomation(singleSelected.id)
                                  : deleteSelectedAutomations}
                                disabled={selectionActionBusy === "delete"}
                              >
                                {selectedIds.length === 1 ? "Delete" : `Delete selected (${selectedIds.length})`}
                              </button>
                            </li>
                          </ul>
                        </div>
                      )}
                      <button
                        className={SOFT_BUTTON_SM}
                        onClick={() => {
                          setImportModalOpen(true);
                          setImportError("");
                        }}
                      >
                        Import
                      </button>
                    </>
                  }
                />

                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  searchQuery={search}
                  searchFields={["automation.name", "automation.description"]}
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
                    const id = row?.record_id || row?.record?.["automation.id"];
                    if (id) navigate(`/automations/${id}`);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {importModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-3xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Import automation</h3>
                <p className="mt-1 text-sm opacity-70">Paste an automation JSON definition to create a new automation.</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (importing) return;
                  setImportModalOpen(false);
                  setImportError("");
                }}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-4">
              {importError ? <div className="alert alert-error text-sm">{importError}</div> : null}
              <label className="form-control">
                <span className="label-text">Automation JSON</span>
                <CodeTextarea
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  minHeight="360px"
                  placeholder={`{\n  "name": "Imported automation",\n  "description": "",\n  "trigger": {\n    "kind": "event",\n    "event_types": ["record.created"],\n    "filters": []\n  },\n  "steps": []\n}`}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    if (importing) return;
                    setImportModalOpen(false);
                    setImportError("");
                  }}
                  disabled={importing}
                >
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={importAutomation} disabled={importing}>
                  {importing ? "Importing..." : "Import"}
                </button>
              </div>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => {
              if (importing) return;
              setImportModalOpen(false);
              setImportError("");
            }}
          />
        </div>
      )}
    </div>
  );
}
