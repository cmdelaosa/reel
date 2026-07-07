import { useEffect, useRef } from "react";

/* Focus trap for modal sheets: moves focus in on open, keeps Tab/Shift-Tab
   inside, and restores focus to the previously-focused element on close. Pair
   with role="dialog" aria-modal="true" on the container. */
export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(selector)).filter((el) => el.offsetParent !== null);

    // Move focus inside (first focusable, else the container).
    const first = focusables()[0];
    (first ?? node).focus?.();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return ref;
}
