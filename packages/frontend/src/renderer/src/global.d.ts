import type { CanopyWindowApi, CanopyBleApi } from "../../preload/index";

declare global {
  interface Window {
    canopyWindow: CanopyWindowApi;
    canopyBle: CanopyBleApi;
  }

  /**
   * Minimal Web Bluetooth surface — only what device provisioning actually uses.
   *
   * TypeScript's DOM lib does not ship these, and this is deliberately a narrow
   * hand-rolled subset rather than the `@types/web-bluetooth` package: the app
   * touches four members, and the dependency is not worth it. Swap this block
   * for that package if the BLE surface grows.
   *
   * The device picker is intercepted in the Electron main process
   * (`select-bluetooth-device`), so `requestDevice` resolves only once the user
   * has chosen a device in Canopy's own UI.
   */
  interface BluetoothRemoteGATTServer {
    readonly connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
  }

  interface BluetoothDevice extends EventTarget {
    readonly id: string;
    readonly name?: string | undefined;
    readonly gatt?: BluetoothRemoteGATTServer | undefined;
  }

  interface BluetoothRequestDeviceOptions {
    acceptAllDevices?: boolean;
    filters?: Array<{ name?: string; namePrefix?: string; services?: string[] }>;
    optionalServices?: string[];
  }

  interface Bluetooth {
    getAvailability(): Promise<boolean>;
    requestDevice(options?: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
  }

  interface Navigator {
    readonly bluetooth: Bluetooth;
  }
}
export {};
