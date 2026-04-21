import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api.js";
import AppSelect from "../../components/AppSelect.jsx";
import { useI18n } from "../../i18n/LocalizationProvider.jsx";

function looksLikeUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function resolveRecordLabel(record, recordId, selectedEntity) {
  const labelField = selectedEntity?.display_field;
  const fieldCandidates = [
    labelField,
    record?.display_name,
    record?.full_name,
    record?.name,
    record?.title,
    record?.label,
    record?.number,
    record?.code,
    record?.reference,
    record?.["workorder.number"],
  ];
  for (const candidate of fieldCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const value = labelField && candidate === labelField ? record?.[candidate] : candidate;
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }
  const ignoredKeys = new Set([
    "id",
    "record_id",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "_meta",
  ]);
  for (const [key, value] of Object.entries(record || {})) {
    if (ignoredKeys.has(key)) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || looksLikeUuid(trimmed)) continue;
    if (trimmed === recordId) continue;
    return trimmed;
  }
  return recordId;
}

export default function SamplePicker({
  sample,
  setSample,
  entities = [],
  showEntitySelect = true,
  entityIdOverride = "",
  rightAction = null,
  size = "md", // md | sm
}) {
  const { t } = useI18n();
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [opened, setOpened] = useState(false);
  const entityId = typeof entityIdOverride === "string" && entityIdOverride
    ? entityIdOverride
    : (sample?.entity_id || "");

  const selectedEntity = useMemo(() => {
    return entities.find((ent) => ent.id === entityId);
  }, [entities, entityId]);

  useEffect(() => {
    let mounted = true;
    async function run() {
      if (!entityId || !opened) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await apiFetch(`/lookup/${entityId}/options`, {
          method: "POST",
          body: { q: searchText.trim() || null, limit: 20 },
        });
        if (!mounted) return;
        setResults(res?.records || []);
      } catch {
        if (mounted) setResults([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, [entityId, searchText, opened]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedLabel() {
      if (!entityId || !sample?.record_id) {
        if (!cancelled) {
          setSelectedLabel("");
          setSearchText("");
        }
        return;
      }
      try {
        const res = await apiFetch(`/records/${encodeURIComponent(entityId)}/${encodeURIComponent(sample.record_id)}`);
        const rec = res?.record || {};
        const label = resolveRecordLabel(rec, sample.record_id, selectedEntity);
        if (!cancelled) setSelectedLabel(String(label || sample.record_id));
      } catch {
        if (!cancelled) setSelectedLabel(String(sample.record_id));
      }
    }
    loadSelectedLabel();
    return () => {
      cancelled = true;
    };
  }, [entityId, sample?.record_id, selectedEntity?.display_field]);

  useEffect(() => {
    function onDocClick(event) {
      const el = event.target;
      if (!(el instanceof Element)) return;
      if (el.closest("[data-sample-picker-root]")) return;
      setOpened(false);
      if (!searchText.trim()) {
        setSearchText(selectedLabel || "");
      }
    }
    if (!opened) return undefined;
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [opened, searchText, selectedLabel]);

  function selectRecord(record) {
    if (!record) return;
    const recordId = record.id || record.record_id;
    if (!recordId) return;
    setSample((prev) => ({ ...(prev || {}), entity_id: entityId, record_id: recordId }));
    const label = resolveRecordLabel(record, recordId, selectedEntity);
    setSelectedLabel(label || recordId);
    setSearchText(label || recordId);
    setOpened(false);
  }

  const layoutClass = showEntitySelect
    ? (rightAction ? "md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]" : "md:grid-cols-3")
    : (rightAction ? "lg:grid-cols-[1fr_auto]" : "");

  return (
    <div className="space-y-3" data-sample-picker-root>
      <div className={`grid grid-cols-1 gap-3 items-end ${layoutClass}`}>
        {showEntitySelect && (
          <label className="form-control">
            <span className="label-text">{t("common.entity")}</span>
            <AppSelect
              className={`select select-bordered ${size === "sm" ? "select-sm" : ""}`}
              value={entityId}
              onChange={(e) => setSample((prev) => ({ ...(prev || {}), entity_id: e.target.value, record_id: "" }))}
            >
              <option value="">{t("settings.template_studio.select_entity")}</option>
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.label || ent.id}
                </option>
              ))}
            </AppSelect>
          </label>
        )}
        <label className={`form-control ${showEntitySelect && !rightAction ? "md:col-span-2" : ""}`}>
          <span className="label-text">{t("settings.template_studio.record_search")}</span>
          <div className="relative">
            <input
              className={`input input-bordered w-full pr-10 ${size === "sm" ? "input-sm" : ""}`}
              placeholder={t("settings.template_studio.search_record")}
              value={opened ? searchText : (searchText || selectedLabel || "")}
              onChange={(e) => setSearchText(e.target.value)}
              disabled={!entityId}
              onFocus={() => {
                setOpened(true);
                setSearchText("");
              }}
            />
            {Boolean(sample?.record_id) && (
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle absolute right-2 top-1/2 z-10 h-7 min-h-7 w-7 min-w-7 -translate-y-1/2 bg-transparent p-0 text-base-content/75 hover:bg-transparent hover:text-base-content"
                onClick={() => {
                  setSearchText("");
                  setSelectedLabel("");
                  setSample((prev) => ({ ...(prev || {}), entity_id: entityId, record_id: "" }));
                }}
                aria-label={t("settings.template_studio.clear_selection")}
                title={t("common.clear")}
              >
                <span className="text-sm font-medium leading-none">×</span>
              </button>
            )}
            {opened && (
              <div className="absolute z-[120] mt-1 w-full rounded-box border border-base-400 bg-base-100 shadow">
                <ul className="menu menu-compact max-h-64 overflow-auto">
                  {loading && <li className="menu-title"><span>{t("settings.template_studio.searching")}</span></li>}
                  {!loading && results.length === 0 && (
                    <li className="menu-title"><span>{searchText.trim() ? t("empty.no_results") : t("empty.no_records_found")}</span></li>
                  )}
                  {results.map((item) => {
                    const record = item.record || {};
                    const label = resolveRecordLabel(record, item.record_id, selectedEntity);
                    return (
                      <li key={item.record_id}>
                        <button
                          type="button"
                          className={item.record_id === sample?.record_id ? "active" : ""}
                          onClick={() => selectRecord({ ...record, record_id: item.record_id })}
                        >
                          {label || item.record_id}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </label>
        {rightAction ? <div className="flex items-end">{rightAction}</div> : null}
      </div>
    </div>
  );
}
