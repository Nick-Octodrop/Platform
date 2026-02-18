import React from "react";
import { Link } from "react-router-dom";

export default function UserMenu({ user, onSignOut }) {
  const email = user?.email || "Account";

  return (
    <div className="dropdown dropdown-end">
      <label tabIndex={0} className="btn btn-ghost btn-sm">
        {email}
      </label>
      <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
        <li><Link to="/settings">Settings</Link></li>
        <li><button onClick={onSignOut}>Sign out</button></li>
      </ul>
    </div>
  );
}
