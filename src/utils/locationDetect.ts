// Auto-detects the user's city via free IP geolocation (ipapi.co).
// Caches the result in localStorage for 24h so we don't hit the API on every launch.
// Manual override `userLocation` always wins over the auto-detected `userLocationAuto`.

const CACHE_KEY = "userLocationAuto";
const CACHE_AT_KEY = "userLocationAutoAt";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type IpApiResponse = {
  city?: string;
  region?: string;
  country_name?: string;
  error?: boolean;
  reason?: string;
};

export async function bootstrapLocation(): Promise<void> {
  if (typeof window === "undefined" || !window.localStorage) return;

  const cachedAt = Number(window.localStorage.getItem(CACHE_AT_KEY) || 0);
  if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://ipapi.co/json/", { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return;
    const data: IpApiResponse = await res.json();
    if (data.error || !data.city) return;
    const parts = [data.city, data.region, data.country_name].filter(Boolean);
    window.localStorage.setItem(CACHE_KEY, parts.join(", "));
    window.localStorage.setItem(CACHE_AT_KEY, String(Date.now()));
  } catch {
    // Silent fail — manual `userLocation` or no location is the fallback.
  }
}
