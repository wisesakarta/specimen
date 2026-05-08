import type { DownloadMode } from "@/lib/downloader-protocol";

export type FoundryPreset = {
  id: string;
  name: string;
  description?: string;
  mode: DownloadMode;
  defaultValues: {
    apiUrl?: string;
    cssUrl?: string;
    itemsPath?: string;
    urlField?: string;
    nameField?: string;
    licenseField?: string;
    source?: string;
  };
};
