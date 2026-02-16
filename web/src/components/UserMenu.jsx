import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getInitialTheme, setTheme } from "../theme/theme.js";

export default function UserMenu({ user, onSignOut }) {
  const [theme, setThemeState] = useState(getInitialTheme());
  const email = user?.email || "Account";

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  function toggleTheme() {
    setThemeState(theme === "dark" ? "light" : "dark");
  }

  return (
    <div className="dropdown dropdown-end">
      <label tabIndex={0} className="btn btn-ghost btn-sm">
        {email}
      </label>
      <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
        <li><Link to="/settings">Settings</Link></li>
        <li><button onClick={toggleTheme}>Theme: {theme === "dark" ? "Dark" : "Light"}</button></li>
        <li><button onClick={onSignOut}>Sign out</button></li>
      </ul>
    </div>
  );
}
