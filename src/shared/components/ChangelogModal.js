"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { GITHUB_CONFIG } from "@/shared/constants/config";
import Button from "@/shared/components/Button";

marked.setOptions({ gfm: true, breaks: true });

export default function ChangelogModal({ isOpen, onClose }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen || html) return;
    setLoading(true);
    setError("");
    fetch(GITHUB_CONFIG.changelogUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((md) => setHtml(DOMPurify.sanitize(marked.parse(md))))
      .catch((err) => setError(err.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [isOpen, html]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal content */}
      <div
        ref={modalRef}
        className="relative w-full bg-surface border border-border rounded-[var(--radius-brand-lg)] shadow-elev fade-in max-w-3xl flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-main">Change Log</h2>
          <Button
            variant="ghost" size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </Button>
        </div>

        {/* Body */}
        <div className="p-5.5 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-8 text-text-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin me-2">progress_activity</span>
              Loading...
            </div>
          )}
          {error && (
            <div className="text-danger py-4">Failed to load changelog: {error}</div>
          )}
          {!loading && !error && html && (
            <div
              className="changelog-body text-text-main"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

ChangelogModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
