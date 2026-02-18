import React, { useState } from "react";
import { supabase } from "../supabase";

export default function PasswordChangeForm({ user, showCurrentPassword = true, onSuccess }) {
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
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password must match.");
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
        if (signInError) throw new Error("Current password is incorrect.");
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNotice("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onSuccess?.();
    } catch (err) {
      setError(err?.message || "Failed to update password.");
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
            placeholder="Current password"
          />
        )}
        <input
          className="input input-bordered input-sm w-full"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={saving}
          required
          placeholder="New password (min 8 chars)"
        />
        <input
          className="input input-bordered input-sm w-full"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={saving}
          required
          placeholder="Confirm new password"
        />
        <button className="btn btn-primary btn-sm w-full" type="submit" disabled={saving}>
          {saving ? "Updating..." : "Update password"}
        </button>
      </form>
    </div>
  );
}

