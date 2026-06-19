import { TinifyClient } from '../tinify/client';
import type { CompressResult, ConvertTarget, ResizeOptions } from '../../tinify';
import type { ImagifyEnv } from './types';

/** Master Plan §2.3 canonical image adapter path (Imagify). Implementation delegates to Tinify API. */
export class ImagifyClient {
  private readonly inner: TinifyClient;

  constructor(env: ImagifyEnv = {}) {
    this.inner = new TinifyClient(env);
  }

  resolveApiKey(env: { IMAGIFY_API_KEY?: string; TINIFY_API_KEY?: string }, explicit?: string): string {
    return explicit ?? env.IMAGIFY_API_KEY ?? env.TINIFY_API_KEY ?? '';
  }

  compressImage(imageBuffer: ArrayBuffer, apiKey: string): Promise<CompressResult> {
    return this.inner.compressImage(imageBuffer, apiKey);
  }

  downloadCompressed(locationUrl: string, apiKey: string): Promise<CompressResult> {
    return this.inner.downloadCompressed(locationUrl, apiKey);
  }

  processImage(
    locationUrl: string,
    apiKey: string,
    options: { resize?: ResizeOptions; convert?: ConvertTarget | ConvertTarget[] | '*/*' } = {},
  ) {
    return this.inner.processImage(locationUrl, apiKey, options);
  }
}