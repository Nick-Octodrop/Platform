import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { getSafeSession, supabase } from "../supabase";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function AuthSetPasswordPage({ user }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canSet = !!user;
  const email = useMemo(() => user?.email || "", [user]);
  const handoffRequired = user?.app_metadata?.octo_managed_account_state === "handoff_required";

  async function exitToLogin() {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // ignore local sign-out failures and still return to login
    }
    navigate("/login", { replace: true });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!password || password.length < 8) {
      setError(t("settings.password_min_length"));
      return;
    }
    if (password !== confirm) {
      setError(t("settings.passwords_must_match"));
      return;
    }
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      if (handoffRequired) {
        await apiFetch("/access/password-handoff/complete", { method: "POST", body: {} });
        await getSafeSession({ forceRefresh: true });
        setNotice(t("settings.auth.password_updated_redirecting"));
        setTimeout(() => {
          exitToLogin();
        }, 700);
        return;
      }
      setNotice(t("settings.auth.password_updated_redirecting"));
      setTimeout(() => navigate("/home", { replace: true }), 700);
    } catch (err) {
      setError(err?.message || t("settings.auth.set_password_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-lg max-w-md w-full">
        <div className="card-body">
          <h1 className="card-title">{t("settings.auth.set_password_title")}</h1>
          <p className="text-sm opacity-70">
            {canSet
              ? t("settings.auth.signed_in_as", { email: email || t("settings.auth.user") })
              : t("settings.auth.open_from_email_link")}
          </p>
          {error ? <div className="alert alert-error">{error}</div> : null}
          {notice ? <div className="alert alert-success">{notice}</div> : null}
          <form className="space-y-3" onSubmit={handleSubmit}>
            <input
              className="input input-bordered input-sm w-full"
              type="password"
              placeholder={t("settings.auth.new_password")}
              value={password}
              disabled={!canSet || saving}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <input
              className="input input-bordered input-sm w-full"
              type="password"
              placeholder={t("settings.auth.confirm_password")}
              value={confirm}
              disabled={!canSet || saving}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <button className="btn btn-primary btn-sm w-full" type="submit" disabled={!canSet || saving}>
              {saving ? t("common.saving") : t("settings.auth.set_password_action")}
            </button>
          </form>
          <div className="text-sm mt-2">
            <button className="link link-primary" type="button" onClick={exitToLogin}>
              {t("settings.auth.back_to_login")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
