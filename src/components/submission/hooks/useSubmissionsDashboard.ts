import { useDeferredValue, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getReadableError } from "../errors";
import { fetchSubmissionSummaryCounts, fetchSubmissionsPage } from "../queries";
import type { FieldErrors, FilterType, SubmissionRecord, ToastState } from "../types";

type UseSubmissionsDashboardArgs = {
  currentPage: number;
  activeFilter: FilterType;
  searchQuery: string;
  refreshToken: number;
  setToast: (value: ToastState) => void;
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
};

type UseSubmissionsDashboardResult = {
  isFetching: boolean;
  deferredSearchQuery: string;
  pageRows: SubmissionRecord[];
  listTotalCount: number;
  summaryTotal: number;
  summaryImages: number;
  summaryDocuments: number;
};

/**
 * Loads summary counts and the current page of submissions from Supabase.
 * Uses a monotonically increasing sequence so stale responses never overwrite newer ones.
 */
export function useSubmissionsDashboard({
  currentPage,
  activeFilter,
  searchQuery,
  refreshToken,
  setToast,
  setFieldErrors,
}: UseSubmissionsDashboardArgs): UseSubmissionsDashboardResult {
  const [isFetching, setIsFetching] = useState(false);
  const [pageRows, setPageRows] = useState<SubmissionRecord[]>([]);
  const [listTotalCount, setListTotalCount] = useState(0);
  const [summaryTotal, setSummaryTotal] = useState(0);
  const [summaryImages, setSummaryImages] = useState(0);
  const [summaryDocuments, setSummaryDocuments] = useState(0);
  const loadSequenceRef = useRef(0);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    const seq = ++loadSequenceRef.current;
    let cancelled = false;

    const load = async () => {
      setIsFetching(true);
      try {
        const [countsResult, pageResult] = await Promise.all([
          fetchSubmissionSummaryCounts(deferredSearchQuery),
          fetchSubmissionsPage(currentPage, activeFilter, deferredSearchQuery),
        ]);

        if (cancelled || seq !== loadSequenceRef.current) {
          return;
        }

        if (countsResult.error) {
          const message = getReadableError(
            countsResult.error.message || "Unable to load summary counts.",
          );
          setToast({ type: "error", message });
          setFieldErrors((current) => ({ ...current, general: message }));
        } else {
          setSummaryTotal(countsResult.total);
          setSummaryImages(countsResult.images);
          setSummaryDocuments(countsResult.documents);
        }

        if (pageResult.error) {
          const message = getReadableError(pageResult.error.message || "Unable to load submissions.");
          setToast({ type: "error", message });
          setFieldErrors((current) => ({ ...current, general: message }));
          setPageRows([]);
          setListTotalCount(0);
        } else {
          setPageRows(pageResult.rows);
          setListTotalCount(pageResult.count);
        }
      } finally {
        if (seq === loadSequenceRef.current) {
          setIsFetching(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [currentPage, activeFilter, deferredSearchQuery, refreshToken, setToast, setFieldErrors]);

  return {
    isFetching,
    deferredSearchQuery,
    pageRows,
    listTotalCount,
    summaryTotal,
    summaryImages,
    summaryDocuments,
  };
}
