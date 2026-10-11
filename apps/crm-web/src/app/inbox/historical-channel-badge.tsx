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
