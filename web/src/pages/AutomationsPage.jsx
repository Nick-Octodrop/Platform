import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { useNavigate } from "react-router-dom";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

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
    const text = window.prompt("Paste automation JSON");
    if (!text) return;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("Invalid JSON");
      return;
    }
    try {
      const data = await apiFetch("/automations/import", { method: "POST", body: parsed });
      navigate(`/automations/${data.automation.id}`);
    } catch (err) {
      setError(err?.message || "Import failed");
    }
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
      load();
    } catch (err) {
      setError(err?.message || "Delete failed");
    }
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

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden">
        <div className="card-body flex flex-col min-h-0">
          <div className="mt-4 flex-1 min-h-0 overflow-auto overflow-x-hidden">
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
                  rightActions={
                    <>
                      {selectedIds.length === 1 && singleSelected && (
                        <div className="flex items-center gap-2">
                          <button
                            className={SOFT_BUTTON_SM}
                            onClick={() => navigate(`/automations/${singleSelected.id}/runs`)}
                          >
                            Runs
                          </button>
                          {singleSelected.status !== "published" && (
                            <button
                              className={SOFT_BUTTON_SM}
                              onClick={() => publish(singleSelected.id)}
                            >
                              Publish
                            </button>
                          )}
                          {singleSelected.status === "published" && (
                            <button
                              className={SOFT_BUTTON_SM}
                              onClick={() => disable(singleSelected.id)}
                            >
                              Disable
                            </button>
                          )}
                          <button
                            className={SOFT_BUTTON_SM}
                            onClick={() => removeAutomation(singleSelected.id)}
                          >
                            Delete (1)
                          </button>
                        </div>
                      )}
                      {selectedIds.length > 1 && (
                        <div className="flex items-center gap-2">
                          <button
                            className={SOFT_BUTTON_SM}
                            onClick={() => {
                              const ok = window.confirm(`Delete ${selectedIds.length} automation(s)?`);
                              if (!ok) return;
                              Promise.all(selectedIds.map((id) => apiFetch(`/automations/${id}`, { method: "DELETE" })))
                                .then(() => {
                                  setSelectedIds([]);
                                  load();
                                })
                                .catch((err) => setError(err?.message || "Delete failed"));
                            }}
                          >
                            Delete ({selectedIds.length})
                          </button>
                        </div>
                      )}
                      <button className={SOFT_BUTTON_SM} onClick={importAutomation}>Import</button>
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
    </div>
  );
}
