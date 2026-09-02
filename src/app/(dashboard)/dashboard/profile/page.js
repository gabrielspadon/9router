'use client';

import { useState, useEffect, useRef } from 'react';
import { Button, Toggle, Input } from '@/shared/components';
import Modal, { ConfirmModal } from '@/shared/components/Modal';
import LanguageSwitcher from '@/shared/components/LanguageSwitcher';
import { useTheme } from '@/shared/hooks/useTheme';
import { cn } from '@/shared/utils/cn';
import { APP_CONFIG } from '@/shared/constants/config';
import { LOCALE_COOKIE, normalizeLocale } from '@/i18n/config';
import { LOCALE_FLAGS } from '@/shared/constants/locales';
import { HIDEABLE_NAV_ITEMS } from '@/shared/components/Sidebar';
import ConnectTimeoutInput from "@/shared/components/ConnectTimeoutInput";

function getLocaleFromCookie() {
  if (typeof document === 'undefined') return 'en';
  const cookie = document.cookie.split(';').find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split('=')[1]) : 'en';
  return normalizeLocale(value);
}

export default function ProfilePage() {
  const { theme, setTheme, isDark } = useTheme();
  const [locale, setLocale] = useState(() => getLocaleFromCookie());
  const [langOpen, setLangOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [settings, setSettings] = useState({ fallbackStrategy: 'fill-first' });
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [passStatus, setPassStatus] = useState({ type: '', message: '' });
  const [passLoading, setPassLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState({ type: '', message: '' });
  const [dbAuth, setDbAuth] = useState({ open: false, mode: '', password: '' });
  const pendingImportRef = useRef(null);
  const [oidcForm, setOidcForm] = useState({
    authMode: 'password',
    oidcIssuerUrl: '',
    oidcClientId: '',
    oidcScopes: 'openid profile email',
    oidcLoginLabel: 'Sign in with OIDC',
  });
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [oidcStatus, setOidcStatus] = useState({ type: '', message: '' });
  const [oidcLoading, setOidcLoading] = useState(false);
  const [oidcTestLoading, setOidcTestLoading] = useState(false);
  const [oidcTestStatus, setOidcTestStatus] = useState({ type: '', message: '' });
  const [oidcExpanded, setOidcExpanded] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const oidcRedirectUri = origin ? `${origin}/api/auth/oidc/callback` : '/api/auth/oidc/callback';
  const samlAcsUrl = origin ? `${origin}/api/auth/saml/acs` : '/api/auth/saml/acs';
  const samlMetadataUrl = origin ? `${origin}/api/auth/saml/metadata` : '/api/auth/saml/metadata';

  // SAML State
  const [ssoTypeTab, setSsoTypeTab] = useState('saml');
  const [samlForm, setSamlForm] = useState({
    samlEntryPoint: '',
    samlIssuer: 'urn:tokenproxy:sp',
    samlCert: '',
    samlLoginLabel: 'Sign in with SAML SSO',
    samlAttributeEmail: 'email',
    samlAttributeName: 'name',
  });
  const [samlStatus, setSamlStatus] = useState({ type: '', message: '' });
  const [samlLoading, setSamlLoading] = useState(false);
  const [samlTestLoading, setSamlTestLoading] = useState(false);
  const [samlTestStatus, setSamlTestStatus] = useState({ type: '', message: '' });
  const [showSamlGuide, setShowSamlGuide] = useState(false);
  const idpMetadataFileRef = useRef(null);
  const certFileRef = useRef(null);

  const importFileRef = useRef(null);
  const [proxyForm, setProxyForm] = useState({
    outboundProxyEnabled: false,
    outboundProxyUrl: '',
    outboundNoProxy: '',
  });
  const [proxyStatus, setProxyStatus] = useState({ type: '', message: '' });
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyTestLoading, setProxyTestLoading] = useState(false);

  // Claude Code minimal mode — hidden sidebar entries (settings.hiddenNavItems)
  const [hiddenNavItems, setHiddenNavItems] = useState([]);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        setSettings(data);
        setOidcForm({
          authMode: data?.authMode || 'password',
          oidcIssuerUrl: data?.oidcIssuerUrl || '',
          oidcClientId: data?.oidcClientId || '',
          oidcScopes: data?.oidcScopes || 'openid profile email',
          oidcLoginLabel: data?.oidcLoginLabel || 'Sign in with OIDC',
        });
        setOidcClientSecret('');
        setSsoTypeTab(data?.ssoType || 'saml');
        setSamlForm({
          samlEntryPoint: data?.samlEntryPoint || '',
          samlIssuer: data?.samlIssuer || 'urn:tokenproxy:sp',
          samlCert: data?.samlCert || '',
          samlLoginLabel: data?.samlLoginLabel || 'Sign in with SAML SSO',
          samlAttributeEmail: data?.samlAttributeEmail || 'email',
          samlAttributeName: data?.samlAttributeName || 'name',
        });
        if (
          data?.authMode === 'sso' ||
          data?.authMode === 'saml' ||
          data?.authMode === 'oidc' ||
          data?.authMode === 'both'
        ) {
          setOidcExpanded(true);
        }
        setProxyForm({
          outboundProxyEnabled: data?.outboundProxyEnabled === true,
          outboundProxyUrl: data?.outboundProxyUrl || '',
          outboundNoProxy: data?.outboundNoProxy || '',
        });
        if (Array.isArray(data?.hiddenNavItems)) setHiddenNavItems(data.hiddenNavItems);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch settings:', err);
        setLoading(false);
      });
  }, []);

  const updateOutboundProxy = async (e) => {
    e.preventDefault();
    if (settings.outboundProxyEnabled !== true) return;
    setProxyLoading(true);
    setProxyStatus({ type: '', message: '' });

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outboundProxyUrl: proxyForm.outboundProxyUrl,
          outboundNoProxy: proxyForm.outboundNoProxy,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyStatus({ type: 'success', message: 'Proxy settings applied' });
      } else {
        setProxyStatus({ type: 'error', message: data.error || 'Failed to update proxy settings' });
      }
    } catch (err) {
      setProxyStatus({ type: 'error', message: 'An error occurred' });
    } finally {
      setProxyLoading(false);
    }
  };

  const testOutboundProxy = async () => {
    if (settings.outboundProxyEnabled !== true) return;

    const proxyUrl = (proxyForm.outboundProxyUrl || '').trim();
    if (!proxyUrl) {
      setProxyStatus({ type: 'error', message: 'Please enter a Proxy URL to test' });
      return;
    }

    setProxyTestLoading(true);
    setProxyStatus({ type: '', message: '' });

    try {
      const res = await fetch('/api/settings/proxy-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxyUrl }),
      });

      const data = await res.json();
      if (res.ok && data?.ok) {
        setProxyStatus({
          type: 'success',
          message: `Proxy test OK (${data.status}) in ${data.elapsedMs}ms`,
        });
      } else {
        setProxyStatus({
          type: 'error',
          message: data?.error || 'Proxy test failed',
        });
      }
    } catch (err) {
      setProxyStatus({ type: 'error', message: 'An error occurred' });
    } finally {
      setProxyTestLoading(false);
    }
  };

  const updateOutboundProxyEnabled = async (outboundProxyEnabled) => {
    setProxyLoading(true);
    setProxyStatus({ type: '', message: '' });

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outboundProxyEnabled }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyForm((prev) => ({
          ...prev,
          outboundProxyEnabled: data?.outboundProxyEnabled === true,
        }));
        setProxyStatus({
          type: 'success',
          message: outboundProxyEnabled ? 'Proxy enabled' : 'Proxy disabled',
        });
      } else {
        setProxyStatus({ type: 'error', message: data.error || 'Failed to update proxy settings' });
      }
    } catch (err) {
      setProxyStatus({ type: 'error', message: 'An error occurred' });
    } finally {
      setProxyLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: 'error', message: 'Passwords do not match' });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: '', message: '' });

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setPassStatus({ type: 'success', message: 'Password updated successfully' });
        setPasswords({ current: '', new: '', confirm: '' });
      } else {
        setPassStatus({ type: 'error', message: data.error || 'Failed to update password' });
      }
    } catch (err) {
      setPassStatus({ type: 'error', message: 'An error occurred' });
    } finally {
      setPassLoading(false);
    }
  };

  const updateFallbackStrategy = async (strategy) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fallbackStrategy: strategy }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, fallbackStrategy: strategy }));
      }
    } catch (err) {
      console.error('Failed to update settings:', err);
    }
  };

  const updateComboStrategy = async (strategy) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comboStrategy: strategy }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, comboStrategy: strategy }));
      }
    } catch (err) {
      console.error('Failed to update combo strategy:', err);
    }
  };

  const updateExposeComboOnly = async (exposeComboOnly) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exposeComboOnly }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, exposeComboOnly }));
      }
    } catch (err) {
      console.error('Failed to update exposeComboOnly:', err);
    }
  };

  const updateStickyLimit = async (limit) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, stickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error('Failed to update sticky limit:', err);
    }
  };

  const updateComboStickyLimit = async (limit) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comboStickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, comboStickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error('Failed to update combo sticky limit:', err);
    }
  };

  const updateRequireLogin = async (requireLogin) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireLogin }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, requireLogin }));
      }
    } catch (err) {
      console.error('Failed to update require login:', err);
    }
  };

  const updateOidcForm = (field, value) => {
    setOidcForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveOidcSettings = async (authMode = oidcForm.authMode || 'password') => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const loginLabel = oidcForm.oidcLoginLabel.trim();
    const secret = oidcClientSecret.trim();

    if (
      authMode !== 'password' &&
      (!issuerUrl || !clientId || !secret) &&
      !settings.oidcConfigured
    ) {
      setOidcStatus({
        type: 'error',
        message: 'Issuer URL, client ID, and client secret are required to enable OIDC.',
      });
      return;
    }

    setOidcLoading(true);
    setOidcStatus({ type: '', message: '' });
    setOidcTestStatus({ type: '', message: '' });

    try {
      const payload = {
        authMode,
        ssoType: 'oidc',
        oidcIssuerUrl: issuerUrl,
        oidcClientId: clientId,
        oidcScopes: scopes || 'openid profile email',
        oidcLoginLabel: loginLabel || 'Sign in with OIDC',
      };
      if (secret) {
        payload.oidcClientSecret = secret;
      }

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setOidcForm({
          authMode: data?.authMode || authMode,
          oidcIssuerUrl: data?.oidcIssuerUrl || issuerUrl,
          oidcClientId: data?.oidcClientId || clientId,
          oidcScopes: data?.oidcScopes || scopes || 'openid profile email',
          oidcLoginLabel: data?.oidcLoginLabel || loginLabel || 'Sign in with OIDC',
        });
        setOidcClientSecret('');
        setOidcStatus({
          type: 'success',
          message:
            authMode === 'oidc'
              ? 'OIDC login enabled'
              : authMode === 'both'
                ? 'Password and OIDC login enabled'
                : 'OIDC settings saved',
        });
      } else {
        setOidcStatus({ type: 'error', message: data.error || 'Failed to save OIDC settings' });
      }
    } catch (err) {
      setOidcStatus({ type: 'error', message: 'An error occurred' });
    } finally {
      setOidcLoading(false);
    }
  };

  const testOidcConnection = async () => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const secret = oidcClientSecret.trim();

    if (!issuerUrl || !clientId) {
      setOidcTestStatus({
        type: 'error',
        message: 'Issuer URL and client ID are required to test the connection.',
      });
      return;
    }

    setOidcTestLoading(true);
    setOidcStatus({ type: '', message: '' });
    setOidcTestStatus({ type: '', message: '' });

    try {
      const saveRes = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authMode: oidcForm.authMode || settings.authMode || 'password',
          oidcIssuerUrl: issuerUrl,
          oidcClientId: clientId,
          oidcScopes: scopes || 'openid profile email',
          oidcLoginLabel: oidcForm.oidcLoginLabel.trim() || 'Sign in with OIDC',
          ...(secret ? { oidcClientSecret: secret } : {}),
        }),
      });

      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        setOidcTestStatus({
          type: 'error',
          message: saved.error || 'Failed to save OIDC settings before testing',
        });
        return;
      }

      const res = await fetch('/api/auth/oidc/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issuerUrl: saved.oidcIssuerUrl || issuerUrl,
          clientId: saved.oidcClientId || clientId,
          scopes: saved.oidcScopes || scopes || 'openid profile email',
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        const statusMessage = data.clientSecretTested
          ? data.clientSecretValid === true
            ? `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret validated too.`
            : `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret was not checked.`
          : `Connection OK. Discovery loaded from ${data.issuerUrl}.`;
        setOidcTestStatus({
          type: 'success',
          message: statusMessage,
        });
      } else {
        setOidcTestStatus({ type: 'error', message: data.error || 'OIDC connection test failed' });
      }
    } catch (err) {
      setOidcTestStatus({ type: 'error', message: 'An error occurred' });
    } finally {
      setOidcTestLoading(false);
    }
  };

  const updateSamlForm = (field, value) => {
    setSamlForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleIdpMetadataUpload = (event) => {
    const file = event.target.files?.[0];
    if (idpMetadataFileRef.current) idpMetadataFileRef.current.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const xmlText = e.target?.result || '';
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'text/xml');
        const parserError = doc.querySelector('parsererror');
        if (parserError) {
          setSamlStatus({
            type: 'error',
            message: 'Unable to parse valid SAML IdP metadata from XML file',
          });
          return;
        }

        const entityID = doc.documentElement.getAttribute('entityID') || '';
        const ssoNodes = Array.from(
          doc.querySelectorAll('SingleSignOnService, *|SingleSignOnService')
        );
        let ssoUrl = '';
        for (const node of ssoNodes) {
          const binding = node.getAttribute('Binding') || '';
          const location = node.getAttribute('Location') || '';
          if (location) {
            ssoUrl = location;
            if (binding.includes('HTTP-Redirect')) break;
          }
        }

        const certNodes = Array.from(doc.querySelectorAll('X509Certificate, *|X509Certificate'));
        let certStr = '';
        if (certNodes.length > 0) {
          certStr = certNodes[0].textContent.trim();
        }

        setSamlForm((prev) => ({
          ...prev,
          samlEntryPoint: ssoUrl || prev.samlEntryPoint,
          samlIssuer: prev.samlIssuer || 'urn:tokenproxy:sp',
          samlCert: certStr || prev.samlCert,
        }));

        setSamlStatus({
          type: 'success',
          message: `IdP Metadata imported! (SSO URL: ${ssoUrl ? 'found' : 'not found'}, EntityID: ${entityID ? 'found' : 'not found'}, Cert: ${certStr ? 'found' : 'not found'})`,
        });
      } catch (err) {
        setSamlStatus({ type: 'error', message: 'Error reading IdP Metadata XML file' });
      }
    };
    reader.readAsText(file);
  };

  const handleCertFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (certFileRef.current) certFileRef.current.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result || '';
      setSamlForm((prev) => ({ ...prev, samlCert: text.trim() }));
      setSamlStatus({ type: 'success', message: 'Certificate file loaded into configuration.' });
    };
    reader.readAsText(file);
  };

  const saveSamlSettings = async (targetAuthMode = oidcForm.authMode || 'password') => {
    setSamlLoading(true);
    setSamlStatus({ type: '', message: '' });
    setSamlTestStatus({ type: '', message: '' });

    try {
      const payload = {
        authMode: targetAuthMode,
        ssoType: 'saml',
        samlEntryPoint: samlForm.samlEntryPoint.trim(),
        samlIssuer: samlForm.samlIssuer.trim() || 'urn:tokenproxy:sp',
        samlCert: samlForm.samlCert.trim(),
        samlLoginLabel: samlForm.samlLoginLabel.trim() || 'Sign in with SAML SSO',
        samlAttributeEmail: samlForm.samlAttributeEmail.trim() || 'email',
        samlAttributeName: samlForm.samlAttributeName.trim() || 'name',
      };

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setSamlForm({
          samlEntryPoint: data?.samlEntryPoint || payload.samlEntryPoint,
          samlIssuer: data?.samlIssuer || payload.samlIssuer,
          samlCert: data?.samlCert || payload.samlCert,
          samlLoginLabel: data?.samlLoginLabel || payload.samlLoginLabel,
          samlAttributeEmail: data?.samlAttributeEmail || payload.samlAttributeEmail,
          samlAttributeName: data?.samlAttributeName || payload.samlAttributeName,
        });
        setSamlStatus({
          type: 'success',
          message:
            targetAuthMode === 'sso' || targetAuthMode === 'saml'
              ? 'SAML SSO login enabled'
              : targetAuthMode === 'both'
                ? 'Password and SAML SSO login enabled'
                : 'SAML 2.0 settings saved',
        });
      } else {
        setSamlStatus({ type: 'error', message: data.error || 'Failed to save SAML settings' });
      }
    } catch {
      setSamlStatus({ type: 'error', message: 'An error occurred while saving SAML settings' });
    } finally {
      setSamlLoading(false);
    }
  };

  const testSamlConnection = async () => {
    setSamlTestLoading(true);
    setSamlStatus({ type: '', message: '' });
    setSamlTestStatus({ type: '', message: '' });

    try {
      const res = await fetch('/api/auth/saml/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          samlEntryPoint: samlForm.samlEntryPoint.trim(),
          samlIssuer: samlForm.samlIssuer.trim(),
          samlCert: samlForm.samlCert.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setSamlTestStatus({
          type: 'success',
          message: data.message || 'SAML configuration verified!',
        });
      } else {
        setSamlTestStatus({
          type: 'error',
          message: data.error || 'SAML configuration test failed',
        });
      }
    } catch {
      setSamlTestStatus({
        type: 'error',
        message: 'An error occurred while testing SAML configuration',
      });
    } finally {
      setSamlTestLoading(false);
    }
  };

  const updateObservabilityEnabled = async (enabled) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableObservability: enabled }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, enableObservability: enabled }));
      }
    } catch (err) {
      console.error('Failed to update enableObservability:', err);
    }
  };

  const updateAnalyticsEnabled = async (enabled) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analyticsEnabled: enabled }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, analyticsEnabled: enabled }));
      }
    } catch (err) {
      console.error('Failed to update analyticsEnabled:', err);
    }
  };

  const reloadSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error('Failed to reload settings:', err);
    }
  };

  const handleExportDatabase = async (password) => {
    setDbLoading(true);
    setDbStatus({ type: '', message: '' });
    try {
      const res = await fetch('/api/settings/database', {
        headers: { 'x-tp-password': password },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to export database');
      }

      const payload = await res.json();
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[.:]/g, '-');
      anchor.href = url;
      anchor.download = `tokenproxy-backup-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setDbStatus({ type: 'success', message: 'Database backup downloaded' });
    } catch (err) {
      setDbStatus({ type: 'error', message: err.message || 'Failed to export database' });
    } finally {
      setDbLoading(false);
    }
  };

  const handleImportDatabase = (event) => {
    const file = event.target.files?.[0];
    if (importFileRef.current) importFileRef.current.value = '';
    if (!file) return;
    pendingImportRef.current = file;
    setDbStatus({ type: '', message: '' });
    setDbAuth({ open: true, mode: 'import', password: '' });
  };

  const runImportDatabase = async (password) => {
    const file = pendingImportRef.current;
    if (!file) return;
    setDbLoading(true);
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);

      const res = await fetch('/api/settings/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to import database');
      }

      await reloadSettings();
      setDbStatus({ type: 'success', message: 'Database imported successfully' });
    } catch (err) {
      setDbStatus({ type: 'error', message: err.message || 'Invalid backup file' });
    } finally {
      pendingImportRef.current = null;
      setDbLoading(false);
    }
  };

  // Confirm password modal, then run export or import.
  const handleDbAuthConfirm = async () => {
    const { mode, password } = dbAuth;
    setDbAuth({ open: false, mode: '', password: '' });
    if (mode === 'export') await handleExportDatabase(password);
    else if (mode === 'import') await runImportDatabase(password);
  };

  const observabilityEnabled = settings.enableObservability === true;
  const analyticsEnabled = settings.analyticsEnabled === true;

  const saveHiddenNavItems = async (next) => {
    setHiddenNavItems(next); // optimistic
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hiddenNavItems: next }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, hiddenNavItems: next }));
        window.dispatchEvent(new Event('hidden-nav-changed'));
      }
    } catch (err) {
      console.error('Failed to update hidden nav items:', err);
    }
  };

  const toggleNavItem = (id) => {
    const next = hiddenNavItems.includes(id)
      ? hiddenNavItems.filter((x) => x !== id)
      : [...hiddenNavItems, id];
    saveHiddenNavItems(next);
  };

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch('/api/version/shutdown', { method: 'POST' });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        window.location.assign('/login');
      }
    } catch (err) {
      console.error('Failed to logout:', err);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* direction.md:95: "Cards are reserved for portable objects. Sections
          are separated by rule, band and inset instead." Every region on this
          route is a page section, so the ten Cards that used to wrap them are
          rules on the page ground. Nothing here is portable: none of these can
          be moved, opened as an object, or deleted. */}
      <div className="flex flex-col gap-5.5">
        {/* Local Mode Info */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="size-10 sm:size-12 rounded-lg bg-surface-2 text-text-muted flex items-center justify-center shrink-0">
                <span aria-hidden="true" className="material-symbols-outlined text-xl sm:text-2xl">computer</span>
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-semibold">Local Mode</h2>
                <p className="text-sm text-text-muted">Running on your machine</p>
              </div>
            </div>
            <div className="inline-flex p-1 rounded-lg bg-surface-2 w-full sm:w-auto">
              {['light', 'dark', 'system'].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  className={cn('focus-ring hit-44 flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md font-medium transition-colors duration-150 flex-1 sm:flex-initial',
                    theme === option
                      ? 'bg-surface text-text-main'
                      : 'text-text-muted hover:text-text-main'
                  )}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                    {option === 'light'
                      ? 'light_mode'
                      : option === 'dark'
                        ? 'dark_mode'
                        : 'contrast'}
                  </span>
                  <span className="capitalize text-xs sm:text-sm">{option}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 pt-4 border-t border-border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 rounded-lg bg-bg border border-border gap-2">
              <div>
                <p className="font-medium text-sm">Database Location</p>
                <p className="text-xs sm:text-sm text-text-muted font-mono break-all">
                  ~/.tokenproxy/db/data.sqlite
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="secondary"
                icon="download"
                onClick={() => setDbAuth({ open: true, mode: 'export', password: '' })}
                loading={dbLoading}
                className="w-full sm:w-auto"
              >
                Download Backup
              </Button>
              <Button
                variant="outline"
                icon="upload"
                onClick={() => importFileRef.current?.click()}
                disabled={dbLoading}
                className="w-full sm:w-auto"
              >
                Import Backup
              </Button>
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                className="focus-ring hidden"
                onChange={handleImportDatabase}
              />
            </div>
            {dbStatus.message && (
              <p
                className={`inline-flex items-start gap-1.5 text-sm ${dbStatus.type === 'error' ? 'text-danger' : 'text-success'}`}
              >
                <span className="material-symbols-outlined shrink-0 text-[16px] leading-5" aria-hidden="true">
                  {dbStatus.type === 'error' ? 'error' : 'check_circle'}
                </span>
                <span className="min-w-0">{dbStatus.message}</span>
              </p>
            )}
          </div>
        </section>

        {/* Language */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-10 rounded-lg bg-surface-2 text-text-muted flex items-center justify-center shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">language</span>
            </div>
            <h3 className="text-sm font-semibold">Language</h3>
          </div>
          <button
            onClick={() => setLangOpen(true)}
            className="focus-ring flex items-center justify-between w-full p-3 rounded-lg bg-bg border border-border hover:border-brand-line transition-colors duration-150"
            data-i18n-skip="true"
          >
            <span className="text-sm text-text-muted">Display language</span>
            <span className="text-2xl">{LOCALE_FLAGS[locale] || '🌐'}</span>
          </button>
        </section>

        {/* Security */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-brand-soft text-brand shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">shield</span>
            </div>
            <h3 className="text-sm font-semibold">Security</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Require login</p>
                <p className="text-xs sm:text-sm text-text-muted">
                  When ON, dashboard requires password. When OFF, access without login.
                </p>
              </div>
              <Toggle
                ariaLabel="Require a login for the dashboard"
                checked={settings.requireLogin === true}
                onChange={() => updateRequireLogin(!settings.requireLogin)}
                disabled={loading}
              />
            </div>
            {settings.requireLogin === true && (
              <form
                onSubmit={handlePasswordChange}
                className="flex flex-col gap-4 pt-4 border-t border-border"
              >
                {settings.hasPassword && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs sm:text-sm font-medium">Current Password</label>
                    <Input
                      type="password"
                      placeholder="Enter current password"
                      value={passwords.current}
                      onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                      required
                    />
                  </div>
                )}
                {/* {!settings.hasPassword && (
                  <div className="p-3 rounded-lg bg-info-soft border border-info-line">
                    <p className="text-sm text-info">
                      Setting password for the first time. Leave current password empty or use default: <code className="bg-info-soft px-1 rounded">123456</code>
                    </p>
                  </div>
                )} */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs sm:text-sm font-medium">New Password</label>
                    <Input
                      type="password"
                      placeholder="Enter new password"
                      value={passwords.new}
                      onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs sm:text-sm font-medium">Confirm New Password</label>
                    <Input
                      type="password"
                      placeholder="Confirm new password"
                      value={passwords.confirm}
                      onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {passStatus.message && (
                  <p
                    className={`inline-flex items-start gap-1.5 text-xs sm:text-sm ${passStatus.type === 'error' ? 'text-danger' : 'text-success'}`}
                  >
                    <span className="material-symbols-outlined shrink-0 text-[16px] leading-5" aria-hidden="true">
                      {passStatus.type === 'error' ? 'error' : 'check_circle'}
                    </span>
                    <span className="min-w-0">{passStatus.message}</span>
                  </p>
                )}

                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={passLoading}
                    className="w-full sm:w-auto"
                  >
                    {settings.hasPassword ? 'Update Password' : 'Set Password'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* Single Sign-On (SSO) */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <button
            type="button"
            onClick={() => setOidcExpanded((v) => !v)}
            className="focus-ring w-full flex items-center gap-3 text-start"
          >
            <div className="p-2 rounded-lg bg-surface-2 text-text-muted shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">lock_open</span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">Single Sign-On (SSO)</h3>
              <p className="text-xs text-text-muted">
                {settings.authMode === 'sso' ||
                settings.authMode === 'oidc' ||
                settings.authMode === 'saml'
                  ? `${settings.ssoType === 'saml' ? 'SAML 2.0' : 'OIDC'} SSO active`
                  : settings.authMode === 'both'
                    ? `Password + ${settings.ssoType === 'saml' ? 'SAML 2.0' : 'OIDC'} active`
                    : 'Optional SSO via Okta, Entra ID, Keycloak, or OIDC'}
              </p>
            </div>
            <span aria-hidden="true" className="material-symbols-outlined text-text-muted shrink-0">
              {oidcExpanded ? 'expand_less' : 'expand_more'}
            </span>
          </button>
          {oidcExpanded && (
            <div className="flex flex-col gap-4 mt-4">
              <p className="text-xs sm:text-sm text-text-muted">
                Configure enterprise Single Sign-On (SSO) for dashboard access using SAML 2.0 or
                OIDC.
              </p>

              {/* SSO Protocol Switcher Tabs */}
              <div className="flex flex-col gap-2">
                <label className="font-medium text-sm">SSO Protocol</label>
                <div className="flex p-1 rounded-lg bg-surface-2 border border-border">
                  <button
                    type="button"
                    onClick={() => setSsoTypeTab('saml')}
                    className={cn('focus-ring flex-1 py-1.5 px-3 rounded-md font-medium text-xs sm:text-sm transition-colors duration-150 text-center',
                      ssoTypeTab === 'saml'
                        ? 'bg-surface text-text-main'
                        : 'text-text-muted hover:text-text-main'
                    )}
                  >
                    SAML 2.0
                  </button>
                  <button
                    type="button"
                    onClick={() => setSsoTypeTab('oidc')}
                    className={cn('focus-ring flex-1 py-1.5 px-3 rounded-md font-medium text-xs sm:text-sm transition-colors duration-150 text-center',
                      ssoTypeTab === 'oidc'
                        ? 'bg-surface text-text-main'
                        : 'text-text-muted hover:text-text-main'
                    )}
                  >
                    OIDC
                  </button>
                </div>
              </div>

              {/* Auth Mode selection */}
              <div className="flex flex-col gap-2">
                <label className="font-medium text-sm">Auth Mode</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    {
                      value: 'password',
                      title: 'Password only',
                      desc: 'Keep legacy password login.',
                    },
                    {
                      value: 'sso',
                      title: `${ssoTypeTab === 'saml' ? 'SAML' : 'OIDC'} only`,
                      desc: 'Require SSO for dashboard access.',
                    },
                    {
                      value: 'both',
                      title: 'Both',
                      desc: 'Allow password or SSO login.',
                    },
                  ].map((option) => {
                    const currentMode = oidcForm.authMode;
                    const active =
                      option.value === 'password'
                        ? currentMode === 'password'
                        : option.value === 'sso'
                          ? currentMode === 'sso' ||
                            currentMode === 'saml' ||
                            currentMode === 'oidc'
                          : currentMode === 'both';
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateOidcForm('authMode', option.value)}
                        className={cn('focus-ring text-start rounded-lg border p-3 transition-colors duration-150',
                          active
                            ? 'border-brand bg-brand-soft'
                            : 'border-border bg-bg hover:bg-surface-2'
                        )}
                        disabled={loading || oidcLoading || samlLoading}
                      >
                        <p className="font-medium text-sm">{option.title}</p>
                        <p className="text-xs sm:text-sm text-text-muted mt-1">{option.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {ssoTypeTab === 'saml' ? (
                /* SAML Configuration Panel */
                <div className="flex flex-col gap-4 pt-2 border-t border-border">
                  {/* IdP Setup Guidelines Banner & Collapsible Drawer */}
                  <div className="rounded-lg border border-border bg-bg/80 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowSamlGuide((prev) => !prev)}
                      className="focus-ring w-full p-3 flex items-center justify-between gap-2 text-start hover:bg-surface-2 transition-colors duration-150"
                    >
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="material-symbols-outlined text-brand text-lg">
                          menu_book
                        </span>
                        <div>
                          <p className="font-semibold text-xs sm:text-sm text-text-main">
                            IdP Setup Guidelines & Provider Configuration Instructions
                          </p>
                          <p className="text-xs text-text-muted">
                            Click to view setup steps for AWS IAM Identity Center, Okta, Entra ID,
                            Keycloak, & Authentik
                          </p>
                        </div>
                      </div>
                      <span aria-hidden="true"
                        className="material-symbols-outlined text-text-muted transition-transform duration-150 text-lg"
                        style={{ transform: showSamlGuide ? 'rotate(180deg)' : 'none' }}
                      >
                        expand_more
                      </span>
                    </button>

                    {showSamlGuide && (
                      <div className="p-4 border-t border-border bg-surface/30 text-xs text-text-main flex flex-col gap-3">
                        <div className="p-3 rounded border border-brand-line bg-brand-soft text-brand text-xs">
                          <p className="font-semibold mb-1">
                            🔑 Required Service Provider (SP) Values for your IdP Setup:
                          </p>
                          <ul className="list-disc ps-4 space-y-1 font-mono text-xs">
                            <li>
                              <b>Assertion Consumer Service (ACS) URL:</b>{' '}
                              <code className="bg-bg px-1 py-1 rounded break-all">
                                {samlAcsUrl}
                              </code>
                            </li>
                            <li>
                              <b>SP Entity ID / Audience URI:</b>{' '}
                              <code className="bg-bg px-1 py-1 rounded break-all">
                                {samlForm.samlIssuer || 'urn:tokenproxy:sp'}
                              </code>
                            </li>
                            <li>
                              <b>NameID Format:</b>{' '}
                              <code className="bg-bg px-1 py-1 rounded">EmailAddress</code> or{' '}
                              <code className="bg-bg px-1 py-1 rounded">Unspecified</code>
                            </li>
                          </ul>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                            <p className="font-semibold text-text-main flex items-center gap-1.5">
                              <span>☁️</span> AWS IAM Identity Center
                            </p>
                            <ol className="list-decimal ps-4 text-text-muted space-y-1">
                              <li>
                                Applications → <b>Add application</b> → Select{' '}
                                <b>Add custom SAML 2.0 application</b>.
                              </li>
                              <li>
                                Set <b>Application ACS URL</b> to{' '}
                                <code className="text-text-main font-mono">{samlAcsUrl}</code>.
                              </li>
                              <li>
                                Set <b>Application SAML audience</b> to{' '}
                                <code className="text-text-main font-mono">
                                  {samlForm.samlIssuer || 'urn:tokenproxy:sp'}
                                </code>
                                .
                              </li>
                              <li>
                                Under <i>Attribute mappings</i>, map{' '}
                                <code className="text-text-main font-mono">Subject</code> or{' '}
                                <code className="text-text-main font-mono">email</code> to{' '}
                                <code className="text-text-main font-mono">${`{user:email}`}</code>.
                              </li>
                              <li>
                                Download <b>IAM Identity Center SAML metadata XML</b> file and use
                                1-Click Import below!
                              </li>
                            </ol>
                          </div>

                          <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                            <p className="font-semibold text-text-main flex items-center gap-1.5">
                              <span>🔷</span> Microsoft Entra ID (Azure AD)
                            </p>
                            <ol className="list-decimal ps-4 text-text-muted space-y-1">
                              <li>
                                Enterprise Applications → <b>New application</b> →{' '}
                                <b>Create your own application</b>.
                              </li>
                              <li>
                                Select <b>Single sign-on</b> → <b>SAML</b>.
                              </li>
                              <li>
                                <b>Identifier (Entity ID):</b>{' '}
                                <code className="text-text-main font-mono">
                                  {samlForm.samlIssuer || 'urn:tokenproxy:sp'}
                                </code>
                              </li>
                              <li>
                                <b>Reply URL (ACS):</b>{' '}
                                <code className="text-text-main font-mono">{samlAcsUrl}</code>
                              </li>
                              <li>
                                Download <b>Federation Metadata XML</b> and import or copy X.509
                                Certificate.
                              </li>
                            </ol>
                          </div>

                          <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                            <p className="font-semibold text-text-main flex items-center gap-1.5">
                              <span>🟢</span> Okta / Auth0
                            </p>
                            <ol className="list-decimal ps-4 text-text-muted space-y-1">
                              <li>
                                Applications → <b>Create App Integration</b> → Select{' '}
                                <b>SAML 2.0</b>.
                              </li>
                              <li>
                                <b>Single Sign-On URL:</b>{' '}
                                <code className="text-text-main font-mono">{samlAcsUrl}</code>
                              </li>
                              <li>
                                <b>Audience URI (SP Entity ID):</b>{' '}
                                <code className="text-text-main font-mono">
                                  {samlForm.samlIssuer || 'urn:tokenproxy:sp'}
                                </code>
                              </li>
                              <li>
                                Name ID format: <i>EmailAddress</i>.
                              </li>
                              <li>
                                Download Identity Provider metadata XML or copy the X.509 cert.
                              </li>
                            </ol>
                          </div>

                          <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                            <p className="font-semibold text-text-main flex items-center gap-1.5">
                              <span>🛡️</span> Keycloak / Authentik
                            </p>
                            <ol className="list-decimal ps-4 text-text-muted space-y-1">
                              <li>
                                Clients → <b>Create client</b> → Select <b>SAML</b>.
                              </li>
                              <li>
                                <b>Client ID:</b>{' '}
                                <code className="text-text-main font-mono">
                                  {samlForm.samlIssuer || 'urn:tokenproxy:sp'}
                                </code>
                              </li>
                              <li>
                                <b>Master SAML Processing URL:</b>{' '}
                                <code className="text-text-main font-mono">{samlAcsUrl}</code>
                              </li>
                              <li>Export SAML Descriptor XML or copy IDP Certificate PEM.</li>
                            </ol>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick Import Card */}
                  <div className="p-3 rounded-lg border border-dashed border-brand-line bg-brand-soft flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm text-text-main">
                        1-Click IdP Metadata XML Import
                      </p>
                      <p className="text-xs text-text-muted">
                        Auto-fill SSO URL, Issuer & Cert from XML metadata
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      icon="upload_file"
                      onClick={() => idpMetadataFileRef.current?.click()}
                    >
                      Upload Metadata XML
                    </Button>
                    <input
                      ref={idpMetadataFileRef}
                      type="file"
                      accept=".xml,application/xml,text/xml"
                      className="focus-ring hidden"
                      onChange={handleIdpMetadataUpload}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-sm">
                        Single Sign-On Service URL (samlEntryPoint)
                      </label>
                      <Input
                        placeholder="https://idp.example.com/app/saml/sso/..."
                        value={samlForm.samlEntryPoint}
                        onChange={(e) => updateSamlForm('samlEntryPoint', e.target.value)}
                        disabled={loading || samlLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-sm">
                        SP Entity ID / Audience (samlIssuer)
                      </label>
                      <Input
                        placeholder="urn:tokenproxy:sp"
                        value={samlForm.samlIssuer}
                        onChange={(e) => updateSamlForm('samlIssuer', e.target.value)}
                        disabled={loading || samlLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <label className="font-medium text-sm">
                          IdP X.509 Certificate (samlCert)
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          icon="file_upload"
                          onClick={() => certFileRef.current?.click()}
                        >
                          Upload Certificate
                        </Button>
                        <input
                          ref={certFileRef}
                          type="file"
                          accept=".crt,.pem,.cer,text/plain"
                          className="focus-ring hidden"
                          onChange={handleCertFileUpload}
                        />
                      </div>
                      <textarea
                        rows={4}
                        placeholder="-----BEGIN CERTIFICATE-----&#10;MIIC...&#10;-----END CERTIFICATE-----"
                        value={samlForm.samlCert}
                        onChange={(e) => updateSamlForm('samlCert', e.target.value)}
                        className="focus-ring w-full p-3 rounded-lg border border-border bg-bg text-xs font-mono text-text-main focus:border-brand"
                        disabled={loading || samlLoading}
                      />
                      <p className="text-xs text-text-muted">
                        Paste raw Base64 certificate or PEM block.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">
                          Login Button Label
                        </label>
                        <Input
                          placeholder="Sign in with SAML SSO"
                          value={samlForm.samlLoginLabel}
                          onChange={(e) => updateSamlForm('samlLoginLabel', e.target.value)}
                          disabled={loading || samlLoading}
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">
                          Email Claim Attribute
                        </label>
                        <Input
                          placeholder="email"
                          value={samlForm.samlAttributeEmail}
                          onChange={(e) => updateSamlForm('samlAttributeEmail', e.target.value)}
                          disabled={loading || samlLoading}
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">
                          Display Name Claim
                        </label>
                        <Input
                          placeholder="name"
                          value={samlForm.samlAttributeName}
                          onChange={(e) => updateSamlForm('samlAttributeName', e.target.value)}
                          disabled={loading || samlLoading}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-bg text-xs sm:text-sm text-text-muted">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-text-main">ACS Callback URL</p>
                        <code className="block break-all font-mono text-xs">{samlAcsUrl}</code>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        icon="content_copy"
                        onClick={() => {
                          navigator.clipboard.writeText(samlAcsUrl);
                          setSamlStatus({
                            type: 'success',
                            message: 'ACS URL copied to clipboard!',
                          });
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                      <div>
                        <p className="font-medium text-text-main">SP XML Metadata</p>
                        <code className="block break-all font-mono text-xs">{samlMetadataUrl}</code>
                      </div>
                      <a
                        href={samlMetadataUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download="tokenproxy-sp-metadata.xml"
                        className="focus-ring inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">download</span>
                        Download XML
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">
                    <Button
                      type="button"
                      variant="primary"
                      loading={samlLoading}
                      onClick={() => saveSamlSettings(oidcForm.authMode)}
                      className="w-full sm:w-auto"
                    >
                      Save SAML settings
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      loading={samlTestLoading}
                      onClick={testSamlConnection}
                      className="w-full sm:w-auto"
                    >
                      Test SAML settings
                    </Button>
                  </div>

                  {samlTestStatus.message && (
                    <p
                      className={`inline-flex items-start gap-1.5 text-xs sm:text-sm ${samlTestStatus.type === 'error' ? 'text-danger' : 'text-success'}`}
                    >
                      <span className="material-symbols-outlined shrink-0 text-[16px] leading-5" aria-hidden="true">
                        {samlTestStatus.type === 'error' ? 'error' : 'check_circle'}
                      </span>
                      <span className="min-w-0">{samlTestStatus.message}</span>
                    </p>
                  )}

                  {samlStatus.message && (
                    <p
                      className={`inline-flex items-start gap-1.5 text-xs sm:text-sm ${samlStatus.type === 'error' ? 'text-danger' : 'text-success'}`}
                    >
                      <span className="material-symbols-outlined shrink-0 text-[16px] leading-5" aria-hidden="true">
                        {samlStatus.type === 'error' ? 'error' : 'check_circle'}
                      </span>
                      <span className="min-w-0">{samlStatus.message}</span>
                    </p>
                  )}
                </div>
              ) : (
                /* OIDC Panel */
                <div className="flex flex-col gap-4 pt-2 border-t border-border">
                  <div className="grid grid-cols-1 gap-4">
                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-sm">Issuer URL</label>
                      <Input
                        placeholder="https://auth.example.com/application/o/tokenproxy/"
                        value={oidcForm.oidcIssuerUrl}
                        onChange={(e) => updateOidcForm('oidcIssuerUrl', e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-sm">Client ID</label>
                      <Input
                        placeholder="tokenproxy-dashboard"
                        value={oidcForm.oidcClientId}
                        onChange={(e) => updateOidcForm('oidcClientId', e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-sm">Client Secret</label>
                      <Input
                        type="password"
                        placeholder="Leave blank to keep existing secret"
                        value={oidcClientSecret}
                        onChange={(e) => setOidcClientSecret(e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                      <p className="text-xs sm:text-sm text-text-muted">
                        This value is write-only after saving.
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-sm">Scopes</label>
                      <Input
                        placeholder="openid profile email"
                        value={oidcForm.oidcScopes}
                        onChange={(e) => updateOidcForm('oidcScopes', e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-sm">Login Button Label</label>
                      <Input
                        placeholder="Sign in with OIDC"
                        value={oidcForm.oidcLoginLabel}
                        onChange={(e) => updateOidcForm('oidcLoginLabel', e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-bg p-3 text-xs sm:text-sm text-text-muted">
                    <p className="font-medium text-text-main mb-1">Redirect URI</p>
                    <code className="block break-all font-mono">{oidcRedirectUri}</code>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">
                    <Button
                      type="button"
                      variant="primary"
                      loading={oidcLoading}
                      onClick={() => saveOidcSettings()}
                      className="w-full sm:w-auto"
                    >
                      Save OIDC settings
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      loading={oidcTestLoading}
                      onClick={testOidcConnection}
                      className="w-full sm:w-auto"
                    >
                      Test connection
                    </Button>
                  </div>

                  {oidcTestStatus.message && (
                    <p
                      className={`inline-flex items-start gap-1.5 text-xs sm:text-sm ${oidcTestStatus.type === 'error' ? 'text-danger' : 'text-success'}`}
                    >
                      <span className="material-symbols-outlined shrink-0 text-[16px] leading-5" aria-hidden="true">
                        {oidcTestStatus.type === 'error' ? 'error' : 'check_circle'}
                      </span>
                      <span className="min-w-0">{oidcTestStatus.message}</span>
                    </p>
                  )}

                  {oidcStatus.message && (
                    <p
                      className={`inline-flex items-start gap-1.5 text-xs sm:text-sm ${oidcStatus.type === 'error' ? 'text-danger' : 'text-success'}`}
                    >
                      <span className="material-symbols-outlined shrink-0 text-[16px] leading-5" aria-hidden="true">
                        {oidcStatus.type === 'error' ? 'error' : 'check_circle'}
                      </span>
                      <span className="min-w-0">{oidcStatus.message}</span>
                    </p>
                  )}
                </div>
              )}

              {settings.authMode === 'oidc' ||
              settings.authMode === 'saml' ||
              settings.authMode === 'sso' ? (
                <p className="text-xs sm:text-sm text-warning">
                  SSO login ({settings.ssoType === 'saml' ? 'SAML 2.0' : 'OIDC'}) is currently
                  active. Password login is disabled until you switch back.
                </p>
              ) : null}

              {settings.authMode === 'both' && (
                <p className="text-xs sm:text-sm text-warning">
                  Password and SSO login ({settings.ssoType === 'saml' ? 'SAML 2.0' : 'OIDC'}) are
                  both active.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Model */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-surface-2 text-text-muted shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">model_training</span>
            </div>
            <h3 className="text-sm font-semibold">Model</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Expose Combo Only</p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Only configured Combo models exposed through{' '}
                  <code className="bg-bg px-1 rounded text-xs">/v1/models</code>
                </p>
              </div>
              <Toggle
                ariaLabel="Expose only Combo models through /v1/models"
                checked={settings.exposeComboOnly === true}
                onChange={() => updateExposeComboOnly(!settings.exposeComboOnly)}
                disabled={loading}
              />
            </div>
          </div>
        </section>

        {/* Routing Preferences */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-surface-2 text-text-muted shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">route</span>
            </div>
            <h3 className="text-sm font-semibold">Routing Strategy</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Round Robin</p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Cycle through accounts to distribute load
                </p>
              </div>
              <Toggle
                ariaLabel="Cycle through accounts instead of strict fallback"
                checked={settings.fallbackStrategy === 'round-robin'}
                onChange={() =>
                  updateFallbackStrategy(
                    settings.fallbackStrategy === 'round-robin' ? 'fill-first' : 'round-robin'
                  )
                }
                disabled={loading}
              />
            </div>

            {/* Sticky Round Robin Limit */}
            {settings.fallbackStrategy === 'round-robin' && (
              <div className="flex items-start sm:items-center justify-between gap-4 pt-2 border-t border-border">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">Sticky Limit</p>
                  <p className="text-xs sm:text-sm text-text-muted">
                    Calls per account before switching
                  </p>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.stickyRoundRobinLimit || 3}
                  onChange={(e) => updateStickyLimit(e.target.value)}
                  disabled={loading}
                  className="w-16 sm:w-20 text-center shrink-0"
                />
              </div>
            )}

            {/* Combo Round Robin */}
            <div className="flex items-start sm:items-center justify-between gap-4 pt-4 border-t border-border">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Combo Round Robin</p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Cycle through providers in combos instead of always starting with first
                </p>
              </div>
              <Toggle
                ariaLabel="Cycle through combo members instead of always starting with the first"
                checked={settings.comboStrategy === 'round-robin'}
                onChange={() =>
                  updateComboStrategy(
                    settings.comboStrategy === 'round-robin' ? 'fallback' : 'round-robin'
                  )
                }
                disabled={loading}
              />
            </div>

            {/* Combo Sticky Round Robin Limit */}
            {settings.comboStrategy === 'round-robin' && (
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div>
                  <p className="font-medium">Combo Sticky Limit</p>
                  <p className="text-sm text-text-muted">Calls per combo model before switching</p>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.comboStickyRoundRobinLimit || 1}
                  onChange={(e) => updateComboStickyLimit(e.target.value)}
                  disabled={loading}
                  className="w-20 text-center"
                />
              </div>
            )}

            <div className="pt-4 border-t border-border">
              <ConnectTimeoutInput
                value={settings.connectTimeoutMs}
                disabled={loading}
                onSaved={(value, nextSettings) => {
                  setSettings((previous) => ({
                    ...previous,
                    ...nextSettings,
                    connectTimeoutMs: value,
                  }));
                }}
              />
            </div>

            <p className="text-xs text-text-muted italic pt-2 border-t border-border">
              {settings.fallbackStrategy === 'round-robin'
                ? `Currently distributing requests across all available accounts with ${settings.stickyRoundRobinLimit || 3} calls per account.`
                : 'Currently using accounts in priority order (Fill First).'}
              {settings.comboStrategy === 'round-robin'
                ? ` Combos rotate after ${settings.comboStickyRoundRobinLimit || 1} call${(settings.comboStickyRoundRobinLimit || 1) === 1 ? '' : 's'} per model.`
                : ' Combos always start with their first model.'}
            </p>
          </div>
        </section>

        {/* Network */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-surface-2 text-text-muted shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">wifi</span>
            </div>
            <h3 className="text-sm font-semibold">Network</h3>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Outbound Proxy</p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Enable proxy for OAuth + provider outbound requests.
                </p>
              </div>
              <Toggle
                ariaLabel="Send upstream traffic through an outbound proxy"
                checked={settings.outboundProxyEnabled === true}
                onChange={() =>
                  updateOutboundProxyEnabled(!(settings.outboundProxyEnabled === true))
                }
                disabled={loading || proxyLoading}
              />
            </div>

            {settings.outboundProxyEnabled === true && (
              <form
                onSubmit={updateOutboundProxy}
                className="flex flex-col gap-4 pt-2 border-t border-border"
              >
                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm">Proxy URL</label>
                  <Input
                    placeholder="http://127.0.0.1:7897"
                    value={proxyForm.outboundProxyUrl}
                    onChange={(e) =>
                      setProxyForm((prev) => ({ ...prev, outboundProxyUrl: e.target.value }))
                    }
                    disabled={loading || proxyLoading}
                  />
                  <p className="text-xs sm:text-sm text-text-muted">
                    Leave empty to inherit existing env proxy (if any).
                  </p>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                  <label className="font-medium text-sm">No Proxy</label>
                  <Input
                    placeholder="localhost,127.0.0.1"
                    value={proxyForm.outboundNoProxy}
                    onChange={(e) =>
                      setProxyForm((prev) => ({ ...prev, outboundNoProxy: e.target.value }))
                    }
                    disabled={loading || proxyLoading}
                  />
                  <p className="text-xs sm:text-sm text-text-muted">
                    Comma-separated hostnames/domains to bypass the proxy.
                  </p>
                </div>

                <div className="pt-2 border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    loading={proxyTestLoading}
                    disabled={loading || proxyLoading}
                    onClick={testOutboundProxy}
                    className="w-full sm:w-auto"
                  >
                    Test proxy URL
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={proxyLoading}
                    className="w-full sm:w-auto"
                  >
                    Apply
                  </Button>
                </div>
              </form>
            )}

            {proxyStatus.message && (
              <p
                className={`inline-flex items-start gap-1.5 text-xs sm:text-sm ${proxyStatus.type === 'error' ? 'text-danger' : 'text-success'} pt-2 border-t border-border`}
              >
                <span className="material-symbols-outlined shrink-0 text-[16px] leading-5" aria-hidden="true">
                  {proxyStatus.type === 'error' ? 'error' : 'check_circle'}
                </span>
                <span className="min-w-0">{proxyStatus.message}</span>
              </p>
            )}
          </div>
        </section>

        {/* Observability Settings */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-surface-2 text-text-muted shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">monitoring</span>
            </div>
            <h3 className="text-sm font-semibold">Observability</h3>
          </div>
          <div className="flex items-start sm:items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Enable Observability</p>
              <p className="text-xs sm:text-sm text-text-muted">
                Record request details for inspection in the logs view
              </p>
            </div>
            <Toggle
              ariaLabel="Enable observability"
              checked={observabilityEnabled}
              onChange={updateObservabilityEnabled}
              disabled={loading}
            />
          </div>
        </section>

        {/* Claude Code Minimal Mode — hide sidebar entries */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-surface-2 text-text-muted shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">visibility_off</span>
            </div>
            <h3 className="text-sm font-semibold">Claude Code Minimal Mode</h3>
          </div>
          <p className="text-xs sm:text-sm text-text-muted mb-3">
            Toggle which sidebar menu entries are hidden. Hidden entries can be restored here at any
            time.
          </p>
          <div className="flex flex-wrap gap-2">
            {HIDEABLE_NAV_ITEMS.map((item) => {
              const hidden = hiddenNavItems.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleNavItem(item.id)}
                  className={cn('focus-ring hit-44 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors duration-150 cursor-pointer',
                    hidden
                      ? 'border-border bg-bg text-text-muted line-through opacity-70'
                      : 'border-brand-line bg-brand-soft text-text-main hover:border-brand'
                  )}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                    {hidden ? 'visibility_off' : 'visibility'}
                  </span>
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              icon="hide_source"
              onClick={() => saveHiddenNavItems(HIDEABLE_NAV_ITEMS.map((i) => i.id))}
              disabled={hiddenNavItems.length === HIDEABLE_NAV_ITEMS.length}
            >
              Hide All
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="visibility"
              onClick={() => saveHiddenNavItems([])}
              disabled={hiddenNavItems.length === 0}
            >
              Show All
            </Button>
          </div>
        </section>

        {/* Privacy Settings */}
        <section className="border-t border-border pt-5.5 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-surface-2 text-text-muted shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">privacy_tip</span>
            </div>
            <h3 className="text-sm font-semibold">Privacy</h3>
          </div>
          <div className="flex items-start sm:items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Anonymous Usage Analytics</p>
              <p className="text-xs sm:text-sm text-text-muted">
                Send anonymous page-view analytics to Google Analytics. Off by default.
              </p>
            </div>
            <Toggle
              ariaLabel="Send anonymous usage analytics"
              checked={analyticsEnabled}
              onChange={updateAnalyticsEnabled}
              disabled={loading}
            />
          </div>
        </section>

        {/* Account actions */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            fullWidth
            icon="power_settings_new"
            onClick={() => setShutdownOpen(true)}
            className="text-danger border-danger-line hover:bg-danger-soft hover:border-danger-line"
          >
            Shutdown
          </Button>
          <Button variant="outline" fullWidth icon="logout" onClick={handleLogout}>
            Logout
          </Button>
        </div>

        {/* App Info */}
        <div className="text-center text-xs sm:text-sm text-text-muted py-4">
          <p>
            {APP_CONFIG.name} v{APP_CONFIG.version}
          </p>
          <p className="mt-1">Local Mode - All data stored on your machine</p>
        </div>
      </div>

      <LanguageSwitcher
        hideTrigger
        isOpen={langOpen}
        onClose={(next) => {
          setLangOpen(false);
          setLocale(next);
        }}
      />
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

      <Modal
        isOpen={dbAuth.open}
        onClose={() => setDbAuth({ open: false, mode: '', password: '' })}
        title="Confirm Password"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDbAuth({ open: false, mode: '', password: '' })}
              disabled={dbLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleDbAuthConfirm}
              loading={dbLoading}
              disabled={!dbAuth.password}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-text-muted mb-3 text-sm">
          Enter your current password to {dbAuth.mode === 'export' ? 'export' : 'import'} the
          database.
        </p>
        <Input
          type="password"
          value={dbAuth.password}
          onChange={(e) => setDbAuth((s) => ({ ...s, password: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dbAuth.password) handleDbAuthConfirm();
          }}
          placeholder="Current password"
          autoFocus
        />
      </Modal>
    </div>
  );
}
