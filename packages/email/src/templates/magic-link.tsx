import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { resolveEmailLocale } from "./resolve-locale";
import { EmailShell, styles } from "./shell";

void React;

export type MagicLinkEmailProps = {
  magicLink: string;
  locale?: string | null;
};

const messages = {
  en: {
    preview: "Sign in to TaskDesk",
    title: "Your secure sign-in link",
    subtitle: "Use this link to continue to your TaskDesk workspace.",
    cta: "Sign in to TaskDesk",
    expiry: "This link expires in 5 minutes for your security.",
    ignore: "If you didn't request this, you can ignore this email.",
    footer: "TaskDesk security email",
  },
  de: {
    preview: "Bei TaskDesk anmelden",
    title: "Dein sicherer Anmeldelink",
    subtitle:
      "Verwende diesen Link, um mit deinem TaskDesk-Workspace fortzufahren.",
    cta: "Bei TaskDesk anmelden",
    expiry: "Dieser Link laeuft aus Sicherheitsgruenden in 5 Minuten ab.",
    ignore:
      "Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.",
    footer: "TaskDesk Sicherheits-E-Mail",
  },
  vi: {
    preview: "Đăng nhập vào TaskDesk",
    title: "Liên kết đăng nhập an toàn của bạn",
    subtitle: "Dùng liên kết này để tiếp tục vào không gian làm việc TaskDesk.",
    cta: "Đăng nhập vào TaskDesk",
    expiry: "Vì lý do bảo mật, liên kết này sẽ hết hạn sau 5 phút.",
    ignore: "Nếu bạn không yêu cầu điều này, bạn có thể bỏ qua email này.",
    footer: "Email bảo mật TaskDesk",
  },
  ja: {
    preview: "TaskDesk にサインイン",
    title: "安全なサインインリンク",
    subtitle: "このリンクから TaskDesk ワークスペースにアクセスできます。",
    cta: "TaskDesk にサインイン",
    expiry: "セキュリティのため、このリンクは5分で有効期限が切れます。",
    ignore: "心当たりがない場合は、このメールを無視してかまいません。",
    footer: "TaskDesk セキュリティメール",
  },
} as const;

const MagicLinkEmail = ({ magicLink, locale }: MagicLinkEmailProps) => {
  const copy = messages[resolveEmailLocale(locale)];

  return (
    <EmailShell
      preview={copy.preview}
      title={copy.title}
      subtitle={copy.subtitle}
    >
      <Section>
        <Link style={styles.button} href={magicLink}>
          {copy.cta}
        </Link>
        <Text style={styles.paragraph}>{copy.expiry}</Text>
        <Text style={styles.muted}>{copy.ignore}</Text>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

MagicLinkEmail.PreviewProps = {
  magicLink: "https://taskdesk.app",
  locale: "en-US",
} as MagicLinkEmailProps;

export default MagicLinkEmail;
