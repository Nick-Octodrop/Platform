import React, { useMemo, useState, useEffect, useRef } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { renderField, setFieldValue, getFieldValue } from "./field_renderers.jsx";
import { apiFetch, createRecord, deleteRecord, googlePlaceDetails, googlePlacesAutocomplete, updateRecord } from "../api.js";
import { evalCondition } from "../utils/conditions.js";
import { applyComputedFields } from "../utils/computedFields.js";
import { formatFieldValue, getFieldInputAffixes } from "../utils/fieldFormatting.js";
import Tabs from "../components/Tabs.jsx";
import { PRIMARY_BUTTON_SM, SOFT_BUTTON_SM, SOFT_ICON_SM } from "../components/buttonStyles.js";
import DaisyTooltip from "../components/DaisyTooltip.jsx";
import ActivityPanel from "./ActivityPanel.jsx";
import AttachmentField from "./AttachmentField.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { useAccessContext } from "../access.js";
import useWorkspaceProviderStatus from "../hooks/useWorkspaceProviderStatus.js";
import ProviderSecretModal from "../components/ProviderSecretModal.jsx";

function resolveAddressAutocompleteMapping(fieldId) {
  if (typeof fieldId !== "string") return null;
  if (fieldId.endsWith(".address_line_1")) {
    const base = fieldId.slice(0, -".address_line_1".length);
    return {
      line1Field: fieldId,
      line2Field: `${base}.address_line_2`,
      cityField: `${base}.city`,
      regionField: `${base}.region`,
      postcodeField: `${base}.postcode`,
      countryField: `${base}.country`,
    };
  }
  if (fieldId.endsWith(".billing_street")) {
    const base = fieldId.slice(0, -".billing_street".length);
    return {
      line1Field: fieldId,
      line2Field: `${base}.billing_street2`,
      cityField: `${base}.billing_city`,
      regionField: `${base}.billing_state`,
      postcodeField: `${base}.billing_postcode`,
      countryField: `${base}.billing_country`,
    };
  }
  if (fieldId.endsWith(".shipping_street")) {
    const base = fieldId.slice(0, -".shipping_street".length);
    return {
      line1Field: fieldId,
      line2Field: `${base}.shipping_street2`,
      cityField: `${base}.shipping_city`,
      regionField: `${base}.shipping_state`,
      postcodeField: `${base}.shipping_postcode`,
      countryField: `${base}.shipping_country`,
    };
  }
  return null;
}

function applyAddressMapping(record, mapping, address) {
  let next = setFieldValue(record || {}, mapping.line1Field, address?.line_1 || "");
  if (mapping.line2Field) next = setFieldValue(next, mapping.line2Field, address?.line_2 || "");
  if (mapping.cityField) next = setFieldValue(next, mapping.cityField, address?.city || "");
  if (mapping.regionField) next = setFieldValue(next, mapping.regionField, address?.region || "");
  if (mapping.postcodeField) next = setFieldValue(next, mapping.postcodeField, address?.postcode || "");
  if (mapping.countryField) next = setFieldValue(next, mapping.countryField, address?.country || "");
  return next;
}

