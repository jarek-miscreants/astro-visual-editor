import { useEffect, useCallback, useState, useRef } from "react";
import { useEditorStore } from "../../store/editor-store";
import { onIframeMessage, provideAstToIframe } from "../../lib/iframe-bridge";
import { api } from "../../lib/api-client";
import { SelectionToolbar } from "./SelectionToolbar";

export function IframeCanvas() {
  const devServerStatus = useEditorStore((s) => s.devServerStatus);
  const devServerError = useEditorStore((s) => s.devServerError);
  const currentFile = useEditorStore((s) => s.currentFile);
  const ast = useEditorStore((s) => s.ast);
  const iframeReady = useEditorStore((s) => s.iframeReady);
  const startDevServer = useEditorStore((s) => s.startDevServer);
  const devicePreset = useEditorStore((s) => s.devicePreset);
  const [showRawError, setShowRawError] = useState(false);
  const [componentPreviewUrl, setComponentPreviewUrl] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const deviceWidth = devicePreset === "mobile" ? 375 : devicePreset === "tablet" ? 768 : undefined;

  const isComponent = currentFile?.startsWith("src/components/");

  // For components, generate a preview page; for pages, use the route directly
  useEffect(() => {
    if (!currentFile || !isComponent) {
      setComponentPreviewUrl(null);
      return;
    }
    api.previewComponent(currentFile).then((result) => {
      if (result.success) {
        setComponentPreviewUrl(`/preview${result.previewRoute}`);
      }
    }).catch((err) => {
      console.error("Failed to generate component preview:", err);
    });
  }, [currentFile, isComponent]);

  const previewUrl = currentFile
    ? isComponent
      ? componentPreviewUrl
      : `/preview${filePathToRoute(currentFile)}`
    : null;

  // Listen for iframe messages — stable handler using getState()
  useEffect(() => {
    return onIframeMessage((msg) => {
      // Re-send AST on every tve:ready (iframe retries until mapper succeeds)
      if (msg.type === "tve:ready") {
        const currentAst = useEditorStore.getState().ast;
        if (currentAst) {
          provideAstToIframe(currentAst);
          useEditorStore.getState().setIframeReady(true);
        }
      }

      if (msg.type === "tve:select") {
        useEditorStore.getState().selectNode(msg.nodeId, msg.elementInfo);
      }

      if (msg.type === "tve:deselect") {
        useEditorStore.getState().selectNode(null);
      }

      if (msg.type === "tve:hover") {
        useEditorStore.getState().hoverNode(msg.nodeId);
      }

      if (msg.type === "tve:text-edit") {
        useEditorStore.getState().applyMutation({
          type: "update-text",
          nodeId: msg.nodeId,
          text: msg.newText,
        });
      }

      if (msg.type === "tve:dom-ready") {
        console.log(`[Editor] Iframe DOM mapped: ${msg.nodeCount} nodes`);
      }
    });
  }, []);

  // Send AST whenever it changes and iframe is ready
  useEffect(() => {
    if (ast && iframeReady) {
      provideAstToIframe(ast);
    }
  }, [ast, iframeReady]);

  // Send AST on iframe load
  const handleIframeLoad = useCallback(() => {
    setTimeout(() => {
      const currentAst = useEditorStore.getState().ast;
      if (currentAst) {
        provideAstToIframe(currentAst);
        useEditorStore.getState().setIframeReady(true);
      }
    }, 500);
  }, []);

  if (devServerStatus !== "running") {
    return (
      <div className="tve-canvas tve-canvas--centered">
        <div className="text-center">
          <p className="mb-3 text-sm text-[color:var(--shell-text-muted)]">
            Start the Astro dev server to preview pages
          </p>
          {devServerStatus === "stopped" && (
            <button onClick={startDevServer} className="tve-button-accent">
              Start Dev Server
            </button>
          )}
          {devServerStatus === "starting" && (
            <p className="text-xs text-[color:var(--shell-warning)]">Starting...</p>
          )}
          {devServerStatus === "error" && (
            <div className="tve-error">
              <p className="tve-error__title">
                {devServerError?.kind === "schema"
                  ? "Content collection schema mismatch"
                  : devServerError?.kind === "config"
                    ? "Astro config error"
                    : devServerError?.kind === "syntax"
                      ? "Syntax error"
                      : devServerError?.kind === "missing-dep"
                        ? "Missing dependency"
                        : devServerError?.kind === "port"
                          ? "Port conflict"
                          : "Failed to start dev server"}
              </p>
              {devServerError && (
                <p className="tve-error__msg">{devServerError.message}</p>
              )}
              {devServerError?.kind === "schema" && devServerError.file && (
                <p className="tve-error__file">{devServerError.file}</p>
              )}
              {devServerError?.kind === "schema" && devServerError.missingFields && devServerError.missingFields.length > 0 && (
                <p className="tve-error__fields">
                  Missing required field{devServerError.missingFields.length === 1 ? "" : "s"}:{" "}
                  <span className="tve-error__fields-list">{devServerError.missingFields.join(", ")}</span>
                </p>
              )}
              <div className="tve-error__actions">
                <button onClick={startDevServer} className="tve-button-accent">
                  Retry
                </button>
                {devServerError && (
                  <button
                    onClick={() => setShowRawError((v) => !v)}
                    className="tve-button-secondary"
                  >
                    {showRawError ? "Hide details" : "Show details"}
                  </button>
                )}
              </div>
              {showRawError && devServerError && (
                <pre className="tve-error__raw">{devServerError.raw}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="tve-canvas tve-canvas--centered">
        <p className="text-sm text-[color:var(--shell-text-muted)]">Select a page from the toolbar to start editing</p>
      </div>
    );
  }

  return (
    <div className="tve-canvas">
      <div
        className="tve-canvas__frame"
        style={{ width: deviceWidth ? `${deviceWidth}px` : "100%", maxWidth: "100%" }}
      >
        <iframe
          ref={iframeRef}
          src={previewUrl}
          className="tve-canvas__iframe"
          title="Page Preview"
          onLoad={handleIframeLoad}
        />
      </div>
      <SelectionToolbar iframeRef={iframeRef} />
    </div>
  );
}

function filePathToRoute(filePath: string): string {
  let route = filePath
    .replace(/^src\/pages\//, "/")
    .replace(/\.astro$/, "")
    .replace(/\/index$/, "/");
  if (!route.startsWith("/")) route = "/" + route;
  return route;
}
