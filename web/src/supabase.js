import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const realtimeFlag = (import.meta.env.VITE_SUPABASE_REALTIME || "").toLowerCase();

export const realtimeEnabled = realtimeFlag === "1" || realtimeFlag === "true" || realtimeFlag === "yes";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
