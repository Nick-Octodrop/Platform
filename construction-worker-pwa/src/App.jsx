import { useEffect, useRef, useState } from "react";
import { ChevronLeft, LogOut, Menu, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "./supabase.js";
import {
  createMaterialLog,
  createTimeEntry,
  deleteMaterialLog,
  findOpenTimeEntry,
  findWorkerForUser,
  getActiveWorkspaceId,
  getProjectMaterialLogs,
  getProjects,
  getWorkerAssignments,
  getUiPrefs,
  nowIso,
  todayDate,
  updateMaterialLog,
  updateTimeEntry,
} from "./api.js";
import { applyBrandColors, applyTheme, getInitialTheme, setBrandColors, setTheme } from "./theme.js";

const SITE_STORAGE_KEY = "construction_worker_pwa:last_project_id";
const INSTALL_HINT_DISMISSED_KEY = "construction_worker_pwa:install_hint_dismissed";
const PRIMARY_COLOR = "#206aff";
const PRIMARY_TEXT = "#ffffff";
const MATERIALS = [
  { value: "cement", label: "Ciment", unit: "bag" },
  { value: "sand", label: "Sable", unit: "m3" },
  { value: "steel", label: "Acier", unit: "kg" },
  { value: "blocks", label: "Blocs", unit: "piece" },
];

const UNITS = [
  { value: "bag", label: "Sac" },
  { value: "kg", label: "kg" },
  { value: "ton", label: "Tonne" },
  { value: "m3", label: "m3" },
  { value: "piece", label: "Unite" },
];

const QUICK_ADD = [1, 5, 10, 20];

function formatElapsed(startValue, tick) {
  if (!startValue) return "00:00:00";
  const start = new Date(startValue).valueOf();
  if (Number.isNaN(start)) return "00:00:00";
  const totalSeconds = Math.max(0, Math.floor((tick - start) / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function defaultUnitForMaterial(materialType) {
  return MATERIALS.find((item) => item.value === materialType)?.unit || "";
}

function unitLabel(unit, quantity = "") {
  const qty = Number(quantity);
  const plural = Number.isFinite(qty) && qty > 1;
  if (unit === "bag") return plural ? "sacs" : "sac";
  if (unit === "piece") return plural ? "unites" : "unite";
  if (unit === "kg") return "kg";
  if (unit === "m3") return "m3";
  if (unit === "ton") return plural ? "tonnes" : "tonne";
  return unit || "";
}

const primarySurfaceStyle = {
  backgroundColor: PRIMARY_COLOR,
  color: PRIMARY_TEXT,
  borderColor: PRIMARY_COLOR,
};

const clockInStyle = {
  backgroundColor: "#22c55e",
  color: "#ffffff",
  borderColor: "#22c55e",
};

const clockOutStyle = {
  backgroundColor: "#ef4444",
  color: "#ffffff",
  borderColor: "#ef4444",
};

const primarySoftStyle = {
  backgroundColor: "#e5e7eb",
  color: "#1f2937",
  borderColor: "#e5e7eb",
};

const neutralChipStyle = {
  backgroundColor: "#e5e7eb",
  color: "#1f2937",
  borderColor: "#e5e7eb",
};

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function isIosDevice() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua);
}

function isSafariBrowser() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/i.test(ua);
}

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [workerContextLoading, setWorkerContextLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [worker, setWorker] = useState(null);
  const [projects, setProjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [openEntry, setOpenEntry] = useState(null);
  const [materialLogs, setMaterialLogs] = useState([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [materialType, setMaterialType] = useState("cement");
  const [materialQty, setMaterialQty] = useState("");
  const [materialUnit, setMaterialUnit] = useState(defaultUnitForMaterial("cement"));
  const [expandedMaterialId, setExpandedMaterialId] = useState("");
  const [editingMaterialId, setEditingMaterialId] = useState("");
  const [timerTick, setTimerTick] = useState(Date.now());
  const [workspaceKey, setWorkspaceKey] = useState(() => getActiveWorkspaceId());
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [installHintDismissed, setInstallHintDismissed] = useState(false);
  const [installPromptVisible, setInstallPromptVisible] = useState(false);
  const [updatePromptVisible, setUpdatePromptVisible] = useState(false);
  const [projectSelectionComplete, setProjectSelectionComplete] = useState(false);

  useEffect(() => {
    applyTheme(getInitialTheme());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setInstallHintDismissed(window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPromptEvent(event);
    }
    function handleInstalled() {
      setInstallPromptEvent(null);
      setInstallPromptVisible(false);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (isStandaloneDisplay() || installHintDismissed) {
      setInstallPromptVisible(false);
      return;
    }
    if (installPromptEvent || (isIosDevice() && isSafariBrowser())) {
      setInstallPromptVisible(true);
    }
  }, [installPromptEvent, installHintDismissed]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function handleUpdateReady() {
      setUpdatePromptVisible(true);
    }
    window.addEventListener("octo:pwa-update-ready", handleUpdateReady);
    return () => {
      window.removeEventListener("octo:pwa-update-ready", handleUpdateReady);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [error, success]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setBooting(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setBooting(false);
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const nextUnit = defaultUnitForMaterial(materialType);
    setMaterialUnit(nextUnit || "bag");
  }, [materialType]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(SITE_STORAGE_KEY) || "";
    if (saved) {
      setSelectedProjectId((current) => current || saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedProjectId) {
      window.localStorage.setItem(SITE_STORAGE_KEY, selectedProjectId);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!openEntry?.record?.["time_entry.check_in_at"]) return undefined;
    setTimerTick(Date.now());
    const interval = window.setInterval(() => {
      setTimerTick(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [openEntry?.record?.["time_entry.check_in_at"]]);

  async function loadWorkerContext(currentSession) {
    const userId = currentSession?.user?.id;
    if (!userId) {
      setWorker(null);
      setProjects([]);
      setAssignments([]);
      setOpenEntry(null);
      setMaterialLogs([]);
      setExpandedMaterialId("");
      setEditingMaterialId("");
      return;
    }

    setWorkerContextLoading(true);
    setLoading(true);
    setError("");
    try {
      const [nextWorker, allProjects] = await Promise.all([findWorkerForUser(userId), getProjects()]);
      if (!nextWorker) {
        setWorker(null);
        setProjects([]);
        setAssignments([]);
        setOpenEntry(null);
        setMaterialLogs([]);
        setExpandedMaterialId("");
        setEditingMaterialId("");
        setError("Aucun compte ouvrier lie.");
        return;
      }

      const nextAssignments = await getWorkerAssignments(nextWorker.record_id);
      const nextOpen = await findOpenTimeEntry(nextWorker.record_id);
      const assignmentProjectIds = Array.from(
        new Set(
          nextAssignments
            .map((assignment) => assignment.record?.["construction_worker_assignment.project_id"])
            .filter(Boolean),
        ),
      );
      const nextProjects = allProjects.filter((project) => assignmentProjectIds.includes(project.record_id));
      const savedProjectId =
        typeof window !== "undefined" ? window.localStorage.getItem(SITE_STORAGE_KEY) || "" : "";
      const nextDefaultProjectId =
        nextOpen?.record?.["time_entry.project_id"] ||
        (savedProjectId && nextProjects.some((project) => project.record_id === savedProjectId) ? savedProjectId : "") ||
        nextProjects[0]?.record_id ||
        "";

      setWorker(nextWorker);
      setProjects(nextProjects);
      setAssignments(nextAssignments);
      setOpenEntry(nextOpen);
      setSelectedProjectId((current) => current || nextDefaultProjectId);
      setProjectSelectionComplete(Boolean(nextOpen) || nextProjects.length <= 1);
    } catch (err) {
      setError(err.message || "Impossible de charger votre profil ouvrier.");
    } finally {
      setLoading(false);
      setWorkerContextLoading(false);
    }
  }

  useEffect(() => {
    if (!session?.user) {
      setWorkerContextLoading(false);
      return;
    }
    loadWorkerContext(session);
  }, [session?.user?.id]);

  useEffect(() => {
    function handleWorkspaceChanged() {
      setWorkspaceKey(getActiveWorkspaceId());
    }
    if (typeof window === "undefined") return undefined;
    window.addEventListener("storage", handleWorkspaceChanged);
    window.addEventListener("octo:workspace-changed", handleWorkspaceChanged);
    return () => {
      window.removeEventListener("storage", handleWorkspaceChanged);
      window.removeEventListener("octo:workspace-changed", handleWorkspaceChanged);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!session?.user) return;
      try {
        const res = await getUiPrefs();
        if (!mounted) return;
        const workspace = res?.workspace || {};
        if (workspace?.colors) {
          setBrandColors(workspace.colors);
          applyBrandColors(workspace.colors);
        }
        const nextTheme = workspace?.theme || getInitialTheme();
        if (nextTheme) {
          setTheme(nextTheme);
        }
      } catch {
        // keep local fallback theme
      }
    })();
    return () => {
      mounted = false;
    };
  }, [session?.user?.id, workspaceKey]);

  const needsSitePicker = projects.length > 1;
  const currentProject =
    projects.find((item) => item.record_id === selectedProjectId) ||
    projects[0] ||
    null;
  const activeProjectId = currentProject?.record_id || "";
  const selectedAssignment =
    assignments.find((item) => item.record?.["construction_worker_assignment.project_id"] === activeProjectId) || null;
  const currentSiteName = currentProject?.record?.["construction_project.name"] || "";
  const activeSiteId =
    selectedAssignment?.record?.["construction_worker_assignment.site_id"] ||
    currentProject?.record?.["construction_project.site_id"] ||
    worker?.record?.["construction_worker.default_site_id"] ||
    "";
  const activeCrewId = worker?.record?.["construction_worker.crew_id"] || "";
  const isClockedIn = Boolean(openEntry);
  const needsProjectSelection = !isClockedIn && needsSitePicker && !projectSelectionComplete;
  const showUnitSelect = materialType === "other";
  const liveTimer = formatElapsed(openEntry?.record?.["time_entry.check_in_at"], timerTick);
  const canGoBack =
    (!isClockedIn && needsSitePicker && (projectSelectionComplete || Boolean(selectedProjectId))) ||
    materialModalOpen;

  useEffect(() => {
    let active = true;
    (async () => {
      if (!activeProjectId) {
        setMaterialLogs([]);
        return;
      }
      try {
        const logs = await getProjectMaterialLogs(activeProjectId);
        if (active) {
          setMaterialLogs(logs);
        }
      } catch {
        if (active) {
          setMaterialLogs([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [activeProjectId]);

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) throw authError;
    } catch (err) {
      setError(err.message || "Connexion impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    setError("");
    try {
      await supabase.auth.signOut();
      setWorker(null);
      setProjects([]);
      setAssignments([]);
      setOpenEntry(null);
      setMaterialLogs([]);
      setExpandedMaterialId("");
      setEditingMaterialId("");
      setSelectedProjectId("");
      setProjectSelectionComplete(false);
      setMenuOpen(false);
      setMaterialModalOpen(false);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(SITE_STORAGE_KEY);
      }
    } catch (err) {
      setError(err.message || "Deconnexion impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function handleClockAction() {
    if (!worker?.record_id) return;
    if (!openEntry && !activeProjectId) {
      setError("Aucun chantier assigne.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      if (openEntry) {
        const before = openEntry.record || {};
        const checkIn = before["time_entry.check_in_at"] ? new Date(before["time_entry.check_in_at"]) : null;
        const checkOut = new Date();
        const hoursWorked =
          checkIn instanceof Date && !Number.isNaN(checkIn.valueOf())
            ? Math.max(0, Math.round((((checkOut - checkIn) / 36e5) || 0) * 100) / 100)
            : undefined;
        await updateTimeEntry(openEntry.record_id, {
          ...before,
          "time_entry.id": openEntry.record_id,
          "time_entry.project_id": before["time_entry.project_id"] || activeProjectId,
          "time_entry.worker_id": before["time_entry.worker_id"] || worker.record_id,
          "time_entry.site_id": before["time_entry.site_id"] || activeSiteId,
          "time_entry.crew_id": before["time_entry.crew_id"] || activeCrewId,
          "time_entry.entry_date": before["time_entry.entry_date"] || todayDate(),
          "time_entry.check_out_at": checkOut.toISOString(),
          "time_entry.hours_worked": hoursWorked,
          "time_entry.status": "closed",
          "time_entry.source": before["time_entry.source"] || "pwa",
        });
        setSuccess("Sortie enregistree.");
      } else {
        await createTimeEntry({
          "time_entry.project_id": activeProjectId,
          "time_entry.worker_id": worker.record_id,
          "time_entry.site_id": activeSiteId,
          "time_entry.crew_id": activeCrewId,
          "time_entry.entry_date": todayDate(),
          "time_entry.check_in_at": nowIso(),
          "time_entry.status": "open",
          "time_entry.source": "pwa",
        });
        setSuccess("Entree enregistree.");
      }
      await loadWorkerContext(session);
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer.");
    } finally {
      setLoading(false);
    }
  }

  function handleQuickAdd(amount) {
    const current = Number(materialQty || 0);
    const next = Math.max(0, current + amount);
    setMaterialQty(String(next));
  }

  async function handleMaterialSubmit(event) {
    event.preventDefault();
    if (!worker?.record_id) return;
    if (!activeProjectId) {
      setError("Aucun chantier assigne.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const quantity = Number(materialQty);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Saisissez une quantite.");
      }
      const record = {
        "material_log.project_id": activeProjectId,
        "material_log.site_id": activeSiteId,
        "material_log.log_date": todayDate(),
        "material_log.material_type": materialType,
        "material_log.quantity": quantity,
        "material_log.unit": materialUnit,
        "material_log.entered_by_worker_id": worker.record_id,
        "material_log.status": "submitted",
      };
      if (editingMaterialId) {
        await updateMaterialLog(editingMaterialId, {
          ...record,
          "material_log.id": editingMaterialId,
        });
        setSuccess("Materiau mis a jour.");
      } else {
        await createMaterialLog(record);
        setSuccess("Materiau ajoute.");
      }
      setMaterialQty("");
      setMaterialType("cement");
      setMaterialUnit(defaultUnitForMaterial("cement"));
      setEditingMaterialId("");
      setMaterialModalOpen(false);
      setMaterialLogs(await getProjectMaterialLogs(activeProjectId));
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer.");
    } finally {
      setLoading(false);
    }
  }

  function formatMaterialTimestamp(log) {
    const createdAt = log.record?.["material_log.created_at"];
    if (createdAt) {
      const date = new Date(createdAt);
      if (!Number.isNaN(date.valueOf())) {
        return {
          date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date),
          time: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date),
        };
      }
    }
    const logDate = log.record?.["material_log.log_date"];
    if (!logDate) return null;
    const date = new Date(logDate);
    if (Number.isNaN(date.valueOf())) return { date: String(logDate), time: "" };
    return {
      date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date),
      time: "",
    };
  }

  function openMaterialEditor(log) {
    const nextType = log.record?.["material_log.material_type"] || "cement";
    setExpandedMaterialId("");
    setEditingMaterialId(log.record_id);
    setMaterialType(nextType);
    setMaterialQty(String(log.record?.["material_log.quantity"] ?? ""));
    setMaterialUnit(log.record?.["material_log.unit"] || defaultUnitForMaterial(nextType));
    setMaterialModalOpen(true);
  }

  async function handleDeleteMaterial(log) {
    if (!log?.record_id) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await deleteMaterialLog(log.record_id);
      setExpandedMaterialId((current) => (current === log.record_id ? "" : current));
      setSuccess("Materiau supprime.");
      setMaterialLogs(await getProjectMaterialLogs(activeProjectId));
    } catch (err) {
      setError(err.message || "Suppression impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function handleInstallApp() {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => null);
    setInstallPromptEvent(null);
    setInstallPromptVisible(false);
  }

  function dismissInstallHint() {
    setInstallPromptVisible(false);
    setInstallHintDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "1");
    }
  }

  async function handleApplyUpdate() {
    const applyUpdate = typeof window !== "undefined" ? window.__octoPwaApplyUpdate : null;
    if (typeof applyUpdate === "function") {
      await applyUpdate(true);
    } else if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  function handleBackNavigation() {
    if (loading) return;
    if (materialModalOpen) {
      setMaterialModalOpen(false);
      return;
    }
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    if (!isClockedIn && needsSitePicker && projectSelectionComplete) {
      setProjectSelectionComplete(false);
      return;
    }
    if (!isClockedIn && needsSitePicker && selectedProjectId) {
      setSelectedProjectId("");
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(SITE_STORAGE_KEY);
      }
    }
  }

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm items-center justify-center px-5 pb-8 pt-4">
        <form className="w-full space-y-4" onSubmit={handleLogin}>
          <h1 className="text-center text-3xl font-black tracking-tight">Connexion</h1>
          <input
            className="input input-bordered input-lg w-full"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="E-mail"
            required
          />
          <input
            className="input input-bordered input-lg w-full"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Mot de passe"
            required
          />
          <button className="btn btn-lg w-full" style={primarySurfaceStyle} disabled={loading} type="submit">
            {loading ? <span className="loading loading-spinner" /> : "Se connecter"}
          </button>
        </form>
        {(error || success) && <Toast error={error} success={success} />}
      </main>
    );
  }

  if (!worker) {
    if (workerContextLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      );
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 pb-8 pt-10">
        <h1 className="text-3xl font-black tracking-tight">Aucun compte ouvrier</h1>
        <p className="mt-2 text-base text-base-content/70">Contactez votre superviseur.</p>
        <button className="btn btn-ghost mt-6 w-fit px-0 text-sm" disabled={loading} onClick={handleLogout}>
          Se deconnecter
        </button>
        {(error || success) && <Toast error={error} success={success} />}
      </main>
    );
  }

  if (!selectedProjectId && projects.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col px-4 pb-6 pt-4">
        <TopBar
          loading={loading}
          menuOpen={menuOpen}
          onMenuToggle={setMenuOpen}
          onLogout={handleLogout}
          siteName=""
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="space-y-2 text-center">
            <p className="text-4xl font-black tracking-tight">Aucun projet assigne</p>
            <p className="text-base text-base-content/70">Vous n'etes affecte a aucun projet.</p>
          </div>
        </div>
        {(error || success) && <Toast error={error} success={success} />}
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-screen max-w-sm flex-col overflow-hidden px-4 pt-4">
      <div className="shrink-0">
        <TopBar
          loading={loading}
          menuOpen={menuOpen}
          onMenuToggle={setMenuOpen}
          onLogout={handleLogout}
          siteName={isClockedIn ? currentSiteName : ""}
          showBackButton={canGoBack}
          onBack={handleBackNavigation}
        />
      </div>

      {isClockedIn ? (
        <>
          <div className="shrink-0">
            <div className="-mx-4 mt-3 flex items-center justify-between rounded-none bg-base-200 px-4 py-3">
              <div>
                <p className="text-xl font-semibold tabular-nums">{liveTimer}</p>
              </div>
              <button className="btn" style={clockOutStyle} onClick={handleClockAction} disabled={loading}>
                {loading ? <span className="loading loading-spinner" /> : "Pointer la sortie"}
              </button>
            </div>
          </div>

          <section className="mt-4 flex flex-1 flex-col overflow-hidden pb-6">
            <button
              className="btn mb-3 w-full"
              style={primarySurfaceStyle}
              type="button"
              onClick={() => {
                setEditingMaterialId("");
                setMaterialType("cement");
                setMaterialQty("");
                setMaterialUnit(defaultUnitForMaterial("cement"));
                setMaterialModalOpen(true);
              }}
              disabled={loading || !activeProjectId}
            >
              Ajouter un materiau
            </button>

            <div className="min-h-0 flex-1">
              <div className="flex h-full min-h-0 flex-col rounded-[var(--rounded-btn)] bg-base-200/45 px-4 py-3">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {materialLogs.length ? (
                    <div className="overflow-hidden rounded-[var(--rounded-btn)] bg-base-100/80 text-sm">
                      {materialLogs.map((log) => {
                        const expanded = expandedMaterialId === log.record_id;
                        const timestamp = formatMaterialTimestamp(log);
                        return (
                          <div
                            key={log.record_id}
                            className={expanded ? "px-3 py-2" : "border-b border-base-300/60 px-3 py-2 last:border-b-0"}
                          >
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-3 text-left"
                              onClick={() =>
                                setExpandedMaterialId((current) => (current === log.record_id ? "" : log.record_id))
                              }
                            >
                              <span className="capitalize text-base-content/75">
                                {log.record?.["material_log.material_type"] || "Materiau"}
                              </span>
                              <span className="text-base-content/60">
                                <span>
                                  {log.record?.["material_log.quantity"]}{" "}
                                  {unitLabel(log.record?.["material_log.unit"], log.record?.["material_log.quantity"])}
                                </span>
                              </span>
                            </button>
                            {expanded ? (
                              <div className="mt-3 pt-1">
                                <div className="flex items-center gap-2 text-xs text-base-content/55">
                                  <span>{timestamp?.date || ""}</span>
                                  {timestamp?.time ? <span>{timestamp.time}</span> : null}
                                </div>
                                <div className="mt-3 flex gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-sm flex-1"
                                    style={primarySoftStyle}
                                    onClick={() => openMaterialEditor(log)}
                                    disabled={loading}
                                  >
                                    <Pencil className="h-4 w-4" />
                                    Modifier
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm flex-1"
                                    style={primarySoftStyle}
                                    onClick={() => handleDeleteMaterial(log)}
                                    disabled={loading}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Supprimer
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-center text-sm text-base-content/55">
                      Aucun materiau ajoute pour le moment.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      ) : needsProjectSelection ? (
        <section className="flex flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="flex w-full max-w-xs flex-col items-center space-y-4 text-center">
              <div className="space-y-2 text-center">
                <p className="text-3xl font-black tracking-tight">Choisissez votre projet</p>
              </div>
              <div className="w-full space-y-3">
                {projects.map((project) => {
                  return (
                    <button
                      key={project.record_id}
                      type="button"
                      className="btn h-auto min-h-0 w-full justify-center rounded-[var(--rounded-btn)] border px-4 py-4 text-center"
                      style={primarySurfaceStyle}
                      onClick={() => {
                        setSelectedProjectId(project.record_id);
                        setProjectSelectionComplete(true);
                      }}
                      disabled={loading}
                    >
                      <span className="block">
                        <span className="block text-base font-semibold">
                          {project.record?.["construction_project.name"] || "Projet"}
                        </span>
                        {project.record?.["construction_project.site_location"] ? (
                          <span className="mt-1 block text-xs opacity-80">
                            {project.record?.["construction_project.site_location"]}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="flex flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
              <div className="space-y-1 text-center">
                <p className="text-2xl font-bold tracking-tight">Pret a commencer le travail sur</p>
                <p className="text-2xl font-bold tracking-tight">{currentSiteName}?</p>
              </div>
              <button
                className="btn btn-lg h-16 w-full text-lg"
                style={clockInStyle}
                onClick={handleClockAction}
                disabled={loading || !activeProjectId}
              >
                {loading ? <span className="loading loading-spinner" /> : "Pointer l'entree"}
              </button>
            </div>
          </div>
        </section>
      )}

      {installPromptVisible ? (
        <InstallPrompt
          canInstall={Boolean(installPromptEvent)}
          onInstall={handleInstallApp}
          onDismiss={dismissInstallHint}
        />
      ) : null}

      {updatePromptVisible && !installPromptVisible ? <UpdatePrompt onUpdate={handleApplyUpdate} /> : null}

      {(error || success) && <Toast error={error} success={success} />}

      {materialModalOpen ? (
        <div className="modal modal-open">
          <div className="modal-box p-4">
            <div className="mb-2 flex items-start justify-end">
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => {
                  setMaterialModalOpen(false);
                }}
                disabled={loading}
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-2" onSubmit={handleMaterialSubmit}>
              <div className="grid grid-cols-2 gap-2">
                {MATERIALS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="btn h-12 min-h-12"
                    style={materialType === item.value ? primarySurfaceStyle : primarySoftStyle}
                    onClick={() => setMaterialType(item.value)}
                    disabled={loading}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="join w-full">
                <input
                  className="input input-bordered join-item h-12 min-h-12 w-full text-center text-2xl font-semibold"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={materialQty}
                  onChange={(event) => setMaterialQty(event.target.value)}
                  placeholder="Quantite"
                  disabled={loading}
                />
                {!showUnitSelect ? (
                  <span
                    className="join-item inline-flex h-12 min-h-12 w-24 items-center justify-center border border-base-content/20 border-l-0 bg-base-100 px-4 text-sm font-medium text-base-content/70"
                  >
                    {unitLabel(materialUnit, materialQty)}
                  </span>
                ) : null}
              </div>

              <div className="flex gap-2">
                {QUICK_ADD.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    className="btn h-12 min-h-12 flex-1"
                    style={primarySoftStyle}
                    onClick={() => handleQuickAdd(amount)}
                    disabled={loading}
                  >
                    +{amount}
                  </button>
                ))}
              </div>

              {showUnitSelect ? (
                <select
                  className="select select-bordered h-12 min-h-12 w-full bg-base-100"
                  value={materialUnit}
                  onChange={(event) => setMaterialUnit(event.target.value)}
                  disabled={loading}
                >
                  {UNITS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              ) : null}

              <button className="btn h-12 min-h-12 w-full" style={primarySurfaceStyle} disabled={loading} type="submit">
                {loading ? <span className="loading loading-spinner" /> : editingMaterialId ? "Mettre a jour" : "Ajouter"}
              </button>
            </form>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Fermer la fenetre"
            onClick={() => {
              if (!loading) {
                setMaterialModalOpen(false);
              }
            }}
          />
        </div>
      ) : null}
    </main>
  );
}

function TopBar({ loading, menuOpen, onMenuToggle, onLogout, siteName, showBackButton = false, onBack }) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
        onMenuToggle(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [menuOpen, onMenuToggle]);

  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showBackButton ? (
          <button
            className="btn btn-ghost btn-circle shrink-0"
            type="button"
            onClick={onBack}
            disabled={loading}
            aria-label="Retour"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
        ) : null}
        {siteName ? <p className="truncate text-sm font-medium text-base-content/70">{siteName}</p> : null}
      </div>
      <div ref={menuRef}>
        <button
          className="btn btn-ghost btn-circle"
          type="button"
          onClick={() => onMenuToggle((current) => !current)}
          disabled={loading}
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
      {menuOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/30"
            aria-label="Fermer le menu"
            onClick={() => onMenuToggle(false)}
          />
          <aside ref={menuRef} className="fixed top-0 right-0 z-50 flex h-full w-72 flex-col bg-base-100 shadow-xl">
            <div className="flex items-center justify-between border-b border-base-300 px-4 py-4">
              <p className="text-base font-semibold">Menu</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => onMenuToggle(false)}
                disabled={loading}
                aria-label="Fermer le menu"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 px-4 py-4">
              <button
                type="button"
                className="btn btn-soft w-full justify-start"
                onClick={onLogout}
                disabled={loading}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Se deconnecter
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </header>
  );
}

function Toast({ error, success }) {
  return (
    <div className="toast toast-top toast-center z-50">
      {error ? (
        <div className="alert alert-error text-sm shadow-sm">
          <span>{error}</span>
        </div>
      ) : null}
      {success ? (
        <div className="alert alert-success text-sm shadow-sm">
          <span>{success}</span>
        </div>
      ) : null}
    </div>
  );
}

function InstallPrompt({ canInstall, onInstall, onDismiss }) {
  const iosInstructions = isIosDevice() && isSafariBrowser();

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-sm rounded-[var(--rounded-btn)] border border-base-300 bg-base-100 p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">Ajouter a l'ecran d'accueil</p>
            <p className="mt-1 text-sm text-base-content/70">
              {iosInstructions
                ? "Enregistrez cette application sur votre ecran d'accueil pour un acces plus rapide."
                : "Installez cette application pour que les ouvriers puissent l'ouvrir comme une application normale."}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-circle shrink-0" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {iosInstructions ? (
          <div className="mt-4 rounded-[var(--rounded-btn)] bg-base-200/60 p-3 text-sm text-base-content/75">
            <p>1. Appuyez sur le bouton Partager dans Safari.</p>
            <p className="mt-1">2. Faites defiler vers le bas.</p>
            <p className="mt-1">3. Appuyez sur `Ajouter a l'ecran d'accueil`.</p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {canInstall ? (
            <button
              type="button"
              className="btn w-full whitespace-nowrap sm:flex-1"
              style={primarySurfaceStyle}
              onClick={onInstall}
            >
              Ajouter a l'ecran d'accueil
            </button>
          ) : null}
          <button type="button" className="btn btn-soft w-full whitespace-nowrap sm:flex-1" onClick={onDismiss}>
            {iosInstructions ? "Fermer" : "Plus tard"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdatePrompt({ onUpdate }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-sm rounded-[var(--rounded-btn)] border border-base-300 bg-base-100 p-4 shadow-lg">
        <p className="text-sm font-semibold">Mise a jour disponible</p>
        <p className="mt-1 text-sm text-base-content/70">Une nouvelle version est prete. Rafraichissez pour mettre l'application a jour.</p>
        <button type="button" className="btn mt-3 w-full" style={primarySurfaceStyle} onClick={onUpdate}>
          Mettre a jour maintenant
        </button>
      </div>
    </div>
  );
}
