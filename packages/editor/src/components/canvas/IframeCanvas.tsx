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
      <div className="flex h-full items-center justify-center bg-zinc-950">
        <div className="text-center">
          <p className="mb-3 text-sm text-zinc-400">
            Start the Astro dev server to preview pages
          </p>
          {devServerStatus === "stopped" && (
            <button
              onClick={startDevServer}
              className=" bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Start Dev Server
            </button>
          )}
          {devServerStatus === "starting" && (
            <p className="text-xs text-yellow-400">Starting...</p>
          )}
          {devServerStatus === "error" && (
            <div className="mx-auto max-w-md text-left">
              <p className="mb-2 text-xs font-medium text-red-400">
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
                <p className="mb-2 text-xs text-zinc-300">{devServerError.message}</p>
              )}
              {devServerError?.kind === "schema" && devServerError.file && (
                <p className="mb-2 break-all font-mono text-[11px] text-zinc-500">{devServerError.file}</p>
              )}
              {devServerError?.kind === "schema" && devServerError.missingFields && devServerError.missingFields.length > 0 && (
                <p className="mb-3 text-[11px] text-zinc-400">
                  Missing required field{devServerError.missingFields.length === 1 ? "" : "s"}:{" "}
                  <span className="font-mono text-zinc-300">{devServerError.missingFields.join(", ")}</span>
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={startDevServer}
                  className="bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Retry
                </button>
                {devServerError && (
                  <button
                    onClick={() => setShowRawError((v) => !v)}
                    className="bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
                  >
                    {showRawError ? "Hide details" : "Show details"}
                  </button>
                )}
              </div>
              {showRawError && devServerError && (
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all bg-zinc-900 p-3 text-[10px] text-zinc-400">
                  {devServerError.raw}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-400">Select a page from the toolbar to start editing</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full justify-center bg-zinc-950 p-2 overflow-auto">
      <div
        className="h-full overflow-hidden  border border-zinc-800 bg-white transition-all duration-300"
        style={{ width: deviceWidth ? `${deviceWidth}px` : "100%", maxWidth: "100%" }}
      >
        <iframe
          ref={iframeRef}
          src={previewUrl}
          className="h-full w-full border-0"
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
