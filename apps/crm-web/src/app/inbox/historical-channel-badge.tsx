import { historicalChannel } from "./historical-channel";
import styles from "./historical-inbox.module.css";

export function HistoricalChannelBadge({
  rawChannel,
  rawType,
}: {
  readonly rawChannel: string | null;
  readonly rawType?: string | null;
}): React.JSX.Element {
  const channel = historicalChannel(rawChannel, rawType);
  return (
    <span
      className={styles.channelBadge}
      data-channel={channel.key}
      title={[rawChannel, rawType].filter(Boolean).join(" · ") || undefined}
    >
      <svg
        className={styles.channelIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {channel.key === "whatsapp" ? (
          <>
            <path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.7A8.5 8.5 0 1 1 20.5 11.7Z" />
            <path d="m8.3 7.4 1.4-.1 1 2.4-.9 1.1a7 7 0 0 0 3.4 3.2l1-1 2.4 1.1v1.4c-.7 1.3-2.2 1.4-4 .5a10.5 10.5 0 0 1-4.7-4.8c-.9-1.8-.7-3.1.4-3.8Z" />
          </>
        ) : channel.key === "email" ? (
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 6 9 7 9-7" />
          </>
        ) : channel.key === "instagram" ? (
          <>
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r=".6" fill="currentColor" />
          </>
        ) : channel.key === "tiktok" ? (
          // TikTok mark: Simple Icons (CC0), icons/tiktok.svg.
          <path
            data-brand-icon="tiktok"
            fill="currentColor"
            stroke="none"
            d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
          />
        ) : channel.key === "call" ? (
          <path d="m5 3 4 1 1 5-2 1c1.2 2.5 3.5 4.8 6 6l1-2 5 1 1 4c0 1.1-.9 2-2 2C10.2 21 3 13.8 3 5c0-1.1.9-2 2-2Z" />
        ) : (
          <>
            <path d="M21 11.5a8.8 8.8 0 0 1-9 8.5H9l-6 2 1.6-5A8.2 8.2 0 0 1 3 11.5 8.8 8.8 0 0 1 12 3a8.8 8.8 0 0 1 9 8.5Z" />
            <path d="M8 11.5h8" />
          </>
        )}
      </svg>
      <span>{channel.label}</span>
    </span>
  );
}
