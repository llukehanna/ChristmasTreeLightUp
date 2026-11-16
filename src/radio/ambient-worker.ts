import { answer, type RenderReply, type RenderRequest } from './ambient-recipes';

/** Renders the ambiences' noise off the main thread (ambient-kit.ts asks, and gets the samples back transferred). */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderReply, transfer: Transferable[]): void;
};
scope.onmessage = (e) => {
  const { reply, transfer } = answer(e.data);
  scope.postMessage(reply, transfer);
};
