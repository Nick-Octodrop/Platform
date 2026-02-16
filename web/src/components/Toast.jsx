import React, { createContext, useContext, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  function pushToast(type, message) {
    const id = Date.now().toString(36);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div className="toast toast-top toast-end z-50">
        {toasts.map((t) => (
          <div key={t.id} className={`alert ${t.type === "error" ? "alert-error" : t.type === "success" ? "alert-success" : "alert-info"}`}>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
