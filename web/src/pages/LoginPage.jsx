import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [sendingReset, setSendingReset] = useState(false);
  const navigate = useNavigate();

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    navigate("/home");
  }

  async function handleForgotPassword() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError(t("settings.auth.enter_email_first"));
      return;
    }
    setSendingReset(true);
    try {
      const redirectTo = `${window.location.origin}/auth/set-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (resetError) throw resetError;
      setNotice(t("settings.auth.password_reset_sent"));
    } catch (err) {
      setError(err?.message || t("settings.auth.password_reset_failed"));
    } finally {
      setSendingReset(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-lg max-w-md w-full">
        <div className="card-body">
          <h2 className="card-title">{t("settings.auth.login_title")}</h2>
          {error && <div className="alert alert-error">{error}</div>}
          {notice && <div className="alert alert-success">{notice}</div>}
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              className="input input-bordered input-sm w-full"
              type="email"
              placeholder={t("settings.email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="input input-bordered input-sm w-full"
              type="password"
              placeholder={t("settings.auth.password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="btn btn-primary w-full" type="submit">
              {t("settings.auth.login_action")}
            </button>
            <button className="btn btn-ghost btn-sm w-full" type="button" onClick={handleForgotPassword} disabled={sendingReset}>
              {sendingReset ? t("settings.auth.sending_reset") : t("settings.auth.forgot_password")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
