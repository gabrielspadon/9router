import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import { BookOpen, Rocket, Terminal, Monitor, FolderOpen, HelpCircle, MessageCircle, Mouse, Folder, Lock, Zap, Smartphone, Lightbulb, AlertTriangle, CheckCircle, ArrowRight, Layers, Plug, Cloud, Wallet, Gift, GitBranch, BarChart3, Code2, Sparkles, Server, PartyPopper, Siren, Link2, Target, Heart, Check, Home, Package, Wrench, OctagonX, Search, Globe, Container } from "lucide-react";

const PAGE_ICONS = {
  "Welcome to 9Router": BookOpen,
  "Introduction": BookOpen,
  "Getting Started": Rocket,
  "Quick Start": Rocket,
  "Installation": Terminal,
  "Providers": Layers,
  "Subscription (Maximize)": Sparkles,
  "Cheap (Backup)": Wallet,
  "Free (Fallback)": Gift,
  "Features": Zap,
  "Smart Routing": GitBranch,
  "Combos & Fallback": Layers,
  "Quota Tracking": BarChart3,
  "Integration": Plug,
  "Claude Code": Code2,
  "OpenAI Codex": Code2,
  "Cursor": Code2,
  "Cline": Code2,
  "Roo": Code2,
  "Continue": Code2,
  "Other Tools": Plug,
  "Deployment": Cloud,
  "Localhost": Monitor,
  "Cloud (VPS/Docker)": Server,
  "Troubleshooting": HelpCircle,
  "FAQ": MessageCircle,
  "Frequently Asked Questions": MessageCircle
};

const ICON_MAP = {
  "terminal": Terminal,
  "monitor": Monitor,
  "mouse": Mouse,
  "folder": Folder,
  "lock": Lock,
  "zap": Zap,
  "smartphone": Smartphone,
  "lightbulb": Lightbulb,
  "alert-triangle": AlertTriangle,
  "check-circle": CheckCircle,
  "arrow-right": ArrowRight,
};

// Emoji to lucide icon mapping (auto-converted in markdown)
const EMOJI_ICON_MAP = {
  "✅": { Icon: CheckCircle, color: "text-success" },
  "✓": { Icon: Check, color: "text-success" },
  "❌": { Icon: AlertTriangle, color: "text-danger" },
  "⚠️": { Icon: AlertTriangle, color: "text-warning" },
  "⚠": { Icon: AlertTriangle, color: "text-warning" },
  "🚨": { Icon: Siren, color: "text-danger" },
  "🛑": { Icon: OctagonX, color: "text-danger" },
  "💡": { Icon: Lightbulb, color: "text-warning" },
  "🔄": { Icon: GitBranch, color: "text-brand" },
  "🚀": { Icon: Rocket, color: "text-brand" },
  "⚡": { Icon: Zap, color: "text-warning" },
  "🔌": { Icon: Plug, color: "text-brand" },
  "☁️": { Icon: Cloud, color: "text-info" },
  "☁": { Icon: Cloud, color: "text-info" },
  "📦": { Icon: Package, color: "text-brand" },
  "💰": { Icon: Wallet, color: "text-success" },
  "🎁": { Icon: Gift, color: "text-text-muted" },
  "📊": { Icon: BarChart3, color: "text-brand" },
  "💻": { Icon: Code2, color: "text-text-main" },
  "✨": { Icon: Sparkles, color: "text-brand" },
  "🖥️": { Icon: Server, color: "text-text-main" },
  "🖥": { Icon: Server, color: "text-text-main" },
  "📖": { Icon: BookOpen, color: "text-brand" },
  "🔒": { Icon: Lock, color: "text-text-main" },
  "➡️": { Icon: ArrowRight, color: "text-brand" },
  "📱": { Icon: Smartphone, color: "text-brand" },
  "📂": { Icon: Folder, color: "text-brand" },
  "📁": { Icon: Folder, color: "text-brand" },
  "🖱️": { Icon: Mouse, color: "text-brand" },
  "🎉": { Icon: PartyPopper, color: "text-text-muted" },
  "🔗": { Icon: Link2, color: "text-info" },
  "🎯": { Icon: Target, color: "text-danger" },
  "❤": { Icon: Heart, color: "text-danger" },
  "❤️": { Icon: Heart, color: "text-danger" },
  "🏠": { Icon: Home, color: "text-brand" },
  "🔧": { Icon: Wrench, color: "text-text-main" },
  "🔍": { Icon: Search, color: "text-text-main" },
  "🌐": { Icon: Globe, color: "text-info" },
  "🐳": { Icon: Container, color: "text-info" }
};

