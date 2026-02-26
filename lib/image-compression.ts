/**
 * Client-side image compression utility.
 * Compresses images before upload to reduce bandwidth and IPFS space.
 */

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0-1
  format?: 'webp' | 'jpeg' | 'png';
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 0.8,
  format: 'webp',
};

/**
 * Compress an image file using canvas API
 * @param file Original image file
 * @param options Compression settings
 * @returns Compressed image as File object
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = {}
): Promise<File> {
  const config = { ...DEFAULT_OPTIONS, ...options };

  // For small images, don't compress
  if (file.size < 100 * 1024) {
    return file; // < 100KB
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();

      img.onload = () => {
        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img;
        const maxRatio = Math.max(width / config.maxWidth, height / config.maxHeight);

        if (maxRatio > 1) {
          width = Math.floor(width / maxRatio);
          height = Math.floor(height / maxRatio);
        }

        // Create canvas and compress
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }

            const compressedFile = new File(
              [blob],
              file.name,
              { type: `image/${config.format}`, lastModified: Date.now() }
            );

            resolve(compressedFile);
          },
          `image/${config.format}`,
          config.quality
        );
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      const src = event.target?.result;
      if (typeof src === 'string') {
        img.src = src;
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Compress multiple images in parallel
 */
export async function compressImages(
  files: File[],
  options?: CompressionOptions
): Promise<File[]> {
  return Promise.all(files.map((file) => compressImage(file, options)));
}

/**
 * Get human-readable file size
 */
export function getFileSize(sizeInBytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = sizeInBytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Calculate compression ratio
 */
export function getCompressionRatio(originalSize: number, compressedSize: number): number {
  return ((1 - compressedSize / originalSize) * 100);
}
