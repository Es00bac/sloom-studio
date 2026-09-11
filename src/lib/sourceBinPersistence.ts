export async function localizeAssetForProject(
  url: string,
  mimeType: string,
): Promise<{ dataUrl: string; mimeType: string }> {
  if (url.startsWith('data:')) {
    const parsedMimeType = url.match(/^data:([^;,]+)/)?.[1];
    return {
      dataUrl: url,
      mimeType: parsedMimeType ?? mimeType,
    };
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Asset fetch failed with status ${response.status}.`);
    }

    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);

    return {
      dataUrl,
      mimeType: blob.type || mimeType,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown localization error.';
    throw new Error(
      `The source-bin asset could not be saved into the project scratch store. ${reason}`,
    );
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to convert the asset into a data URL.'));
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('The localized asset could not be converted into a data URL.'));
          return;
        }

        resolve(reader.result);
      };
      reader.readAsDataURL(blob);
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}