const EMOJI_REGEX = new RegExp(`^(${Object.keys(EMOJI_ICON_MAP).map(e => e.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")).join("|")})\\s*`);

export function parseMarkdown(content) {
  return content;
}

// Unicode-aware slugify: keeps letters/numbers from any language (Vietnamese, Chinese, Japanese, etc.)
export function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/^-+|-+$/g, "");
}

// Extract leading emoji from heading children and replace with lucide icon
function renderHeadingWithEmoji(tag, children, props) {
  const Tag = tag;
  const text = (Array.isArray(children) ? children : [children])
    .map(c => (typeof c === "string" ? c : ""))
    .join("");
  const emojiMatch = text.match(EMOJI_REGEX);
  const textForId = emojiMatch ? text.slice(emojiMatch[0].length).trim() : text;
  const id = slugify(textForId);
  if (emojiMatch) {
    const { Icon, color } = EMOJI_ICON_MAP[emojiMatch[1]];
    const rest = text.slice(emojiMatch[0].length);
    return (
      <Tag id={id} {...props}>
        <Icon className={`inline-block mr-2 align-[-0.15em] w-[1em] h-[1em] ${color}`} />
        {rest}
      </Tag>
    );
  }
  return <Tag id={id} {...props}>{children}</Tag>;
}

export function MarkdownRenderer({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      className="markdown-content"
      components={{
        h1: ({ node, children, ...props }) => {
          const text = children?.toString() || "";
          const IconComponent = PAGE_ICONS[text];
          const id = slugify(text);
          
          return (
            <h1 id={id} {...props}>
              {IconComponent && <IconComponent className="inline-block mr-3" />}
              {children}
            </h1>
          );
        },
        h2: ({ node, children, ...props }) => renderHeadingWithEmoji("h2", children, props),
        h3: ({ node, children, ...props }) => renderHeadingWithEmoji("h3", children, props),
        li: ({ node, children, ...props }) => {
          // Extract text from children (handle React elements)
          const extractText = (child) => {
            if (typeof child === 'string') return child;
            if (Array.isArray(child)) return child.map(extractText).join('');
            if (child?.props?.children) return extractText(child.props.children);
            return '';
          };
          
          const text = extractText(children);
          const iconMatch = text.match(/^\[icon:([a-z-]+)\]\s*(.*)$/);
          
          if (iconMatch) {
            const iconName = iconMatch[1];
            const restText = iconMatch[2];
            const IconComponent = ICON_MAP[iconName];
            
            return (
              <li {...props}>
                {IconComponent && <IconComponent className="inline-block mr-2 w-4 h-4 text-brand" />}
                {restText}
              </li>
            );
          }

          // Auto-convert leading emoji to lucide icon
          const emojiMatch = text.match(EMOJI_REGEX);
          if (emojiMatch) {
            const { Icon, color } = EMOJI_ICON_MAP[emojiMatch[1]];
            const restText = text.slice(emojiMatch[0].length);
            return (
              <li {...props}>
                <Icon className={`inline-block mr-2 w-4 h-4 ${color}`} />
                {restText}
              </li>
            );
          }
          
          return <li {...props}>{children}</li>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function extractHeadings(content) {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].replace(EMOJI_REGEX, "").trim();
    const id = slugify(text);
    
    headings.push({
      level,
      text,
      id
    });
  }

  return headings;
}
