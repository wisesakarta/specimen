declare module 'fonteditor-core' {
    export interface FontOptions {
        type: 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'svg';
    }

    export interface WriteOptions {
        type: 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'svg';
    }

    export class Font {
        static create(buffer: Buffer, options: FontOptions): Font;
        write(options: WriteOptions): ArrayBuffer;
    }

    export namespace woff2 {
        function init(): Promise<void>;
    }
}
