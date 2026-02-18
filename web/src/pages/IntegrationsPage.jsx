import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Wrench } from "lucide-react";
import { apiFetch } from "../api.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";

const TAB_IDS = ["connections", "integrations"];

function normalizeTabId(value) {
  const raw = String(value || "").trim().toLowerCase();
  return TAB_IDS.includes(raw) ? raw : "connections";
}

function providerFromType(type) {
  const raw = String(type || "");
  if (!raw.startsWith("integration.")) return raw || "—";
  return raw.split(".", 2)[1] || "—";
}

export default function IntegrationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(normalizeTabId(searchParams.get("tab")));

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  useEffect(() => {
    setActiveTab(normalizeTabId(searchParams.get("tab")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("tab")]);

  function goTab(id) {
    const next = normalizeTabId(id);
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      nextParams.set("tab", next);
      return nextParams;
    });
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/integrations/connections");
      setItems(res?.connections || []);
    } catch (err) {
      setItems([]);
      setError(err?.message || "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createConnection() {
    const provider = window.prompt("Provider (e.g. slack, stripe, zendesk)");
    if (!provider) return;
    const name = window.prompt("Connection name");
    if (!name) return;
    try {
      const res = await apiFetch("/integrations/connections", {
        method: "POST",
        body: { provider: provider.trim(), name: name.trim(), status: "active", config: {} },
      });
      const id = res?.connection?.id;
      if (id) navigate(`/integrations/connections/${id}`);
      else await load();
    } catch (err) {
      setError(err?.message || "Failed to create connection");
    }
  }

  const rows = useMemo(
    () => (items || []).map((c) => ({
      id: c.id,
      name: c.name || c.id,
      provider: providerFromType(c.type),
      status: c.status || "active",
      updated_at: c.updated_at || c.created_at || "",
      type: c.type || "",
    })),
    [items],
  );

  const listFieldIndex = useMemo(
    () => ({
      "conn.name": { id: "conn.name", label: "Name" },
      "conn.provider": { id: "conn.provider", label: "Provider" },
      "conn.status": { id: "conn.status", label: "Status" },
      "conn.updated_at": { id: "conn.updated_at", label: "Updated" },
      "conn.type": { id: "conn.type", label: "Type" },
    }),
    [],
  );

  const listView = useMemo(
    () => ({
      id: "system.integrations.connections.list",
      kind: "list",
      columns: [
        { field_id: "conn.name" },
        { field_id: "conn.provider" },
        { field_id: "conn.status" },
        { field_id: "conn.updated_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "conn.name": row.name,
        "conn.provider": row.provider,
        "conn.status": row.status,
        "conn.updated_at": row.updated_at,
        "conn.type": row.type,
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "active", label: "Active", domain: { op: "eq", field: "conn.status", value: "active" } },
      { id: "disabled", label: "Disabled", domain: { op: "eq", field: "conn.status", value: "disabled" } },
    ],
    [],
  );

  const activeFilter = useMemo(() => filters.find((f) => f.id === statusFilter) || null, [filters, statusFilter]);

  return (
    <TabbedPaneShell
      title={(
        <span className="inline-flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Integrations
        </span>
      )}
      subtitle="Connections and provider setup"
      tabs={[
        { id: "connections", label: "Connections" },
        { id: "integrations", label: "Integrations" },
      ]}
      activeTabId={activeTab}
      onTabChange={goTab}
      rightActions={(
        <button className="btn btn-sm btn-ghost" type="button" onClick={load} disabled={loading}>
          Refresh
        </button>
      )}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {activeTab === "integrations" ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4">
          <div className="text-sm opacity-70">
            Provider catalog and guided setup will live here.
          </div>
        </div>
      ) : (
        <div className="rounded-box border border-base-300 bg-base-100 p-4">
          <SystemListToolbar
            title="Connections"
            createTooltip="New connection"
            onCreate={createConnection}
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
            showListToggle={false}
          />

          <div className="mt-4">
            {loading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-sm opacity-60">No connections yet.</div>
            ) : (
              <ListViewRenderer
                view={listView}
                fieldIndex={listFieldIndex}
                records={listRecords}
                hideHeader
                disableHorizontalScroll
                tableClassName="w-full table-fixed min-w-0"
                searchQuery={search}
                searchFields={["conn.name", "conn.provider", "conn.type"]}
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
                  if (id) navigate(`/integrations/connections/${id}`);
                }}
              />
            )}
          </div>
        </div>
      )}
    </TabbedPaneShell>
  );
}

