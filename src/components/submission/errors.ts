import type { FieldErrors } from "./types";

/**
 * Maps low-level API errors to short, actionable copy for end users.
 */
export function getReadableError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("invalid key")) {
    return "This file name contains unsupported characters. Please rename the file or try again.";
  }

  if (normalizedMessage.includes("row-level security")) {
    return "You do not have permission to save this record right now. Please check your Supabase table policies.";
  }

  if (
    normalizedMessage.includes("duplicate") ||
    normalizedMessage.includes("unique") ||
    normalizedMessage.includes("23505")
  ) {
    return "A similar record already exists. Please change the identifier and try again.";
  }

  return message;
}

/**
 * Routes a single error message to the most relevant form field.
 */
export function mapErrorToFields(message: string): FieldErrors {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("identifier")) {
    return { identifier: message };
  }

  if (
    normalizedMessage.includes("file") ||
    normalizedMessage.includes("upload") ||
    normalizedMessage.includes("invalid key")
  ) {
    return { file: message };
  }

  return { general: message };
}
