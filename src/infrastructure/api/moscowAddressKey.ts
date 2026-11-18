import { normalizeHouseAddress } from '../../shared/address';

/** Matches abbreviated street types while retaining significant house, block and structure numbers. */
export function moscowAddressKey(address: string): string {
  return normalizeHouseAddress(address.replace(/российская федерация|город\s+москва/gi, ''))
    .replace(/(^|\s)(улица|проспект|переулок|шоссе|бульвар|набережная|площадь|проезд|аллея|тупик|город)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
