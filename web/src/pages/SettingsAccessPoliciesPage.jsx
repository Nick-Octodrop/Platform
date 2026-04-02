import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";

function ProfileModal({ draft, setDraft, saving, onCancel, onConfirm }) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">Create Access Profile</h3>
        <p className="mt-1 text-sm opacity-70">Create a reusable access bundle like Sales, Ops, Finance, or a customer-specific role.</p>

        <div className="mt-5 grid grid-cols-1 gap-4">
          <label className="form-control">
            <span className="label-text text-sm">Name</span>
            <input className="input input-bordered" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} disabled={saving} />
          </label>
          <label className="form-control">
            <span className="label-text text-sm">Key</span>
            <input className="input input-bordered" value={draft.profile_key} onChange={(e) => setDraft((prev) => ({ ...prev, profile_key: e.target.value }))} disabled={saving} />
          </label>
          <label className="form-control">
            <span className="label-text text-sm">Description</span>
            <textarea className="textarea textarea-bordered min-h-[8rem]" value={draft.description} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} disabled={saving} />
          </label>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={saving || !draft.name.trim()}>
            {saving ? "Creating..." : "Create Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsAccessPoliciesPage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createDraft, setCreateDraft] = useState({ name: "", description: "", profile_key: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/access/profiles");
      setProfiles(res?.profiles || []);
    } catch (err) {
      setProfiles([]);
      setError(err?.message || "Failed to load access profiles");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createProfile() {
    if (!createDraft.name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/access/profiles", {
        method: "POST",
        body: createDraft,
      });
      setShowCreateModal(false);
      setCreateDraft({ name: "", description: "", profile_key: "" });
      await load();
      if (response?.profile?.id) {
        navigate(`/settings/access-policies/${response.profile.id}`);
      }
    } catch (err) {
      setError(err?.message || "Failed to create access profile");
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(
    () => (profiles || []).map((profile) => ({
      id: profile.id,
      name: profile.name || profile.id,
      profile_key: profile.profile_key || "—",
      description: profile.description || "No description",
      rule_count: Number(profile.rule_count || 0),
      assignment_count: Number(profile.assignment_count || 0),
    })),
    [profiles],
  );

  const listFieldIndex = useMemo(
    () => ({
      "profile.name": { id: "profile.name", label: "Name" },
      "profile.profile_key": { id: "profile.profile_key", label: "Key" },
      "profile.description": { id: "profile.description", label: "Description" },
      "profile.rule_count": { id: "profile.rule_count", label: "Rules", type: "number" },
      "profile.assignment_count": { id: "profile.assignment_count", label: "Users", type: "number" },
    }),
    [],
  );

  const listView = useMemo(
    () => ({
      id: "system.settings.access_policies.list",
      kind: "list",
      columns: [
        { field_id: "profile.name" },
        { field_id: "profile.profile_key" },
        { field_id: "profile.description" },
        { field_id: "profile.rule_count" },
        { field_id: "profile.assignment_count" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "profile.name": row.name,
        "profile.profile_key": row.profile_key,
        "profile.description": row.description,
        "profile.rule_count": row.rule_count,
        "profile.assignment_count": row.assignment_count,
      },
    })),
    [rows],
  );

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className="bg-base-100 md:card md:rounded-[1.75rem] md:border md:border-base-300 md:shadow-sm md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
        <div className="p-4 md:card-body md:flex md:flex-col md:min-h-0 md:overflow-hidden">
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title="Access Policies"
              createTooltip="New profile"
              onCreate={() => setShowCreateModal(true)}
              searchValue={search}
              onSearchChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              filters={[]}
              onClearFilters={() => {}}
              onRefresh={load}
              showSavedViews={false}
              pagination={{
                page,
                pageSize: 25,
                totalItems,
                onPageChange: setPage,
              }}
            />

            <div className="md:mt-4">
              {loading ? (
                <div className="text-sm opacity-70">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="text-sm opacity-60">No access profiles yet.</div>
              ) : (
                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  disableHorizontalScroll
                  tableClassName="w-full table-fixed min-w-0"
                  searchQuery={search}
                  searchFields={["profile.name", "profile.profile_key", "profile.description"]}
                  filters={[]}
                  activeFilter={null}
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
                    if (id) navigate(`/settings/access-policies/${id}`);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <ProfileModal
          draft={createDraft}
          setDraft={setCreateDraft}
          saving={saving}
          onCancel={() => setShowCreateModal(false)}
          onConfirm={createProfile}
        />
      ) : null}
    </div>
  );
}
