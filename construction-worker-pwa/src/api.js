import { supabase } from "./supabase.js";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").trim();
const WORKSPACE_ID = (import.meta.env.VITE_WORKSPACE_ID || "").trim();
const ACTIVE_WORKSPACE_STORAGE_KEY = "octo_active_workspace_id";
const TAB_WORKSPACE_STORAGE_KEY = "octo_tab_workspace_id";

export function getActiveWorkspaceId() {
  if (typeof window === "undefined") {
    return WORKSPACE_ID;
  }
  try {
    const tabWorkspaceId = window.sessionStorage.getItem(TAB_WORKSPACE_STORAGE_KEY) || "";
    if (tabWorkspaceId) return tabWorkspaceId;
  } catch {
    // ignore
  }
  try {
    const activeWorkspaceId = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || "";
    if (activeWorkspaceId) return activeWorkspaceId;
  } catch {
    // ignore
  }
  return WORKSPACE_ID;
}

async function authHeaders() {
  const session = (await supabase.auth.getSession()).data.session;
  const headers = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) {
    headers["X-Workspace-Id"] = workspaceId;
  }
  return headers;
}

export async function apiFetch(path, options = {}) {
  const headers = {
    ...(await authHeaders()),
    ...(options.headers || {}),
  };
  const body =
    typeof options.body === "string" ? options.body : options.body ? JSON.stringify(options.body) : undefined;
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.errors?.[0]?.message || data?.message || "Request failed";
    throw new Error(message);
  }
  return data;
}

export async function getProjects() {
  const domain = encodeURIComponent(
    JSON.stringify({
      op: "in",
      field: "construction_project.status",
      value: ["planned", "active", "on_hold"],
    }),
  );
  const fields = encodeURIComponent(
    [
      "construction_project.name",
      "construction_project.code",
      "construction_project.status",
      "construction_project.site_location",
      "construction_project.site_id",
    ].join(","),
  );
  const data = await apiFetch(`/records/entity.construction_project?limit=100&fields=${fields}&domain=${domain}`);
  return Array.isArray(data?.records) ? data.records : [];
}

export async function getWorkerAssignments(workerRecordId) {
  if (!workerRecordId) return [];
  const domain = encodeURIComponent(
    JSON.stringify({
      op: "and",
      conditions: [
        {
          op: "eq",
          field: "construction_worker_assignment.worker_id",
          value: workerRecordId,
        },
        {
          op: "eq",
          field: "construction_worker_assignment.active",
          value: true,
        },
      ],
    }),
  );
  const fields = encodeURIComponent(
    [
      "construction_worker_assignment.worker_id",
      "construction_worker_assignment.project_id",
      "construction_worker_assignment.site_id",
      "construction_worker_assignment.assignment_role",
      "construction_worker_assignment.start_date",
      "construction_worker_assignment.end_date",
      "construction_worker_assignment.active",
    ].join(","),
  );
  const data = await apiFetch(
    `/records/entity.construction_worker_assignment?limit=100&fields=${fields}&domain=${domain}`,
  );
  return Array.isArray(data?.records) ? data.records : [];
}

export async function findWorkerForUser(userId) {
  const domain = encodeURIComponent(
    JSON.stringify({
      op: "and",
      conditions: [
        {
          op: "eq",
          field: "construction_worker.portal_user_id",
          value: userId,
        },
        {
          op: "eq",
          field: "construction_worker.active",
          value: true,
        },
      ],
    }),
  );
  const fields = encodeURIComponent(
    [
      "construction_worker.full_name",
      "construction_worker.worker_code",
      "construction_worker.role",
      "construction_worker.crew_id",
      "construction_worker.crew_name",
      "construction_worker.portal_user_id",
      "construction_worker.active",
      "construction_worker.default_project_id",
      "construction_worker.default_site_id",
    ].join(","),
  );
  const data = await apiFetch(`/records/entity.construction_worker?limit=1&fields=${fields}&domain=${domain}`);
  return Array.isArray(data?.records) && data.records.length ? data.records[0] : null;
}

export async function findOpenTimeEntry(workerRecordId) {
  const domain = encodeURIComponent(
    JSON.stringify({
      op: "and",
      conditions: [
        {
          op: "eq",
          field: "time_entry.worker_id",
          value: workerRecordId,
        },
        {
          op: "eq",
          field: "time_entry.status",
          value: "open",
        },
      ],
    }),
  );
  const fields = encodeURIComponent(
    [
      "time_entry.project_id",
      "time_entry.entry_date",
      "time_entry.check_in_at",
      "time_entry.status",
    ].join(","),
  );
  const data = await apiFetch(`/records/entity.time_entry?limit=1&fields=${fields}&domain=${domain}`);
  return Array.isArray(data?.records) && data.records.length ? data.records[0] : null;
}

