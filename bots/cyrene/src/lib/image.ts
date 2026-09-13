import type { Env } from '@eiflow/shared';

export const IMAGE_PROMPT_MAX = 1000;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export class MediaResponseError extends Error {
  override readonly name = 'MediaResponseError';
}

export interface ImageMedia {
  data: Buffer;
  contentType: string;
  extension: 'png' | 'jpeg' | 'webp' | 'gif';
}

export function validateImagePrompt(value: string | null | undefined): string {
  const prompt = value?.trim() ?? '';
  if (prompt.length === 0) throw new MediaResponseError('Please provide an image prompt.');
  if (prompt.length > IMAGE_PROMPT_MAX) {
    throw new MediaResponseError(`Image prompts must be ${IMAGE_PROMPT_MAX} characters or fewer.`);
  }
  return prompt;
}

/**
 * Agnes' endpoint and response contract are intentionally not guessed here.
 * Keep the command fail-safe until the assigned provider contract is supplied.
 */
export async function generateImage(_env: Env, _prompt: string, _signal?: AbortSignal): Promise<ImageMedia> {
  throw new MediaResponseError('Image generation is unavailable until the Agnes provider endpoint is configured.');
}
