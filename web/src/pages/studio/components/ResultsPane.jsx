import React from "react";

export default function ResultsPane({ validate, logEntries }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold">Validate</div>
        {validate?.ts && <div className="text-xs opacity-70">{validate.ts}</div>}
        {(validate?.errors || []).length === 0 && (validate?.warnings || []).length === 0 && (
          <div className="text-sm opacity-60">No validation issues.</div>
        )}
        {(validate?.errors || []).map((e, idx) => (
          <div key={`err-${idx}`} className="text-xs text-error">
            {e.code} — {e.message}{e.path ? ` (${e.path})` : ""}
          </div>
        ))}
        {(validate?.warnings || []).map((e, idx) => (
          <div key={`warn-${idx}`} className="text-xs text-warning">
            {e.code} — {e.message}{e.path ? ` (${e.path})` : ""}
          </div>
        ))}
      </div>
      <div>
        <div className="text-sm font-semibold">Logs</div>
        <div className="mt-2 space-y-2">
          {logEntries.length === 0 && <div className="text-sm opacity-60">No actions yet.</div>}
          {logEntries.map((entry, idx) => (
            <div key={idx} className="text-xs">
              <span className="font-mono">{entry.ts}</span> — {entry.action} [{entry.status}]
              {entry.detail ? <span className="opacity-70"> — {entry.detail}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
