import React from "react";

export default function StudioHeader({
  title,
  chips,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  onSaveDraft,
  saveDisabled,
  onValidate,
  onPreview,
  onDiscardDraft,
  onRollback,
  onDelete,
  onExport,
  onCopyId,
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-2xl font-semibold">{title}</div>
        <div className="mt-1 flex flex-wrap gap-2">
          {(chips || []).map((chip) => (
            <span key={chip.label} className={`badge ${chip.tone || "badge-outline"}`}>
              {chip.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={onPrimary} disabled={primaryDisabled}>
          {primaryLabel}
        </button>
        <div className="dropdown dropdown-end">
          <button className="btn btn-ghost">More</button>
          <ul className="menu dropdown-content z-[1000] p-2 shadow bg-base-100 rounded-box w-56 text-sm">
            <li><button onClick={onSaveDraft} disabled={saveDisabled}>Save Draft</button></li>
            <li><button onClick={onValidate}>Validate</button></li>
            <li><button onClick={onPreview}>Preview</button></li>
            {onDiscardDraft && <li><button onClick={onDiscardDraft}>Discard Draft</button></li>}
            {onRollback && <li><button onClick={onRollback}>Rollback</button></li>}
            <li><button onClick={onExport}>Export manifest</button></li>
            <li><button onClick={onCopyId}>Copy module id</button></li>
            {onDelete && <li><button className="text-error" onClick={onDelete}>Delete Module</button></li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
