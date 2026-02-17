import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase";

export default function LoginPage() {
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
      setError("Enter your email first.");
      return;
    }
    setSendingReset(true);
    try {
      const redirectTo = `${window.location.origin}/auth/set-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (resetError) throw resetError;
      setNotice("Password reset email sent.");
    } catch (err) {
      setError(err?.message || "Failed to send password reset email.");
    } finally {
      setSendingReset(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-lg max-w-md w-full">
        <div className="card-body">
          <h2 className="card-title">Login</h2>
          {error && <div className="alert alert-error">{error}</div>}
          {notice && <div className="alert alert-success">{notice}</div>}
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              className="input input-bordered w-full"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="input input-bordered w-full"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="btn btn-primary w-full" type="submit">
              Login
            </button>
            <button className="btn btn-ghost btn-sm w-full" type="button" onClick={handleForgotPassword} disabled={sendingReset}>
              {sendingReset ? "Sending reset..." : "Forgot password?"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
