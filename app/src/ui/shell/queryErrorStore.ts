// Tiny external store fed by the global QueryCache onError (see main.tsx) and
// read by <QueryErrorToast>. A failed query otherwise renders as an empty state
// / eternal skeleton — this gives it a visible signal without every page having
// to read isError.

let visible = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Flash the "couldn't load" toast for a few seconds. Called on query errors. */
export function flashQueryError() {
  visible = true;
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => {
    visible = false;
    emit();
  }, 5000);
}

export function subscribeQueryError(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const isQueryErrorVisible = () => visible;
