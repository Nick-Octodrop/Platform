import React, { useMemo, useState, useEffect, useRef } from "react";
import { renderField, setFieldValue, getFieldValue } from "./field_renderers.jsx";
import { apiFetch } from "../api.js";
import { evalCondition } from "../utils/conditions.js";
import Tabs from "../components/Tabs.jsx";
import { PRIMARY_BUTTON_SM, SOFT_BUTTON_SM, SOFT_BUTTON_XS } from "../components/buttonStyles.js";
import DaisyTooltip from "../components/DaisyTooltip.jsx";
import ActivityPanel from "./ActivityPanel.jsx";
import AttachmentField from "./AttachmentField.jsx";

export default function FormViewRenderer({
  view,
  fieldIndex,
  record,
  entityLabel,
  displayField,
  autoSaveState = "idle",
  hasRecord = false,
  entityId = null,
  recordId = null,
  onChange,
  onSave,
  onDiscard,
  readonly,
  showValidation = true,
  applyDefaults = false,
  requiredFields = [],
  hiddenFields = [],
  header,
  primaryActions = [],
  secondaryActions = [],
  onActionClick,
  isDirty = false,
  hideHeader = false,
  previewMode = false,
  canCreateLookup,
  onLookupCreate,
}) {
  if (!view) return <div className="alert">Missing form view</div>;
  const sections = view.sections || [];
  const viewLineEditors = useMemo(() => {
    const raw = view?.line_editors ?? view?.lineEditors;
    return raw && typeof raw === "object" ? raw : {};
  }, [view]);
  const demoLineItemsConfig = useMemo(
    () => ({
      entity_id: "entity.workorder_line",
      parent_field: "workorder_line.workorder_id",
      item_lookup_field: "workorder_line.item_id",
      item_lookup_entity: "entity.item",
      item_lookup_display_field: "item.name",
      description_field: "workorder_line.description",
      defaults: {
        "workorder_line.qty": 1,
        "workorder_line.unit_price": 0,
        "workorder_line.tax_rate": 0,
        "workorder_line.discount_pct": 0,
      },
      columns: [
        { field_id: "workorder_line.item_id", label: "Item", readonly: true },
        { field_id: "workorder_line.description", label: "Description" },
        { field_id: "workorder_line.qty", label: "Qty", type: "number" },
        { field_id: "workorder_line.unit_price", label: "Unit Price", type: "number" },
        { field_id: "workorder_line.discount_pct", label: "Discount %", type: "number" },
        { field_id: "workorder_line.tax_rate", label: "Tax %", type: "number" },
        { field_id: "workorder_line.line_total", label: "Line Total", type: "number" },
      ],
    }),
    []
  );
  const sectionFieldIds = useMemo(
    () => sections.flatMap((s) => (Array.isArray(s?.fields) ? s.fields : [])),
    [sections]
  );
  const isWorkorderForm = useMemo(() => {
    const eid = String(entityId || "");
    if (eid === "entity.workorder" || eid === "workorder" || eid.endsWith(".workorder")) {
      return true;
    }
    return sections.some((section) =>
      Array.isArray(section?.fields) && section.fields.some((fieldId) => typeof fieldId === "string" && fieldId.startsWith("workorder."))
    );
  }, [entityId, sections]);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const tabsConfig = header?.tabs || null;
  const activityConfig = view?.activity && view.activity.enabled === true ? view.activity : null;
  const activityTabId = "__activity";
  const detailsTabId = "__details";
  const activityTabLabel = (typeof activityConfig?.tab_label === "string" && activityConfig.tab_label.trim()) || "Activity";
  const tabsForUi = useMemo(() => {
    const baseTabs = Array.isArray(tabsConfig?.tabs) ? tabsConfig.tabs : [];
    if (!activityConfig || activityConfig.mode === "panel") {
      return baseTabs;
    }
    if (baseTabs.length > 0) {
      if (baseTabs.some((tab) => tab?.id === activityTabId)) return baseTabs;
      return [...baseTabs, { id: activityTabId, label: activityTabLabel }];
    }
    return [
      { id: detailsTabId, label: "Details" },
      { id: activityTabId, label: activityTabLabel },
    ];
  }, [tabsConfig?.tabs, activityConfig, activityTabLabel]);
  const hasTabs = tabsForUi.length > 0;
  const [activeTab, setActiveTab] = useState(() => tabsConfig?.default_tab || tabsForUi[0]?.id || null);
  const [sectionTabs, setSectionTabs] = useState({});

  const missing = sectionFieldIds.find((fieldId) => !fieldIndex[fieldId]);
  if (missing) {
    return <div className="alert alert-error">Missing field in manifest: {missing}</div>;
  }

  useEffect(() => {
    const nextDefault = tabsConfig?.default_tab || tabsForUi[0]?.id || null;
    setActiveTab((current) => {
      if (current && tabsForUi.some((tab) => tab?.id === current)) return current;
      return nextDefault;
    });
  }, [tabsConfig?.default_tab, tabsForUi]);

  const hiddenSet = useMemo(() => {
    const set = new Set(Array.isArray(hiddenFields) ? hiddenFields : []);
    const statusFieldId = header?.statusbar?.field_id;
    if (statusFieldId) set.add(statusFieldId);
    return set;
  }, [hiddenFields, header?.statusbar]);

  const validationErrors = useMemo(() => {
    const errors = {};
    const requiredByStatus = new Set(Array.isArray(requiredFields) ? requiredFields : []);
    for (const fieldId of sectionFieldIds) {
      if (hiddenSet.has(fieldId)) continue;
      const field = fieldIndex[fieldId];
      if (field?.type === "attachments") continue;
      const requiredWhen = field?.required_when;
      const requiredByCondition = requiredWhen ? evalCondition(requiredWhen, { record }) : false;
      const isRequired = field?.required || requiredByStatus.has(fieldId) || requiredByCondition;
      const visibleWhen = field?.visible_when;
      const isVisible = visibleWhen ? evalCondition(visibleWhen, { record }) : true;
      if (isRequired && !readonly) {
        const value = getFieldValue(record, fieldId);
        const hasDefault = Object.prototype.hasOwnProperty.call(field, "default");
        const isSystem = Boolean(field.system);
        if ((value === "" || value === null || value === undefined) && !hasDefault && !isSystem) {
          if (!isVisible && !requiredByCondition) {
            continue;
          }
          errors[fieldId] = "Required";
        }
      }
    }
    return errors;
  }, [record, sectionFieldIds, fieldIndex, readonly, requiredFields, hiddenSet]);

  const saveMode = header?.save_mode || "bottom";
  const showTopSave = saveMode === "top" || saveMode === "both";
  const showBottomSave = saveMode === "bottom" || saveMode === "both";
  const saveDisabled = previewMode || !isDirty || (showValidation && Object.keys(validationErrors).length > 0);
  const effectiveRecordId = recordId || (hasRecord ? record?.id || null : null);
  const isNewRecord = !effectiveRecordId;
  const autoSaveEnabled = Boolean(header?.auto_save);
  // New records cannot autosave until they have an id, so keep explicit save/discard visible.
  const needsExplicitSave = isNewRecord || !autoSaveEnabled;
  const shouldShowManualSaveControls =
    needsExplicitSave && !readonly && onSave && showTopSave && (isDirty || isNewRecord);
  const shouldShowManualBottomSaveControls =
    needsExplicitSave && !readonly && onSave && showBottomSave && (isDirty || isNewRecord);

  const resolvedTitleField = header?.title_field || displayField || null;
  const resolvedTitleValue = resolvedTitleField ? getFieldValue(record, resolvedTitleField) : null;
  const titleText = (resolvedTitleValue && String(resolvedTitleValue).trim()) || "New";

  useEffect(() => {
    if (!applyDefaults || defaultsApplied || readonly) return;
    if (!record || typeof record !== "object") return;
    const updates = {};
    for (const fieldId of sectionFieldIds) {
      const field = fieldIndex[fieldId];
      if (!field || !Object.prototype.hasOwnProperty.call(field, "default")) continue;
      const existing = getFieldValue(record, fieldId);
      if (existing === "" || existing === null || existing === undefined) {
        updates[fieldId] = field.default;
      }
    }
    const keys = Object.keys(updates);
    if (keys.length === 0) {
      setDefaultsApplied(true);
      return;
    }
    let next = { ...record };
    for (const fieldId of keys) {
      next = setFieldValue(next, fieldId, updates[fieldId]);
    }
    setDefaultsApplied(true);
    onChange(next);
  }, [applyDefaults, defaultsApplied, readonly, record, sectionFieldIds, fieldIndex, onChange]);

  const renderSections = (() => {
    if (!hasTabs) {
      return sections;
    }
    if (activeTab === activityTabId) return [];
    if (!tabsConfig || !Array.isArray(tabsConfig.tabs) || tabsConfig.tabs.length === 0) {
      return sections;
    }
    const tab = tabsConfig.tabs.find((t) => t?.id === activeTab);
    if (!tab || !Array.isArray(tab.sections)) return [];
    const allowed = new Set(tab.sections);
    return sections.filter((s) => allowed.has(s.id));
  })();

  function getVisibleFields(section) {
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    const visible = [];
    for (const fieldId of fields) {
      if (hiddenSet.has(fieldId)) continue;
      const field = fieldIndex[fieldId];
      const visibleWhen = field?.visible_when;
      const isVisible = visibleWhen ? evalCondition(visibleWhen, { record }) : true;
      if (isVisible) visible.push(fieldId);
    }
    return visible;
  }

  function getActiveSectionTab(section) {
    const tabs = Array.isArray(section?.tabs) ? section.tabs : [];
    if (tabs.length === 0) return null;
    const saved = sectionTabs[section.id];
    if (saved && tabs.some((t) => t?.id === saved)) return saved;
    return tabs[0]?.id || null;
  }

  function collectMissingFields(condition, missing) {
    if (!condition || typeof condition !== "object") return;
    const op = condition.op;
    if (op === "exists") {
      const fieldId = condition.field;
      if (typeof fieldId === "string") {
        const value = getFieldValue(record, fieldId);
        if (value === "" || value === null || value === undefined) {
          missing.add(fieldId);
        }
      }
      return;
    }
    if (op === "and" && Array.isArray(condition.conditions)) {
      condition.conditions.forEach((c) => collectMissingFields(c, missing));
      return;
    }
    if (op === "or" && Array.isArray(condition.conditions)) {
      condition.conditions.forEach((c) => collectMissingFields(c, missing));
      return;
    }
    if (op === "not" && condition.condition) {
      collectMissingFields(condition.condition, missing);
    }
  }

  function actionDisabledReason(action) {
    const cond = action?.enabled_when;
    if (!cond) return null;
    const enabled = evalCondition(cond, { record });
    if (enabled) return null;
    const missing = new Set();
    collectMissingFields(cond, missing);
    if (missing.size === 0) return "Requirements not met.";
    const labels = Array.from(missing).map((fieldId) => fieldIndex[fieldId]?.label || fieldId);
    return `Missing: ${labels.join(", ")}`;
  }

  let renderedSections = renderSections
    .map((section) => ({
      section,
      fields: getVisibleFields(section),
      lineEditorConfig:
        ((section?.line_editor ?? section?.lineEditor) && typeof (section?.line_editor ?? section?.lineEditor) === "object"
          ? (section?.line_editor ?? section?.lineEditor)
          : null) ||
        (viewLineEditors[section?.id] && typeof viewLineEditors[section.id] === "object" ? viewLineEditors[section.id] : null) ||
        (section?.id === "line_items" && isWorkorderForm ? demoLineItemsConfig : null),
    }))
    .filter((item) => item.fields.length > 0 || Boolean(item.lineEditorConfig));

  const activeSection = activeTab ? sections.find((section) => section?.id === activeTab) : null;
  const activeFallbackConfig =
    (((activeSection?.line_editor ?? activeSection?.lineEditor) &&
      typeof (activeSection?.line_editor ?? activeSection?.lineEditor) === "object"
      ? (activeSection?.line_editor ?? activeSection?.lineEditor)
      : null)) ||
    (activeTab && viewLineEditors[activeTab] && typeof viewLineEditors[activeTab] === "object" ? viewLineEditors[activeTab] : null) ||
    (activeTab === "line_items" && isWorkorderForm ? demoLineItemsConfig : null);

  if (renderedSections.length === 0 && hasTabs && activeTab && activeFallbackConfig) {
    renderedSections = [
      {
        section: { id: activeTab, title: activeTab },
        fields: [],
        lineEditorConfig: activeFallbackConfig,
      },
    ];
  }

  const emptyTabState =
    hasTabs &&
    activeTab !== activityTabId &&
    renderedSections.length === 0;

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      {header && !hideHeader && (
        <div className="shrink-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base font-semibold truncate">{titleText}</h1>
            {!autoSaveEnabled && !readonly && isDirty && (
              <span className="text-sm opacity-60">Unsaved changes</span>
            )}
            {shouldShowManualSaveControls && (
              <div className="flex items-center gap-2">
                <button
                  className={PRIMARY_BUTTON_SM}
                  onClick={() => onSave(validationErrors)}
                  disabled={saveDisabled}
                >
                  Save
                </button>
                <button
                  className={SOFT_BUTTON_SM}
                  onClick={() => onDiscard?.()}
                  disabled={previewMode || (!isDirty && !isNewRecord)}
                >
                  Discard
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {primaryActions.map((item) => {
              const disabled = !item.enabled || previewMode || readonly;
              const reason = readonly
                ? "Read-only access."
                : !item.enabled
                  ? actionDisabledReason(item.action)
                  : null;
              const button = (
                <button
                  key={item.label}
                  className={SOFT_BUTTON_SM}
                  onClick={() => {
                    if (disabled) return;
                    onActionClick?.(item.action);
                  }}
                  disabled={disabled}
                >
                  {item.label}
                </button>
              );
              if (!reason) return button;
              return (
                <DaisyTooltip key={item.label} label={reason} placement="bottom">
                  {button}
                </DaisyTooltip>
              );
            })}
            {secondaryActions.length > 0 && (
              <div className="dropdown dropdown-end">
                <button className={SOFT_BUTTON_SM} disabled={previewMode || readonly}>
                  More
                </button>
                <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-48 z-50">
                  {secondaryActions.map((item) => (
                    <li key={item.label}>
                      <button
                        onClick={() => {
                          if (previewMode || readonly || !item.enabled) return;
                          onActionClick?.(item.action);
                        }}
                        disabled={!item.enabled || previewMode || readonly}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
      {header?.statusbar?.field_id && (
        <div className="shrink-0 pt-1">
          <StatusBar field={fieldIndex[header.statusbar.field_id]} value={getFieldValue(record, header.statusbar.field_id)} />
        </div>
      )}
      {hasTabs && (
        <div className="shrink-0">
          <Tabs tabs={tabsForUi} activeId={activeTab} onChange={setActiveTab} />
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto space-y-4">
        {activityConfig?.mode === "panel" && (
          <div className="border border-base-300 rounded-box p-3">
            <div className="text-sm font-semibold mb-2">{activityTabLabel}</div>
            <ActivityPanel entityId={entityId} recordId={effectiveRecordId} config={activityConfig || {}} />
          </div>
        )}
        {activeTab === activityTabId && (
          <ActivityPanel entityId={entityId} recordId={effectiveRecordId} config={activityConfig || {}} />
        )}
        {emptyTabState && (
          <div className="text-sm opacity-70 py-2">
            Nothing here yet. This section becomes available after the required fields are completed or status changes.
          </div>
        )}
        {activeTab !== activityTabId && renderedSections.map(({ section, fields, lineEditorConfig }) => (
          <div key={section.id} className="space-y-3">
            {!hasTabs && (
              <div className="text-sm font-semibold">{section.title || section.id}</div>
            )}
            {lineEditorConfig ? (
              <InlineLineItemsTable
                config={lineEditorConfig}
                parentRecordId={effectiveRecordId}
                readonly={readonly}
                previewMode={previewMode}
                onLookupCreate={onLookupCreate}
                canCreateLookup={canCreateLookup}
              />
            ) : (() => {
              const layout = section.layout;
              const isSectionTabs = layout === "tabs" && Array.isArray(section.tabs) && section.tabs.length > 0;
              const columns = !isSectionTabs && layout === "columns" && section.columns === 2 ? 2 : 1;
              const gridClass = columns === 2 ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "grid grid-cols-1 gap-4";
              const sectionTabId = isSectionTabs ? getActiveSectionTab(section) : null;
              const sectionTab = isSectionTabs ? section.tabs.find((t) => t?.id === sectionTabId) : null;
              const sectionTabFields = Array.isArray(sectionTab?.fields) ? sectionTab.fields : [];
              const activeFields = isSectionTabs ? sectionTabFields.filter((fieldId) => fields.includes(fieldId)) : fields;
              return (
                <>
                  {isSectionTabs && (
                    <Tabs
                      tabs={section.tabs}
                      activeId={sectionTabId}
                      onChange={(next) => setSectionTabs((prev) => ({ ...prev, [section.id]: next }))}
                    />
                  )}
                  <div className={gridClass}>
                    {activeFields.map((fieldId) => {
                    const field = fieldIndex[fieldId];
                    const value = getFieldValue(record, fieldId);
                    const disabledWhen = field?.disabled_when;
                    const isDisabled = disabledWhen ? evalCondition(disabledWhen, { record }) : false;
                    const isAttachmentField = field?.type === "attachments";
                    return (
                      <div key={fieldId}>
                        <fieldset className="fieldset">
                          <legend className="fieldset-legend text-xs uppercase opacity-60 tracking-wide">
                            {field.label || field.id}
                          </legend>
                          {isAttachmentField ? (
                            <AttachmentField
                              entityId={entityId}
                              recordId={effectiveRecordId}
                              fieldId={fieldId}
                              readonly={readonly || isDisabled}
                              previewMode={previewMode}
                              buttonLabel={field?.ui?.button_label || field?.button_label || "Attach"}
                              description={field?.ui?.description || field?.help_text || ""}
                            />
                          ) : field.type === "lookup" ? (
                            <LookupField
                              field={field}
                              value={value}
                              onChange={(val) => onChange(setFieldValue(record, fieldId, val))}
                              readonly={readonly || isDisabled}
                              record={record}
                              previewMode={previewMode}
                              canCreate={canCreateLookup}
                              onCreate={onLookupCreate}
                            />
                          ) : (
                            renderField(
                              field,
                              value,
                              (val) => onChange(setFieldValue(record, fieldId, val)),
                              readonly || isDisabled
                            )
                          )}
                          {!isAttachmentField && field.help_text && <span className="label label-text-alt opacity-50">{field.help_text}</span>}
                          {showValidation && validationErrors[fieldId] && <div className="text-xs text-error">{validationErrors[fieldId]}</div>}
                        </fieldset>
                      </div>
                    );
                  })}
                  </div>
                </>
              );
            })()}
          </div>
        ))}
      </div>
      {shouldShowManualBottomSaveControls && (
        <div className="shrink-0 flex items-center gap-2">
          <button
            className={PRIMARY_BUTTON_SM}
            onClick={() => onSave(validationErrors)}
            disabled={saveDisabled}
          >
            Save
          </button>
          <button
            className={SOFT_BUTTON_SM}
            onClick={() => onDiscard?.()}
            disabled={previewMode || (!isDirty && !isNewRecord)}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

function coerceEditorValue(value, type) {
  if (type === "number") {
    if (value === "" || value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  if (type === "bool") return Boolean(value);
  return value;
}

function InlineLineItemsTable({
  config,
  parentRecordId,
  readonly,
  previewMode = false,
  onLookupCreate,
  canCreateLookup,
}) {
  const childEntityId = config?.entity_id || null;
  const parentField = config?.parent_field || null;
  const itemField = config?.item_lookup_field || null;
  const itemEntityId = config?.item_lookup_entity || null;
  const itemDisplayField = config?.item_lookup_display_field || null;
  const descriptionField = config?.description_field || null;
  const itemFieldMap = config?.item_field_map && typeof config.item_field_map === "object" ? config.item_field_map : {};
  const defaults = config?.defaults && typeof config.defaults === "object" ? config.defaults : {};
  const columns = Array.isArray(config?.columns) ? config.columns : [];
  const itemPrefix = useMemo(() => {
    if (typeof itemDisplayField === "string" && itemDisplayField.includes(".")) {
      return itemDisplayField.split(".")[0];
    }
    if (typeof itemField === "string" && itemField.includes(".")) {
      return itemField.split(".")[0];
    }
    return "item";
  }, [itemDisplayField, itemField]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupOptions, setLookupOptions] = useState([]);
  const [lookupCache, setLookupCache] = useState({});
  const lookupRef = useRef(null);

  const fetchRows = React.useCallback(async () => {
    if (!childEntityId || !parentField || !parentRecordId || previewMode) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const fieldIds = Array.from(
        new Set(
          [
            ...columns.map((c) => c?.field_id).filter(Boolean),
            itemField,
            descriptionField,
          ].filter(Boolean)
        )
      );
      const qs = new URLSearchParams();
      if (fieldIds.length) qs.set("fields", fieldIds.join(","));
      qs.set(
        "domain",
        JSON.stringify({
          op: "eq",
          field: parentField,
          value: parentRecordId,
        })
      );
      const res = await apiFetch(`/records/${childEntityId}?${qs.toString()}`);
      const next = (res?.records || []).map((r) => ({
        record_id: r.record_id,
        record: r.record || {},
      }));
      setRows(next);
    } catch (err) {
      setError(err?.message || "Failed to load line items.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [childEntityId, parentField, parentRecordId, previewMode, columns, itemField, descriptionField]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!lookupOpen || !itemEntityId || previewMode) return;
      if (searchDebounced.length < 2) {
        setLookupOptions([]);
        return;
      }
      setLookupLoading(true);
      try {
        const res = await apiFetch(`/lookup/${itemEntityId}/options`, {
          method: "POST",
          body: JSON.stringify({
            q: searchDebounced,
            limit: 30,
          }),
        });
        const opts = (res?.records || []).map((item) => {
          const rec = item.record || {};
          const rid = item.record_id || rec.id;
          const label = (itemDisplayField && rec[itemDisplayField]) || rid || "—";
          return { value: rid, label };
        });
        if (!cancelled) setLookupOptions(opts);
      } catch {
        if (!cancelled) setLookupOptions([]);
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [lookupOpen, itemEntityId, itemDisplayField, previewMode, searchDebounced]);

  useEffect(() => {
    function onOutside(e) {
      if (!lookupRef.current) return;
      if (lookupRef.current.contains(e.target)) return;
      setLookupOpen(false);
    }
    if (!lookupOpen) return;
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [lookupOpen]);

  async function patchRow(recordId, fieldId, rawValue, type) {
    const value = coerceEditorValue(rawValue, type);
    setRows((prev) =>
      prev.map((row) =>
        row.record_id === recordId
          ? { ...row, record: { ...row.record, [fieldId]: value } }
          : row
      )
    );
    try {
      await apiFetch(`/records/${childEntityId}/${recordId}`, {
        method: "PUT",
        body: JSON.stringify({ [fieldId]: value }),
      });
    } catch {
      fetchRows();
    }
  }

  async function deleteRow(recordId) {
    try {
      await apiFetch(`/records/${childEntityId}/${recordId}`, { method: "DELETE" });
      setRows((prev) => prev.filter((row) => row.record_id !== recordId));
    } catch {
      fetchRows();
    }
  }

  async function addRowFromOption(option) {
    if (!option?.value || !parentRecordId) return;
    let itemRecord = null;
    try {
      const itemRes = await apiFetch(`/records/${itemEntityId}/${option.value}`);
      itemRecord = itemRes?.record || itemRes || null;
    } catch {
      itemRecord = null;
    }
    const payload = {
      ...defaults,
      [parentField]: parentRecordId,
      [itemField]: option.value,
    };
    const explicitMappings = Object.entries(itemFieldMap);
    if (itemRecord && explicitMappings.length > 0) {
      for (const [targetField, sourceField] of explicitMappings) {
        if (typeof targetField !== "string" || typeof sourceField !== "string") continue;
        const mapped = itemRecord[sourceField];
        if (mapped !== undefined && mapped !== null && mapped !== "") {
          payload[targetField] = mapped;
        }
      }
    } else if (itemRecord) {
      const unitPriceColumn = columns.find((c) => typeof c?.field_id === "string" && c.field_id.endsWith(".unit_price"));
      const taxRateColumn = columns.find((c) => typeof c?.field_id === "string" && c.field_id.endsWith(".tax_rate"));
      const itemUnitPrice = itemRecord[`${itemPrefix}.unit_price`];
      const itemTaxRate = itemRecord[`${itemPrefix}.tax_rate`];
      const itemDescription = itemRecord[`${itemPrefix}.description`];
      if (unitPriceColumn?.field_id && itemUnitPrice !== undefined && itemUnitPrice !== null) {
        payload[unitPriceColumn.field_id] = itemUnitPrice;
      }
      if (taxRateColumn?.field_id && itemTaxRate !== undefined && itemTaxRate !== null) {
        payload[taxRateColumn.field_id] = itemTaxRate;
      }
      if (descriptionField && !payload[descriptionField] && itemDescription) {
        payload[descriptionField] = itemDescription;
      }
    }
    if (descriptionField && !payload[descriptionField]) payload[descriptionField] = option.label || "";
    try {
      const created = await apiFetch(`/records/${childEntityId}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const createdId = created?.record_id;
      if (createdId) {
        setLookupCache((prev) => ({ ...prev, [createdId]: option.label || option.value }));
      }
      setSearch("");
      setSearchDebounced("");
      setLookupOpen(false);
      await fetchRows();
    } catch (err) {
      setError(err?.message || "Failed to add line item.");
    }
  }

  if (!childEntityId || !parentField || !itemField || !itemEntityId) {
    return <div className="text-sm text-error">Line editor is missing configuration.</div>;
  }

  if (!parentRecordId) {
    return <div className="text-sm opacity-70">Save the work order first, then add line items.</div>;
  }

  return (
    <div className="rounded-box border border-base-300 bg-base-100">
      <div className="overflow-x-auto min-h-80">
        <table className="table table-sm">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.field_id || col.label}>{col.label || col.field_id}</th>
              ))}
              {!readonly ? <th className="w-12" /> : null}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length + (readonly ? 0 : 1)} className="text-sm opacity-70">Loading line items...</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (readonly ? 0 : 1)} className="text-sm opacity-70">No line items yet.</td>
              </tr>
            )}
            {!loading && rows.map((row) => (
              <tr key={row.record_id}>
                {columns.map((col) => {
                  const fieldId = col.field_id;
                  const raw = row.record?.[fieldId];
                  if (fieldId === itemField) {
                    const label = lookupCache[row.record_id] || row.record?.[descriptionField] || raw || "";
                    return <td key={`${row.record_id}-${fieldId}`}>{label}</td>;
                  }
                  if (readonly || col.readonly) {
                    return <td key={`${row.record_id}-${fieldId}`}>{String(raw ?? "")}</td>;
                  }
                  return (
                    <td key={`${row.record_id}-${fieldId}`}>
                      <input
                        className="input input-bordered input-xs w-full"
                        type={col.type === "number" ? "number" : "text"}
                        value={raw ?? ""}
                        onChange={(e) => {
                          const next = e.target.value;
                          setRows((prev) =>
                            prev.map((r) =>
                              r.record_id === row.record_id
                                ? { ...r, record: { ...r.record, [fieldId]: next } }
                                : r
                            )
                          );
                        }}
                        onBlur={(e) => patchRow(row.record_id, fieldId, e.target.value, col.type)}
                      />
                    </td>
                  );
                })}
                {!readonly ? (
                  <td>
                    <button
                      type="button"
                      className={SOFT_BUTTON_XS}
                      onClick={() => deleteRow(row.record_id)}
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          {!readonly && (
            <tfoot>
              <tr>
                <td colSpan={columns.length + 1}>
                  <div ref={lookupRef} className="relative">
                    <input
                      className="input input-bordered input-sm w-full"
                      placeholder="Add line: search item..."
                      value={search}
                      onFocus={() => setLookupOpen(true)}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setLookupOpen(true);
                      }}
                    />
                    {lookupOpen && (
                      <div className="absolute z-30 mt-1 w-full rounded-box border border-base-300 bg-base-100 shadow">
                        <ul className="menu menu-compact max-h-64 overflow-auto">
                          {lookupLoading && <li className="menu-title"><span>Loading...</span></li>}
                          {!lookupLoading && searchDebounced.length < 2 && <li className="menu-title"><span>Type at least 2 characters...</span></li>}
                          {!lookupLoading && searchDebounced.length >= 2 && lookupOptions.length === 0 && <li className="menu-title"><span>No results</span></li>}
                          {lookupOptions.map((opt) => (
                            <li key={opt.value}>
                              <button type="button" onClick={() => addRowFromOption(opt)}>
                                {opt.label}
                              </button>
                            </li>
                          ))}
                          {typeof canCreateLookup === "function" && canCreateLookup(itemEntityId) && (
                            <li className="border-t border-base-300 mt-1 pt-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  if (typeof onLookupCreate !== "function") return;
                                  const result = await onLookupCreate({
                                    entityId: itemEntityId,
                                    displayField: itemDisplayField,
                                    initialValue: searchDebounced || "",
                                  });
                                  if (result?.record_id) {
                                    await addRowFromOption({ value: result.record_id, label: result.label || result.record_id });
                                  }
                                }}
                              >
                                + Create new item
                              </button>
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {error ? <div className="px-3 pb-3 text-xs text-error">{error}</div> : null}
    </div>
  );
}

function StatusBar({ field, value }) {
  if (!field || !Array.isArray(field.options)) return null;
  return (
    <ul className="steps steps-horizontal w-full">
      {field.options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <li key={opt.value} className={`step ${isActive ? "step-primary" : ""}`}>
            {opt.label ?? opt.value}
          </li>
        );
      })}
    </ul>
  );
}

function collectRecordRefs(node, acc) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectRecordRefs(item, acc));
    return;
  }
  if (typeof node.ref === "string") {
    const ref = node.ref;
    if (ref.startsWith("$record.")) acc.add(ref.slice("$record.".length));
    if (ref.startsWith("record.")) acc.add(ref.slice("record.".length));
  }
  if (typeof node.field === "string" && node.field.startsWith("record.")) {
    acc.add(node.field.slice("record.".length));
  }
  if (node.left) collectRecordRefs(node.left, acc);
  if (node.right) collectRecordRefs(node.right, acc);
  if (node.condition) collectRecordRefs(node.condition, acc);
  if (Array.isArray(node.conditions)) node.conditions.forEach((c) => collectRecordRefs(c, acc));
}

function buildRecordContext(domain, record) {
  if (!domain || !record || typeof record !== "object") return {};
  const refs = new Set();
  collectRecordRefs(domain, refs);
  if (refs.size === 0) return {};
  const context = {};
  const keys = Array.from(refs).sort();
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      context[key] = record[key];
    }
  }
  return context;
}

function LookupField({ field, value, onChange, readonly, record, previewMode = false, onCreate, canCreate }) {
  const [options, setOptions] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const containerRef = useRef(null);
  const cacheRef = useRef(new Map());
  const lastKeyRef = useRef(null);
  const entityId = field?.entity || null;
  const recordContext = useMemo(() => buildRecordContext(field?.domain || null, record), [field?.domain, record]);
  const recordContextKey = useMemo(() => JSON.stringify(recordContext), [recordContext]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      if (!entityId) return;
      if (previewMode) return;
      const trimmed = (debouncedSearch || "").trim();
      if (!opened && trimmed.length < 2) return;
      if (trimmed.length < 2) {
        setOptions([]);
        return;
      }
      const requestKey = JSON.stringify({
        entityId,
        fieldId: field?.id || null,
        q: debouncedSearch || "",
        domain: field?.domain || null,
        recordContextKey,
      });
      if (requestKey === lastKeyRef.current) return;
      lastKeyRef.current = requestKey;
      const cached = cacheRef.current.get(requestKey);
      if (cached && Date.now() - cached.ts < 60000) {
        setOptions(cached.options);
        return;
      }
      setLoading(true);
      try {
        const res = await apiFetch(`/lookup/${entityId}/options`, {
          method: "POST",
          body: JSON.stringify({
            q: debouncedSearch || null,
            limit: 50,
            domain: field.domain || null,
            record_context: recordContext,
          }),
        });
        const records = res.records || [];
        const labelField = field.display_field;
        const opts = records.map((item) => {
          const record = item.record || {};
          const recordId = item.record_id || record.id;
          const label = (labelField && record[labelField]) || recordId || "—";
          return { value: recordId, label };
        });
        if (!cancelled) {
          cacheRef.current.set(requestKey, { ts: Date.now(), options: opts });
          setOptions(opts);
        }
      } catch {
        if (!cancelled) {
          setOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    const handle = setTimeout(loadOptions, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [entityId, field.display_field, field?.id, debouncedSearch, field.domain, recordContextKey, opened, previewMode]);

  const labelField = field.display_field;

  useEffect(() => {
    if (!value) {
      setSelectedLabel("");
      return;
    }
    const match = options.find((opt) => opt.value === value);
    if (match) {
      setSelectedLabel(match.label || "");
      return;
    }
    if (!selectedLabel) {
      setSelectedLabel(value);
    }
  }, [value, options, selectedLabel]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedLabel() {
      if (!entityId || !value) return;
      if (previewMode) return;
      const match = options.find((opt) => opt.value === value);
      if (match) return;
      try {
        const res = await apiFetch(`/records/${entityId}/${value}`);
        const record = res?.record || res;
        const label = (labelField && record && record[labelField]) || value;
        if (!cancelled) {
          setSelectedLabel(label);
        }
      } catch {
        if (!cancelled) {
          setSelectedLabel(value);
        }
      }
    }
    loadSelectedLabel();
    return () => {
      cancelled = true;
    };
  }, [entityId, value, labelField, options, previewMode]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      setOpened(false);
      if (!search.trim()) {
        setSearch(selectedLabel || "");
      }
    }
    if (!opened) return;
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [opened, search, selectedLabel]);

  function handleSelect(option) {
    setSelectedLabel(option.label || "");
    setSearch(option.label || "");
    setOpened(false);
    onChange(option.value || null);
  }

  const inputValue = opened ? search : search || selectedLabel || "";
  const showOptions = opened;
  const allowCreate =
    !readonly &&
    !field?.readonly &&
    (typeof canCreate === "function" ? canCreate(field?.entity) : true);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          className="input input-bordered w-full pr-10"
          value={inputValue}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          disabled={readonly || field.readonly}
          onFocus={() => {
            setOpened(true);
            setSearch(search || "");
          }}
        />
        {Boolean(value) && !readonly && !field.readonly && (
          <button
            type="button"
            className={`${SOFT_BUTTON_XS} absolute right-2 top-1/2 -translate-y-1/2`}
            onClick={() => {
              setSearch("");
              setSelectedLabel("");
              onChange(null);
            }}
            aria-label="Clear selection"
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>
      {showOptions && (
        <div className="absolute z-30 mt-1 w-full rounded-box border border-base-400 bg-base-100 shadow">
          <ul className="menu menu-compact max-h-64 overflow-auto">
            {loading && <li className="menu-title"><span>Loading…</span></li>}
            {!loading && search.trim().length < 2 && (
              <li className="menu-title"><span>Type to search…</span></li>
            )}
            {!loading && search.trim().length >= 2 && options.length === 0 && (
              <li className="menu-title"><span>No results</span></li>
            )}
            {options.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={opt.value === value ? "active" : ""}
                >
                  {opt.label}
                </button>
              </li>
            ))}
            {allowCreate && (
              <li className="border-t border-base-400 mt-1 pt-1">
                <button
                  type="button"
                  disabled={typeof onCreate !== "function"}
                  onClick={async () => {
                    if (typeof onCreate !== "function") return;
                    const result = await onCreate({
                      entityId: field?.entity,
                      displayField: field?.display_field,
                      initialValue: search.trim() || "",
                    });
                    if (result?.record_id) {
                      setSelectedLabel(result.label || "");
                      setSearch(result.label || "");
                      onChange(result.record_id);
                    }
                  }}
                >
                  + Create new
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      {field.disabled_hint && <div className="text-xs opacity-60 mt-1">{field.disabled_hint}</div>}
    </div>
  );
}