export async function createTimeEntry(record) {
  return apiFetch("/records/entity.time_entry", {
    method: "POST",
    body: { record },
  });
}

export async function updateTimeEntry(recordId, record) {
  return apiFetch(`/records/entity.time_entry/${recordId}`, {
    method: "PUT",
    body: { record },
  });
}

export async function createMaterialLog(record) {
  return apiFetch("/records/entity.material_log", {
    method: "POST",
    body: { record },
  });
}

export async function updateMaterialLog(recordId, record) {
  return apiFetch(`/records/entity.material_log/${recordId}`, {
    method: "PUT",
    body: { record },
  });
}

export async function deleteMaterialLog(recordId) {
  return apiFetch(`/records/entity.material_log/${recordId}`, {
    method: "DELETE",
  });
}

export async function getProjectMaterialLogs(projectId) {
  if (!projectId) return [];
  const domain = encodeURIComponent(
    JSON.stringify({
      op: "eq",
      field: "material_log.project_id",
      value: projectId,
    }),
  );
  const fields = encodeURIComponent(
    [
      "material_log.material_type",
      "material_log.quantity",
      "material_log.unit",
      "material_log.log_date",
      "material_log.created_at",
    ].join(","),
  );
  const sort = encodeURIComponent("-material_log.created_at");
  const data = await apiFetch(
    `/records/entity.material_log?limit=20&fields=${fields}&domain=${domain}&sort=${sort}`,
  );
  return Array.isArray(data?.records) ? data.records : [];
}

export async function getUiPrefs() {
  return apiFetch("/prefs/ui");
}

export async function getTodaySummary(workerRecordId) {
  const date = todayDate();
  const timeDomain = encodeURIComponent(
    JSON.stringify({
      op: "and",
      conditions: [
        {
          op: "eq",
          field: "time_entry.worker_id",
          value: workerRecordId,
        },
        {
          op: "eq",
          field: "time_entry.entry_date",
          value: date,
        },
      ],
    }),
  );
  const materialDomain = encodeURIComponent(
    JSON.stringify({
      op: "and",
      conditions: [
        {
          op: "eq",
          field: "material_log.entered_by_worker_id",
          value: workerRecordId,
        },
        {
          op: "eq",
          field: "material_log.log_date",
          value: date,
        },
      ],
    }),
  );
  const [timeData, materialData] = await Promise.all([
    apiFetch(`/records/entity.time_entry?limit=100&fields=${encodeURIComponent("time_entry.hours_worked")}&domain=${timeDomain}`),
    apiFetch(`/records/entity.material_log?limit=100&fields=${encodeURIComponent("material_log.id")}&domain=${materialDomain}`),
  ]);
  const timeRecords = Array.isArray(timeData?.records) ? timeData.records : [];
  const materialRecords = Array.isArray(materialData?.records) ? materialData.records : [];
  const hoursWorked = Math.round(
    timeRecords.reduce((sum, item) => sum + Number(item?.record?.["time_entry.hours_worked"] || 0), 0) * 100,
  ) / 100;
  return {
    hoursWorked,
    materialEntries: materialRecords.length,
  };
}

export async function getSupervisorSummary() {
  const date = todayDate();
  const openDomain = encodeURIComponent(
    JSON.stringify({
      op: "eq",
      field: "time_entry.status",
      value: "open",
    }),
  );
  const materialDomain = encodeURIComponent(
    JSON.stringify({
      op: "eq",
      field: "material_log.log_date",
      value: date,
    }),
  );
  const pendingMaterialsDomain = encodeURIComponent(
    JSON.stringify({
      op: "eq",
      field: "material_log.status",
      value: "submitted",
    }),
  );
  const [openEntries, materialsToday, pendingMaterials] = await Promise.all([
    apiFetch(`/records/entity.time_entry?limit=100&fields=${encodeURIComponent("time_entry.id")}&domain=${openDomain}`),
    apiFetch(`/records/entity.material_log?limit=100&fields=${encodeURIComponent("material_log.id")}&domain=${materialDomain}`),
    apiFetch(`/records/entity.material_log?limit=100&fields=${encodeURIComponent("material_log.id")}&domain=${pendingMaterialsDomain}`),
  ]);
  return {
    attendanceCount: Array.isArray(openEntries?.records) ? openEntries.records.length : 0,
    materialEntries: Array.isArray(materialsToday?.records) ? materialsToday.records.length : 0,
    pendingApprovals: Array.isArray(pendingMaterials?.records) ? pendingMaterials.records.length : 0,
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}
