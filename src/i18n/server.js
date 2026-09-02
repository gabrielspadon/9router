import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale } from "./config";

// Server-side counterpart of runtime.js's getLocaleFromCookie(). Used by the root
// layout so <html lang>/<html dir> are correct in the first byte, before hydration.
export async function getServerLocale() {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}
