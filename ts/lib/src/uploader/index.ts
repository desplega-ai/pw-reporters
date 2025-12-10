import { FileScanner, type FileInfo } from "./file-scanner";
import { HttpUploader, type UploadResult } from "./http-uploader";

export interface FileUploaderConfig {
  /** HTTP endpoint for uploads */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Number of parallel uploads (default: 3) */
  parallel?: number;
  /** Chunk size in MB for large files (default: 5) */
  chunkSizeMb?: number;
  /** Number of retry attempts per file (default: 3) */
  retries?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface UploadSummary {
  /** Total files found */
  totalFiles: number;
  /** Successfully uploaded files */
  successCount: number;
  /** Failed uploads */
  failedCount: number;
  /** Total bytes uploaded */
  totalBytes: number;
  /** Failed file details */
  failures: UploadResult[];
}

/**
 * Orchestrates file scanning and parallel uploads with controlled concurrency.
 */
export class FileUploader {
  private config: FileUploaderConfig;
  private scanner: FileScanner;
  private uploader: HttpUploader;
  private debug: boolean;
  private files: FileInfo[] = [];

  // Defaults
  private readonly parallelUploads: number;
  private readonly chunkSizeBytes: number;
  private readonly retries: number;

  constructor(config: FileUploaderConfig) {
    this.config = config;
    this.debug = config.debug ?? false;

    this.parallelUploads = config.parallel ?? 3;
    this.chunkSizeBytes = (config.chunkSizeMb ?? 5) * 1024 * 1024;
    this.retries = config.retries ?? 3;

    this.scanner = new FileScanner({ debug: this.debug });
    this.uploader = new HttpUploader({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      chunkSizeBytes: this.chunkSizeBytes,
      retries: this.retries,
      debug: this.debug,
    });
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[file-uploader]", ...args);
    }
  }

  /**
   * Scan directory for files to upload.
   * Call this in onEnd to build the manifest.
   */
  async scanFiles(directory: string): Promise<void> {
    this.files = await this.scanner.scan(directory);
    const totalSize = FileScanner.getTotalSize(this.files);
    this.log(
      `Scanned ${this.files.length} files (${FileScanner.formatSize(totalSize)})`,
    );
  }

  /**
   * Upload all scanned files with controlled concurrency.
   * Call this in onExit to perform the uploads.
   */
  async uploadAll(runId: string): Promise<UploadSummary> {
    if (this.files.length === 0) {
      this.log("No files to upload");
      return {
        totalFiles: 0,
        successCount: 0,
        failedCount: 0,
        totalBytes: 0,
        failures: [],
      };
    }

    const results: UploadResult[] = [];
    const pending = [...this.files];

    this.log(
      `Starting upload of ${pending.length} files with concurrency ${this.parallelUploads}`,
    );

    // Process files with controlled concurrency
    const uploadFile = async (): Promise<void> => {
      while (pending.length > 0) {
        const file = pending.shift();
        if (!file) break;

        const result = await this.uploader.upload(file, runId);
        results.push(result);
      }
    };

    // Start parallel upload workers
    const workers = Array(Math.min(this.parallelUploads, pending.length))
      .fill(null)
      .map(() => uploadFile());

    await Promise.all(workers);

    // Build summary
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);
    const totalBytes = successes.reduce((sum, r) => sum + r.file.size, 0);

    const summary: UploadSummary = {
      totalFiles: results.length,
      successCount: successes.length,
      failedCount: failures.length,
      totalBytes,
      failures,
    };

    this.log(
      `Upload complete: ${summary.successCount}/${summary.totalFiles} succeeded`,
    );

    if (failures.length > 0) {
      this.log("Failed uploads:");
      for (const failure of failures) {
        this.log(`  - ${failure.file.relativePath}: ${failure.error}`);
      }
    }

    return summary;
  }

  /**
   * Get the list of scanned files
   */
  getFiles(): FileInfo[] {
    return this.files;
  }

  /**
   * Enrich scanned files with test IDs from the attachment map.
   * Call this after scanFiles() to associate files with their tests.
   */
  enrichWithTestIds(attachmentTestMap: Map<string, string>): void {
    for (const file of this.files) {
      const testId = attachmentTestMap.get(file.path);
      if (testId) {
        file.testId = testId;
      }
    }
  }
}

// Re-export types
export type { FileInfo } from "./file-scanner";
export type { UploadResult } from "./http-uploader";
