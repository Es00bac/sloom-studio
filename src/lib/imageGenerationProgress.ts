export function getImageGenerationProgressDetail(hasPreviousImage: boolean): string {
  return hasPreviousImage
    ? 'Blurring the previous image while the provider renders the next final frame.'
    : 'Synthetic progress backdrop; the provider returns the final image when it is ready.';
}
