import React from "react";

export default function LoadingSpinner({ className = "min-h-[40vh]" }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <span className="loading loading-spinner loading-lg"></span>
    </div>
  );
}
