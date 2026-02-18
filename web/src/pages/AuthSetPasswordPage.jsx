import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabase";

export default function AuthSetPasswordPage({ user }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canSet = !!user;
  const email = useMemo(() => user?.email || "", [user]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setNotice("Password updated. Redirecting…");
      setTimeout(() => navigate("/home", { replace: true }), 700);
    } catch (err) {
      setError(err?.message || "Failed to set password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-lg max-w-md w-full">
        <div className="card-body">
          <h1 className="card-title">Set Password</h1>
          <p className="text-sm opacity-70">
            {canSet ? `Signed in as ${email || "user"}. Set your password to continue.` : "Open this page from a valid invite or password reset email link."}
          </p>
          {error ? <div className="alert alert-error">{error}</div> : null}
          {notice ? <div className="alert alert-success">{notice}</div> : null}
          <form className="space-y-3" onSubmit={handleSubmit}>
            <input
              className="input input-bordered input-sm w-full"
              type="password"
              placeholder="New password"
              value={password}
              disabled={!canSet || saving}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <input
              className="input input-bordered input-sm w-full"
              type="password"
              placeholder="Confirm password"
              value={confirm}
              disabled={!canSet || saving}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <button className="btn btn-primary btn-sm w-full" type="submit" disabled={!canSet || saving}>
              {saving ? "Saving..." : "Set password"}
            </button>
          </form>
          <div className="text-sm mt-2">
            <Link className="link link-primary" to="/login">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
