"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import {
  STARTER_PROMPTS,
  PLACEHOLDER_INPUT,
  GREETING,
  CREATE_SESSION_ENDPOINT,
  WORKFLOW_ID,
  getThemeConfig,
} from "@/lib/config";
import { ErrorOverlay } from "./ErrorOverlay";
import type { ColorScheme } from "@/hooks/useColorScheme";

export type FactAction = {
  type: "save";
  factId: string;
  factText: string;
};

type ChatKitPanelProps = {
  theme: ColorScheme;
  onWidgetAction: (action: FactAction) => Promise<void>;
  onResponseEnd: () => void;
  onThemeRequest: (scheme: ColorScheme) => void;
};

type ErrorState = {
  script: string | null;
  session: string | null;
  integration: string | null;
  retryable: boolean;
};

type SessionCache = {
  secret: string;
  expiresAt: number;
};

const SESSION_CACHE_BUFFER_MS = 60_000;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;

const isBrowser = typeof window !== "undefined";
const isDev = process.env.NODE_ENV !== "production";

const createInitialErrors = (): ErrorState => ({
  script: null,
  session: null,
  integration: null,
  retryable: false,
});

export function ChatKitPanel({
  theme,
  onWidgetAction,
  onResponseEnd,
  onThemeRequest,
}: ChatKitPanelProps) {
  const processedFacts = useRef(new Set<string>());
  const sessionCacheRef = useRef<SessionCache | null>(null);
  const pendingSessionRef = useRef<Promise<string> | null>(null);
  const [errors, setErrors] = useState<ErrorState>(() => createInitialErrors());
  const [isInitializingSession, setIsInitializingSession] = useState(true);
  const isMountedRef = useRef(true);
  const [scriptStatus, setScriptStatus] = useState<
    "pending" | "ready" | "error"
  >(() =>
    isBrowser && window.customElements?.get("openai-chatkit")
      ? "ready"
      : "pending"
  );
  const [widgetInstanceKey, setWidgetInstanceKey] = useState(0);

  const setErrorState = useCallback((updates: Partial<ErrorState>) => {
    setErrors((current) => ({ ...current, ...updates }));
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isBrowser) {
      return;
    }

    let timeoutId: number | undefined;

    const handleLoaded = () => {
      if (!isMountedRef.current) {
        return;
      }
      setScriptStatus("ready");
      setErrorState({ script: null });
    };

    const handleError = (event: Event) => {
      console.error("Failed to load chatkit.js for some reason", event);
      if (!isMountedRef.current) {
        return;
      }
      setScriptStatus("error");
      const detail = (event as CustomEvent<unknown>)?.detail ?? "unknown error";
      setErrorState({ script: `Error: ${detail}`, retryable: false });
      setIsInitializingSession(false);
    };

    window.addEventListener("chatkit-script-loaded", handleLoaded);
    window.addEventListener(
      "chatkit-script-error",
      handleError as EventListener
    );

    if (window.customElements?.get("openai-chatkit")) {
      handleLoaded();
    } else if (scriptStatus === "pending") {
      timeoutId = window.setTimeout(() => {
        if (!window.customElements?.get("openai-chatkit")) {
          handleError(
            new CustomEvent("chatkit-script-error", {
              detail:
                "ChatKit web component is unavailable. Verify that the script URL is reachable.",
            })
          );
        }
      }, 5000);
    }

    return () => {
      window.removeEventListener("chatkit-script-loaded", handleLoaded);
      window.removeEventListener(
        "chatkit-script-error",
        handleError as EventListener
      );
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [scriptStatus, setErrorState]);

  const isWorkflowConfigured = Boolean(
    WORKFLOW_ID && !WORKFLOW_ID.startsWith("wf_replace")
  );

  useEffect(() => {
    if (!isWorkflowConfigured && isMountedRef.current) {
      setErrorState({
        session: "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID in your .env.local file.",
        retryable: false,
      });
      setIsInitializingSession(false);
    }
  }, [isWorkflowConfigured, setErrorState]);

  const handleResetChat = useCallback(() => {
    const run = async () => {
      // Best-effort: ask server to clear the HttpOnly session cookie so a fresh
      // user id is generated on next session.
      try {
        await fetch("/api/clear-session", { method: "POST" });
      } catch {
        // ignore
      }

      processedFacts.current.clear();
      sessionCacheRef.current = null;
      pendingSessionRef.current = null;
      if (isBrowser) {
        setScriptStatus(
          window.customElements?.get("openai-chatkit") ? "ready" : "pending"
        );
      }
      setIsInitializingSession(true);
      setErrors(createInitialErrors());
      setWidgetInstanceKey((prev) => prev + 1);
    };
    void run();
  }, []);

  const getClientSecret = useCallback(
    async (currentSecret: string | null) => {
      if (isDev) {
        console.info("[ChatKitPanel] getClientSecret invoked", {
          currentSecretPresent: Boolean(currentSecret),
          workflowId: WORKFLOW_ID,
          endpoint: CREATE_SESSION_ENDPOINT,
        });
      }

      if (!isWorkflowConfigured) {
        const detail =
          "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID in your .env.local file.";
        if (isMountedRef.current) {
          setErrorState({ session: detail, retryable: false });
          setIsInitializingSession(false);
        }
        throw new Error(detail);
      }

      const now = Date.now();

      if (currentSecret) {
        sessionCacheRef.current = {
          secret: currentSecret,
          expiresAt:
            sessionCacheRef.current?.secret === currentSecret
              ? sessionCacheRef.current.expiresAt
              : now + DEFAULT_SESSION_TTL_MS,
        };

        if (isMountedRef.current) {
          setErrorState({ session: null, integration: null, retryable: false });
          setIsInitializingSession(false);
        }
        return currentSecret;
      }

      const cached = sessionCacheRef.current;
      if (cached && cached.expiresAt - now > SESSION_CACHE_BUFFER_MS) {
        if (isMountedRef.current) {
          setErrorState({ session: null, integration: null, retryable: false });
          setIsInitializingSession(false);
        }
        return cached.secret;
      }

      if (pendingSessionRef.current) {
        if (isMountedRef.current) {
          setIsInitializingSession(true);
        }
        return pendingSessionRef.current;
      }

      if (isMountedRef.current) {
        setIsInitializingSession(true);
        setErrorState({ session: null, integration: null, retryable: false });
      }

      const requestPromise = (async () => {
        try {
          const response = await fetch(CREATE_SESSION_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              workflow: { id: WORKFLOW_ID },
              chatkit_configuration: {
                file_upload: {
                  enabled: true,
                },
              },
            }),
          });

          const raw = await response.text();

          if (isDev) {
            console.info("[ChatKitPanel] createSession response", {
              status: response.status,
              ok: response.ok,
              bodyPreview: raw.slice(0, 1600),
            });
          }

          let data: Record<string, unknown> = {};
          if (raw) {
            try {
              data = JSON.parse(raw) as Record<string, unknown>;
            } catch (parseError) {
              console.error(
                "Failed to parse create-session response",
                parseError
              );
            }
          }

          if (!response.ok) {
            const detail = extractErrorDetail(data, response.statusText);
            console.error("Create session request failed", {
              status: response.status,
              body: data,
            });
            throw new Error(detail);
          }

          const clientSecret = data?.client_secret as string | undefined;
          if (!clientSecret) {
            throw new Error("Missing client secret in response");
          }

          const expiresAt = resolveSessionExpiry(data?.expires_after);
          sessionCacheRef.current = {
            secret: clientSecret,
            expiresAt,
          };

          if (isMountedRef.current) {
            setErrorState({ session: null, integration: null, retryable: false });
          }

          return clientSecret;
        } catch (error) {
          console.error("Failed to create ChatKit session", error);
          const detail =
            error instanceof Error
              ? error.message
              : "Unable to start ChatKit session.";
          if (isMountedRef.current) {
            setErrorState({
              session: detail,
              retryable: isLikelyTransientError(error, detail),
            });
          }
          throw error instanceof Error ? error : new Error(detail);
        } finally {
          if (isMountedRef.current) {
            setIsInitializingSession(false);
          }
        }
      })();

      const trackedPromise = requestPromise.finally(() => {
        pendingSessionRef.current = null;
      });

      pendingSessionRef.current = trackedPromise;
      return trackedPromise;
    },
    [isWorkflowConfigured, setErrorState]
  );

  const chatkit = useChatKit({
    api: { getClientSecret },
    theme: {
      colorScheme: theme,
      ...getThemeConfig(theme),
    },
    startScreen: {
      greeting: GREETING,
      prompts: STARTER_PROMPTS,
    },
    composer: {
      placeholder: PLACEHOLDER_INPUT,
      attachments: {
        // Enable attachments
        enabled: true,
      },
    },
    threadItemActions: {
      feedback: false,
    },
    onClientTool: async (invocation: {
      name: string;
      params: Record<string, unknown>;
    }) => {
      if (invocation.name === "switch_theme") {
        const requested = invocation.params.theme;
        if (requested === "light" || requested === "dark") {
          if (isDev) {
            console.debug("[ChatKitPanel] switch_theme", requested);
          }
          onThemeRequest(requested);
          return { success: true };
        }
        return { success: false };
      }

      if (invocation.name === "record_fact") {
        const id = String(invocation.params.fact_id ?? "");
        const text = String(invocation.params.fact_text ?? "");
        if (!id || processedFacts.current.has(id)) {
          return { success: true };
        }
        processedFacts.current.add(id);
        void onWidgetAction({
          type: "save",
          factId: id,
          factText: text.replace(/\s+/g, " ").trim(),
        });
        return { success: true };
      }

      return { success: false };
    },
    onResponseEnd: () => {
      onResponseEnd();
    },
    onResponseStart: () => {
      setErrorState({ integration: null, retryable: false });
    },
    onThreadChange: () => {
      processedFacts.current.clear();
    },
    onError: ({ error }: { error: unknown }) => {
      // Note that Chatkit UI handles errors for your users.
      // Thus, your app code doesn't need to display errors on UI.
      console.error("ChatKit error", error);
    },
  });

  const activeError = errors.session ?? errors.integration;
  const blockingError = errors.script ?? activeError;

  if (isDev) {
    console.debug("[ChatKitPanel] render state", {
      isInitializingSession,
      hasControl: Boolean(chatkit.control),
      scriptStatus,
      hasError: Boolean(blockingError),
      workflowId: WORKFLOW_ID,
    });
  }

  return (
    <div className="relative flex h-full max-h-full w-full flex-col overflow-hidden rounded-2xl bg-white pb-8 shadow-sm transition-colors dark:bg-slate-900">
      <ChatKit
        key={widgetInstanceKey}
        control={chatkit.control}
        className={
          blockingError || isInitializingSession
            ? "pointer-events-none opacity-0"
            : "block h-full w-full"
        }
      />
      <ErrorOverlay
        error={blockingError}
        fallbackMessage={
          blockingError || !isInitializingSession
            ? null
            : "Loading assistant session..."
        }
        onRetry={blockingError && errors.retryable ? handleResetChat : null}
        retryLabel="Restart chat"
      />
    </div>
  );
}

