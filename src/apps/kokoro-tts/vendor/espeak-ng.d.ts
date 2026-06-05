type ESpeakNgModuleOptions = {
  arguments?: string[];
  wasmBinary?: ArrayBuffer | Uint8Array;
};

type ESpeakNgModule = {
  FS: {
    readFile(path: string, options: { encoding: "utf8" }): string;
    readFile(path: string): Uint8Array;
  };
};

declare const createESpeakNg: (options?: ESpeakNgModuleOptions) => Promise<ESpeakNgModule>;

export default createESpeakNg;
