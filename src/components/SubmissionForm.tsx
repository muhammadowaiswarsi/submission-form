import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { supabase } from "../lib/supabase";

type SubmissionType = "image" | "document";
type FilterType = "all" | SubmissionType;
type AnimationState = "enter" | "exit";

type SubmissionRecord = {
  id?: string;
  identifier: string;
  type: SubmissionType;
  file_url: string;
  status: string;
  created_at?: string;
};

type ToastState = {
  type: "success" | "error";
  message: string;
} | null;

const ACCEPTED_FILE_TYPES = [
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

const BUCKET_NAME = import.meta.env.VITE_SUPABASE_BUCKET;

function SubmissionForm() {
  const [identifier, setIdentifier] = useState("");
  const [type, setType] = useState<SubmissionType>("image");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [items, setItems] = useState<SubmissionRecord[]>([]);
  const [images, setImages] = useState<SubmissionRecord[]>([]);
  const [documents, setDocuments] = useState<SubmissionRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(8);
  const [filteredData, setFilteredData] = useState<SubmissionRecord[]>([]);
  const [cardsAnimation, setCardsAnimation] = useState<AnimationState>("enter");
  const [toast, setToast] = useState<ToastState>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    identifier?: string;
    file?: string;
    general?: string;
  }>({});

  useEffect(() => {
    void fetchSubmissions();
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 4000);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    const nextItems = getItemsForFilter(activeFilter, items, images, documents);
    setFilteredData(filterSubmissionsBySearch(nextItems, searchQuery));
  }, [activeFilter, items, images, documents, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, searchQuery]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, currentPage, itemsPerPage]);

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
  }, [currentPage, filteredData, activeFilter, searchQuery]);

  const resetMessages = () => {
    setFieldErrors({});
  };

  const fetchSubmissions = async () => {
    setIsFetching(true);

    const { data, error } = await supabase
      .from("submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setToast({
        type: "error",
        message: getReadableError(error.message || "Unable to load submissions."),
      });
      setFieldErrors({
        general: getReadableError(error.message || "Unable to load submissions."),
      });
      setIsFetching(false);
      return;
    }

    const nextItems = ((data as SubmissionRecord[]) ?? []).map((item): SubmissionRecord => ({
      ...item,
      type: item.type === "document" ? "document" : "image",
    }));

    setItems(nextItems);
    setImages(nextItems.filter((item) => item.type === "image"));
    setDocuments(nextItems.filter((item) => item.type === "document"));
    setIsFetching(false);
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

    if (!identifier.trim()) {
      setFieldErrors({ identifier: "Please enter an identifier before submitting." });
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

      const payload: SubmissionRecord = {
        identifier: identifier.trim(),
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

      await fetchSubmissions();
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

  const totalCount = items.length;
  const imageCount = images.length;
  const documentCount = documents.length;

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

      {toast ? (
        <div className={`toast toast--${toast.type}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          <button className="toast-close" type="button" onClick={() => setToast(null)}>
            Close
          </button>
        </div>
      ) : null}

      <section className="dashboard-summary">
        <div className="summary-card">
          <span>Total Files</span>
          <strong>{totalCount}</strong>
        </div>
        <div className="summary-card">
          <span>Images</span>
          <strong>{imageCount}</strong>
        </div>
        <div className="summary-card">
          <span>Documents</span>
          <strong>{documentCount}</strong>
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
            onClick={() => void fetchSubmissions()}
            disabled={isFetching}
          >
            {isFetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="filter-tabs" role="tablist" aria-label="File type filters">
          <div className="filter-tabs__list">
            {[
              { value: "all", label: "All Types" },
              { value: "image", label: "Images" },
              { value: "document", label: "Documents" },
            ].map((tab) => (
              <button
                key={tab.value}
                className={`filter-tab${activeFilter === tab.value ? " filter-tab--active" : ""}`}
                type="button"
                onClick={() => setActiveFilter(tab.value as FilterType)}
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
              placeholder="Search by identifier or file name"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        <div className={`browse-list browse-list--${cardsAnimation}`}>
          {paginatedItems.length === 0 ? (
            <div className="empty-state empty-state--wide">
              {isFetching
                ? "Loading files..."
                : searchQuery.trim()
                  ? "No files found for this search."
                  : "No files found for this filter."}
            </div>
          ) : (
            paginatedItems.map((item, index) => (
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
                    <time>{formatDate(item.created_at, true)}</time>
                  </div>
                  <a href={item.file_url} target="_blank" rel="noreferrer">
                    Open file
                  </a>
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

function sanitizeFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex > -1 ? fileName.slice(dotIndex) : "";
  const baseName = dotIndex > -1 ? fileName.slice(0, dotIndex) : fileName;
  const safeBaseName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${safeBaseName || "file"}${extension.toLowerCase()}`;
}

function getReadableError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("invalid key")) {
    return "This file name contains unsupported characters. Please rename the file or try again.";
  }

  if (normalizedMessage.includes("row-level security")) {
    return "You do not have permission to save this record right now. Please check your Supabase table policies.";
  }

  if (normalizedMessage.includes("duplicate")) {
    return "A similar record already exists. Please change the identifier and try again.";
  }

  return message;
}

function mapErrorToFields(message: string) {
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

function getItemsForFilter(
  filter: FilterType,
  items: SubmissionRecord[],
  images: SubmissionRecord[],
  documents: SubmissionRecord[],
) {
  if (filter === "image") {
    return images;
  }

  if (filter === "document") {
    return documents;
  }

  return items;
}

function filterSubmissionsBySearch(items: SubmissionRecord[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) => {
    const fileName = extractFileName(item.file_url).toLowerCase();
    const typeLabel = item.type.toLowerCase();
    const pluralType = item.type === "image" ? "images" : "documents";

    return (
      item.identifier.toLowerCase().includes(normalizedQuery) ||
      fileName.includes(normalizedQuery) ||
      typeLabel.includes(normalizedQuery) ||
      pluralType.includes(normalizedQuery)
    );
  });
}

function getPaginationItems(
  currentPage: number,
  totalPages: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = [1];

  if (currentPage > 3) {
    pages.push(-1);
  }

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (currentPage < totalPages - 2) {
    pages.push(-1);
  }

  pages.push(totalPages);

  return pages.map((value) => (value === -1 ? "ellipsis" : value));
}

function extractFileName(fileUrl: string) {
  try {
    const pathname = new URL(fileUrl).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "Uploaded file");
  } catch {
    return "Uploaded file";
  }
}

function formatDate(value?: string, withTime = false) {
  if (!value) {
    return "Just now";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

export default SubmissionForm;