function resolveSessionExpiry(raw: unknown): number {
  const now = Date.now();
  if (typeof raw === "number") {
    if (raw > 1_000_000_000_000) {
      return raw;
    }
    return now + raw * 1000;
  }

  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return now + DEFAULT_SESSION_TTL_MS;
}

function isLikelyTransientError(error: unknown, detail: string): boolean {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.includes("TIMEOUT")) {
      return true;
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
      const nestedCode = (cause as { code?: unknown }).code;
      if (typeof nestedCode === "string" && nestedCode.includes("TIMEOUT")) {
        return true;
      }
    }
  }

  const lowered = detail.toLowerCase();
  return (
    lowered.includes("timeout") ||
    lowered.includes("temporary") ||
    lowered.includes("fetch failed") ||
    lowered.includes("network")
  );
}

function extractErrorDetail(
  payload: Record<string, unknown> | undefined,
  fallback: string
): string {
  if (!payload) {
    return fallback;
  }

  const error = payload.error;
  if (typeof error === "string") {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  const details = payload.details;
  if (typeof details === "string") {
    return details;
  }

  if (details && typeof details === "object" && "error" in details) {
    const nestedError = (details as { error?: unknown }).error;
    if (typeof nestedError === "string") {
      return nestedError;
    }
    if (
      nestedError &&
      typeof nestedError === "object" &&
      "message" in nestedError &&
      typeof (nestedError as { message?: unknown }).message === "string"
    ) {
      return (nestedError as { message: string }).message;
    }
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return fallback;
}
