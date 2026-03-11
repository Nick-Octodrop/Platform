import React from "react";
import { Link } from "react-router-dom";

export default function UserMenu({ user, onSignOut }) {
  const email = user?.email || "Account";
  const compact = user?.email ? user.email.split("@")[0] : "Account";

  return (
    <div className="dropdown dropdown-end">
      <label tabIndex={0} className="btn btn-ghost btn-sm max-w-[9rem] sm:max-w-[14rem]">
        <span className="sm:hidden truncate">{compact}</span>
        <span className="hidden sm:inline truncate">{email}</span>
      </label>
      <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
        <li><Link to="/settings">Settings</Link></li>
        <li><button onClick={onSignOut}>Sign out</button></li>
      </ul>
    </div>
  );
}
