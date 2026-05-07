//import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

export async function getSourceMap(
  url: string | URL,
  source: string): Promise<any | undefined> {
  try {
    // Extract sourceMappingURL from source
    const match = source.match(/\/\/#\s*sourceMappingURL=(.+?)(?:\s|$)/);
    if (!match) {
      return undefined;
    }

    const sourceMappingURL = match[1].trim();
    let mapContent: string;

    // Determine if it's a data URL or a file URL
    if (sourceMappingURL.startsWith("data:")) {
      // Parse data URL
      const dataMatch = sourceMappingURL.match(/data:application\/json(?:;base64)?,(.+)/);
      if (!dataMatch) {
        throw new Error(`Invalid data URL`);
      }
      if (sourceMappingURL.includes(";base64")) {
        mapContent = atob(dataMatch[1]);
      } else {
        mapContent = decodeURIComponent(dataMatch[1]);
      }
    } else {
      // Fetch from URL
      const mapUrl = new URL(sourceMappingURL, url);
      const response = await fetch(mapUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch source map`);
      }
      mapContent = await response.text();
    }
    return JSON.parse(mapContent);
  } catch (e) {
    console.warn(`Failed to load source map for ${url}:`, e);
    return undefined;
  }
}