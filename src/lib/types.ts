export type DownloadMode = "css-url" | "api-json" | "direct-url" | "browser-intercept" | "batch-direct";

export type LicenseMode = "open-license" | "restricted-with-proof";

export type LicensePayload = {
  id: string;
  mode: LicenseMode;
  proof?: string;
};

export type CssUrlRequest = {
  mode: "css-url";
  cssUrl: string;
  family?: string;
  source?: string;
  licenseId?: string;
  licenseProof?: string;
  userAgent?: string;
  outputFolder?: string;
  metadata?: any;
};

export type ApiJsonRequest = {
  mode: "api-json";
  apiUrl: string;
  source?: string;
  apiToken?: string;
  userAgent?: string;
  itemsPath?: string;
  urlField?: string;
  nameField?: string;
  licenseField?: string;
  licenseId?: string;
  licenseProof?: string;
  outputFolder?: string;
  metadata?: any;
};

export type DirectUrlRequest = {
  mode: "direct-url";
  fileUrl: string;
  source?: string;
  family?: string;
  style?: string;
  weight?: string;
  licenseId?: string;
  licenseProof?: string;
  userAgent?: string;
  outputFolder?: string;
  metadata?: any;
};

export type BrowserInterceptRequest = {
  mode: "browser-intercept";
  targetUrl: string;
  source?: string;
  outputFolder?: string;
  licenseId?: string; // Optional for this mode
  expectedCount?: number; // Optimization: used for smart exit
  injectScript?: string; // Saka Genius: Custom JS injection
  onProgress?: (event: { type: 'progress' | 'log'; current?: number; total?: number; message?: string }) => void;
  masterFoundry?: boolean; // Saka Master Forge Activation
  metadata?: any;
};

/**
 * Shared BrowserRequest for engine implementation
 */
export interface BrowserRequest {
  targetUrl: string;
  target?: string;
  foundry?: string;
  metadata?: any;
  delay?: number;
  waitForSelector?: string;
  clickSelector?: string;
  scrollCount?: number;
  capturePatterns?: string[];
  blockAds?: boolean;
  outputFolder?: string;
  mode?: string;
  expectedCount?: number;
  injectScript?: string;
  masterFoundry?: boolean;
  onProgress?: (event: { type: 'progress' | 'log'; current?: number; total?: number; message?: string }) => void;
}

export type BatchDirectRequest = {
  mode: "batch-direct";
  fonts: { url: string; family: string; format?: string; style?: string; weight?: string; metadata?: any }[];
  source?: string;
  userAgent?: string;
  outputFolder?: string;
  metadata?: any;
};

export type DownloadRequest = CssUrlRequest | ApiJsonRequest | DirectUrlRequest | BrowserInterceptRequest | BatchDirectRequest;

export interface CapturedFontItem {
  url: string;
  contentType: string;
  contentLength?: number;
  buffer?: Buffer;
  extension?: string;
  fileName?: string;
  postscriptName?: string;
  family?: string;
  style?: string;
  weight?: string;
}

export type DownloadedFile = {
  fileName: string;
  filePath: string;
  sourceUrl: string;
  name?: string;
  psName?: string;
  family?: string;
  style?: string;
  weight?: string;
  license?: LicensePayload;
  isRegistered?: boolean;
};

export type SkippedItem = {
  index: number;
  reason: string;
  name?: string;
};

export type DownloadResult = {
  jobId?: string;
  command?: DownloadMode;
  source?: string;
  outputDir: string;
  downloadedAt?: string;
  downloaded: DownloadedFile[];
  skipped: SkippedItem[];
  logPath?: string;
  validationLogPath?: string;
  analysisLogPath?: string;
  targetAudit?: any;
  qualityLogPath?: string;
  qualityAudit?: any;
  specimenLogPath?: string;
  specimenAudit?: any;
};
