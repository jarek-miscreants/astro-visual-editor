import { create } from "zustand";

export type ToastVariant = "default" | "success" | "error";

export interface Toast {
  id: string;
  message: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastStore {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id"> & { durationMs?: number }) => void;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION = 2200;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: ({ durationMs = DEFAULT_DURATION, ...toast }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({ toasts: [...state.toasts, { id, ...toast }] }));
    window.setTimeout(() => {
      get().dismiss(id);
    }, durationMs);
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Convenience helpers — import and call anywhere. */
export const toast = {
  show: (message: string, description?: string) =>
    useToastStore.getState().push({ message, description }),
  success: (message: string, description?: string) =>
    useToastStore.getState().push({ message, description, variant: "success" }),
  error: (message: string, description?: string) =>
    useToastStore.getState().push({ message, description, variant: "error" }),
};

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
