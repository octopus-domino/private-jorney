/** External sources are read by the user's device, never relayed through CoDoc. */
export function publishedSourceUrl(target: string): string {
  return target;
}
