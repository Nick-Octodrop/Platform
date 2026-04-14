import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import PaginationControls from "../components/PaginationControls.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";

export default function AutomationRunsPage() {
  const { automationId } = useParams();
  const { t, formatDateTime } = useI18n();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const totalPages = useMemo(() => Math.max(1, Math.ceil(runs.length / pageSize)), [runs.length]);

  useEffect(() => {
    setPage((prev) => Math.min(Math.max(0, prev), totalPages - 1));
  }, [totalPages]);

  const pagedRuns = useMemo(() => {
    const start = page * pageSize;
    return runs.slice(start, start + pageSize);
  }, [runs, page]);

  async function load() {
    setLoading(true);
    const res = await apiFetch(`/automations/${automationId}/runs`);
    if (res.ok) {
      setRuns(res.data?.runs || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [automationId]);

  return (
    <div className={isMobile ? "min-h-full bg-base-100 p-4 space-y-4" : "space-y-6"}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("settings.automation_runs.title")}</h1>
        <Link className="btn" to={`/automations/${automationId}`}>{t("common.back")}</Link>
      </div>

      <div className={isMobile ? "bg-base-100" : DESKTOP_PAGE_SHELL}>
        <div className={isMobile ? "" : DESKTOP_PAGE_SHELL_BODY}>
          {loading ? (
            <div className="text-sm opacity-70">{t("common.loading")}</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-end">
                <PaginationControls
                  page={page}
                  pageSize={pageSize}
                  totalItems={runs.length}
                  onPageChange={setPage}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="table w-full min-w-max">
                <thead>
                  <tr>
                    <th>{t("common.status")}</th>
                    <th>{t("common.started")}</th>
                    <th>{t("common.ended")}</th>
                    <th className="text-right">{t("settings.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="whitespace-nowrap">{run.status ? t(`common.${run.status}`, {}, { defaultValue: run.status }) : "-"}</td>
                      <td className="whitespace-nowrap opacity-70 text-sm">{formatDateTime(run.started_at, { defaultValue: "-" }) || "-"}</td>
                      <td className="whitespace-nowrap opacity-70 text-sm">{formatDateTime(run.ended_at, { defaultValue: "-" }) || "-"}</td>
                      <td className="whitespace-nowrap text-right">
                        <Link className="btn btn-sm" to={`/automation-runs/${run.id}`}>{t("common.open")}</Link>
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="opacity-60 text-sm">{t("settings.automation_runs.empty")}</td>
                    </tr>
                  )}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
