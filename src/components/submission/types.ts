/**
 * Domain types for the submissions dashboard and upload form.
 */

export type SubmissionType = "image" | "document";
export type FilterType = "all" | SubmissionType;
export type AnimationState = "enter" | "exit";

/** Row shape used in the UI (normalized `type`, optional fields from partial selects). */
export type SubmissionRecord = {
  id?: string;
  identifier: string;
  type: SubmissionType;
  file_url: string;
  status: string;
  created_at?: string;
};

export type ToastState = {
  type: "success" | "error";
  message: string;
} | null;

export type FieldErrors = {
  identifier?: string;
  file?: string;
  general?: string;
};
