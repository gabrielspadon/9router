"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import dynamic from "next/dynamic";
import { useTheme } from "@/shared/hooks/useTheme";
import { ConfirmModal } from "./Modal";
import Button from "@/shared/components/Button";

const ChangelogModal = dynamic(() => import("./ChangelogModal"), { ssr: false });

function MenuItem({ icon, label, onClick, trailing, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-11 items-center gap-3 w-full px-4 py-3 text-sm transition-colors ${
        danger
          ? "text-danger hover:bg-danger-soft"
          : "text-text-main hover:bg-surface-2"
      }`}
    >
      <span
        aria-hidden="true"
        className={`material-symbols-outlined text-[20px] ${danger ? "" : "text-text-muted"}`}
      >
        {icon}
      </span>
      <span className="flex-1 text-start">{label}</span>
      {trailing && <span className="text-xs text-text-muted">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

export default function HeaderMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const { toggleTheme, isDark } = useTheme();
  const menuRef = useRef(null);

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/version/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  // Build identity, baked at app build time (NEXT_PUBLIC_TP_BUILD_SHA), mirroring
  // the Sidebar footer. Hidden when missing (dev without config) or unknown.
  const buildSha = process.env.NEXT_PUBLIC_TP_BUILD_SHA;

  return (
    <div className="flex items-center gap-2">
      <div className="relative" ref={menuRef}>
        <Button
          variant="ghost" size="icon"
          className="min-h-11 min-w-11"
          onClick={() => setIsOpen((v) => !v)}
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <span aria-hidden="true" className="material-symbols-outlined">grid_view</span>
        </Button>

        {isOpen && (
          <div
            role="menu"
            aria-label="Menu"
            className="absolute end-0 top-full mt-2 w-60 bg-surface border border-border rounded-[var(--radius-brand-lg)] shadow-elev z-50 fade-in overflow-hidden py-1"
          >
            <MenuItem
              icon="history"
              label="Change Log"
              onClick={() => { close(); setChangelogOpen(true); }}
            />
            <MenuItem
              icon={isDark ? "light_mode" : "dark_mode"}
              label="Theme"
              onClick={() => { toggleTheme(); close(); }}
            />
            <MenuItem
              icon="power_settings_new"
              label="Shutdown"
              danger
              onClick={() => { close(); setShutdownOpen(true); }}
            />
            <MenuItem
              icon="logout"
              label="Logout"
              danger
              onClick={() => { close(); onLogout(); }}
            />
          </div>
        )}
      </div>

      {changelogOpen && (
        <ChangelogModal isOpen onClose={() => setChangelogOpen(false)} />
      )}
      <ConfirmModal
        isOpen={shutdownOpen}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />
      {buildSha && buildSha !== "unknown" && (
        <span
          data-testid="header-build"
          className="font-mono text-xs text-content-tertiary"
          title={`Build ${buildSha}`}
        >
          build {buildSha}
        </span>
      )}
    </div>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
