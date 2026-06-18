import type { CompressResult } from '../../tinify';
import type { TinifyProcessResult } from './types';

export class MockTinifyClient {
  async compressImage(imageBuffer: ArrayBuffer): Promise<CompressResult> {
    return { ok: true, compressed: imageBuffer, locationUrl: 'https://mock.tinify.local/image', inputSize: imageBuffer.byteLength, outputSize: imageBuffer.byteLength, contentType: 'image/webp' };
  }

  async downloadCompressed(locationUrl: string): Promise<CompressResult> {
    return { ok: true, compressed: new ArrayBuffer(0), locationUrl, inputSize: 0, outputSize: 0, contentType: 'image/webp' };
  }

  async processImage(): Promise<TinifyProcessResult> {
    return { ok: true, data: new ArrayBuffer(0), contentType: 'image/webp' };
  }
}
