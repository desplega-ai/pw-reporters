import { readFile } from "node:fs/promises";
import type { FileInfo } from "./file-scanner";

export interface HttpUploaderConfig {
  /** HTTP endpoint for uploads */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Chunk size in bytes for large files */
  chunkSizeBytes: number;
  /** Number of retry attempts */
  retries: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface UploadResult {
  /** File that was uploaded */
  file: FileInfo;
  /** Whether upload succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Number of attempts made */
  attempts: number;
}

/**
 * HTTP file uploader with chunking and retry support.
 */
export class HttpUploader {
  private config: HttpUploaderConfig;
  private debug: boolean;

  constructor(config: HttpUploaderConfig) {
    this.config = config;
    this.debug = config.debug ?? false;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[http-uploader]", ...args);
    }
  }

  /**
   * Calculate delay with exponential backoff
   */
  private getRetryDelay(attempt: number): number {
    // 1s, 2s, 4s...
    return Math.min(1000 * Math.pow(2, attempt), 10000);
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Upload a single file with retry logic
   */
  async upload(file: FileInfo, runId: string): Promise<UploadResult> {
    let lastError: string | undefined;
    let attempts = 0;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      attempts++;

      try {
        if (file.size > this.config.chunkSizeBytes) {
          await this.uploadChunked(file, runId);
        } else {
          await this.uploadSimple(file, runId);
        }

        this.log("Uploaded:", file.relativePath);
        return { file, success: true, attempts };
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "Unknown upload error";
        this.log(
          `Upload failed (attempt ${attempt + 1}/${this.config.retries + 1}):`,
          file.relativePath,
          lastError,
        );

        if (attempt < this.config.retries) {
          const delay = this.getRetryDelay(attempt);
          this.log(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    return { file, success: false, error: lastError, attempts };
  }

  /**
   * Simple upload for small files using multipart form data
   */
  private async uploadSimple(file: FileInfo, runId: string): Promise<void> {
    const formData = new FormData();
    const fileBlob = await this.readFileAsBlob(file.path);

    formData.append("file", fileBlob, file.name);
    formData.append("runId", runId);
    formData.append("relativePath", file.relativePath);

    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  /**
   * Chunked upload for large files
   */
  private async uploadChunked(file: FileInfo, runId: string): Promise<void> {
    const totalChunks = Math.ceil(file.size / this.config.chunkSizeBytes);
    const uploadId = `${runId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    this.log(
      `Uploading ${file.relativePath} in ${totalChunks} chunks (${file.size} bytes)`,
    );

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * this.config.chunkSizeBytes;
      const end = Math.min(start + this.config.chunkSizeBytes, file.size);
      const chunkBlob = await this.readFileSlice(file.path, start, end);

      const formData = new FormData();
      formData.append("file", chunkBlob, file.name);
      formData.append("runId", runId);
      formData.append("relativePath", file.relativePath);
      formData.append("uploadId", uploadId);
      formData.append("chunkIndex", chunkIndex.toString());
      formData.append("totalChunks", totalChunks.toString());

      const response = await fetch(`${this.config.endpoint}/chunk`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} (chunk ${chunkIndex + 1}/${totalChunks})`,
        );
      }

      this.log(`Uploaded chunk ${chunkIndex + 1}/${totalChunks}`);
    }
  }

  /**
   * Read entire file as Blob (Node.js compatible)
   */
  private async readFileAsBlob(filePath: string): Promise<Blob> {
    const buffer = await readFile(filePath);
    return new Blob([buffer]);
  }

  /**
   * Read a slice of a file as Blob (Node.js compatible)
   */
  private async readFileSlice(
    filePath: string,
    start: number,
    end: number,
  ): Promise<Blob> {
    const buffer = await readFile(filePath);
    return new Blob([buffer.subarray(start, end)]);
  }
}
