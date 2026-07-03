import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Check } from "lucide-react";

interface ToastItem {
  id: number;
  text: string;
}

const ToastContext = createContext<(text: string) => void>(() => undefined);

export const useToast = (): ((text: string) => void) => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((text: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] shadow-pop"
          >
            <Check size={14} strokeWidth={2} className="text-success" />
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
