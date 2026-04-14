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
  getCatalogMaterials,
  getConstructionSites,
  getProjectMaterialLogs,
  getProjects,
  getWorkerAssignments,
  getUiPrefs,
  linkAttachmentToRecord,
  nowIso,
  todayDate,
  uploadAttachment,
  updateMaterialLog,
  updateTimeEntry,
} from "./api.js";
import { applyBrandColors, applyTheme, getInitialTheme, setBrandColors, setTheme } from "./theme.js";

const SITE_STORAGE_KEY = "construction_worker_pwa:last_project_id";
const INSTALL_HINT_DISMISSED_KEY = "construction_worker_pwa:install_hint_dismissed";
const PRIMARY_COLOR = "#206aff";
const PRIMARY_TEXT = "#ffffff";

const QUICK_ADD = [1, 5, 10, 20];
const DEFAULT_LOCALE = "en-NZ";
const SUPPORTED_PWA_LOCALES = {
  en: "en-NZ",
  fr: "fr-FR",
  nl: "nl-NL",
};
const PWA_COPY = {
  en: {
    login_title: "Sign in",
    email: "Email",
    password: "Password",
    login: "Sign in",
    no_worker_title: "No worker account",
    no_worker_body: "Contact your supervisor.",
    logout: "Sign out",
    no_project_title: "No assigned project",
    no_project_body: "You are not assigned to any project.",
    clock_out: "Clock out",
    add_material: "Add a material",
    material_fallback: "Material",
    material_empty: "No materials added yet.",
    edit: "Edit",
    delete: "Delete",
    choose_project: "Choose your project",
    project_fallback: "Project",
    ready_to_start: "Ready to start work on",
    take_photo_clock_in: "Take photo and clock in",
    take_photo_clock_out: "Take photo and clock out",
    edit_material: "Edit material",
    add_material_title: "Add a material",
    choose_material: "Choose a material",
    quantity: "Quantity",
    update: "Update",
    add: "Add",
    verify_clock_in: "Clock-in verification",
    verify_clock_out: "Clock-out verification",
    close: "Close",
    close_window: "Close window",
    back: "Back",
    open_menu: "Open menu",
    close_menu: "Close menu",
    menu: "Menu",
    install_title: "Add to home screen",
    install_body_ios: "Save this app to your home screen for faster access.",
    install_body_other: "Install this app so workers can open it like a normal app.",
    install_step_1: "1. Tap the Share button in Safari.",
    install_step_2: "2. Scroll down.",
    install_step_3: "3. Tap `Add to Home Screen`.",
    later: "Later",
    update_title: "Update available",
    update_body: "A new version is ready. Refresh to update the app.",
    update_now: "Update now",
    geolocation_unavailable: "Geolocation is not available on this device.",
    geolocation_permission: "Allow location access to clock in.",
    geolocation_not_found: "Location not found. Try outside or move closer to the site.",
    geolocation_timeout: "Location request timed out. Try again.",
    geolocation_failed: "Unable to get your location.",
    unit_piece_one: "piece",
    unit_piece_many: "pieces",
    unit_bag_one: "bag",
    unit_bag_many: "bags",
    unit_pair_one: "pair",
    unit_pair_many: "pairs",
    unit_sheet_one: "sheet",
    unit_sheet_many: "sheets",
    unit_ton_one: "ton",
    unit_ton_many: "tons",
    unit_unit_one: "unit",
    unit_unit_many: "units",
    no_worker_linked: "No linked worker account.",
    load_worker_failed: "Unable to load your worker profile.",
    login_failed: "Unable to sign in.",
    logout_failed: "Unable to sign out.",
    camera_unavailable: "Camera is not available on this device.",
    camera_not_ready: "Camera is not ready yet.",
    capture_failed: "Unable to capture the photo.",
    no_project_assigned: "No assigned project.",
    photo_required_clock_in: "Take a photo before clocking in.",
    photo_required_clock_out: "Take a photo before clocking out.",
    gps_required_clock_in: "GPS location is required to clock in.",
    gps_required_clock_out: "GPS location is required to clock out.",
    outside_radius: "You are outside the allowed site radius ({{distance}} m / {{allowed}} m).",
    save_failed: "Unable to save.",
    clock_in_saved: "Clock-in recorded.",
    clock_out_saved: "Clock-out recorded.",
    quantity_required: "Enter a quantity.",
    choose_catalog_material: "Choose a material from the catalog.",
    material_missing: "The selected material no longer exists.",
    material_type_required: "Add a material type on the catalog item.",
    material_updated: "Material updated.",
    material_added_success: "Material added.",
    material_deleted: "Material deleted.",
    delete_failed: "Unable to delete.",
  },
  fr: {
    login_title: "Connexion",
    email: "E-mail",
    password: "Mot de passe",
    login: "Se connecter",
    no_worker_title: "Aucun compte ouvrier",
    no_worker_body: "Contactez votre superviseur.",
    logout: "Se deconnecter",
    no_project_title: "Aucun projet assigne",
    no_project_body: "Vous n'etes affecte a aucun projet.",
    clock_out: "Pointer la sortie",
    add_material: "Ajouter un materiau",
    material_fallback: "Materiau",
    material_empty: "Aucun materiau ajoute pour le moment.",
    edit: "Modifier",
    delete: "Supprimer",
    choose_project: "Choisissez votre projet",
    project_fallback: "Projet",
    ready_to_start: "Pret a commencer le travail sur",
    take_photo_clock_in: "Prendre une photo et pointer l'entree",
    take_photo_clock_out: "Prendre une photo et pointer la sortie",
    edit_material: "Modifier le materiau",
    add_material_title: "Ajouter un materiau",
    choose_material: "Choisir un materiau",
    quantity: "Quantite",
    update: "Mettre a jour",
    add: "Ajouter",
    verify_clock_in: "Verification de l'entree",
    verify_clock_out: "Verification de la sortie",
    close: "Fermer",
    close_window: "Fermer la fenetre",
    back: "Retour",
    open_menu: "Ouvrir le menu",
    close_menu: "Fermer le menu",
    menu: "Menu",
    install_title: "Ajouter a l'ecran d'accueil",
    install_body_ios: "Enregistrez cette application sur votre ecran d'accueil pour un acces plus rapide.",
    install_body_other: "Installez cette application pour que les ouvriers puissent l'ouvrir comme une application normale.",
    install_step_1: "1. Appuyez sur le bouton Partager dans Safari.",
    install_step_2: "2. Faites defiler vers le bas.",
    install_step_3: "3. Appuyez sur `Ajouter a l'ecran d'accueil`.",
    later: "Plus tard",
    update_title: "Mise a jour disponible",
    update_body: "Une nouvelle version est prete. Rafraichissez pour mettre l'application a jour.",
    update_now: "Mettre a jour maintenant",
    geolocation_unavailable: "La geolocalisation n'est pas disponible sur cet appareil.",
    geolocation_permission: "Autorisez la localisation pour pointer votre entree.",
    geolocation_not_found: "Position introuvable. Essayez a l'exterieur ou rapprochez-vous du site.",
    geolocation_timeout: "La localisation a expire. Reessayez.",
    geolocation_failed: "Impossible d'obtenir votre position.",
    unit_piece_one: "unite",
    unit_piece_many: "unites",
    unit_bag_one: "sac",
    unit_bag_many: "sacs",
    unit_pair_one: "paire",
    unit_pair_many: "paires",
    unit_sheet_one: "plaque",
    unit_sheet_many: "plaques",
    unit_ton_one: "tonne",
    unit_ton_many: "tonnes",
    unit_unit_one: "unite",
    unit_unit_many: "unites",
    no_worker_linked: "Aucun compte ouvrier lie.",
    load_worker_failed: "Impossible de charger votre profil ouvrier.",
    login_failed: "Connexion impossible.",
    logout_failed: "Deconnexion impossible.",
    camera_unavailable: "La camera n'est pas disponible sur cet appareil.",
    camera_not_ready: "La camera n'est pas encore prete.",
    capture_failed: "Impossible de capturer la photo.",
    no_project_assigned: "Aucun chantier assigne.",
    photo_required_clock_in: "Prenez une photo avant de pointer votre entree.",
    photo_required_clock_out: "Prenez une photo avant de pointer votre sortie.",
    gps_required_clock_in: "La position GPS est requise pour pointer votre entree.",
    gps_required_clock_out: "La position GPS est requise pour pointer votre sortie.",
    outside_radius: "Vous etes hors du rayon autorise du site ({{distance}} m / {{allowed}} m).",
    save_failed: "Impossible d'enregistrer.",
    clock_in_saved: "Entree enregistree.",
    clock_out_saved: "Sortie enregistree.",
    quantity_required: "Saisissez une quantite.",
    choose_catalog_material: "Choisissez un materiau du catalogue.",
    material_missing: "Le materiau selectionne n'existe plus.",
    material_type_required: "Ajoutez un type de materiau sur l'article du catalogue.",
    material_updated: "Materiau mis a jour.",
    material_added_success: "Materiau ajoute.",
    material_deleted: "Materiau supprime.",
    delete_failed: "Suppression impossible.",
  },
  nl: {
    login_title: "Aanmelden",
    email: "E-mail",
    password: "Wachtwoord",
    login: "Aanmelden",
    no_worker_title: "Geen werknemersaccount",
    no_worker_body: "Neem contact op met je supervisor.",
    logout: "Afmelden",
    no_project_title: "Geen toegewezen project",
    no_project_body: "Je bent aan geen enkel project toegewezen.",
    clock_out: "Uitklokken",
    add_material: "Materiaal toevoegen",
    material_fallback: "Materiaal",
    material_empty: "Nog geen materiaal toegevoegd.",
    edit: "Bewerken",
    delete: "Verwijderen",
    choose_project: "Kies je project",
    project_fallback: "Project",
    ready_to_start: "Klaar om te starten op",
    take_photo_clock_in: "Foto nemen en inklokken",
    take_photo_clock_out: "Foto nemen en uitklokken",
    edit_material: "Materiaal bewerken",
    add_material_title: "Materiaal toevoegen",
    choose_material: "Kies een materiaal",
    quantity: "Hoeveelheid",
    update: "Bijwerken",
    add: "Toevoegen",
    verify_clock_in: "Inklokverificatie",
    verify_clock_out: "Uitklokverificatie",
    close: "Sluiten",
    close_window: "Venster sluiten",
    back: "Terug",
    open_menu: "Menu openen",
    close_menu: "Menu sluiten",
    menu: "Menu",
    install_title: "Toevoegen aan startscherm",
    install_body_ios: "Sla deze app op op je startscherm voor snellere toegang.",
    install_body_other: "Installeer deze app zodat werknemers ze als een normale app kunnen openen.",
    install_step_1: "1. Tik op de Deel-knop in Safari.",
    install_step_2: "2. Scroll naar beneden.",
    install_step_3: "3. Tik op `Zet op beginscherm`.",
    later: "Later",
    update_title: "Update beschikbaar",
    update_body: "Er staat een nieuwe versie klaar. Vernieuw om de app bij te werken.",
    update_now: "Nu bijwerken",
    geolocation_unavailable: "Geolocatie is niet beschikbaar op dit apparaat.",
    geolocation_permission: "Sta locatie toe om in te klokken.",
    geolocation_not_found: "Locatie niet gevonden. Probeer buiten of dichter bij de site.",
    geolocation_timeout: "Locatieverzoek is verlopen. Probeer opnieuw.",
    geolocation_failed: "Kan je locatie niet ophalen.",
    unit_piece_one: "stuk",
    unit_piece_many: "stuks",
    unit_bag_one: "zak",
    unit_bag_many: "zakken",
    unit_pair_one: "paar",
    unit_pair_many: "paren",
    unit_sheet_one: "plaat",
    unit_sheet_many: "platen",
    unit_ton_one: "ton",
    unit_ton_many: "ton",
    unit_unit_one: "eenheid",
    unit_unit_many: "eenheden",
    no_worker_linked: "Geen gekoppeld werknemersaccount.",
    load_worker_failed: "Kan je werknemersprofiel niet laden.",
    login_failed: "Aanmelden mislukt.",
    logout_failed: "Afmelden mislukt.",
    camera_unavailable: "Camera is niet beschikbaar op dit apparaat.",
    camera_not_ready: "Camera is nog niet klaar.",
    capture_failed: "Kan de foto niet vastleggen.",
    no_project_assigned: "Geen toegewezen project.",
    photo_required_clock_in: "Maak een foto voordat je inklokt.",
    photo_required_clock_out: "Maak een foto voordat je uitklokt.",
    gps_required_clock_in: "GPS-locatie is vereist om in te klokken.",
    gps_required_clock_out: "GPS-locatie is vereist om uit te klokken.",
    outside_radius: "Je bevindt je buiten de toegestane straal van de site ({{distance}} m / {{allowed}} m).",
    save_failed: "Kan niet opslaan.",
    clock_in_saved: "Inklokken opgeslagen.",
    clock_out_saved: "Uitklokken opgeslagen.",
    quantity_required: "Voer een hoeveelheid in.",
    choose_catalog_material: "Kies een materiaal uit de catalogus.",
    material_missing: "Het geselecteerde materiaal bestaat niet meer.",
    material_type_required: "Voeg een materiaaltype toe op het catalogusitem.",
    material_updated: "Materiaal bijgewerkt.",
    material_added_success: "Materiaal toegevoegd.",
    material_deleted: "Materiaal verwijderd.",
    delete_failed: "Verwijderen mislukt.",
  },
};

function normalizedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

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

function resolveLocaleKey(locale) {
  const text = normalizedText(locale);
  if (text.startsWith("fr")) return "fr";
  if (text.startsWith("nl")) return "nl";
  return "en";
}

function t(locale, key, vars = {}) {
  const localeKey = resolveLocaleKey(locale);
  let template = PWA_COPY[localeKey]?.[key] || PWA_COPY.en[key] || key;
  Object.entries(vars).forEach(([name, value]) => {
    template = template.replaceAll(`{{${name}}}`, String(value));
  });
  return template;
}

function defaultUnitForMaterial(item) {
  return String(item?.record?.["item.uom"] || "").trim();
}

function materialDisplayLabel(item) {
  if (!item) return "";
  const code = item.record?.["item.code"];
  const name = item.record?.["item.name"] || "";
  return code ? `${name} (${code})` : name;
}

function buildSiteLabel(site) {
  if (!site?.record) return "";
  const parts = [
    site.record["construction_site.name"],
    site.record["construction_site.address"],
    site.record["construction_site.city"],
  ].filter(Boolean);
  return parts.join(" - ");
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371e3;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function requestCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.navigator?.geolocation) {
      reject({ code: 0 });
      return;
    }
    window.navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
      ...options,
    });
  });
}

function geolocationErrorMessage(error, locale = DEFAULT_LOCALE) {
  const code = error?.code;
  if (code === 0) return t(locale, "geolocation_unavailable");
  if (code === 1) return t(locale, "geolocation_permission");
  if (code === 2) return t(locale, "geolocation_not_found");
  if (code === 3) return t(locale, "geolocation_timeout");
  return error?.message || t(locale, "geolocation_failed");
}

