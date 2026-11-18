/** A verified excerpt with attribution, shared by live house cards and locally saved walk reports. */
export interface PlaceHistory {
  sourceName?: string;
  title?: string;
  imageUrl?: string;
  excerpt: string;
  sourceUrl: string;
}
