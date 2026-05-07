import { EncodedSourceMap } from "@jridgewell/trace-mapping";

export async function getSourceMap(
  url: string | URL,
  source: string): Promise<EncodedSourceMap | undefined> {
  try {
    // Extract sourceMappingURL from source
    const match = source.match(/\/\/#\s*sourceMappingURL=(.+?)(?:\s|$)/);
    if (!match) {
      return undefined;
    }
    const sourceMappingURL = match[1].trim();

    // Determine if it's a data URL or a file URL
    if (sourceMappingURL.startsWith("data:")) {
      // Parse data URL
      const dataMatch = sourceMappingURL.match(/data:application\/json(?:;base64)?,(.+)/);
      if (!dataMatch) {
        throw new Error(`Invalid data URL`);
      }

      // Extact JSON.
      let jsonString: string;
      if (sourceMappingURL.includes(";base64")) {
        jsonString = atob(dataMatch[1]);
      } else {
        jsonString = decodeURIComponent(dataMatch[1]);
      }
      return JSON.parse(jsonString);
    } else {
      // Fetch from URL
      const mapUrl = new URL(sourceMappingURL, url);
      const response = await fetch(mapUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch source map`);
      }
      return await response.json();
    }
  } catch (e) {
    console.warn(`Failed to load source map for ${url}:`, e);
    return undefined;
  }
}