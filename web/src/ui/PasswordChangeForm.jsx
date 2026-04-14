import React, { useState } from "react";
import { supabase } from "../supabase";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function PasswordChangeForm({ user, showCurrentPassword = true, onSuccess }) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!newPassword || newPassword.length < 8) {
      setError(t("settings.password_min_length"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("settings.passwords_must_match"));
      return;
    }
    setSaving(true);
    try {
      // Optional re-auth helps provide a better error when the current password is wrong.
      if (showCurrentPassword && currentPassword && user?.email) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });
        if (signInError) throw new Error(t("settings.current_password_incorrect"));
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNotice(t("settings.password_updated"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onSuccess?.();
    } catch (err) {
      setError(err?.message || t("settings.password_update_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {error ? <div className="alert alert-error mb-3">{error}</div> : null}
      {notice ? <div className="alert alert-success mb-3">{notice}</div> : null}
      <form className="space-y-3" onSubmit={handleSubmit}>
        {showCurrentPassword && (
          <input
            className="input input-bordered input-sm w-full"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={saving}
            placeholder={t("settings.current_password")}
          />
        )}
        <input
          className="input input-bordered input-sm w-full"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={saving}
          required
          placeholder={t("settings.new_password")}
        />
        <input
          className="input input-bordered input-sm w-full"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={saving}
          required
          placeholder={t("settings.confirm_new_password")}
        />
        <button className="btn btn-primary btn-sm w-full" type="submit" disabled={saving}>
          {saving ? t("settings.updating_password") : t("settings.update_password")}
        </button>
      </form>
    </div>
  );
}
