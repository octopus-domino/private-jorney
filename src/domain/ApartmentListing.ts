export interface ApartmentListing {
  id: string;
  title: string;
  address: string;
  priceRub: number;
  url: string;
  imageUrl?: string;
  matchNote?: string;
}
