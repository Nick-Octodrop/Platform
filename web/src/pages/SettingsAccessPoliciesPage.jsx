import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

function ProfileModal({ t, draft, setDraft, saving, onCancel, onConfirm }) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">{t("settings.access_policies.create_title")}</h3>
        <p className="mt-1 text-sm opacity-70">{t("settings.access_policies.create_description")}</p>

        <div className="mt-5 grid grid-cols-1 gap-4">
          <label className="form-control">
            <span className="label-text text-sm">{t("settings.access_policies.name")}</span>
            <input className="input input-bordered" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} disabled={saving} />
            <span className="label label-text-alt opacity-50">{t("settings.access_policies.name_help")}</span>
          </label>
          <label className="form-control">
            <span className="label-text text-sm">{t("settings.access_policies.key")}</span>
            <input className="input input-bordered" value={draft.profile_key} onChange={(e) => setDraft((prev) => ({ ...prev, profile_key: e.target.value }))} disabled={saving} />
            <span className="label label-text-alt opacity-50">{t("settings.access_policies.key_help")}</span>
          </label>
          <label className="form-control">
            <span className="label-text text-sm">{t("settings.access_policies.description")}</span>
            <textarea className="textarea textarea-bordered min-h-[8rem]" value={draft.description} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} disabled={saving} />
            <span className="label label-text-alt opacity-50">{t("settings.access_policies.description_help")}</span>
          </label>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={saving || !draft.name.trim()}>
            {saving ? t("settings.access_policies.creating") : t("settings.access_policies.create_profile")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsAccessPoliciesPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [createDraft, setCreateDraft] = useState({ name: "", description: "", profile_key: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/access/profiles");
      setProfiles(res?.profiles || []);
    } catch (err) {
      setProfiles([]);
      setError(err?.message || t("settings.access_policies.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function deleteSelectedProfiles() {
    if (!selectedIds.length || saving) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(selectedIds.map((id) => apiFetch(`/access/profiles/${id}`, { method: "DELETE" })));
      setSelectedIds([]);
      setShowDeleteModal(false);
      pushToast("success", selectedIds.length === 1 ? t("settings.access_policies.deleted_one") : t("settings.access_policies.deleted_many"));
      await load();
    } catch (err) {
      setError(err?.message || t("settings.access_policies.delete_failed"));
    } finally {
      setSaving(false);
    }
  }

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
      pushToast("success", t("settings.access_policies.created"));
      await load();
      if (response?.profile?.id) {
        navigate(`/settings/access-policies/${response.profile.id}`);
      }
    } catch (err) {
      setError(err?.message || t("settings.access_policies.create_failed"));
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(
    () => (profiles || []).map((profile) => ({
      id: profile.id,
      name: profile.name || profile.id,
      profile_key: profile.profile_key || "—",
      description: profile.description || t("settings.access_policies.no_description"),
      rule_count: Number(profile.rule_count || 0),
      assignment_count: Number(profile.assignment_count || 0),
    })),
    [profiles, t],
  );

  const listFieldIndex = useMemo(
    () => ({
      "profile.name": { id: "profile.name", label: t("settings.access_policies.name") },
      "profile.profile_key": { id: "profile.profile_key", label: t("settings.access_policies.key") },
      "profile.description": { id: "profile.description", label: t("settings.access_policies.description") },
      "profile.rule_count": { id: "profile.rule_count", label: t("settings.access_policies.rules"), type: "number" },
      "profile.assignment_count": { id: "profile.assignment_count", label: t("settings.access_policies.users"), type: "number" },
    }),
    [t],
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
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title={t("settings.access_policies.title")}
              createTooltip={t("settings.access_policies.new_profile")}
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
                          <button onClick={() => navigate(`/settings/access-policies/${selectedIds[0]}`)}>
                            {t("settings.access_policies.open_profile")}
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button className="text-error" onClick={() => setShowDeleteModal(true)} disabled={saving}>
                          {selectedIds.length === 1 ? t("common.delete") : t("settings.access_policies.delete_selected", { count: selectedIds.length })}
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
                  searchFields={["profile.name", "profile.profile_key", "profile.description"]}
                  filters={[]}
                  activeFilter={null}
                  clientFilters={[]}
                  page={page}
                  pageSize={25}
                  onPageChange={setPage}
                  onTotalItemsChange={setTotalItems}
                  showPaginationControls={false}
                  emptyLabel={null}
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
          t={t}
          draft={createDraft}
          setDraft={setCreateDraft}
          saving={saving}
          onCancel={() => setShowCreateModal(false)}
          onConfirm={createProfile}
        />
      ) : null}

      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-semibold text-lg">
              {selectedIds.length > 1 ? t("settings.access_policies.delete_title_many") : t("settings.access_policies.delete_title_one")}
            </h3>
            <div className="mt-3 text-sm">
              {t("settings.access_policies.delete_body", { count: selectedIds.length })}
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => !saving && setShowDeleteModal(false)}
                disabled={saving}
              >
                {t("common.cancel")}
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteSelectedProfiles} disabled={saving}>
                {saving ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => !saving && setShowDeleteModal(false)}>
            close
          </button>
        </div>
      ) : null}
    </div>
  );
}
