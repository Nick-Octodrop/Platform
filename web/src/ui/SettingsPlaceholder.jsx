import React from "react";

export default function SettingsPlaceholder({ title, description }) {
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title">{title}</h2>
        <div className="text-sm opacity-70">{description}</div>
        <div className="text-sm opacity-60 mt-2">This section is not wired yet.</div>
      </div>
    </div>
  );
}
