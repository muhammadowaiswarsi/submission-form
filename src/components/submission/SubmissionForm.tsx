import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../lib/database.types";
import { ACCEPTED_FILE_TYPES, BUCKET_NAME, FILTER_TABS, ITEMS_PER_PAGE } from "./constants";
import { getReadableError, mapErrorToFields } from "./errors";
import { extractFileName, formatDate, sanitizeFileName } from "./formatters";
import { useSubmissionsDashboard } from "./hooks/useSubmissionsDashboard";
import { getPaginationItems } from "./pagination";
import { extractStorageObjectPath, isStorageObjectMissingError } from "./storage";
import { fetchIdentifierExistsCaseInsensitive, normalizeSubmissionType } from "./queries";
import type {
  AnimationState,
  FieldErrors,
  FilterType,
  SubmissionRecord,
  SubmissionType,
  ToastState,
} from "./types";

type SubmissionInsert = Database["public"]["Tables"]["submissions"]["Insert"];

/**
 * Dashboard + modal upload flow for Supabase-backed file submissions.
 */
export default function SubmissionForm() {
  const [identifier, setIdentifier] = useState("");
  const [type, setType] = useState<SubmissionType>("image");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [cardsAnimation, setCardsAnimation] = useState<AnimationState>("enter");
  const [toast, setToast] = useState<ToastState>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SubmissionRecord | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const bumpRefresh = () => {
    setRefreshToken((value) => value + 1);
  };

  const {
    isFetching,
    deferredSearchQuery,
    pageRows,
    listTotalCount,
    summaryTotal,
    summaryImages,
    summaryDocuments,
  } = useSubmissionsDashboard({
    currentPage,
    activeFilter,
    searchQuery,
    refreshToken,
    setToast,
    setFieldErrors,
  });

  useEffect(() => {
    if (!pendingDelete) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPendingDelete(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingDelete]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 4000);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const totalPages = listTotalCount === 0 ? 0 : Math.ceil(listTotalCount / ITEMS_PER_PAGE);

  const paginationItems = useMemo(
    () => getPaginationItems(currentPage, totalPages),
    [currentPage, totalPages],
  );

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCardsAnimation("exit");
    const timeoutId = window.setTimeout(() => {
      setCardsAnimation("enter");
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [currentPage, pageRows, activeFilter, deferredSearchQuery]);

  const resetMessages = () => {
    setFieldErrors({});
  };

  const handleFileSelection = (file: File | null) => {
    if (!file) {
      return;
    }

    setSelectedFile(file);
    setFieldErrors((current) => ({ ...current, file: undefined, general: undefined }));
  };

  const handleInputFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFileSelection(event.target.files?.[0] ?? null);
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFileSelection(event.dataTransfer.files?.[0] ?? null);
  };

  const resetForm = () => {
    setIdentifier("");
    setType("image");
    setSelectedFile(null);
    setIsDragging(false);
    setFieldErrors({});
  };

  const openModal = () => {
    resetMessages();
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    if (!BUCKET_NAME) {
      setFieldErrors({
        general: "Upload settings are missing. Please add the storage bucket configuration.",
      });
      return;
    }

    const trimmedIdentifier = identifier.trim();

    if (!trimmedIdentifier) {
      setFieldErrors({ identifier: "Please enter an identifier before submitting." });
      return;
    }

    const { exists: identifierTaken, error: duplicateCheckError } =
      await fetchIdentifierExistsCaseInsensitive(trimmedIdentifier);

    if (duplicateCheckError) {
      setFieldErrors({
        general: getReadableError(duplicateCheckError.message || "Could not verify identifier."),
      });
      return;
    }

    if (identifierTaken) {
      setFieldErrors({
        identifier:
          "This identifier is already in use. Each submission must use a different identifier.",
      });
      return;
    }

    if (!selectedFile) {
      setFieldErrors({ file: "Please choose a file before submitting the form." });
      return;
    }

    setIsSubmitting(true);

    let uploadedPath = "";

    try {
      uploadedPath = `${Date.now()}_${sanitizeFileName(selectedFile.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(uploadedPath, selectedFile);

      if (uploadError) {
        throw new Error(getReadableError(uploadError.message || "File upload failed."));
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET_NAME).getPublicUrl(uploadedPath);

      if (!publicUrl) {
        throw new Error("Could not generate a public URL for the uploaded file.");
      }

      const payload: SubmissionInsert = {
        identifier: trimmedIdentifier,
        type,
        file_url: publicUrl,
        status: "pending",
      };

      const { error: insertError } = await supabase.from("submissions").insert(payload);

      if (insertError) {
        throw new Error(
          getReadableError(insertError.message || "Submission record could not be created."),
        );
      }

      setCurrentPage(1);
      bumpRefresh();
      resetForm();
      setToast({ type: "success", message: "Submission saved successfully." });
      setIsModalOpen(false);
    } catch (error) {
      if (uploadedPath) {
        await supabase.storage.from(BUCKET_NAME).remove([uploadedPath]);
      }

      const message =
        error instanceof Error ? error.message : "Something went wrong while submitting.";
      setToast({ type: "error", message });
      setFieldErrors(mapErrorToFields(message));
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestDeleteSubmission = (item: SubmissionRecord) => {
    if (!item.id) {
      setToast({ type: "error", message: "This record cannot be deleted because it has no id." });
      return;
    }
    setPendingDelete(item);
  };

  const cancelPendingDelete = () => {
    setPendingDelete(null);
  };

  const performDeleteSubmission = async (item: SubmissionRecord) => {
    if (!item.id) {
      return;
    }

    setDeletingId(item.id);

    try {
      const { error: deleteRowError } = await supabase.from("submissions").delete().eq("id", item.id);

      if (deleteRowError) {
        throw new Error(
          getReadableError(deleteRowError.message || "Could not delete this submission from the database."),
        );
      }

      if (BUCKET_NAME) {
        const objectPath = extractStorageObjectPath(item.file_url, BUCKET_NAME);
        if (objectPath) {
          const { error: removeError } = await supabase.storage.from(BUCKET_NAME).remove([objectPath]);
          if (removeError && !isStorageObjectMissingError(removeError.message)) {
            setToast({
              type: "error",
              message: `Removed from the database, but storage cleanup failed: ${getReadableError(removeError.message)}`,
            });
            bumpRefresh();
            return;
          }
        }
      }

      bumpRefresh();
      setToast({ type: "success", message: "Submission removed from the database." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong while deleting.";
      setToast({ type: "error", message });
    } finally {
      setDeletingId(null);
    }
  };

  const confirmPendingDelete = () => {
    if (!pendingDelete?.id || deletingId) {
      return;
    }
    const item = pendingDelete;
    setPendingDelete(null);
    void performDeleteSubmission(item);
  };

  return (
    <section className="file-dashboard">
      <header className="dashboard-topbar">
        <div>
          <p className="dashboard-kicker">Supabase-powered uploads</p>
          <h1 className="dashboard-heading">File Uploader</h1>
        </div>
        <button className="primary-action" type="button" onClick={openModal}>
          Add New
        </button>
      </header>

      {toast || pendingDelete ? (
        <div className="toast-stack" aria-live="polite">
          {toast ? (
            <div className={`toast toast--${toast.type}`} role="status">
              <span>{toast.message}</span>
              <button className="toast-close" type="button" onClick={() => setToast(null)}>
                Close
              </button>
            </div>
          ) : null}
          {pendingDelete ? (
            <div
              className="toast toast--confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-confirm-title"
              aria-describedby="delete-confirm-desc"
            >
              <div className="toast-confirm__inner">
                <p id="delete-confirm-title" className="toast-confirm__title">
                  Delete this submission?
                </p>
                <p id="delete-confirm-desc" className="toast-confirm__desc">
                  <strong>{pendingDelete.identifier}</strong>{" "}
                  <span className="toast-confirm__type">
                    ({normalizeSubmissionType(pendingDelete.type)})
                  </span>{" "}
                  will be removed from the database and its file deleted from storage. This cannot be
                  undone.
                </p>
                <div className="toast-confirm__actions">
                  <button
                    className="toast-confirm__btn toast-confirm__btn--ghost"
                    type="button"
                    onClick={cancelPendingDelete}
                  >
                    Cancel
                  </button>
                  <button
                    className="toast-confirm__btn toast-confirm__btn--danger"
                    type="button"
                    onClick={confirmPendingDelete}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="dashboard-summary">
        <div className="summary-card">
          <span>Total Files</span>
          <strong>{summaryTotal}</strong>
        </div>
        <div className="summary-card">
          <span>Images</span>
          <strong>{summaryImages}</strong>
        </div>
        <div className="summary-card">
          <span>Documents</span>
          <strong>{summaryDocuments}</strong>
        </div>
      </section>

      <section className="card section-card">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Filter uploads</p>
            <h2>Browse by type</h2>
          </div>
          <button
            className="ghost-action"
            type="button"
            onClick={() => bumpRefresh()}
            disabled={isFetching}
          >
            {isFetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="filter-tabs" role="tablist" aria-label="File type filters">
          <div className="filter-tabs__list">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.value}
                className={`filter-tab${activeFilter === tab.value ? " filter-tab--active" : ""}`}
                type="button"
                onClick={() => {
                  setActiveFilter(tab.value);
                  setCurrentPage(1);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <label className="search-input-wrap" htmlFor="file-search">
            <span className="search-input-wrap__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </span>
            <input
              id="file-search"
              className="search-input"
              type="search"
              placeholder="Search..."
              value={searchQuery}
              title="Runs on Supabase (ilike on identifier, file_url, type)"
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setCurrentPage(1);
              }}
            />
          </label>
        </div>

        <div className={`browse-list browse-list--${cardsAnimation}`}>
          {pageRows.length === 0 ? (
            <div className="empty-state empty-state--wide">
              {isFetching
                ? "Loading files..."
                : deferredSearchQuery.trim()
                  ? "No files found for this search."
                  : "No files found for this filter."}
            </div>
          ) : (
            pageRows.map((item, index) => (
              <article
                className="browse-item"
                key={item.id ?? `${item.file_url}-${index}`}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div>
                  <h3>{item.identifier}</h3>
                  <p>{extractFileName(item.file_url)}</p>
                </div>
                <div className="browse-item__meta">
                  <div className="browse-item__meta-row">
                    <span className={`pill pill--${item.type}`}>{item.type}</span>
                    <time>{formatDate(item.created_at ?? undefined, true)}</time>
                  </div>
                  <div className="browse-item__actions">
                    <a href={item.file_url} target="_blank" rel="noreferrer">
                      Open file
                    </a>
                    <button
                      className="browse-item__delete"
                      type="button"
                      aria-label={`Delete submission ${item.identifier}`}
                      disabled={!item.id || deletingId === item.id}
                      onClick={() => requestDeleteSubmission(item)}
                    >
                      {deletingId === item.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        {totalPages > 1 ? (
          <nav className="pagination" aria-label="Submission pages">
            <button
              className="pagination__button"
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <div className="pagination__pages">
              {paginationItems.map((value, index) =>
                value === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} className="pagination__ellipsis">
                    ...
                  </span>
                ) : (
                  <button
                    key={value}
                    className={`pagination__page${
                      value === currentPage ? " pagination__page--active" : ""
                    }`}
                    type="button"
                    onClick={() => setCurrentPage(value)}
                  >
                    {value}
                  </button>
                ),
              )}
            </div>
            <button
              className="pagination__button"
              type="button"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </nav>
        ) : null}
      </section>

      {isModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeModal}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-file-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="section-kicker">New upload</p>
                <h2 id="add-file-title">Add a new file</h2>
              </div>
              <button className="modal-close" type="button" onClick={closeModal}>
                Close
              </button>
            </div>

            <form className="submission-form" onSubmit={handleSubmit}>
              {fieldErrors.general ? (
                <div className="message message--error">{fieldErrors.general}</div>
              ) : null}

              <div className="field-group">
                <label className="field-label" htmlFor="identifier">
                  Identifier
                </label>
                <input
                  id="identifier"
                  className="text-input"
                  type="text"
                  placeholder="Enter a unique identifier"
                  value={identifier}
                  onChange={(event) => {
                    setIdentifier(event.target.value);
                    setFieldErrors((current) => ({
                      ...current,
                      identifier: undefined,
                      general: undefined,
                    }));
                  }}
                  required
                />
                {fieldErrors.identifier ? (
                  <p className="field-error">{fieldErrors.identifier}</p>
                ) : null}
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="type">
                  Type
                </label>
                <select
                  id="type"
                  className="select-input"
                  value={type}
                  onChange={(event) => setType(event.target.value as SubmissionType)}
                >
                  <option value="image">Image</option>
                  <option value="document">Document</option>
                </select>
              </div>

              <div className="field-group">
                <span className="field-label">Upload file</span>
                <label
                  className={`upload-area${isDragging ? " upload-area--active" : ""}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    accept={ACCEPTED_FILE_TYPES}
                    onChange={handleInputFileChange}
                  />
                  <span className="upload-area__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                      <path
                        d="M12 16V7m0 0-3.5 3.5M12 7l3.5 3.5M5 17.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <p className="upload-area__title">Drag and drop or click to browse</p>
                  <p className="upload-area__hint">
                    Images, PDFs, Word files, spreadsheets, and presentation documents
                    are supported.
                  </p>
                  <p className="upload-area__file">
                    {selectedFile ? `Selected: ${selectedFile.name}` : "No file selected yet"}
                  </p>
                </label>
                {fieldErrors.file ? <p className="field-error">{fieldErrors.file}</p> : null}
              </div>

              <button className="submit-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? <span className="button-spinner" aria-hidden="true" /> : null}
                <span>{isSubmitting ? "Submitting..." : "Submit file"}</span>
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
