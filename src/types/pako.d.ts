declare module 'pako' {
  export interface InflateOptions {
    chunkSize?: number;
    raw?: boolean;
  }

  export interface InflateStream {
    avail_in: number;
  }

  export class Inflate {
    constructor(options?: InflateOptions);

    ended: boolean;
    err: number;
    msg: string;
    strm: InflateStream;
    onData(chunk: Uint8Array): void;
    push(data: Uint8Array, final: boolean): boolean;
  }
}
