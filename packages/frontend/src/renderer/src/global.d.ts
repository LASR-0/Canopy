import type { CanopyWindowApi, CanopyBleApi } from "../../preload/index";

declare global {
  interface Window {
    canopyWindow: CanopyWindowApi;
    canopyBle: CanopyBleApi;
  }
}
export {};
