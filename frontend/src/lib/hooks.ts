"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";

/**
 * Debounce any fast-changing value (e.g. search input).
 * @param value The value to debounce.
 * @param delay Debounce delay in milliseconds.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Returns true if the client-side component has mounted.
 * Useful to prevent hydration mismatches for browser-only APIs.
 */
const subscribeNever = () => () => {};

export function useMounted(): boolean {
  // True in the browser, false while rendering on the server.
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

/**
 * Reads one query-string parameter of the current URL.
 * It is null while rendering on the server and the real value in the browser.
 */
export function useQueryParam(name: string): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => new URLSearchParams(window.location.search).get(name),
    () => null
  );
}

/**
 * Evaluates a CSS media query and subscribes to changes.
 * @param query CSS media query string (e.g. "(min-width: 768px)").
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) {
        return () => {};
      }
      const mediaQueryList = window.matchMedia(query);
      // Modern API, with a fallback for older browsers
      if (mediaQueryList.addEventListener) {
        mediaQueryList.addEventListener("change", onChange);
        return () => mediaQueryList.removeEventListener("change", onChange);
      }
      mediaQueryList.addListener(onChange);
      return () => mediaQueryList.removeListener(onChange);
    },
    [query]
  );

  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches,
    () => false
  );
}

/**
 * Persistent state in localStorage with SSR fallback and error handling.
 * @param key The localStorage key.
 * @param initialValue Default initial value if key is not found.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return initialValue;
    }
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch (error) {
      console.warn(`useLocalStorage: error reading key "${key}"`, error);
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        setStoredValue((current) => {
          const valueToStore =
            value instanceof Function ? value(current) : value;
          if (typeof window !== "undefined") {
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
          }
          return valueToStore;
        });
      } catch (error) {
        console.warn(`useLocalStorage: error setting key "${key}"`, error);
      }
    },
    [key]
  );

  return [storedValue, setValue];
}
