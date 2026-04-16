import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import { decodeIntegrationOauthState, buildIntegrationOauthRedirectUri } from "../utils/integrationsOAuth.js";

export default function IntegrationOAuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("Processing OAuth callback...");
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    async function run() {
      const code = searchParams.get("code") || "";
      const state = decodeIntegrationOauthState(searchParams.get("state"));
      const providerKey = String(state?.providerKey || "xero").trim().toLowerCase();
      const connectionId = String(state?.connectionId || "").trim();
      const returnOrigin = String(state?.returnOrigin || "").trim().replace(/\/+$/, "");
      const providerError = searchParams.get("error");
      const providerErrorDescription = searchParams.get("error_description");
      const redirectUri = buildIntegrationOauthRedirectUri(window.location.origin, providerKey, connectionId);

      if (providerError) {
        if (!cancelled) {
          setError(providerErrorDescription || providerError);
          setStatus("OAuth authorization failed.");
        }
        return;
      }
      if (!connectionId) {
        if (!cancelled) {
          setError("Missing integration connection in OAuth state.");
          setStatus("OAuth callback could not be matched to a connection.");
        }
        return;
      }
      if (!code) {
        if (!cancelled) {
          setError("Missing OAuth authorization code.");
          setStatus("OAuth callback did not include a code.");
        }
        return;
      }

      try {
        if (!cancelled) setStatus("Exchanging OAuth code...");
        await apiFetch(`/integrations/connections/${encodeURIComponent(connectionId)}/oauth/exchange`, {
          method: "POST",
          body: {
            code,
            redirect_uri: redirectUri,
          },
        });
        if (!cancelled) {
          const nextPath = `/integrations/connections/${encodeURIComponent(connectionId)}?oauth=connected`;
          if (returnOrigin && returnOrigin !== window.location.origin.replace(/\/+$/, "")) {
            window.location.assign(`${returnOrigin}${nextPath}`);
            return;
          }
          navigate(nextPath, { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "OAuth exchange failed");
          setStatus("OAuth exchange failed.");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-base-200 px-4">
      <div className="w-full max-w-lg rounded-box border border-base-300 bg-base-100 p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Integration OAuth</h1>
        <p className="mt-2 text-sm opacity-80">{status}</p>
        {error ? <pre className="mt-4 overflow-auto rounded-box bg-base-200 p-3 text-xs text-error">{error}</pre> : null}
      </div>
    </div>
  );
}
