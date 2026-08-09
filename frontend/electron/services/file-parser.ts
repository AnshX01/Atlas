import * as fs from 'fs/promises';
import * as path from 'path';

export interface ParsedFile {
  type: 'text' | 'image';
  content: string;
  mimeType?: string;
  filename: string;
}

export async function parseFile(filePath: string): Promise<ParsedFile> {
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Basic image extensions
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  
  if (imageExts.includes(ext)) {
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');
    let mimeType = 'image/jpeg';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.bmp') mimeType = 'image/bmp';

    return {
      type: 'image',
      content: base64,
      mimeType,
      filename,
    };
  }

  // Fallback to text for other files
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return {
      type: 'text',
      content,
      filename,
    };
  } catch (err: any) {
    throw new Error(`Failed to read file ${filename}: ${err.message}`);
  }
}
