export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Delegated listeners tied to the current render. reset(root) drops the previous render's.
const controllers = new WeakMap();
export function reset(root) {
  controllers.get(root)?.abort();
  controllers.set(root, new AbortController());
}
export function on(root, event, selector, handler) {
  if (!controllers.has(root)) reset(root);
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  }, { signal: controllers.get(root).signal });
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  // Run now, but only if a call is pending.
  wrapped.flush = () => {
    if (t === null) return;
    clearTimeout(t);
    t = null;
    fn();
  };
  return wrapped;
}