function AddressAutocompleteField({ field, value, onChange, onRecordChange, readonly, record, previewMode = false }) {
  const { hasCapability } = useAccessContext();
  const { providers, reload: reloadProviderStatus } = useWorkspaceProviderStatus(["google_maps"]);
  const containerRef = useRef(null);
  const sessionTokenRef = useRef(`gmaps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [search, setSearch] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [lookupError, setLookupError] = useState("");
  const [mapsModalOpen, setMapsModalOpen] = useState(false);
  const mapping = useMemo(() => resolveAddressAutocompleteMapping(field?.id), [field?.id]);
  const mapsConnected = Boolean(providers?.google_maps?.connected);
  const canManageSettings = hasCapability("workspace.manage_settings");
  const disabled = readonly || field?.readonly || previewMode;

  useEffect(() => {
    setSearch(value || "");
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    if (!open || disabled || !mapsConnected) {
      setSuggestions([]);
      setLookupError("");
      setLoading(false);
      return undefined;
    }
    const query = String(search || "").trim();
    if (query.length < 3) {
      setSuggestions([]);
      setLookupError("");
      setLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLookupError("");
      try {
        const res = await googlePlacesAutocomplete(query, sessionTokenRef.current);
        if (!cancelled) {
          setSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
        }
      } catch (err) {
        if (!cancelled) {
          setSuggestions([]);
          setLookupError(err?.message || "Address lookup failed. Check your Google Maps key, billing, and Places API access.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [disabled, mapsConnected, open, search]);

  async function handleSelectSuggestion(suggestion) {
    if (!mapping || disabled) return;
    setLoading(true);
    try {
      const res = await googlePlaceDetails(suggestion.place_id, sessionTokenRef.current);
      const address = res?.address || {};
      const nextRecord = applyAddressMapping(record || {}, mapping, address);
      onRecordChange?.(nextRecord);
      setSearch(address?.line_1 || suggestion?.main_text || suggestion?.description || "");
      setOpen(false);
      sessionTokenRef.current = `gmaps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    } catch (err) {
      setLookupError(err?.message || "Address details lookup failed. Check your Google Maps key, billing, and Places API access.");
      onChange(suggestion?.description || search);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div ref={containerRef} className="relative space-y-1">
        <input
          className="input input-bordered w-full"
          disabled={disabled}
          value={search}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            setSearch(next);
            onChange(next);
            if (!open) setOpen(true);
          }}
        />
        {open && !disabled ? (
          <div className="absolute z-30 mt-1 w-full rounded-box border border-base-300 bg-base-100 shadow">
            {mapsConnected ? (
              <ul className="menu menu-compact menu-vertical w-full max-h-72 overflow-y-auto">
                {loading ? <li className="menu-title"><span>Searching addresses…</span></li> : null}
                {!loading && lookupError ? (
                  <li className="menu-title text-error"><span>{lookupError}</span></li>
                ) : null}
                {!loading && String(search || "").trim().length < 3 ? (
                  <li className="menu-title"><span>Type at least 3 characters</span></li>
                ) : null}
                {!loading && !lookupError && String(search || "").trim().length >= 3 && suggestions.length === 0 ? (
                  <li className="menu-title"><span>No address matches</span></li>
                ) : null}
                {suggestions.map((item) => (
                  <li key={item.place_id}>
                    <button type="button" className="text-left" onClick={() => handleSelectSuggestion(item)}>
                      <div className="flex flex-col items-start">
                        <span>{item.main_text || item.description}</span>
                        {item.secondary_text ? <span className="text-xs opacity-60">{item.secondary_text}</span> : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-2">
                {canManageSettings ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline w-full justify-start"
                    onClick={() => setMapsModalOpen(true)}
                  >
                    Create Google Maps key
                  </button>
                ) : null}
                <div className="px-1 pt-2 text-xs opacity-60">
                  {canManageSettings
                    ? "Connect Google Maps to enable address autocomplete."
                    : "Ask a workspace admin to connect Google Maps for address autocomplete."}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <ProviderSecretModal
        open={mapsModalOpen}
        providerKey="google_maps"
        canManageSettings={canManageSettings}
        onClose={() => setMapsModalOpen(false)}
        onSaved={async () => {
          setMapsModalOpen(false);
          await reloadProviderStatus();
          setOpen(true);
        }}
      />
    </>
  );
}

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
  actionBusy = false,
  actionBusyLabel = null,
  isDirty = false,
  hideHeader = false,
  previewMode = false,
  canCreateLookup,
  onLookupCreate,
  onRefreshRecord,
  onFieldFocusChange,
  bottomActionsMode = "inline",
  renderBlocks = null,
}) {
  if (!view) return <div className="alert">Missing form view</div>;
  const rawSections = Array.isArray(view.sections) ? view.sections : [];
  const sections = useMemo(
    () =>
      rawSections
        .map((section) => {
          if (!section || typeof section !== "object") return null;
          const fields = Array.isArray(section.fields)
            ? section.fields.filter((fieldId) => typeof fieldId === "string" && fieldIndex[fieldId])
            : [];
          return { ...section, fields };
        })
        .filter((section) => {
          if (!section) return false;
          const lineEditor = section.line_editor ?? section.lineEditor;
          return section.fields.length > 0 || Boolean(lineEditor && typeof lineEditor === "object");
        }),
    [rawSections, fieldIndex]
  );
  const isMobile = useMediaQuery("(max-width: 768px)");
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
  const activityTabLabel = (typeof activityConfig?.tab_label === "string" && activityConfig.tab_label.trim()) || "Activity";
  const visibleSectionIds = useMemo(() => new Set(sections.map((section) => section.id).filter(Boolean)), [sections]);
  const tabsForUi = useMemo(() => {
    const baseTabs = Array.isArray(tabsConfig?.tabs)
      ? tabsConfig.tabs
          .map((tab) => {
            if (!tab || typeof tab !== "object") return null;
            const nextSections = Array.isArray(tab.sections) ? tab.sections.filter((sectionId) => visibleSectionIds.has(sectionId)) : [];
            return { ...tab, sections: nextSections };
          })
          .filter((tab) => tab && ((tab.sections?.length || 0) > 0 || (Array.isArray(tab.content) && tab.content.length > 0)))
      : [];
    if (!activityConfig || activityConfig.mode !== "tab") {
      return baseTabs;
    }
    if (baseTabs.length > 0) {
      if (baseTabs.some((tab) => tab?.id === activityTabId)) return baseTabs;
      return [...baseTabs, { id: activityTabId, label: activityTabLabel }];
    }
    return [{ id: activityTabId, label: activityTabLabel }];
  }, [tabsConfig?.tabs, activityConfig, activityTabLabel, visibleSectionIds]);
  const hasTabs = tabsForUi.length > 0;
  const [activeTab, setActiveTab] = useState(() => tabsConfig?.default_tab || tabsForUi[0]?.id || null);
  const [sectionTabs, setSectionTabs] = useState({});
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [workspaceMembersLoading, setWorkspaceMembersLoading] = useState(false);
  const [mobileAttachmentSheet, setMobileAttachmentSheet] = useState(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const mobileActionsRef = useRef(null);
  const formRootRef = useRef(null);
  const computedRecord = useMemo(
    () => applyComputedFields(fieldIndex || {}, record || {}),
    [fieldIndex, record]
  );
  const applyRecordChange = React.useCallback(
    (nextRecord) => onChange?.(applyComputedFields(fieldIndex || {}, nextRecord || {})),
    [onChange, fieldIndex]
  );
  const handleFocusCapture = React.useCallback(() => {
    onFieldFocusChange?.(true);
  }, [onFieldFocusChange]);
  const handleBlurCapture = React.useCallback(
    (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget && formRootRef.current?.contains(nextTarget)) return;
      onFieldFocusChange?.(false);
    },
    [onFieldFocusChange]
  );

  if (sections.length === 0 && !activityConfig) {
    return <div className="alert alert-info">No visible fields for this form.</div>;
  }

  useEffect(() => {
    const nextDefault = tabsConfig?.default_tab || tabsForUi[0]?.id || null;
    setActiveTab((current) => {
      if (current && tabsForUi.some((tab) => tab?.id === current)) return current;
      return nextDefault;
    });
  }, [tabsConfig?.default_tab, tabsForUi]);

  useEffect(() => {
    let cancelled = false;
    async function loadMembers() {
      if (previewMode) return;
      setWorkspaceMembersLoading(true);
      try {
        const res = await apiFetch("/access/members");
        const rows = Array.isArray(res?.members) ? res.members : [];
        if (!cancelled) setWorkspaceMembers(rows);
      } catch {
        if (!cancelled) setWorkspaceMembers([]);
      } finally {
        if (!cancelled) setWorkspaceMembersLoading(false);
      }
    }
    loadMembers();
    return () => {
      cancelled = true;
    };
  }, [previewMode]);

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
      const requiredByCondition = requiredWhen ? evalCondition(requiredWhen, { record: computedRecord }) : false;
      const isRequired = field?.required || requiredByStatus.has(fieldId) || requiredByCondition;
      const visibleWhen = field?.visible_when;
      const isVisible = visibleWhen ? evalCondition(visibleWhen, { record: computedRecord }) : true;
      if (isRequired && !readonly) {
        const value = getFieldValue(computedRecord, fieldId);
        const hasDefault = Object.prototype.hasOwnProperty.call(field, "default");
        const isSystem = Boolean(field.system);
        const isEmptyValue =
          value === "" ||
          value === null ||
          value === undefined ||
          (Array.isArray(value) && value.length === 0);
        if (isEmptyValue && !hasDefault && !isSystem) {
          if (!isVisible && !requiredByCondition) {
            continue;
          }
          errors[fieldId] = "Required";
        }
      }
    }
    return errors;
  }, [computedRecord, sectionFieldIds, fieldIndex, readonly, requiredFields, hiddenSet]);

  const saveMode = header?.save_mode || "bottom";
  const showTopSave = saveMode === "top" || saveMode === "both";
  const showBottomSave = saveMode === "bottom" || saveMode === "both";
  const saveDisabled = previewMode || !isDirty || (showValidation && Object.keys(validationErrors).length > 0);
  const effectiveRecordId = recordId || (hasRecord ? computedRecord?.id || null : null);
  const isNewRecord = !effectiveRecordId;
  const autoSaveEnabled = Boolean(header?.auto_save);
  // New records cannot autosave until they have an id, so keep explicit save/discard visible.
  const needsExplicitSave = isNewRecord || !autoSaveEnabled;
  const shouldShowManualSaveControls =
    needsExplicitSave && !readonly && onSave && showTopSave && (isDirty || isNewRecord);
  const shouldShowManualBottomSaveControls =
    needsExplicitSave && !readonly && onSave && showBottomSave && (isDirty || isNewRecord);
  const bottomActionsClass =
    bottomActionsMode === "sticky_right"
      ? "shrink-0 sticky bottom-0 z-10 -mx-1 px-1 py-3 mt-2 border-t border-base-300 bg-base-100/95 backdrop-blur flex items-center justify-end gap-2"
      : "shrink-0 flex items-center gap-2";

  const resolvedTitleField = header?.title_field || displayField || null;
  const resolvedTitleValue = resolvedTitleField ? getFieldValue(computedRecord, resolvedTitleField) : null;
  const titleText = (resolvedTitleValue && String(resolvedTitleValue).trim()) || "New";

  useEffect(() => {
    if (!applyDefaults || defaultsApplied || readonly) return;
    if (!computedRecord || typeof computedRecord !== "object") return;
    const updates = {};
    for (const fieldId of sectionFieldIds) {
      const field = fieldIndex[fieldId];
      if (!field || !Object.prototype.hasOwnProperty.call(field, "default")) continue;
      const existing = getFieldValue(computedRecord, fieldId);
      if (existing === "" || existing === null || existing === undefined) {
        updates[fieldId] = field.default;
      }
    }
    const keys = Object.keys(updates);
    if (keys.length === 0) {
      setDefaultsApplied(true);
      return;
    }
    let next = { ...computedRecord };
    for (const fieldId of keys) {
      next = setFieldValue(next, fieldId, updates[fieldId]);
    }
    setDefaultsApplied(true);
    applyRecordChange(next);
  }, [applyDefaults, defaultsApplied, readonly, computedRecord, sectionFieldIds, fieldIndex, applyRecordChange]);

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
  const activeTabConfig =
    hasTabs && tabsConfig && Array.isArray(tabsConfig.tabs)
      ? tabsConfig.tabs.find((tab) => tab?.id === activeTab) || null
      : null;
  const activeTabBlocks = Array.isArray(activeTabConfig?.content) ? activeTabConfig.content : [];
  const hasCustomTabBlocks = activeTabBlocks.length > 0;

  function getVisibleFields(section) {
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    const visible = [];
    for (const fieldId of fields) {
      if (hiddenSet.has(fieldId)) continue;
      const field = fieldIndex[fieldId];
      const visibleWhen = field?.visible_when;
      const isVisible = visibleWhen ? evalCondition(visibleWhen, { record: computedRecord }) : true;
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
        const value = getFieldValue(computedRecord, fieldId);
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
    const enabled = evalCondition(cond, { record: computedRecord });
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
    !hasCustomTabBlocks &&
    renderedSections.length === 0;
  const isSingleLineEditorTab =
    activeTab !== activityTabId &&
    !hasCustomTabBlocks &&
    renderedSections.length === 1 &&
    Boolean(renderedSections[0]?.lineEditorConfig) &&
    renderedSections[0]?.fields?.length === 0;
  const mobileHeaderActions = [...primaryActions, ...secondaryActions];

  useEffect(() => {
    if (!mobileActionsOpen) return undefined;
    function handlePointerDown(event) {
      if (!mobileActionsRef.current) return;
      if (!mobileActionsRef.current.contains(event.target)) {
        setMobileActionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [mobileActionsOpen]);

  return (
    <div
      ref={formRootRef}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      className={`h-full min-h-0 flex flex-col ${isMobile ? "gap-4" : "gap-4"}`}
    >
      {header && !hideHeader && (
        <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-3 min-w-0">
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
          <div className="ml-auto flex shrink-0 items-center justify-end gap-2 self-start">
            {isMobile && mobileHeaderActions.length > 0 && (
              <div className="relative" ref={mobileActionsRef}>
                <button
                  type="button"
                  className={SOFT_ICON_SM}
                  onClick={() => setMobileActionsOpen((open) => !open)}
                  aria-label="More actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {mobileActionsOpen && (
                  <ul className="absolute right-0 top-full mt-2 menu p-2 shadow bg-base-100 rounded-box w-56 z-[220] border border-base-300">
                    {mobileHeaderActions.map((item) => {
                      const disabled = !item.enabled || previewMode || readonly;
                      const reason = readonly
                        ? "Read-only access."
                        : item.reason || (!item.enabled ? actionDisabledReason(item.action) : null);
                      const button = (
                        <button
                          onClick={() => {
                            if (disabled) return;
                            onActionClick?.(item.action);
                            setMobileActionsOpen(false);
                          }}
                          disabled={disabled}
                        >
                          {item.label}
                        </button>
                      );
                      return (
                        <li key={item.label}>
                          {reason ? (
                            <DaisyTooltip label={reason} placement="left">
                              <span className="block">{button}</span>
                            </DaisyTooltip>
                          ) : button}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className={`flex flex-wrap items-center justify-end gap-2 shrink-0 w-full md:w-auto md:max-w-[60%] ${isMobile ? "hidden" : ""}`}>
            {primaryActions.map((item) => {
              const disabled = !item.enabled || previewMode || readonly;
              const reason = readonly
                ? "Read-only access."
                : !item.enabled
                  ? (item.reason || actionDisabledReason(item.action))
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
                  {actionBusy && actionBusyLabel === item.label ? <span className="loading loading-spinner loading-xs" /> : null}
                  {item.label}
                </button>
              );
              if (!reason) return button;
              return (
                <DaisyTooltip key={item.label} label={reason} placement="bottom">
                  <span className="inline-flex">{button}</span>
                </DaisyTooltip>
              );
            })}
            {secondaryActions.length > 0 && (
              <div className="dropdown dropdown-end">
                <DaisyTooltip label="More actions" placement="bottom">
                  <button type="button" className={SOFT_ICON_SM} aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DaisyTooltip>
                <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-[220]">
                  {secondaryActions.map((item) => (
                    <li key={item.label}>
                      {(() => {
                        const disabled = !item.enabled || previewMode || readonly;
                        const reason = readonly
                          ? "Read-only access."
                          : !item.enabled
                            ? (item.reason || actionDisabledReason(item.action))
                            : null;
                        const button = (
                          <button
                            onClick={() => {
                              if (disabled) return;
                              onActionClick?.(item.action);
                            }}
                            disabled={disabled}
                          >
                            {actionBusy && actionBusyLabel === item.label ? <span className="loading loading-spinner loading-xs" /> : null}
                            {item.label}
                          </button>
                        );
                        if (!reason) return button;
                        return (
                          <DaisyTooltip label={reason} placement="left">
                            <span className="block">{button}</span>
                          </DaisyTooltip>
                        );
                      })()}
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
          <StatusBar field={fieldIndex[header.statusbar.field_id]} value={getFieldValue(computedRecord, header.statusbar.field_id)} />
        </div>
      )}
      {hasTabs && (
        <div className="shrink-0">
          <Tabs tabs={tabsForUi} activeId={activeTab} onChange={setActiveTab} />
        </div>
      )}
      <div className={
        hasCustomTabBlocks
          ? (isMobile ? "space-y-4" : "flex-1 min-h-0 overflow-hidden")
          : isSingleLineEditorTab
            ? (isMobile ? "space-y-4" : "flex-1 min-h-0 overflow-hidden")
            : (isMobile ? "space-y-4" : "flex-1 min-h-0 overflow-auto space-y-4")
      }>
      {activityConfig?.mode === "panel" && (
          <div className={`border border-base-300 rounded-box ${isMobile ? "p-4" : "p-3"}`}>
            <div className="text-sm font-semibold mb-2">{activityTabLabel}</div>
            <ActivityPanel entityId={entityId} recordId={effectiveRecordId} config={activityConfig || {}} />
          </div>
        )}
        {activeTab === activityTabId && (
          <ActivityPanel entityId={entityId} recordId={effectiveRecordId} config={activityConfig || {}} />
        )}
        {activeTab !== activityTabId && hasCustomTabBlocks && renderBlocks?.(activeTabBlocks, {
          entityId,
          recordId: effectiveRecordId,
          record,
          hiddenFields: Array.from(hiddenSet),
        })}
        {emptyTabState && (
          <div className="text-sm opacity-70 py-2">
            Nothing here yet. This section becomes available after the required fields are completed or status changes.
          </div>
        )}
        {activeTab !== activityTabId && renderedSections.map(({ section, fields, lineEditorConfig }) => (
          <div key={section.id} className={lineEditorConfig && isSingleLineEditorTab ? "h-full min-h-0" : "space-y-3"}>
            {!hasTabs && (
              <div className="text-sm font-semibold">{section.title || section.id}</div>
            )}
            {lineEditorConfig ? (
              <InlineLineItemsTable
                config={lineEditorConfig}
                parentEntityId={entityId}
                parentRecordId={effectiveRecordId}
                parentRecord={computedRecord}
                readonly={readonly}
                previewMode={previewMode}
                onLookupCreate={onLookupCreate}
                canCreateLookup={canCreateLookup}
                onRefreshParent={onRefreshRecord}
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
                    const value = getFieldValue(computedRecord, fieldId);
                    const disabledWhen = field?.disabled_when;
                    const isDisabled = disabledWhen ? evalCondition(disabledWhen, { record: computedRecord }) : false;
                    const isAttachmentField = field?.type === "attachments";
                    return (
                      <div key={fieldId}>
                        <fieldset className="fieldset">
                          <legend className="fieldset-legend text-xs uppercase opacity-60 tracking-wide">
                            {field.label || field.id}
                          </legend>
                          {isAttachmentField ? (
                            isMobile ? (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm w-full justify-start"
                                onClick={() => setMobileAttachmentSheet({
                                  fieldId,
                                  label: field.label || field.id,
                                  readonly: readonly || isDisabled,
                                  buttonLabel: field?.ui?.button_label || field?.button_label || "Attach",
                                  description: field?.ui?.description || field?.help_text || "",
                                })}
                              >
                                {field.label || field.id}
                              </button>
                            ) : (
                              <AttachmentField
                                entityId={entityId}
                                recordId={effectiveRecordId}
                                fieldId={fieldId}
                                readonly={readonly || isDisabled}
                                previewMode={previewMode}
                                buttonLabel={field?.ui?.button_label || field?.button_label || "Attach"}
                                description={field?.ui?.description || field?.help_text || ""}
                              />
                            )
                          ) : field.type === "lookup" ? (
                            <LookupField
                              field={field}
                              value={value}
                              onChange={(val) => applyRecordChange(setFieldValue(computedRecord, fieldId, val))}
                              readonly={readonly || isDisabled}
                              record={computedRecord}
                              previewMode={previewMode}
                              canCreate={canCreateLookup}
                              onCreate={onLookupCreate}
                            />
                          ) : field.type === "user" ? (
                            <WorkspaceUserField
                              field={field}
                              value={value}
                              onChange={(val) => applyRecordChange(setFieldValue(computedRecord, fieldId, val))}
                              readonly={readonly || isDisabled}
                              members={workspaceMembers}
                              loadingMembers={workspaceMembersLoading}
                            />
                          ) : field.type === "users" ? (
                            <WorkspaceUsersField
                              field={field}
                              value={value}
                              onChange={(val) => applyRecordChange(setFieldValue(computedRecord, fieldId, val))}
                              readonly={readonly || isDisabled}
                              members={workspaceMembers}
                              loadingMembers={workspaceMembersLoading}
                            />
                          ) : field.type === "string" && resolveAddressAutocompleteMapping(fieldId) ? (
                            <AddressAutocompleteField
                              field={field}
                              value={value}
                              onChange={(val) => applyRecordChange(setFieldValue(computedRecord, fieldId, val))}
                              onRecordChange={applyRecordChange}
                              readonly={readonly || isDisabled}
                              record={computedRecord}
                              previewMode={previewMode}
                            />
                          ) : (
                            renderField(
                              field,
                              value,
                              (val) => applyRecordChange(setFieldValue(computedRecord, fieldId, val)),
                              readonly || isDisabled,
                              computedRecord
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
        <div className={bottomActionsClass}>
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
      {isMobile && mobileAttachmentSheet && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label="Close attachments"
            onClick={() => setMobileAttachmentSheet(null)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[86vh] rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4 flex flex-col">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="px-1 pb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{mobileAttachmentSheet.label}</div>
              <button type="button" className={SOFT_BUTTON_SM} onClick={() => setMobileAttachmentSheet(null)}>
                Done
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <AttachmentField
                entityId={entityId}
                recordId={effectiveRecordId}
                fieldId={mobileAttachmentSheet.fieldId}
                readonly={mobileAttachmentSheet.readonly}
                previewMode={previewMode}
                buttonLabel={mobileAttachmentSheet.buttonLabel}
                description={mobileAttachmentSheet.description}
              />
            </div>
          </div>
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
  parentEntityId,
  parentRecordId,
  parentRecord,
  readonly,
  previewMode = false,
  onLookupCreate,
  canCreateLookup,
  onRefreshParent,
}) {
  const childEntityId = config?.entity_id || null;
  const parentField = config?.parent_field || null;
  const itemField = config?.item_lookup_field || null;
  const itemEntityId = config?.item_lookup_entity || null;
  const itemDisplayField = config?.item_lookup_display_field || null;
  const itemLookupDomain = config?.item_lookup_domain || null;
  const descriptionField = config?.description_field || null;
  const itemFieldMap = config?.item_field_map && typeof config.item_field_map === "object" ? config.item_field_map : {};
  const parentFieldMap = config?.parent_field_map && typeof config.parent_field_map === "object" ? config.parent_field_map : {};
  const defaults = config?.defaults && typeof config.defaults === "object" ? config.defaults : {};
  const customLineDefaults = config?.custom_line_defaults && typeof config.custom_line_defaults === "object" ? config.custom_line_defaults : {};
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
  const [lookupCache, setLookupCache] = useState({});
  const [pendingDeleteRow, setPendingDeleteRow] = useState(null);
  const [deletingRowId, setDeletingRowId] = useState("");
  const [addLookupResetKey, setAddLookupResetKey] = useState(0);
  const [creatingCustomLine, setCreatingCustomLine] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const lookupCacheRef = useRef({});
  const uomColumn = columns.find((col) => typeof col?.field_id === "string" && col.field_id.endsWith(".uom"));
  const quantityColumn = columns.find((col) => typeof col?.field_id === "string" && col.field_id.endsWith(".quantity"));
  const unitAmountColumn = columns.find(
    (col) => typeof col?.field_id === "string" && (col.field_id.endsWith(".unit_price") || col.field_id.endsWith(".unit_cost"))
  );
  const addLookupField = useMemo(
    () => ({
      id: `${itemField || "line_item"}.adder`,
      type: "lookup",
      label: "Add item",
      entity: itemEntityId,
      display_field: itemDisplayField,
      domain: itemLookupDomain,
      placeholder: "Add line item...",
    }),
    [itemDisplayField, itemEntityId, itemField, itemLookupDomain]
  );

  async function addParentActivity(message) {
    if (!parentEntityId || !parentRecordId || previewMode || !message) return;
    try {
      await apiFetch("/api/activity/comment", {
        method: "POST",
        body: {
          entity_id: parentEntityId,
          record_id: parentRecordId,
          body: message,
        },
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("octo:activity-mutated", {
            detail: { entityId: parentEntityId, recordId: parentRecordId },
          })
        );
      }
    } catch {
      // Activity logging is best-effort; line edits should not fail because the feed rejected a note.
    }
  }

  function rowLabel(rowOrRecord) {
    const recordId = rowOrRecord?.record_id;
    const record = rowOrRecord?.record || rowOrRecord || {};
    return lookupCache[recordId] || record?.[descriptionField] || record?.[itemField] || "line item";
  }

  useEffect(() => {
    lookupCacheRef.current = lookupCache;
  }, [lookupCache]);

  const resolveItemLabel = React.useCallback(async (itemId) => {
    if (!itemEntityId || !itemId || previewMode) return String(itemId || "");
    try {
      const res = await apiFetch(`/records/${itemEntityId}/${itemId}`);
      const itemRecord = res?.record || res || {};
      return itemRecord?.[itemDisplayField] || itemRecord?.id || String(itemId);
    } catch {
      return String(itemId);
    }
  }, [itemDisplayField, itemEntityId, previewMode]);

  const hydrateLookupLabels = React.useCallback(async (nextRows) => {
    const missingEntries = (Array.isArray(nextRows) ? nextRows : [])
      .map((row) => ({
        recordId: row?.record_id,
        itemId: row?.record?.[itemField],
      }))
      .filter(({ recordId, itemId }) => recordId && itemId);
    if (missingEntries.length === 0) return;
    const unresolved = missingEntries.filter(({ recordId }) => !lookupCacheRef.current[recordId]);
    if (unresolved.length === 0) return;
    const resolvedPairs = await Promise.all(
      unresolved.map(async ({ recordId, itemId }) => [recordId, await resolveItemLabel(itemId)])
    );
    setLookupCache((prev) => {
      const next = { ...prev };
      for (const [recordId, label] of resolvedPairs) {
        if (recordId && label) next[recordId] = label;
      }
      return next;
    });
  }, [itemField, resolveItemLabel]);

  const buildRowPayload = React.useCallback((rowRecord, overrides = {}) => {
    const nextRecord = { ...(rowRecord || {}), ...(overrides || {}) };
    const fieldIds = new Set([
      parentField,
      itemField,
      descriptionField,
      ...Object.keys(defaults || {}),
      ...Object.keys(itemFieldMap || {}),
      ...Object.keys(parentFieldMap || {}),
      ...columns.map((column) => column?.field_id).filter(Boolean),
    ]);
    const payload = {};
    for (const fieldId of fieldIds) {
      if (!fieldId) continue;
      if (fieldId === parentField) {
        payload[fieldId] = nextRecord[fieldId] ?? parentRecordId;
        continue;
      }
      if (fieldId.endsWith(".line_total")) continue;
      const parentSourceField = parentFieldMap?.[fieldId];
      if (
        typeof parentSourceField === "string" &&
        !Object.prototype.hasOwnProperty.call(nextRecord, fieldId)
      ) {
        const mapped = parentRecord?.[parentSourceField];
        if (mapped !== undefined && mapped !== null && mapped !== "") {
          payload[fieldId] = mapped;
          continue;
        }
      }
      if (Object.prototype.hasOwnProperty.call(nextRecord, fieldId)) {
        payload[fieldId] = nextRecord[fieldId];
      }
    }
    return payload;
  }, [columns, defaults, descriptionField, itemField, itemFieldMap, parentFieldMap, parentField, parentRecord, parentRecordId]);

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
            ...columns.map((c) => c?.currency_field).filter(Boolean),
            itemField,
            descriptionField,
            ...Object.keys(parentFieldMap || {}),
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
      void hydrateLookupLabels(next);
    } catch (err) {
      setError(err?.message || "Failed to load line items.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [childEntityId, parentField, parentRecordId, previewMode, columns, itemField, descriptionField, parentFieldMap, hydrateLookupLabels]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  async function patchRow(recordId, fieldId, rawValue, type) {
    const value = coerceEditorValue(rawValue, type);
    const currentRow = rows.find((row) => row.record_id === recordId);
    const beforeValue = currentRow?.record?.[fieldId];
    if (beforeValue === value) return;
    const nextRecord = { ...(currentRow?.record || {}), [fieldId]: value };
    setRows((prev) =>
      prev.map((row) =>
        row.record_id === recordId
          ? { ...row, record: { ...row.record, [fieldId]: value } }
          : row
      )
    );
    try {
      const updated = await updateRecord(childEntityId, recordId, buildRowPayload(nextRecord));
      const updatedRecord = updated?.record && typeof updated.record === "object" ? updated.record : nextRecord;
      setRows((prev) =>
        prev.map((row) =>
          row.record_id === recordId ? { ...row, record: updatedRecord } : row
        )
      );
      const column = columns.find((col) => col?.field_id === fieldId);
      await addParentActivity(`Line item updated: ${rowLabel(currentRow)} (${column?.label || fieldId}).`);
      await onRefreshParent?.();
    } catch {
      fetchRows();
    }
  }

  async function deleteRow(recordId) {
    if (!recordId || deletingRowId) return;
    setDeletingRowId(recordId);
    try {
      const currentRow = rows.find((row) => row.record_id === recordId);
      await deleteRecord(childEntityId, recordId);
      setRows((prev) => prev.filter((row) => row.record_id !== recordId));
      setPendingDeleteRow(null);
      await addParentActivity(`Line item removed: ${rowLabel(currentRow)}.`);
      await onRefreshParent?.();
    } catch {
      fetchRows();
    } finally {
      setDeletingRowId("");
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
    for (const [targetField, sourceField] of Object.entries(parentFieldMap || {})) {
      if (typeof targetField !== "string" || typeof sourceField !== "string") continue;
      const mapped = parentRecord?.[sourceField];
      if (mapped !== undefined && mapped !== null && mapped !== "") {
        payload[targetField] = mapped;
      }
    }
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
      const created = await createRecord(childEntityId, payload);
      const createdId = created?.record_id;
      const createdRecord = created?.record && typeof created.record === "object"
        ? created.record
        : { ...payload, id: createdId || payload.id };
      if (createdId) {
        setRows((prev) => {
          if (prev.some((row) => row.record_id === createdId)) return prev;
          return [...prev, { record_id: createdId, record: createdRecord }];
        });
        setLookupCache((prev) => ({ ...prev, [createdId]: option.label || option.value }));
      }
      setAddLookupResetKey((prev) => prev + 1);
      await addParentActivity(`Line item added: ${option.label || option.value}.`);
      await onRefreshParent?.();
    } catch (err) {
      setError(err?.message || "Failed to add line item.");
    }
  }

  async function createInlineCustomLine() {
    if (!parentRecordId || creatingCustomLine) return;
    const description = "Custom line";
    const payload = {
      ...defaults,
      ...customLineDefaults,
      [parentField]: parentRecordId,
      ...(descriptionField ? { [descriptionField]: description } : {}),
    };
    for (const [targetField, sourceField] of Object.entries(parentFieldMap || {})) {
      if (typeof targetField !== "string" || typeof sourceField !== "string") continue;
      const mapped = parentRecord?.[sourceField];
      if (mapped !== undefined && mapped !== null && mapped !== "") {
        payload[targetField] = mapped;
      }
    }
    if (quantityColumn?.field_id) {
      payload[quantityColumn.field_id] = coerceEditorValue(defaults?.[quantityColumn.field_id], "number") ?? 1;
    }
    if (uomColumn?.field_id) {
      payload[uomColumn.field_id] = defaults?.[uomColumn.field_id] || "EA";
    }
    if (unitAmountColumn?.field_id) {
      payload[unitAmountColumn.field_id] = coerceEditorValue(defaults?.[unitAmountColumn.field_id], "number") ?? 0;
    }
    setCreatingCustomLine(true);
    try {
      const created = await createRecord(childEntityId, payload);
      const createdId = created?.record_id;
      const createdRecord = created?.record && typeof created.record === "object"
        ? created.record
        : { ...payload, id: createdId || payload.id };
      if (createdId) {
        setRows((prev) => {
          if (prev.some((row) => row.record_id === createdId)) return prev;
          return [...prev, { record_id: createdId, record: createdRecord }];
        });
      }
      setAddLookupResetKey((prev) => prev + 1);
      await addParentActivity(`Custom line item added: ${description}.`);
      await onRefreshParent?.();
    } catch (err) {
      setError(err?.message || "Failed to add custom line.");
    } finally {
      setCreatingCustomLine(false);
    }
  }

  if (!childEntityId || !parentField || !itemField || !itemEntityId) {
    return <div className="text-sm text-error">Line editor is missing configuration.</div>;
  }

  if (!parentRecordId) {
    return <div className="text-sm opacity-70">Save this record first, then add line items.</div>;
  }

  function columnWeight(col) {
    const width = col?.width ?? col?.min_width ?? col?.minWidth;
    if (typeof width === "number" && Number.isFinite(width)) return width;
    if (typeof width === "string") {
      const parsed = Number.parseFloat(width);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 180;
  }

  const actionColumnWeight = readonly ? 0 : 72;
  const totalColumnWeight = columns.reduce((total, col) => total + columnWeight(col), actionColumnWeight) || 1;
  const actionColumnStyle = { width: `${(actionColumnWeight / totalColumnWeight) * 100}%` };
  const mobileTableMinWidth = Math.max(totalColumnWeight, 720);

  function columnStyle(col) {
    return { width: `${(columnWeight(col) / totalColumnWeight) * 100}%` };
  }

  function readOnlyCell(raw, col, rowRecord = null) {
    const pseudoField =
      col?.type === "number"
        ? {
            type: "number",
            format: col?.format || (col?.currency_field ? { kind: "currency", currency_field: col.currency_field, precision: col.precision ?? 2 } : null),
          }
        : null;
    const display = pseudoField ? formatFieldValue(pseudoField, raw, rowRecord) : String(raw ?? "");
    return (
      <div className={`min-h-8 flex items-center gap-2 ${col?.align === "right" ? "justify-end text-right" : ""}`}>
        <span className={col?.type === "number" ? "tabular-nums" : ""}>{display}</span>
      </div>
    );
  }

  return (
    <div className="h-full min-h-[520px] rounded-box border border-base-300 bg-base-100 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-auto">
        <table
          className={`table table-sm [&_td]:px-2 [&_th]:px-2 ${isMobile ? "w-max min-w-full table-auto" : "table-fixed w-full"}`}
          style={isMobile ? { minWidth: `${mobileTableMinWidth}px` } : undefined}
        >
          <colgroup>
            {columns.map((col, index) => (
              <col key={`col-${col.field_id || col.label || index}`} style={columnStyle(col)} />
            ))}
            {!readonly ? <col style={actionColumnStyle} /> : null}
          </colgroup>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.field_id || col.label} style={columnStyle(col)} className={col.align === "right" ? "text-right" : ""}>
                  {col.label || col.field_id}
                </th>
              ))}
              {!readonly ? <th style={actionColumnStyle}><span className="sr-only">Actions</span></th> : null}
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
                    const isCustomLine = !raw;
                    const label = isCustomLine ? "Custom" : lookupCache[row.record_id] || row.record?.[descriptionField] || raw || "";
                    if (readonly || col.readonly) {
                      return (
                        <td key={`${row.record_id}-${fieldId}`} style={columnStyle(col)}>
                          {isCustomLine ? <span className="badge badge-outline badge-sm">Custom</span> : label}
                        </td>
                      );
                    }
                    return (
                      <td key={`${row.record_id}-${fieldId}`} style={columnStyle(col)}>
                        <LookupField
                          field={{
                            id: fieldId,
                            label: col.label || "Item",
                            type: "lookup",
                            entity: itemEntityId,
                            display_field: itemDisplayField,
                            placeholder: "Search items...",
                          }}
                          value={raw || null}
                          onChange={async (nextItemId) => {
                            if (!nextItemId) return;
                            let itemRecord = null;
                            try {
                              const itemRes = await apiFetch(`/records/${itemEntityId}/${nextItemId}`);
                              itemRecord = itemRes?.record || itemRes || null;
                            } catch {
                              itemRecord = null;
                            }
                            const mappedValues = {};
                            for (const [targetField, sourceField] of Object.entries(itemFieldMap || {})) {
                              if (!itemRecord || typeof targetField !== "string" || typeof sourceField !== "string") continue;
                              const mapped = itemRecord[sourceField];
                              if (mapped !== undefined && mapped !== null && mapped !== "") {
                                mappedValues[targetField] = mapped;
                              }
                            }
                            const nextRecord = {
                              ...row.record,
                              ...mappedValues,
                              [itemField]: nextItemId,
                            };
                            if (descriptionField && !mappedValues[descriptionField] && itemRecord?.[itemDisplayField]) {
                              nextRecord[descriptionField] = itemRecord[itemDisplayField];
                            }
                            setRows((prev) =>
                              prev.map((current) =>
                                current.record_id === row.record_id ? { ...current, record: nextRecord } : current
                              )
                            );
                            try {
                              const updated = await updateRecord(childEntityId, row.record_id, buildRowPayload(nextRecord));
                              const updatedRecord = updated?.record && typeof updated.record === "object" ? updated.record : nextRecord;
                              const nextLabel = await resolveItemLabel(nextItemId);
                              setRows((prev) =>
                                prev.map((current) =>
                                  current.record_id === row.record_id ? { ...current, record: updatedRecord } : current
                                )
                              );
                              setLookupCache((prev) => ({ ...prev, [row.record_id]: nextLabel }));
                              await addParentActivity(`Line item changed: ${rowLabel(row)} -> ${nextLabel || nextItemId}.`);
                              await onRefreshParent?.();
                            } catch {
                              fetchRows();
                            }
                          }}
                          readonly={readonly || col.readonly}
                          record={row.record}
                          previewMode={previewMode}
                          canCreate={canCreateLookup}
                          onCreate={onLookupCreate}
                        />
                      </td>
                    );
                  }
                  if (readonly || col.readonly) {
                    return <td key={`${row.record_id}-${fieldId}`} style={columnStyle(col)}>{readOnlyCell(raw, col, row.record)}</td>;
                  }
                  if (col.type === "enum" && Array.isArray(col.options)) {
                    return (
                      <td key={`${row.record_id}-${fieldId}`} style={columnStyle(col)}>
                        <select
                          className="select select-bordered select-xs w-full"
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
                            void patchRow(row.record_id, fieldId, next, col.type);
                          }}
                        >
                          <option value="">Select...</option>
                          {col.options.map((option) => (
                            <option key={option.value ?? option.label} value={option.value ?? ""}>
                              {option.label ?? option.value}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  }
                  if (col.type === "number") {
                    const pseudoField = {
                      type: "number",
                      format: col?.format || (col?.currency_field ? { kind: "currency", currency_field: col.currency_field, precision: col.precision ?? 2 } : null),
                    };
                    const { prefix, suffix, align } = getFieldInputAffixes(pseudoField, row.record);
                    const leftPad = prefix ? `${Math.max(3.2, prefix.length * 0.6 + 1.4)}rem` : undefined;
                    const rightPad = suffix ? `${Math.max(3.2, suffix.length * 0.6 + 1.4)}rem` : undefined;
                    return (
                      <td key={`${row.record_id}-${fieldId}`} style={columnStyle(col)}>
                        <div className="relative">
                          {prefix ? (
                            <span className="absolute left-2 top-1/2 z-10 -translate-y-1/2 text-xs text-base-content/60 pointer-events-none">
                              {prefix}
                            </span>
                          ) : null}
                          <input
                            className={`input input-bordered input-xs w-full min-w-0 ${align || ""} tabular-nums [appearance:textfield]`.trim()}
                            type="text"
                            inputMode="decimal"
                            style={{
                              appearance: "textfield",
                              MozAppearance: "textfield",
                              paddingLeft: leftPad,
                              paddingRight: rightPad,
                            }}
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
                          {suffix ? (
                            <span className="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-xs text-base-content/60 pointer-events-none">
                              {suffix}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td key={`${row.record_id}-${fieldId}`} style={columnStyle(col)}>
                      <input
                        className={`input input-bordered input-xs w-full min-w-0 ${col.align === "right" ? "text-right tabular-nums" : ""}`}
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
                  <td className="text-right" style={actionColumnStyle}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error"
                      onClick={() => setPendingDeleteRow(row)}
                      aria-label="Delete line item"
                      title="Delete line item"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          {!readonly && (
            <tfoot>
              <tr>
                <td colSpan={columns.length + 1} className="bg-base-100">
                  <LookupField
                    key={addLookupResetKey}
                    field={addLookupField}
                    value={null}
                    onChange={async (nextItemId) => {
                      if (!nextItemId) return;
                      const nextLabel = await resolveItemLabel(nextItemId);
                      await addRowFromOption({ value: nextItemId, label: nextLabel || nextItemId });
                    }}
                    readonly={readonly}
                    record={parentRecord}
                    previewMode={previewMode}
                    canCreate={canCreateLookup}
                    onCreate={onLookupCreate}
                      extraActions={[
                        {
                          label: creatingCustomLine ? "Adding custom line..." : "New custom line",
                          help: "Add freight, service, discount, or one-off item without creating a product.",
                          onClick: createInlineCustomLine,
                        },
                      ]}
                    />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {error ? <div className="shrink-0 px-3 py-2 text-xs text-error border-t border-base-300">{error}</div> : null}
      {pendingDeleteRow ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-semibold text-base">Delete line item?</h3>
            <p className="mt-2 text-sm opacity-70">
              This will remove{" "}
              <span className="font-medium">
                {lookupCache[pendingDeleteRow.record_id]
                  || pendingDeleteRow.record?.[descriptionField]
                  || pendingDeleteRow.record?.[itemField]
                  || "this line item"}
              </span>
              .
            </p>
            <div className="modal-action">
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => setPendingDeleteRow(null)}
                disabled={!!deletingRowId}
              >
                Cancel
              </button>
              <button
                className="btn btn-sm btn-error"
                type="button"
                onClick={() => deleteRow(pendingDeleteRow.record_id)}
                disabled={!!deletingRowId}
              >
                {deletingRowId ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => setPendingDeleteRow(null)}>
            close
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StatusBar({ field, value }) {
  if (!field || !Array.isArray(field.options)) return null;
  return (
    <div className="w-full overflow-x-auto md:overflow-visible no-scrollbar">
      <ul className="steps steps-horizontal w-full min-w-max md:min-w-0">
        {field.options.map((opt) => {
          const isActive = value === opt.value;
          return (
            <li key={opt.value} className={`step whitespace-nowrap text-xs sm:text-sm ${isActive ? "step-primary" : ""}`}>
              {opt.label ?? opt.value}
            </li>
          );
        })}
      </ul>
    </div>
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

function normalizeMembers(members) {
  if (!Array.isArray(members)) return [];
  return members
    .map((member) => {
      const userId = String(member?.user_id || "").trim();
      if (!userId) return null;
      const name = typeof member?.name === "string" ? member.name.trim() : "";
      const email = typeof member?.email === "string" ? member.email.trim() : "";
      const label = name || email || userId;
      return {
        user_id: userId,
        name,
        email,
        label,
        search: `${label} ${email} ${userId}`.toLowerCase(),
      };
    })
    .filter(Boolean);
}

function normalizeUserIds(value) {
  if (Array.isArray(value)) {
    const ids = value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    return Array.from(new Set(ids));
  }
  if (typeof value === "string") {
    const parts = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return Array.from(new Set(parts));
  }
  return [];
}

function WorkspaceUserField({ field, value, onChange, readonly, members, loadingMembers = false }) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);
  const normalizedMembers = useMemo(() => normalizeMembers(members), [members]);
  const selectedId = typeof value === "string" ? value.trim() : "";
  const selected = normalizedMembers.find((member) => member.user_id === selectedId);
  const selectedLabel = selected?.label || selectedId || "";
  const normalizedSearch = (search || "").trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedSearch) return normalizedMembers.slice(0, 50);
    return normalizedMembers.filter((member) => member.search.includes(normalizedSearch)).slice(0, 50);
  }, [normalizedMembers, normalizedSearch]);

  useEffect(() => {
    if (!opened) setSearch("");
  }, [opened]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      setOpened(false);
    }
    if (!opened) return;
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [opened]);

  const displayValue = opened ? search : selectedLabel;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          className="input input-bordered w-full pr-10"
          value={displayValue}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search workspace user..."
          disabled={readonly || field.readonly}
          onFocus={() => {
            setOpened(true);
            setSearch("");
          }}
        />
        <button
          type="button"
          className={`absolute right-3 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center bg-transparent p-0 text-[15px] leading-none text-base-content/65 transition-opacity hover:text-base-content ${
            Boolean(selectedId) && !readonly && !field.readonly ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={() => {
            setSearch("");
            setOpened(false);
            onChange(null);
          }}
          aria-label="Clear selection"
          title="Clear"
          tabIndex={Boolean(selectedId) && !readonly && !field.readonly ? 0 : -1}
        >
          <span className="block leading-none">×</span>
        </button>
      </div>
      {opened && !isMobile && (
        <div className="absolute z-30 mt-1 w-full rounded-box border border-base-400 bg-base-100 shadow">
          <ul className="menu menu-compact menu-vertical w-full max-h-[15rem] overflow-y-auto overflow-x-hidden">
            {loadingMembers && <li className="menu-title"><span>Loading workspace users…</span></li>}
            {!loadingMembers && normalizedMembers.length === 0 && (
              <li className="menu-title"><span>No workspace users found</span></li>
            )}
            {!loadingMembers && normalizedMembers.length > 0 && filtered.length === 0 && (
              <li className="menu-title"><span>No matches</span></li>
            )}
            {!loadingMembers &&
              filtered.map((member) => (
                <li key={member.user_id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(member.user_id);
                      setOpened(false);
                      setSearch("");
                    }}
                    className={member.user_id === selectedId ? "active" : ""}
                  >
                    {member.label}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
      {opened && isMobile && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label="Close workspace user picker"
            onClick={() => setOpened(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[86vh] rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4 flex flex-col">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="px-1 pb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Select workspace user</div>
              <button type="button" className={SOFT_BUTTON_SM} onClick={() => setOpened(false)}>
                Done
              </button>
            </div>
            <input
              className="input input-bordered w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspace user..."
              disabled={readonly || field.readonly}
              autoFocus
            />
            <div className="mt-3 flex-1 min-h-0 overflow-auto">
              <ul className="menu menu-compact">
                {loadingMembers && <li className="menu-title"><span>Loading workspace users…</span></li>}
                {!loadingMembers && normalizedMembers.length === 0 && (
                  <li className="menu-title"><span>No workspace users found</span></li>
                )}
                {!loadingMembers && normalizedMembers.length > 0 && filtered.length === 0 && (
                  <li className="menu-title"><span>No matches</span></li>
                )}
                {!loadingMembers &&
                  filtered.map((member) => (
                    <li key={member.user_id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(member.user_id);
                          setOpened(false);
                          setSearch("");
                        }}
                        className={member.user_id === selectedId ? "active" : ""}
                      >
                        {member.label}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceUsersField({ field, value, onChange, readonly, members, loadingMembers = false }) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);
  const normalizedMembers = useMemo(() => normalizeMembers(members), [members]);
  const selectedIds = useMemo(() => normalizeUserIds(value), [value]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const normalizedSearch = (search || "").trim().toLowerCase();
  const filtered = useMemo(() => {
    const available = normalizedMembers.filter((member) => !selectedSet.has(member.user_id));
    if (!normalizedSearch) return available.slice(0, 50);
    return available.filter((member) => member.search.includes(normalizedSearch)).slice(0, 50);
  }, [normalizedMembers, selectedSet, normalizedSearch]);
  const selectedMembers = useMemo(
    () =>
      selectedIds.map((id) => {
        const member = normalizedMembers.find((row) => row.user_id === id);
        return { user_id: id, label: member?.label || id };
      }),
    [selectedIds, normalizedMembers]
  );

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      setOpened(false);
    }
    if (!opened) return;
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [opened]);

  function addUser(userId) {
    if (!userId) return;
    if (selectedSet.has(userId)) return;
    onChange([...selectedIds, userId]);
    setSearch("");
    setOpened(true);
  }

  function removeUser(userId) {
    onChange(selectedIds.filter((id) => id !== userId));
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`input input-bordered w-full min-h-[3rem] h-auto pr-2 flex flex-wrap gap-1 items-center ${
          readonly || field.readonly ? "opacity-60 pointer-events-none" : ""
        }`}
        onClick={() => {
          if (!readonly && !field.readonly) setOpened(true);
        }}
      >
        {selectedMembers.map((member) => (
          <span key={member.user_id} className="badge badge-outline badge-dismissible">
            {member.label}
            {!readonly && !field.readonly && (
              <button
                type="button"
                className="badge-remove"
                onClick={(event) => {
                  event.stopPropagation();
                  removeUser(member.user_id);
                }}
                aria-label={`Remove ${member.label}`}
                title={`Remove ${member.label}`}
              >
                ✕
              </button>
            )}
          </span>
        ))}
        <input
          className="flex-1 min-w-[7rem] bg-transparent outline-none"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpened(true);
          }}
          onFocus={() => setOpened(true)}
          placeholder={selectedMembers.length > 0 ? "Add another user..." : "Search workspace users..."}
          disabled={readonly || field.readonly}
        />
      </div>
      {opened && !isMobile && (
        <div className="absolute z-30 mt-1 w-full rounded-box border border-base-400 bg-base-100 shadow">
          <ul className="menu menu-compact menu-vertical w-full max-h-[15rem] overflow-y-auto overflow-x-hidden">
            {loadingMembers && <li className="menu-title"><span>Loading workspace users…</span></li>}
            {!loadingMembers && normalizedMembers.length === 0 && (
              <li className="menu-title"><span>No workspace users found</span></li>
            )}
            {!loadingMembers && normalizedMembers.length > 0 && filtered.length === 0 && (
              <li className="menu-title"><span>No matches</span></li>
            )}
            {!loadingMembers &&
              filtered.map((member) => (
                <li key={member.user_id}>
                  <button type="button" onClick={() => addUser(member.user_id)}>
                    {member.label}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
      {opened && isMobile && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label="Close workspace users picker"
            onClick={() => setOpened(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[86vh] rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4 flex flex-col">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="px-1 pb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Select workspace users</div>
              <button type="button" className={SOFT_BUTTON_SM} onClick={() => setOpened(false)}>
                Done
              </button>
            </div>
            <input
              className="input input-bordered w-full"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpened(true);
              }}
              placeholder={selectedMembers.length > 0 ? "Add another user..." : "Search workspace users..."}
              disabled={readonly || field.readonly}
              autoFocus
            />
            <div className="mt-3 flex-1 min-h-0 overflow-auto">
              <ul className="menu menu-compact">
                {loadingMembers && <li className="menu-title"><span>Loading workspace users…</span></li>}
                {!loadingMembers && normalizedMembers.length === 0 && (
                  <li className="menu-title"><span>No workspace users found</span></li>
                )}
                {!loadingMembers && normalizedMembers.length > 0 && filtered.length === 0 && (
                  <li className="menu-title"><span>No matches</span></li>
                )}
                {!loadingMembers &&
                  filtered.map((member) => (
                    <li key={member.user_id}>
                      <button type="button" onClick={() => addUser(member.user_id)}>
                        {member.label}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LookupField({ field, value, onChange, readonly, record, previewMode = false, onCreate, canCreate, extraActions = [] }) {
  const isMobile = useMediaQuery("(max-width: 768px)");
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
  const placeholder = field?.search_placeholder || field?.placeholder || "Search...";
  const recordContext = useMemo(() => buildRecordContext(field?.domain || null, record), [field?.domain, record]);
  const recordContextKey = useMemo(() => JSON.stringify(recordContext), [recordContext]);
  const visibleExtraActions = Array.isArray(extraActions)
    ? extraActions.filter((action) => action && typeof action.onClick === "function")
    : [];

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      if (!entityId) return;
      if (previewMode) return;
      if (!opened) return;
      const trimmed = (debouncedSearch || "").trim();
      const requestKey = JSON.stringify({
        entityId,
        fieldId: field?.id || null,
        q: trimmed || null,
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
            q: trimmed || null,
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

  function handleExtraAction(action) {
    setOpened(false);
    setSearch(selectedLabel || "");
    action.onClick();
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
          placeholder={placeholder}
          disabled={readonly || field.readonly}
          onFocus={() => {
            setOpened(true);
            setSearch("");
          }}
        />
        <button
          type="button"
          className={`absolute right-3 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center bg-transparent p-0 text-[15px] leading-none text-base-content/65 transition-opacity hover:text-base-content ${
            Boolean(value) && !readonly && !field.readonly ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={() => {
            setSearch("");
            setSelectedLabel("");
            onChange(null);
          }}
          aria-label="Clear selection"
          title="Clear"
          tabIndex={Boolean(value) && !readonly && !field.readonly ? 0 : -1}
        >
          <span className="block leading-none">×</span>
        </button>
      </div>
      {showOptions && !isMobile && (
        <div className="absolute z-30 mt-1 flex max-h-[18rem] w-full flex-col overflow-hidden rounded-box border border-base-400 bg-base-100 shadow">
          <ul className="menu menu-compact menu-vertical block w-full flex-1 overflow-y-auto overflow-x-hidden whitespace-normal">
            {loading && <li className="menu-title"><span>Loading…</span></li>}
            {!loading && options.length === 0 && (
              <li className="menu-title"><span>{search.trim() ? "No results" : "No records found"}</span></li>
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
          </ul>
          {allowCreate && (
            <div className="shrink-0 border-t border-base-400 p-1">
              <ul className="menu menu-compact menu-vertical block w-full">
                <li>
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
              </ul>
            </div>
          )}
          {visibleExtraActions.length > 0 && (
            <div className="shrink-0 border-t border-base-400 p-1">
              <ul className="menu menu-compact menu-vertical block w-full">
                {visibleExtraActions.map((action) => (
                  <li key={action.label || "custom-action"}>
                    <button type="button" onClick={() => handleExtraAction(action)}>
                      <span className="flex flex-col items-start gap-0.5">
                        <span>{action.label || "New custom line"}</span>
                        {action.help ? <span className="text-xs font-normal opacity-60">{action.help}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {showOptions && isMobile && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label="Close lookup picker"
            onClick={() => setOpened(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[86vh] rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4 flex flex-col">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="px-1 pb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{field.label || "Select record"}</div>
              <button type="button" className={SOFT_BUTTON_SM} onClick={() => setOpened(false)}>
                Done
              </button>
            </div>
            <input
              className="input input-bordered w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              disabled={readonly || field.readonly}
              autoFocus
            />
            <div className="mt-3 flex-1 min-h-0 overflow-auto">
              <ul className="menu menu-compact">
                {loading && <li className="menu-title"><span>Loading…</span></li>}
                {!loading && options.length === 0 && (
                  <li className="menu-title"><span>{search.trim() ? "No results" : "No records found"}</span></li>
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
                          setOpened(false);
                        }
                      }}
                    >
                      + Create new
                    </button>
                  </li>
                )}
                {visibleExtraActions.map((action, index) => (
                  <li key={action.label || `extra-${index}`} className={index === 0 ? "border-t border-base-400 mt-1 pt-1" : ""}>
                    <button type="button" onClick={() => handleExtraAction(action)}>
                      <span className="flex flex-col items-start gap-0.5">
                        <span>{action.label || "New custom line"}</span>
                        {action.help ? <span className="text-xs font-normal opacity-60">{action.help}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      {field.disabled_hint && <div className="text-xs opacity-60 mt-1">{field.disabled_hint}</div>}
    </div>
  );
}
