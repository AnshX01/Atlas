import { FolderOpen } from "lucide-react";

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * Google 4-color "G" logo
 */
export function GoogleLogo({ size = 16, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Google"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

/**
 * GitHub Octocat mark — uses currentColor to adapt to theme
 */
export function GitHubLogo({ size = 16, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="GitHub"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.337-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"
      />
    </svg>
  );
}

/**
 * Slack hash/pound logo with official brand colors
 */
export function SlackLogo({ size = 16, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Slack"
    >
      {/* Top-left: red/pink */}
      <path
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
        fill="#E01E5A"
      />
      {/* Top-right: cyan */}
      <path
        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
        fill="#36C5F0"
      />
      {/* Bottom-right: green */}
      <path
        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.522 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.522 2.522v6.312z"
        fill="#2EB67D"
      />
      {/* Bottom-left: yellow */}
      <path
        d="M15.165 18.956a2.528 2.528 0 0 1 2.522 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.521-2.522v-2.522h2.521zm0-1.27a2.527 2.527 0 0 1-2.521-2.522 2.528 2.528 0 0 1 2.521-2.522h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.521h-6.313z"
        fill="#ECB22E"
      />
    </svg>
  );
}

/**
 * Notion logo — uses currentColor to adapt to light/dark theme
 */
export function NotionLogo({ size = 16, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Notion"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.29 2.15c-.42-.326-.98-.7-2.055-.607l-12.8.932c-.466.047-.56.28-.373.466l1.397 1.267zm.793 2.893v13.867c0 .746.373 1.027 1.214.98l14.523-.84c.84-.046.933-.56.933-1.166V6.054c0-.606-.233-.933-.746-.886l-15.177.886c-.56.047-.747.327-.747.887zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.607.327-1.166.514-1.633.514-.746 0-.933-.234-1.493-.933l-4.571-7.178v6.95l1.446.327s0 .84-1.166.84l-3.22.187c-.092-.187 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.453-.233 4.758 7.272v-6.44l-1.213-.14c-.094-.514.28-.886.746-.933l3.23-.187z"
      />
    </svg>
  );
}

/**
 * Local Files logo — styled FolderOpen from lucide
 */
export function LocalFilesLogo({ size = 16, className }: LogoProps) {
  return (
    <FolderOpen
      size={size}
      className={className ?? "text-amber-400"}
      aria-label="Local Files"
    />
  );
}

/**
 * Jira logo — official blue gradient
 */
export function JiraLogo({ size = 16, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Jira"
    >
      <defs>
        <linearGradient id="jira-grad-1" x1="98.031%" y1="0.161%" x2="58.888%" y2="40.766%">
          <stop offset="18%" stopColor="#0052CC" stopOpacity="0" />
          <stop offset="100%" stopColor="#2684FF" />
        </linearGradient>
        <linearGradient id="jira-grad-2" x1="100.935%" y1="0.161%" x2="55.786%" y2="44.327%">
          <stop offset="18%" stopColor="#0052CC" stopOpacity="0" />
          <stop offset="100%" stopColor="#2684FF" />
        </linearGradient>
      </defs>
      <path
        d="M22.54 11.29L13.26 2l-1.26-1.26L4.84 7.9l-3.38 3.39a.94.94 0 0 0 0 1.33l6.8 6.82L12 23.18l7.17-7.18.1-.1 3.27-3.28a.94.94 0 0 0 0-1.33zM12 15.36L8.64 12 12 8.64 15.36 12 12 15.36z"
        fill="#2684FF"
      />
      <path
        d="M12 8.64a4.95 4.95 0 0 1-.01-7L4.84 7.9l3.81 3.82L12 8.64z"
        fill="url(#jira-grad-1)"
      />
      <path
        d="M15.37 11.98L12 15.36a4.95 4.95 0 0 1 0 7l7.18-7.18-4.81-4.2z"
        fill="url(#jira-grad-2)"
      />
    </svg>
  );
}

/**
 * Linear logo — purple brand mark
 */
export function LinearLogo({ size = 16, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Linear"
    >
      <path
        d="M2.414 14.956a10.048 10.048 0 0 0 6.63 6.63l9.97-9.97a10.097 10.097 0 0 0-.592-3.208L6.01 20.82a10.076 10.076 0 0 0-3.596-5.864zm-.368-2.324A10.048 10.048 0 0 0 2 14c0 .269.01.535.032.798l8.766-8.766A10.048 10.048 0 0 0 2.046 12.632zm.94-4.13l10.718-10.718c-.1-.008-.2-.015-.3-.02a10.048 10.048 0 0 0-5.544 1.606L2.126 5.104a10.046 10.046 0 0 0-.936 1.81c-.081.197-.158.396-.23.598l2.026 1.99zM4.61 3.294L3.066 5.162l15.772 15.772 1.868-1.544A10.048 10.048 0 0 0 4.61 3.294zm17.1 3.28L5.428 22.854a10.048 10.048 0 0 0 2.326.94l13.158-13.158a10.089 10.089 0 0 0-.608-2.374l1.406-1.688zM22 12c0-.269-.01-.535-.032-.798l-8.766 8.766A10.048 10.048 0 0 0 22 12zm-1.046-3.368a10.048 10.048 0 0 0-7.586-7.586L3.398 11.016a10.097 10.097 0 0 0 .592 3.208L17.6 0.614a10.076 10.076 0 0 0 3.354 8.018z"
        fill="#5E6AD2"
      />
    </svg>
  );
}
