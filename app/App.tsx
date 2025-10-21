"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { ChatKitPanel, type FactAction } from "@/components/ChatKitPanel";
import { useColorScheme } from "@/hooks/useColorScheme";

export default function App() {
  const { scheme, setScheme } = useColorScheme();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(520);
  const [activeSize, setActiveSize] = useState<PanelSize>("md");
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{ startHeight: number; startY: number } | null>(
    null
  );
  const hasMountedRef = useRef(false);

  const handleWidgetAction = useCallback(async (action: FactAction) => {
    if (process.env.NODE_ENV !== "production") {
      console.info("[ChatKitPanel] widget action", action);
    }
  }, []);

  const handleResponseEnd = useCallback(() => {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[ChatKitPanel] response end");
    }
  }, []);

  const bounds = useMemo(
    () => getHeightBounds(viewportWidth),
    [viewportWidth]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const applyViewportState = () => {
      const nextBounds = getHeightBounds(window.innerWidth);
      setViewportWidth(window.innerWidth);
      setPanelHeight((current) => clamp(current, nextBounds.min, nextBounds.max));
    };

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      applyViewportState();
    }

    window.addEventListener("resize", applyViewportState);
    return () => window.removeEventListener("resize", applyViewportState);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!isFullscreen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((current) => {
      if (!current) {
        setIsFullscreen(false);
      }
      return !current;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsCollapsed(false);
    setIsFullscreen((current) => !current);
  }, []);

  const cycleSize = useCallback(() => {
    setIsCollapsed(false);
    setIsFullscreen(false);
    setActiveSize((current) => {
      const currentIndex = PANEL_SIZE_PRESETS.findIndex(
        (preset) => preset.id === current
      );
      const nextIndex = (currentIndex + 1) % PANEL_SIZE_PRESETS.length;
      return PANEL_SIZE_PRESETS[nextIndex].id;
    });
  }, []);

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isFullscreen) {
        return;
      }
      event.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      resizeStateRef.current = {
        startY: event.clientY,
        startHeight: rect?.height ?? panelHeight,
      };
      setIsResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [isFullscreen, panelHeight]
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isResizing || !resizeStateRef.current) {
        return;
      }
      const delta = resizeStateRef.current.startY - event.clientY;
      const nextHeight = resizeStateRef.current.startHeight + delta;
      setPanelHeight(clamp(nextHeight, bounds.min, bounds.max));
    },
    [bounds.max, bounds.min, isResizing]
  );

  const stopResizing = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isResizing) {
        return;
      }
      resizeStateRef.current = null;
      setIsResizing(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [isResizing]
  );

  const panelStyle = useMemo(() => {
    if (isFullscreen) {
  return { height: "100%", width: "100%" } satisfies CSSProperties;
    }

    const isCompactViewport = (viewportWidth ?? 0) < 640;
    const widthPreset = PANEL_SIZE_PRESETS.find(
      (preset) => preset.id === activeSize
    );

    const width = isCompactViewport
      ? undefined
      : `${widthPreset?.width ?? 380}px`;

    return {
      height: `${Math.round(panelHeight)}px`,
      width,
    } satisfies CSSProperties;
  }, [activeSize, isFullscreen, panelHeight, viewportWidth]);

  const sizeLabel = useMemo(() => {
    const preset = PANEL_SIZE_PRESETS.find((item) => item.id === activeSize);
    return preset?.label ?? "Resize";
  }, [activeSize]);

  return (
    <main className="relative min-h-screen bg-black">
      <iframe
        src="/scramjet-ui/"
        title="Scramjet browser"
        className="fixed inset-0 h-full w-full border-0"
      />
      {isCollapsed ? (
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="pointer-events-auto fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white sm:bottom-6 sm:right-6"
        >
          <IconChatBubble />
          Open assistant
        </button>
      ) : (
        <>
          {isFullscreen && (
            <div className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm" />
          )}
          <div
            ref={containerRef}
            className={
              isFullscreen
                ? "pointer-events-auto fixed inset-0 z-50 flex items-center justify-center"
                : "pointer-events-auto fixed bottom-4 left-4 right-4 z-50 flex justify-end sm:bottom-6 sm:left-auto sm:right-6"
            }
          >
            <div
              className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl transition dark:border-slate-800 dark:bg-slate-900 ${
                isFullscreen ? "sm:rounded-none sm:border-0 sm:shadow-none" : ""
              }`}
              style={panelStyle}
            >
              {!isFullscreen && (
                <div
                  role="presentation"
                  className="group flex h-3 cursor-row-resize items-center justify-center bg-transparent"
                  onPointerDown={handleResizePointerDown}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={stopResizing}
                  onPointerCancel={stopResizing}
                >
                  <span className={`h-1 w-12 rounded-full bg-slate-300 transition group-hover:bg-slate-400 dark:bg-slate-700 dark:group-hover:bg-slate-600 ${
                    isResizing ? "bg-slate-400 dark:bg-slate-500" : ""
                  }`} />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/95 px-3 py-2 text-slate-700 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-100">
                <div className="flex items-center gap-2">
                  <IconChatBubble className="h-4 w-4" />
                  <span className="text-sm font-semibold">Assistant</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <HeaderIconButton
                    label={`Size: ${sizeLabel}`}
                    onClick={cycleSize}
                  >
                    <IconResize />
                  </HeaderIconButton>
                  <HeaderIconButton
                    label={isFullscreen ? "Exit full screen" : "Enter full screen"}
                    onClick={toggleFullscreen}
                  >
                    {isFullscreen ? <IconExitFull /> : <IconFull />}
                  </HeaderIconButton>
                  <HeaderIconButton
                    label="Collapse assistant"
                    onClick={toggleCollapse}
                  >
                    <IconMinimize />
                  </HeaderIconButton>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <ChatKitPanel
                  theme={scheme}
                  onWidgetAction={handleWidgetAction}
                  onResponseEnd={handleResponseEnd}
                  onThemeRequest={setScheme}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

type PanelSize = (typeof PANEL_SIZE_PRESETS)[number]["id"];

const PANEL_SIZE_PRESETS = [
  { id: "sm", label: "Compact", width: 320 },
  { id: "md", label: "Comfort", width: 380 },
  { id: "lg", label: "Spacious", width: 460 },
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getHeightBounds(viewportWidth: number | null | undefined = undefined) {
  if (typeof window === "undefined") {
    return { min: 320, max: 720 } as const;
  }
  const windowHeight = window.innerHeight || 900;
  const effectiveWidth = viewportWidth ?? window.innerWidth ?? 0;
  const isCompact = effectiveWidth < 640;
  const padding = isCompact ? 48 : 96;
  const max = Math.max(320, Math.min(windowHeight - padding, 880));
  const minFloor = isCompact ? 280 : 320;
  const min = Math.min(minFloor, Math.max(260, max - 240));
  return { min, max } as const;
}

type IconProps = {
  className?: string;
};

function HeaderIconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-200/80 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 dark:text-slate-200 dark:hover:bg-slate-700/70 dark:hover:text-white"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function IconChatBubble({ className }: IconProps = {}) {
  return (
    <svg
      className={className ?? "h-5 w-5"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17.5 4.5 20l.5-3A8.5 8.5 0 1 1 20 11.5 8.5 8.5 0 0 1 11.5 20a8.4 8.4 0 0 1-4.5-1.3Z" />
    </svg>
  );
}

function IconMinimize() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function IconFull() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M4 16v4h4" />
      <path d="M20 16v4h-4" />
    </svg>
  );
}

function IconExitFull() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 9H5V5" />
      <path d="M15 9h4V5" />
      <path d="M5 15v4h4" />
      <path d="M19 15v4h-4" />
    </svg>
  );
}

function IconResize() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 6h8" />
      <path d="M6 10v8" />
      <path d="m6 6 4 4" />
      <path d="m14 14 4 4" />
    </svg>
  );
}