function unitLabel(unit, quantity = "", locale = DEFAULT_LOCALE) {
  const raw = String(unit || "").trim();
  const text = normalizedText(raw);
  const qty = Number(quantity);
  const plural = Number.isFinite(qty) && qty > 1;
  if (!raw) return "";
  if (
    text === "kg" ||
    text === "g" ||
    text === "mg" ||
    text === "lb" ||
    text === "lbs" ||
    text === "oz" ||
    text === "l" ||
    text === "ml" ||
    text === "m" ||
    text === "cm" ||
    text === "mm" ||
    text === "km" ||
    text === "ft" ||
    text === "in" ||
    text === "m2" ||
    text === "m^2" ||
    text === "sqm" ||
    text === "sq m" ||
    text === "m3" ||
    text === "m^3"
  ) {
    return raw;
  }
  if (text.includes("bag") || text.includes("sac")) return t(locale, plural ? "unit_bag_many" : "unit_bag_one");
  if (text.includes("pair")) return t(locale, plural ? "unit_pair_many" : "unit_pair_one");
  if (text.includes("sheet") || text.includes("plaque") || text.includes("plaat")) return t(locale, plural ? "unit_sheet_many" : "unit_sheet_one");
  if (text.includes("kilo")) return raw;
  if (text.includes("cubic") || text.includes("cube")) return raw;
  if (text.includes("ton")) return t(locale, plural ? "unit_ton_many" : "unit_ton_one");
  if (!text || text.includes("unit") || text.includes("unite") || text.includes("piece") || text.includes("stuk")) {
    return t(locale, plural ? "unit_piece_many" : "unit_piece_one");
  }
  return raw;
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
  const [sitesById, setSitesById] = useState({});
  const [assignments, setAssignments] = useState([]);
  const [openEntry, setOpenEntry] = useState(null);
  const [materialItems, setMaterialItems] = useState([]);
  const [materialLogs, setMaterialLogs] = useState([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [locale, setLocale] = useState(DEFAULT_LOCALE);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [selectedMaterialItemId, setSelectedMaterialItemId] = useState("");
  const [materialQty, setMaterialQty] = useState("");
  const [materialUnit, setMaterialUnit] = useState("");
  const [expandedMaterialId, setExpandedMaterialId] = useState("");
  const [editingMaterialId, setEditingMaterialId] = useState("");
  const [timerTick, setTimerTick] = useState(Date.now());
  const [workspaceKey, setWorkspaceKey] = useState(() => getActiveWorkspaceId());
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [installHintDismissed, setInstallHintDismissed] = useState(false);
  const [installPromptVisible, setInstallPromptVisible] = useState(false);
  const [updatePromptVisible, setUpdatePromptVisible] = useState(false);
  const [projectSelectionComplete, setProjectSelectionComplete] = useState(false);
  const [checkInPromptOpen, setCheckInPromptOpen] = useState(false);
  const [checkInCameraError, setCheckInCameraError] = useState("");
  const [checkInCameraLoading, setCheckInCameraLoading] = useState(false);
  const [checkInLocation, setCheckInLocation] = useState(null);
  const [checkInLocationError, setCheckInLocationError] = useState("");
  const [checkInLocationLoading, setCheckInLocationLoading] = useState(false);
  const [checkOutPromptOpen, setCheckOutPromptOpen] = useState(false);
  const [checkOutCameraError, setCheckOutCameraError] = useState("");
  const [checkOutCameraLoading, setCheckOutCameraLoading] = useState(false);
  const [checkOutLocation, setCheckOutLocation] = useState(null);
  const [checkOutLocationError, setCheckOutLocationError] = useState("");
  const [checkOutLocationLoading, setCheckOutLocationLoading] = useState(false);
  const checkInCameraVideoRef = useRef(null);
  const checkInCameraStreamRef = useRef(null);
  const checkOutCameraVideoRef = useRef(null);
  const checkOutCameraStreamRef = useRef(null);

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
    if (!checkInPromptOpen) return undefined;
    let cancelled = false;

    async function startCheckInCamera() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCheckInCameraError(t(locale, "camera_unavailable"));
        return;
      }

      setCheckInCameraLoading(true);
      setCheckInCameraError("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        checkInCameraStreamRef.current = stream;
        if (checkInCameraVideoRef.current) {
          checkInCameraVideoRef.current.srcObject = stream;
          await checkInCameraVideoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setCheckInCameraError(err?.message || t(locale, "camera_unavailable"));
      } finally {
        if (!cancelled) {
          setCheckInCameraLoading(false);
        }
      }
    }

    startCheckInCamera();

    return () => {
      cancelled = true;
      if (checkInCameraStreamRef.current) {
        checkInCameraStreamRef.current.getTracks().forEach((track) => track.stop());
        checkInCameraStreamRef.current = null;
      }
      if (checkInCameraVideoRef.current) {
        checkInCameraVideoRef.current.srcObject = null;
      }
    };
  }, [checkInPromptOpen]);

  useEffect(() => {
    if (!checkOutPromptOpen) return undefined;
    let cancelled = false;

    async function startCheckOutCamera() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCheckOutCameraError(t(locale, "camera_unavailable"));
        return;
      }

      setCheckOutCameraLoading(true);
      setCheckOutCameraError("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        checkOutCameraStreamRef.current = stream;
        if (checkOutCameraVideoRef.current) {
          checkOutCameraVideoRef.current.srcObject = stream;
          await checkOutCameraVideoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setCheckOutCameraError(err?.message || t(locale, "camera_unavailable"));
      } finally {
        if (!cancelled) {
          setCheckOutCameraLoading(false);
        }
      }
    }

    startCheckOutCamera();

    return () => {
      cancelled = true;
      if (checkOutCameraStreamRef.current) {
        checkOutCameraStreamRef.current.getTracks().forEach((track) => track.stop());
        checkOutCameraStreamRef.current = null;
      }
      if (checkOutCameraVideoRef.current) {
        checkOutCameraVideoRef.current.srcObject = null;
      }
    };
  }, [checkOutPromptOpen]);

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
    if (!selectedMaterialItemId) return;
    const nextItem = materialItems.find((item) => item.record_id === selectedMaterialItemId);
    if (!nextItem) return;
    setMaterialUnit(defaultUnitForMaterial(nextItem));
  }, [materialItems, selectedMaterialItemId]);

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
      setSitesById({});
      setAssignments([]);
      setOpenEntry(null);
      setMaterialItems([]);
      setMaterialLogs([]);
      setExpandedMaterialId("");
      setEditingMaterialId("");
      return;
    }

    setWorkerContextLoading(true);
    setLoading(true);
    setError("");
    try {
      const [nextWorker, allProjects, nextMaterialItems] = await Promise.all([
        findWorkerForUser(userId),
        getProjects(),
        getCatalogMaterials(),
      ]);
      if (!nextWorker) {
        setWorker(null);
        setProjects([]);
        setSitesById({});
        setAssignments([]);
        setOpenEntry(null);
        setMaterialItems(nextMaterialItems);
        setMaterialLogs([]);
        setExpandedMaterialId("");
        setEditingMaterialId("");
        setError(t(locale, "no_worker_linked"));
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
      const siteIds = Array.from(
        new Set(
          [
            ...nextAssignments
              .map((assignment) => assignment.record?.["construction_worker_assignment.site_id"])
              .filter(Boolean),
            ...nextProjects.map((project) => project.record?.["construction_project.site_id"]).filter(Boolean),
            nextWorker.record?.["construction_worker.default_site_id"],
          ].filter(Boolean),
        ),
      );
      const nextSites = await getConstructionSites(siteIds);
      const nextSitesById = Object.fromEntries(nextSites.map((site) => [site.record_id, site]));
      const savedProjectId =
        typeof window !== "undefined" ? window.localStorage.getItem(SITE_STORAGE_KEY) || "" : "";
      const nextDefaultProjectId =
        nextOpen?.record?.["time_entry.project_id"] ||
        (savedProjectId && nextProjects.some((project) => project.record_id === savedProjectId) ? savedProjectId : "") ||
        nextProjects[0]?.record_id ||
        "";

      setWorker(nextWorker);
      setProjects(nextProjects);
      setSitesById(nextSitesById);
      setAssignments(nextAssignments);
      setOpenEntry(nextOpen);
      setMaterialItems(nextMaterialItems);
      setSelectedProjectId((current) => current || nextDefaultProjectId);
      setProjectSelectionComplete(Boolean(nextOpen) || nextProjects.length <= 1);
    } catch (err) {
      setError(err.message || t(locale, "load_worker_failed"));
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
        const nextLocale = String(
          res?.resolved?.locale || res?.user?.locale || workspace?.default_locale || DEFAULT_LOCALE,
        ).trim();
        if (workspace?.colors) {
          setBrandColors(workspace.colors);
          applyBrandColors(workspace.colors);
        }
        const nextTheme = workspace?.theme || getInitialTheme();
        if (nextTheme) {
          setTheme(nextTheme);
        }
        setLocale(SUPPORTED_PWA_LOCALES[resolveLocaleKey(nextLocale)] || DEFAULT_LOCALE);
      } catch {
        // keep local fallback theme
      }
    })();
    return () => {
      mounted = false;
    };
  }, [session?.user?.id, workspaceKey]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale || DEFAULT_LOCALE;
    }
  }, [locale]);

  const needsSitePicker = projects.length > 1;
  const currentProject =
    projects.find((item) => item.record_id === selectedProjectId) ||
    projects[0] ||
    null;
  const materialItemById = Object.fromEntries(materialItems.map((item) => [item.record_id, item]));
  const activeProjectId = currentProject?.record_id || "";
  const selectedAssignment =
    assignments.find((item) => item.record?.["construction_worker_assignment.project_id"] === activeProjectId) || null;
  const activeSiteId =
    selectedAssignment?.record?.["construction_worker_assignment.site_id"] ||
    currentProject?.record?.["construction_project.site_id"] ||
    worker?.record?.["construction_worker.default_site_id"] ||
    "";
  const currentSite = sitesById[activeSiteId] || null;
  const currentSiteName =
    currentSite?.record?.["construction_site.name"] ||
    currentProject?.record?.["construction_project.name"] ||
    "";
  const activeCrewId = worker?.record?.["construction_worker.crew_id"] || "";
  const isClockedIn = Boolean(openEntry);
  const needsProjectSelection = !isClockedIn && needsSitePicker && !projectSelectionComplete;
  const liveTimer = formatElapsed(openEntry?.record?.["time_entry.check_in_at"], timerTick);
  const canGoBack =
    (!isClockedIn && needsSitePicker && (projectSelectionComplete || Boolean(selectedProjectId))) ||
    materialModalOpen ||
    checkInPromptOpen ||
    checkOutPromptOpen;

  useEffect(() => {
    let active = true;
    (async () => {
      if (!activeProjectId || !worker?.record_id) {
        setMaterialLogs([]);
        return;
      }
      try {
        const logs = await getProjectMaterialLogs(activeProjectId, worker.record_id);
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
  }, [activeProjectId, worker?.record_id]);

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
      setError(err.message || t(locale, "login_failed"));
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
      setSitesById({});
      setAssignments([]);
      setOpenEntry(null);
      setMaterialItems([]);
      setMaterialLogs([]);
      setExpandedMaterialId("");
      setEditingMaterialId("");
      setSelectedMaterialItemId("");
      setSelectedProjectId("");
      setProjectSelectionComplete(false);
      setMenuOpen(false);
      setMaterialModalOpen(false);
      setCheckInPromptOpen(false);
      setCheckInLocation(null);
      setCheckInLocationError("");
      setCheckOutPromptOpen(false);
      setCheckOutLocation(null);
      setCheckOutLocationError("");
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(SITE_STORAGE_KEY);
      }
    } catch (err) {
      setError(err.message || t(locale, "logout_failed"));
    } finally {
      setLoading(false);
    }
  }

  function resetCheckInPrompt() {
    setCheckInPromptOpen(false);
    setCheckInCameraError("");
    setCheckInLocation(null);
    setCheckInLocationError("");
    setCheckInLocationLoading(false);
  }

  function resetCheckOutPrompt() {
    setCheckOutPromptOpen(false);
    setCheckOutCameraError("");
    setCheckOutLocation(null);
    setCheckOutLocationError("");
    setCheckOutLocationLoading(false);
  }

  async function captureAndConfirmCheckIn() {
    const video = checkInCameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCheckInCameraError(t(locale, "camera_not_ready"));
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCheckInCameraError(t(locale, "capture_failed"));
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      setCheckInCameraError(t(locale, "capture_failed"));
      return;
    }

    setCheckInCameraError("");
    const photoFile = new File([blob], `check-in-${Date.now()}.jpg`, { type: "image/jpeg" });
    await confirmCheckIn(photoFile);
  }

  async function captureAndConfirmCheckOut() {
    const video = checkOutCameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCheckOutCameraError(t(locale, "camera_not_ready"));
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCheckOutCameraError(t(locale, "capture_failed"));
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      setCheckOutCameraError(t(locale, "capture_failed"));
      return;
    }

    setCheckOutCameraError("");
    const photoFile = new File([blob], `check-out-${Date.now()}.jpg`, { type: "image/jpeg" });
    await confirmCheckOut(photoFile);
  }

  async function refreshCheckInLocation() {
    setCheckInLocationLoading(true);
    setCheckInLocationError("");
    try {
      const position = await requestCurrentPosition();
      const latitude = Number(position.coords?.latitude);
      const longitude = Number(position.coords?.longitude);
      const accuracy = Number(position.coords?.accuracy || 0);
      const siteLatitude = Number(currentSite?.record?.["construction_site.latitude"]);
      const siteLongitude = Number(currentSite?.record?.["construction_site.longitude"]);
      const distanceFromSite =
        Number.isFinite(siteLatitude) && Number.isFinite(siteLongitude)
          ? Math.round(haversineDistanceMeters(latitude, longitude, siteLatitude, siteLongitude))
          : null;
      const nextLocation = {
        latitude,
        longitude,
        accuracy,
        distanceFromSite,
      };
      setCheckInLocation(nextLocation);
      return nextLocation;
    } catch (err) {
      setCheckInLocation(null);
      setCheckInLocationError(geolocationErrorMessage(err, locale));
      return null;
    } finally {
      setCheckInLocationLoading(false);
    }
  }

  async function refreshCheckOutLocation() {
    setCheckOutLocationLoading(true);
    setCheckOutLocationError("");
    try {
      const position = await requestCurrentPosition();
      const latitude = Number(position.coords?.latitude);
      const longitude = Number(position.coords?.longitude);
      const accuracy = Number(position.coords?.accuracy || 0);
      const siteLatitude = Number(currentSite?.record?.["construction_site.latitude"]);
      const siteLongitude = Number(currentSite?.record?.["construction_site.longitude"]);
      const distanceFromSite =
        Number.isFinite(siteLatitude) && Number.isFinite(siteLongitude)
          ? Math.round(haversineDistanceMeters(latitude, longitude, siteLatitude, siteLongitude))
          : null;
      const nextLocation = {
        latitude,
        longitude,
        accuracy,
        distanceFromSite,
      };
      setCheckOutLocation(nextLocation);
      return nextLocation;
    } catch (err) {
      setCheckOutLocation(null);
      setCheckOutLocationError(geolocationErrorMessage(err, locale));
      return null;
    } finally {
      setCheckOutLocationLoading(false);
    }
  }

  async function startCheckInFlow() {
    if (!worker?.record_id) return;
    if (!activeProjectId) {
      setError(t(locale, "no_project_assigned"));
      return;
    }
    setError("");
    setSuccess("");
    setCheckInPromptOpen(true);
    setCheckInCameraError("");
    setCheckInLocation(null);
    setCheckInLocationError("");
    await refreshCheckInLocation();
  }

  async function startCheckOutFlow() {
    if (!worker?.record_id || !openEntry) return;
    setError("");
    setSuccess("");
    setCheckOutPromptOpen(true);
    setCheckOutCameraError("");
    setCheckOutLocation(null);
    setCheckOutLocationError("");
    await refreshCheckOutLocation();
  }

  async function confirmCheckIn(photoFile) {
    if (!worker?.record_id || !activeProjectId) return;
    if (!photoFile) {
      setCheckInLocationError("");
      setError(t(locale, "photo_required_clock_in"));
      return;
    }
    let nextLocation = checkInLocation;
    if (!nextLocation) {
      nextLocation = await refreshCheckInLocation();
    }
    if (!nextLocation) {
      setError(checkInLocationError || t(locale, "gps_required_clock_in"));
      return;
    }
    const allowedRadiusMeters = Number(currentSite?.record?.["construction_site.allowed_radius_m"] || 0);
    if (
      allowedRadiusMeters > 0 &&
      Number.isFinite(nextLocation.distanceFromSite) &&
      nextLocation.distanceFromSite > allowedRadiusMeters
    ) {
      setError(t(locale, "outside_radius", { distance: nextLocation.distanceFromSite, allowed: allowedRadiusMeters }));
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const uploadedAttachment = await uploadAttachment(photoFile);
      const created = await createTimeEntry({
        "time_entry.project_id": activeProjectId,
        "time_entry.worker_id": worker.record_id,
        "time_entry.site_id": activeSiteId,
        "time_entry.crew_id": activeCrewId,
        "time_entry.entry_date": todayDate(),
        "time_entry.check_in_at": nowIso(),
        "time_entry.check_in_latitude": nextLocation.latitude,
        "time_entry.check_in_longitude": nextLocation.longitude,
        "time_entry.check_in_accuracy_m": nextLocation.accuracy,
        "time_entry.check_in_distance_from_site_m": nextLocation.distanceFromSite,
        "time_entry.status": "open",
        "time_entry.source": "pwa",
      });
      if (uploadedAttachment?.id && created?.record_id) {
        await linkAttachmentToRecord({
          attachmentId: uploadedAttachment.id,
          entityId: "entity.time_entry",
          recordId: created.record_id,
          purpose: "check_in_photo",
        });
      }
      resetCheckInPrompt();
      setSuccess(t(locale, "clock_in_saved"));
      await loadWorkerContext(session);
    } catch (err) {
      setError(err.message || t(locale, "save_failed"));
    } finally {
      setLoading(false);
    }
  }

  async function confirmCheckOut(photoFile) {
    if (!worker?.record_id || !openEntry) return;
    if (!photoFile) {
      setCheckOutLocationError("");
      setError(t(locale, "photo_required_clock_out"));
      return;
    }
    let nextLocation = checkOutLocation;
    if (!nextLocation) {
      nextLocation = await refreshCheckOutLocation();
    }
    if (!nextLocation) {
      setError(checkOutLocationError || t(locale, "gps_required_clock_out"));
      return;
    }
    const allowedRadiusMeters = Number(currentSite?.record?.["construction_site.allowed_radius_m"] || 0);
    if (
      allowedRadiusMeters > 0 &&
      Number.isFinite(nextLocation.distanceFromSite) &&
      nextLocation.distanceFromSite > allowedRadiusMeters
    ) {
      setError(t(locale, "outside_radius", { distance: nextLocation.distanceFromSite, allowed: allowedRadiusMeters }));
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const before = openEntry.record || {};
      const checkIn = before["time_entry.check_in_at"] ? new Date(before["time_entry.check_in_at"]) : null;
      const checkOut = new Date();
      const hoursWorked =
        checkIn instanceof Date && !Number.isNaN(checkIn.valueOf())
          ? Math.max(0, Math.round((((checkOut - checkIn) / 36e5) || 0) * 100) / 100)
          : undefined;
      const uploadedAttachment = await uploadAttachment(photoFile);
      await updateTimeEntry(openEntry.record_id, {
        ...before,
        "time_entry.id": openEntry.record_id,
        "time_entry.project_id": before["time_entry.project_id"] || activeProjectId,
        "time_entry.worker_id": before["time_entry.worker_id"] || worker.record_id,
        "time_entry.site_id": before["time_entry.site_id"] || activeSiteId,
        "time_entry.crew_id": before["time_entry.crew_id"] || activeCrewId,
        "time_entry.entry_date": before["time_entry.entry_date"] || todayDate(),
        "time_entry.check_out_at": checkOut.toISOString(),
        "time_entry.check_out_latitude": nextLocation.latitude,
        "time_entry.check_out_longitude": nextLocation.longitude,
        "time_entry.check_out_accuracy_m": nextLocation.accuracy,
        "time_entry.check_out_distance_from_site_m": nextLocation.distanceFromSite,
        "time_entry.hours_worked": hoursWorked,
        "time_entry.status": "closed",
        "time_entry.source": before["time_entry.source"] || "pwa",
      });
      if (uploadedAttachment?.id) {
        await linkAttachmentToRecord({
          attachmentId: uploadedAttachment.id,
          entityId: "entity.time_entry",
          recordId: openEntry.record_id,
          purpose: "check_out_photo",
        });
      }
      resetCheckOutPrompt();
      setSuccess(t(locale, "clock_out_saved"));
      await loadWorkerContext(session);
    } catch (err) {
      setError(err.message || t(locale, "save_failed"));
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
      setError(t(locale, "no_project_assigned"));
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const quantity = Number(materialQty);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(t(locale, "quantity_required"));
      }
      if (!selectedMaterialItemId) {
        throw new Error(t(locale, "choose_catalog_material"));
      }
      const materialItem = materialItemById[selectedMaterialItemId];
      if (!materialItem) {
        throw new Error(t(locale, "material_missing"));
      }
      const nextMaterialType = String(materialItem.record?.["item.material_type"] || "").trim();
      if (!nextMaterialType) {
        throw new Error(t(locale, "material_type_required"));
      }
      const unitCost = Number(materialItem.record?.["item.cost_price"]);
      const record = {
        "material_log.project_id": activeProjectId,
        "material_log.site_id": activeSiteId,
        "material_log.log_date": todayDate(),
        "material_log.item_id": selectedMaterialItemId,
        "material_log.material_type": nextMaterialType,
        "material_log.quantity": quantity,
        "material_log.unit": materialUnit,
        "material_log.unit_cost": Number.isFinite(unitCost) ? unitCost : 0,
        "material_log.entered_by_worker_id": worker.record_id,
        "material_log.status": "submitted",
      };
      if (editingMaterialId) {
        const existingLog = materialLogs.find((item) => item.record_id === editingMaterialId)?.record || {};
        await updateMaterialLog(editingMaterialId, {
          ...existingLog,
          ...record,
          "material_log.id": editingMaterialId,
        });
        setSuccess(t(locale, "material_updated"));
      } else {
        await createMaterialLog(record);
        setSuccess(t(locale, "material_added_success"));
      }
      setMaterialQty("");
      setSelectedMaterialItemId("");
      setMaterialUnit("");
      setEditingMaterialId("");
      setMaterialModalOpen(false);
      setMaterialLogs(await getProjectMaterialLogs(activeProjectId, worker.record_id));
    } catch (err) {
      setError(err.message || t(locale, "save_failed"));
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
          date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date),
          time: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(date),
        };
      }
    }
    const logDate = log.record?.["material_log.log_date"];
    if (!logDate) return null;
    const date = new Date(logDate);
    if (Number.isNaN(date.valueOf())) return { date: String(logDate), time: "" };
    return {
      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date),
      time: "",
    };
  }

  function openMaterialEditor(log) {
    const nextItemId = log.record?.["material_log.item_id"] || "";
    setExpandedMaterialId("");
    setEditingMaterialId(log.record_id);
    setSelectedMaterialItemId(nextItemId);
    setMaterialQty(String(log.record?.["material_log.quantity"] ?? ""));
    setMaterialUnit(log.record?.["material_log.unit"] || defaultUnitForMaterial(materialItemById[nextItemId]));
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
      setSuccess(t(locale, "material_deleted"));
      setMaterialLogs(await getProjectMaterialLogs(activeProjectId, worker.record_id));
    } catch (err) {
      setError(err.message || t(locale, "delete_failed"));
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
          <h1 className="text-center text-3xl font-black tracking-tight">{t(locale, "login_title")}</h1>
          <input
            className="input input-bordered input-lg w-full"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t(locale, "email")}
            required
          />
          <input
            className="input input-bordered input-lg w-full"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t(locale, "password")}
            required
          />
          <button className="btn btn-lg w-full" style={primarySurfaceStyle} disabled={loading} type="submit">
            {loading ? <span className="loading loading-spinner" /> : t(locale, "login")}
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
        <h1 className="text-3xl font-black tracking-tight">{t(locale, "no_worker_title")}</h1>
        <p className="mt-2 text-base text-base-content/70">{t(locale, "no_worker_body")}</p>
        <button className="btn btn-ghost mt-6 w-fit px-0 text-sm" disabled={loading} onClick={handleLogout}>
          {t(locale, "logout")}
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
          locale={locale}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="space-y-2 text-center">
            <p className="text-4xl font-black tracking-tight">{t(locale, "no_project_title")}</p>
            <p className="text-base text-base-content/70">{t(locale, "no_project_body")}</p>
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
          locale={locale}
        />
      </div>

      {isClockedIn ? (
        <>
          <div className="shrink-0">
            <div className="-mx-4 mt-3 flex items-center justify-between rounded-none bg-base-200 px-4 py-3">
              <div>
                <p className="text-xl font-semibold tabular-nums">{liveTimer}</p>
              </div>
              <button className="btn" style={clockOutStyle} onClick={startCheckOutFlow} disabled={loading}>
                {loading ? <span className="loading loading-spinner" /> : t(locale, "clock_out")}
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
                setSelectedMaterialItemId("");
                setMaterialQty("");
                setMaterialUnit("");
                setMaterialModalOpen(true);
              }}
              disabled={loading || !activeProjectId}
            >
              {t(locale, "add_material")}
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
                              <span className="text-base-content/75">
                                {materialDisplayLabel(materialItemById[log.record?.["material_log.item_id"]]) ||
                                  log.record?.["material_log.material_type"] ||
                                  t(locale, "material_fallback")}
                              </span>
                              <span className="text-base-content/60">
                                <span>
                                  {log.record?.["material_log.quantity"]}{" "}
                                  {unitLabel(log.record?.["material_log.unit"], log.record?.["material_log.quantity"], locale)}
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
                                    {t(locale, "edit")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm flex-1"
                                    style={primarySoftStyle}
                                    onClick={() => handleDeleteMaterial(log)}
                                    disabled={loading}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    {t(locale, "delete")}
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
                      {t(locale, "material_empty")}
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
                <p className="text-3xl font-black tracking-tight">{t(locale, "choose_project")}</p>
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
                          {project.record?.["construction_project.name"] || t(locale, "project_fallback")}
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
                <p className="text-2xl font-bold tracking-tight">{t(locale, "ready_to_start")}</p>
                <p className="text-2xl font-bold tracking-tight">{currentSiteName}?</p>
              </div>
              <button
                className="btn btn-lg h-16 w-full text-lg"
                style={clockInStyle}
                onClick={startCheckInFlow}
                disabled={loading || !activeProjectId}
              >
                {loading ? <span className="loading loading-spinner" /> : t(locale, "take_photo_clock_in")}
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
          locale={locale}
        />
      ) : null}

      {updatePromptVisible && !installPromptVisible ? <UpdatePrompt onUpdate={handleApplyUpdate} locale={locale} /> : null}

      {(error || success) && <Toast error={error} success={success} />}

      {materialModalOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label={t(locale, "close_window")}
            onClick={() => {
              if (!loading) {
                setMaterialModalOpen(false);
              }
            }}
          />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-sm rounded-t-[28px] bg-base-100 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-3 shadow-2xl">
            <div className="mb-3 flex justify-center">
              <div className="h-1.5 w-14 rounded-full bg-base-300" />
            </div>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{editingMaterialId ? t(locale, "edit_material") : t(locale, "add_material_title")}</h3>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => {
                  setMaterialModalOpen(false);
                }}
                disabled={loading}
                aria-label={t(locale, "close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-3" onSubmit={handleMaterialSubmit}>
              <select
                className="select select-bordered h-12 min-h-12 w-full bg-base-100 text-base"
                value={selectedMaterialItemId}
                onChange={(event) => setSelectedMaterialItemId(event.target.value)}
                disabled={loading}
                required
              >
                <option value="">{t(locale, "choose_material")}</option>
                {materialItems.map((item) => (
                  <option key={item.record_id} value={item.record_id}>
                    {materialDisplayLabel(item)}
                  </option>
                ))}
              </select>

              <div className="join w-full">
                <input
                  className="input input-bordered join-item h-12 min-h-12 w-full text-center text-2xl font-semibold"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={materialQty}
                  onChange={(event) => setMaterialQty(event.target.value)}
                  placeholder={t(locale, "quantity")}
                  disabled={loading}
                />
                <span
                  className="join-item inline-flex h-12 min-h-12 w-28 items-center justify-center border border-base-content/20 border-l-0 bg-base-100 px-4 text-sm font-medium text-base-content/70"
                >
                  {unitLabel(materialUnit, materialQty, locale)}
                </span>
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

              <button className="btn h-12 min-h-12 w-full" style={primarySurfaceStyle} disabled={loading} type="submit">
                {loading ? <span className="loading loading-spinner" /> : editingMaterialId ? t(locale, "update") : t(locale, "add")}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {checkInPromptOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label={t(locale, "close_window")}
            onClick={() => {
              if (!loading) resetCheckInPrompt();
            }}
          />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-sm rounded-t-[28px] bg-base-100 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-3 shadow-2xl">
            <div className="mb-3 flex justify-center">
              <div className="h-1.5 w-14 rounded-full bg-base-300" />
            </div>
            <div className="relative mb-3 text-center">
              <h3 className="text-lg font-bold">{t(locale, "verify_clock_in")}</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle absolute right-0 top-0"
                onClick={() => {
                  if (!loading) resetCheckInPrompt();
                }}
                disabled={loading}
                aria-label={t(locale, "close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-center">
              <div className="space-y-3">
                <div className="mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-[var(--rounded-btn)] bg-base-300/40">
                  <video
                    ref={checkInCameraVideoRef}
                    className="h-full w-full object-cover"
                    autoPlay
                    muted
                    playsInline
                  />
                </div>
                {checkInCameraError ? <p className="text-sm text-error">{checkInCameraError}</p> : null}
              </div>

              <button
                className="btn h-12 min-h-12 w-full"
                style={clockInStyle}
                type="button"
                onClick={captureAndConfirmCheckIn}
                disabled={loading || checkInCameraLoading}
              >
                {loading || checkInCameraLoading ? <span className="loading loading-spinner" /> : t(locale, "take_photo_clock_in")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {checkOutPromptOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label={t(locale, "close_window")}
            onClick={() => {
              if (!loading) resetCheckOutPrompt();
            }}
          />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-sm rounded-t-[28px] bg-base-100 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-3 shadow-2xl">
            <div className="mb-3 flex justify-center">
              <div className="h-1.5 w-14 rounded-full bg-base-300" />
            </div>
            <div className="relative mb-3 text-center">
              <h3 className="text-lg font-bold">{t(locale, "verify_clock_out")}</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle absolute right-0 top-0"
                onClick={() => {
                  if (!loading) resetCheckOutPrompt();
                }}
                disabled={loading}
                aria-label={t(locale, "close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-center">
              <div className="space-y-3">
                <div className="mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-[var(--rounded-btn)] bg-base-300/40">
                  <video
                    ref={checkOutCameraVideoRef}
                    className="h-full w-full object-cover"
                    autoPlay
                    muted
                    playsInline
                  />
                </div>
                {checkOutCameraError ? <p className="text-sm text-error">{checkOutCameraError}</p> : null}
              </div>

              <button
                className="btn h-12 min-h-12 w-full"
                style={clockOutStyle}
                type="button"
                onClick={captureAndConfirmCheckOut}
                disabled={loading || checkOutCameraLoading}
              >
                {loading || checkOutCameraLoading ? <span className="loading loading-spinner" /> : t(locale, "take_photo_clock_out")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function TopBar({ loading, menuOpen, onMenuToggle, onLogout, siteName, showBackButton = false, onBack, locale = DEFAULT_LOCALE }) {
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
            aria-label={t(locale, "back")}
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
          aria-label={t(locale, "open_menu")}
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
      {menuOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/30"
            aria-label={t(locale, "close_menu")}
            onClick={() => onMenuToggle(false)}
          />
          <aside ref={menuRef} className="fixed top-0 right-0 z-50 flex h-full w-72 flex-col bg-base-100 shadow-xl">
            <div className="flex items-center justify-between border-b border-base-300 px-4 py-4">
              <p className="text-base font-semibold">{t(locale, "menu")}</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => onMenuToggle(false)}
                disabled={loading}
                aria-label={t(locale, "close_menu")}
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
                {t(locale, "logout")}
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

function InstallPrompt({ canInstall, onInstall, onDismiss, locale = DEFAULT_LOCALE }) {
  const iosInstructions = isIosDevice() && isSafariBrowser();

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-sm rounded-[var(--rounded-btn)] border border-base-300 bg-base-100 p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">{t(locale, "install_title")}</p>
            <p className="mt-1 text-sm text-base-content/70">
              {iosInstructions
                ? t(locale, "install_body_ios")
                : t(locale, "install_body_other")}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-circle shrink-0" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {iosInstructions ? (
          <div className="mt-4 rounded-[var(--rounded-btn)] bg-base-200/60 p-3 text-sm text-base-content/75">
            <p>{t(locale, "install_step_1")}</p>
            <p className="mt-1">{t(locale, "install_step_2")}</p>
            <p className="mt-1">{t(locale, "install_step_3")}</p>
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
              {t(locale, "install_title")}
            </button>
          ) : null}
          <button type="button" className="btn btn-soft w-full whitespace-nowrap sm:flex-1" onClick={onDismiss}>
            {iosInstructions ? t(locale, "close") : t(locale, "later")}
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdatePrompt({ onUpdate, locale = DEFAULT_LOCALE }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-sm rounded-[var(--rounded-btn)] border border-base-300 bg-base-100 p-4 shadow-lg">
        <p className="text-sm font-semibold">{t(locale, "update_title")}</p>
        <p className="mt-1 text-sm text-base-content/70">{t(locale, "update_body")}</p>
        <button type="button" className="btn mt-3 w-full" style={primarySurfaceStyle} onClick={onUpdate}>
          {t(locale, "update_now")}
        </button>
      </div>
    </div>
  );
}
