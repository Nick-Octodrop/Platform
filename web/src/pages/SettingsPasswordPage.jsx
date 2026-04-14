import React from "react";
import PasswordChangeForm from "../ui/PasswordChangeForm.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function SettingsPasswordPage({ user }) {
  const { t } = useI18n();
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-lg max-w-md w-full">
        <div className="card-body">
          <h2 className="card-title">{t("settings.change_password")}</h2>
          <p className="text-sm opacity-70">{t("settings.password_description")}</p>
          <div className="mt-3">
            <PasswordChangeForm user={user} showCurrentPassword />
          </div>
        </div>
      </div>
    </div>
  );
}
