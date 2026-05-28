// localStorage-backed JWT. XSS tradeoff documented in phase-04 §Security.
const KEY = "fluxion.jwt";

export function loadJwt(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveJwt(token: string): void {
  window.localStorage.setItem(KEY, token);
}

export function clearJwt(): void {
  window.localStorage.removeItem(KEY);
}
