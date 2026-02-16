import React from "react";
import Tabs from "../../../components/Tabs.jsx";

export default function WorkspaceTabs({ tabs, activeId, onChange, pipeline }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Tabs tabs={tabs} activeId={activeId} onChange={onChange} />
      <div className="text-xs opacity-70">
        Validate: {pipeline.validate} · Preview: {pipeline.preview} · Apply: {pipeline.apply}
      </div>
    </div>
  );
}
