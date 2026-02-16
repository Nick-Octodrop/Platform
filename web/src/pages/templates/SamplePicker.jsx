import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api.js";
import { SOFT_BUTTON_XS } from "../../components/buttonStyles.js";

export default function SamplePicker({
  sample,
  setSample,
  entities = [],
  showEntitySelect = true,
  rightAction = null,
}) {
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [opened, setOpened] = useState(false);
  const entityId = sample?.entity_id || "";

  const selectedEntity = useMemo(() => {
    return entities.find((ent) => ent.id === entityId);
  }, [entities, entityId]);

  const recentsKey = useMemo(() => {
    return entityId ? `template-sample-recent:${entityId}` : null;
  }, [entityId]);

  const recents = useMemo(() => {
    if (!recentsKey) return [];
    try {
      const raw = localStorage.getItem(recentsKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [recentsKey]);

  useEffect(() => {
    let mounted = true;
    async function run() {
      if (!entityId || searchText.trim().length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await apiFetch(`/lookup/${entityId}/options`, {
          method: "POST",
          body: { q: searchText.trim(), limit: 20 },
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
  }, [entityId, searchText]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedLabel() {
      if (!entityId || !sample?.record_id) return;
      try {
        const res = await apiFetch(`/records/${encodeURIComponent(entityId)}/${encodeURIComponent(sample.record_id)}`);
        const rec = res?.record || {};
        const labelField = selectedEntity?.display_field;
        const label =
          (labelField && rec?.[labelField]) ||
          rec?.display_name ||
          rec?.full_name ||
          rec?.name ||
          rec?.["workorder.number"] ||
          sample.record_id;
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

  function updateRecents(record) {
    if (!recentsKey || !record) return;
    const labelField = selectedEntity?.display_field;
    const label = labelField
      ? record[labelField]
      : record.id || record.name || record.record_id;
    const next = [
      { record_id: record.id || record.record_id, label: label || "Record" },
      ...recents.filter((r) => r.record_id !== (record.id || record.record_id)),
    ].slice(0, 10);
    localStorage.setItem(recentsKey, JSON.stringify(next));
  }

  function selectRecord(record) {
    if (!record) return;
    const recordId = record.id || record.record_id;
    if (!recordId) return;
    setSample((prev) => ({ ...(prev || {}), entity_id: entityId, record_id: recordId }));
    const labelField = selectedEntity?.display_field;
    const label =
      (labelField && record[labelField]) ||
      record.display_name ||
      record.full_name ||
      record.name ||
      record["workorder.number"] ||
      recordId;
    setSelectedLabel(label || recordId);
    setSearchText(label || recordId);
    setOpened(false);
    updateRecents(record);
  }

  return (
    <div className="space-y-3" data-sample-picker-root>
      <div className={`grid grid-cols-1 gap-3 items-end ${showEntitySelect ? "md:grid-cols-3" : "lg:grid-cols-[1fr_auto]"}`}>
        {showEntitySelect && (
          <label className="form-control">
            <span className="label-text">Entity</span>
            <select
              className="select select-bordered"
              value={entityId}
              onChange={(e) => setSample((prev) => ({ ...(prev || {}), entity_id: e.target.value, record_id: "" }))}
            >
              <option value="">Select entity</option>
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.label || ent.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={`form-control ${showEntitySelect ? "md:col-span-2" : ""}`}>
          <span className="label-text">Record search</span>
          <div className="relative">
            <input
              className="input input-bordered w-full pr-10"
              placeholder="Search record..."
              value={opened ? searchText : (searchText || selectedLabel || "")}
              onChange={(e) => setSearchText(e.target.value)}
              disabled={!entityId}
              onFocus={() => setOpened(true)}
            />
            {Boolean(sample?.record_id) && (
              <button
                type="button"
                className={`${SOFT_BUTTON_XS} absolute right-2 top-1/2 -translate-y-1/2`}
                onClick={() => {
                  setSearchText("");
                  setSelectedLabel("");
                  setSample((prev) => ({ ...(prev || {}), entity_id: entityId, record_id: "" }));
                }}
                aria-label="Clear selection"
                title="Clear"
              >
                x
              </button>
            )}
            {opened && (
              <div className="absolute z-[120] mt-1 w-full rounded-box border border-base-400 bg-base-100 shadow">
                <ul className="menu menu-compact max-h-64 overflow-auto">
                  {loading && <li className="menu-title"><span>Searching...</span></li>}
                  {!loading && searchText.trim().length < 2 && (
                    <li className="menu-title"><span>Type at least 2 characters...</span></li>
                  )}
                  {!loading && searchText.trim().length >= 2 && results.length === 0 && (
                    <li className="menu-title"><span>No results</span></li>
                  )}
                  {results.map((item) => {
                    const record = item.record || {};
                    const labelField = selectedEntity?.display_field;
                    const label =
                      (labelField && record[labelField]) ||
                      record.display_name ||
                      record.full_name ||
                      record.name ||
                      record["workorder.number"] ||
                      item.record_id;
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
        {!showEntitySelect && rightAction}
      </div>
    </div>
  );
}
