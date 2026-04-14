import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import AppSelect from "../components/AppSelect.jsx";
import { useModuleStore } from "../state/moduleStore.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import PaginationControls from "../components/PaginationControls.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { formatDateTime } from "../utils/dateTime.js";

const FETCH_LIMIT = 500;

export default function AuditPage() {
  const { t } = useI18n();
  const { modules } = useModuleStore();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [moduleFilter, setModuleFilter] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(FETCH_LIMIT));
        if (moduleFilter) params.set("module_id", moduleFilter);
        const res = await apiFetch(`/audit?${params.toString()}`);
        setEvents(res.data?.events || []);
        setError(null);
      } catch (err) {
        setError(err.message || t("settings.audit.load_failed"));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [moduleFilter]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(events.length / pageSize)), [events.length]);

  useEffect(() => {
    setPage((prev) => Math.min(Math.max(0, prev), totalPages - 1));
  }, [totalPages]);

  const pagedEvents = useMemo(() => {
    const start = page * pageSize;
    return events.slice(start, start + pageSize);
  }, [events, page]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("navigation.audit")}</h1>
        <div className="text-sm opacity-70">{t("settings.audit.subtitle")}</div>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <AppSelect className="select select-bordered" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
          <option value="">{t("settings.audit.all_modules")}</option>
          {modules.map((m) => (
            <option key={m.module_id} value={m.module_id}>{m.module_id}</option>
          ))}
        </AppSelect>
      </div>
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">{t("common.activity")}</h2>
          {error && <div className="alert alert-error mb-4">{error}</div>}
          {loading && <LoadingSpinner className="min-h-[16vh]" />}
          <div className="flex items-center justify-end mb-2">
            <PaginationControls
              page={page}
              pageSize={pageSize}
              totalItems={events.length}
              onPageChange={setPage}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("settings.audit.timestamp")}</th>
                  <th>{t("common.type")}</th>
                  <th>{t("settings.audit.target")}</th>
                  <th>{t("common.action")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("settings.audit.detail")}</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="opacity-70">{t("settings.audit.empty")}</td>
                  </tr>
                )}
                {pagedEvents.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.ts) || "—"}</td>
                    <td>{e.type || "—"}</td>
                    <td>{e.module_id || "—"}</td>
                    <td>{(e.detail?.action || "").toString() || "—"}</td>
                    <td>{e.status ? t(`common.${e.status}`, {}, { defaultValue: e.status }) : "—"}</td>
                    <td><span className="text-xs opacity-70">{JSON.stringify(e.detail || {})}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-sm opacity-70 mt-2">{t("settings.audit.footer")}</div>
        </div>
      </div>
    </div>
  );
}
