import React from "react";
import PasswordChangeForm from "../ui/PasswordChangeForm.jsx";

export default function SettingsPasswordPage({ user }) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-lg max-w-md w-full">
        <div className="card-body">
          <h2 className="card-title">Change Password</h2>
          <p className="text-sm opacity-70">Update your account password used for login.</p>
          <div className="mt-3">
            <PasswordChangeForm user={user} showCurrentPassword />
          </div>
        </div>
      </div>
    </div>
  );
}
