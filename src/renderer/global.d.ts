import type { HorizonBridge } from "../shared/types";
declare global {
  interface Window {
    horizon?: HorizonBridge;
  }
}
export {};
