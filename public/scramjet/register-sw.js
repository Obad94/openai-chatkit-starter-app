"use strict";
const stockSW = "/scramjet/sw.js";
const scramjetScope = "/scramjet/";

/**
 * List of hostnames that are allowed to run serviceworkers on http://
 */
const swAllowedHostnames = ["localhost", "127.0.0.1"];

/**
 * Global util
 * Used in 404.html and index.html
 */
window.registerSW = async function registerSW() {
  if (!navigator.serviceWorker) {
    if (
      location.protocol !== "https:" &&
      !swAllowedHostnames.includes(location.hostname)
    )
      throw new Error("Service workers cannot be registered without https.");

    throw new Error("Your browser doesn't support service workers.");
  }
  const origin = `${location.origin}/`;

  if (navigator.serviceWorker.getRegistrations) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      // Unregister any registration whose scope starts with the scramjet scope
      // or matches the origin. This is more robust for environments where
      // scopes may vary (trailing slashes, root-scoped registrations, etc.).
      await Promise.all(
        registrations
          .filter((registration) => {
            try {
              const scope = registration.scope || "";
              return (
                scope === origin ||
                scope.startsWith(origin + "scramjet/") ||
                scope.startsWith(origin + "scramjet") ||
                scope.includes("/scramjet/")
              );
            } catch (e) {
              return false;
            }
          })
          .map(async (registration) => {
            try {
              return await registration.unregister();
            } catch (err) {
              console.warn("Failed to unregister service worker scope", registration.scope, err);
              return false;
            }
          })
      );
    } catch (error) {
      console.warn("Failed cleaning up legacy service workers", error);
    }
  }

  await navigator.serviceWorker.register(stockSW, {
    scope: scramjetScope,
  });
};
