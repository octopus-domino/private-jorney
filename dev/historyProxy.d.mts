import type { IncomingMessage, ServerResponse } from 'node:http';
export function historyProxy(req: IncomingMessage, res: ServerResponse, next: () => void): void;
export class HistorySourceGateway {
  constructor(execute?: (...args: any[]) => any);
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
}
