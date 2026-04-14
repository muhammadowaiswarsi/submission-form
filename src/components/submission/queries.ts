/**
 * Supabase reads for the submissions dashboard (counts + paginated list + uniqueness checks).
 */

import { supabase } from "../../lib/supabase";
import { ITEMS_PER_PAGE } from "./constants";
import type { FilterType, SubmissionRecord, SubmissionType } from "./types";


/** Strips characters that would break PostgREST `or` / `ilike` clauses. */
function searchFragmentForOr(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/%/g, "")
    .replace(/_/g, "")
    .replace(/,/g, "")
    .replace(/[()]/g, "")
    .replace(/"/g, "");
  return stripped.length > 0 ? stripped : null;
}

/** Builds a PostgREST `.or()` filter across identifier, URL, and type keywords. */
function buildSubmissionSearchOrClause(fragment: string): string {
  const pat = `%${fragment}%`;
  const parts = [`identifier.ilike.${pat}`, `file_url.ilike.${pat}`, `type.ilike.${pat}`];
  const low = fragment.toLowerCase();
  if (low === "images") {
    parts.push("type.eq.image");
  }
  if (low === "documents") {
    parts.push("type.eq.document");
  }
  return parts.join(",");
}

/** Coerces unknown DB values to the UI's supported union. */
export function normalizeSubmissionType(value: unknown): SubmissionType {
  return String(value).toLowerCase() === "document" ? "document" : "image";
}

/**
 * Runs a head count query with optional type filter and shared search fragment.
 */
function countSubmissionsQuery(searchRaw: string, typeFilter?: SubmissionType) {
  let query = supabase.from("submissions").select("id", { count: "exact", head: true });
  if (typeFilter) {
    query = query.eq("type", typeFilter);
  }
  const fragment = searchFragmentForOr(searchRaw);
  if (fragment) {
    query = query.or(buildSubmissionSearchOrClause(fragment));
  }
  return query;
}

/**
 * Parallel count queries for summary cards (total / images / documents) with the same search.
 */
export async function fetchSubmissionSummaryCounts(searchRaw: string): Promise<{
  total: number;
  images: number;
  documents: number;
  error: Error | null;
}> {
  const [allRes, imagesRes, documentsRes] = await Promise.all([
    countSubmissionsQuery(searchRaw),
    countSubmissionsQuery(searchRaw, "image"),
    countSubmissionsQuery(searchRaw, "document"),
  ]);

  const firstError = allRes.error ?? imagesRes.error ?? documentsRes.error;
  if (firstError) {
    return { total: 0, images: 0, documents: 0, error: new Error(firstError.message) };
  }

  return {
    total: allRes.count ?? 0,
    images: imagesRes.count ?? 0,
    documents: documentsRes.count ?? 0,
    error: null,
  };
}

/**
 * Fetches one page of rows for the active type filter and search, newest first.
 */
export async function fetchSubmissionsPage(
  page: number,
  activeFilter: FilterType,
  searchRaw: string,
): Promise<{ rows: SubmissionRecord[]; count: number; error: Error | null }> {
  const from = (page - 1) * ITEMS_PER_PAGE;
  const to = from + ITEMS_PER_PAGE - 1;

  let query = supabase.from("submissions").select("*", { count: "exact" });

  if (activeFilter === "image") {
    query = query.eq("type", "image");
  } else if (activeFilter === "document") {
    query = query.eq("type", "document");
  }

  const fragment = searchFragmentForOr(searchRaw);
  if (fragment) {
    query = query.or(buildSubmissionSearchOrClause(fragment));
  }

  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to);

  if (error) {
    return { rows: [], count: 0, error: new Error(error.message) };
  }

  const rows = (data ?? []).map(
    (row): SubmissionRecord => ({
      ...row,
      type: normalizeSubmissionType(row.type),
      created_at: row.created_at ?? undefined,
    }),
  );

  return { rows, count: count ?? 0, error: null };
}

/**
 * Returns whether an identifier already exists (case-insensitive), for form validation.
 */
export async function fetchIdentifierExistsCaseInsensitive(
  identifier: string,
): Promise<{ exists: boolean; error: Error | null }> {
  const { count, error } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .ilike("identifier", identifier);

  if (error) {
    return { exists: false, error: new Error(error.message) };
  }

  return { exists: (count ?? 0) > 0, error: null };
}
