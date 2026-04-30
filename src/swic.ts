/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;
export {};

// Activate the newly installed worker immediately.
self.addEventListener("install", (event: ExtendableEvent) => {
	event.waitUntil(self.skipWaiting());
});

// Take control of existing pages as soon as this worker activates.
self.addEventListener("activate", (event: ExtendableEvent) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event: FetchEvent) => {
	event.respondWith(
		(async () => {
			const response = await fetch(event.request);

			// Opaque responses (e.g. some cross-origin requests) cannot be modified.
			if (response.type === "opaque") {
				return response;
			}

			const headers = new Headers(response.headers);
			headers.set("x-swic-service-worker", "active");

			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		})(),
	);
});
