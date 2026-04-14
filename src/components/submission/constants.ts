import type { FilterType } from "./types";

export const ACCEPTED_FILE_TYPES = [
  "image/*",
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".rtf",
  ".xls",
  ".xlsx",
  ".csv",
  ".ppt",
  ".pptx",
].join(",");

export const BUCKET_NAME = import.meta.env.VITE_SUPABASE_BUCKET as string | undefined;

/** Page size for server-side range queries (must match UI pagination). */
export const ITEMS_PER_PAGE = 10;

/** Tab config for the browse toolbar (value matches `FilterType`). */
export const FILTER_TABS: ReadonlyArray<{ value: FilterType; label: string }> = [
  { value: "all", label: "All Types" },
  { value: "image", label: "Images" },
  { value: "document", label: "Documents" },
];
