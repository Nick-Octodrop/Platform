function titleCase(text) {
  return text
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((t) => t[0].toUpperCase() + t.slice(1))
    .join(" ");
}

export function getAppDisplayName(moduleId, moduleRecord) {
  if (moduleRecord?.name) return moduleRecord.name;
  return titleCase(moduleId);
}
