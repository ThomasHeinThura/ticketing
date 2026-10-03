import { resolveEmailLocale } from "./resolve-locale";

const messages = {
  en: {
    subject: "TaskDesk security notice",
    title: "An instance administrator recovery command was used",
    message:
      "An instance administrator recovery command was used. Review the instance audit log. If you did not expect this change, contact your instance operator.",
  },
  de: {
    subject: "TaskDesk-Sicherheitshinweis",
    title:
      "Ein Wiederherstellungsbefehl für einen Instanzadministrator wurde verwendet",
    message:
      "Überprüfen Sie das Instanz-Auditprotokoll. Wenn Sie diese Änderung nicht erwartet haben, wenden Sie sich an Ihren Instanzbetreiber.",
  },
  vi: {
    subject: "Thông báo bảo mật TaskDesk",
    title: "Lệnh khôi phục quản trị viên phiên bản đã được sử dụng",
    message:
      "Hãy kiểm tra nhật ký kiểm toán của phiên bản. Nếu bạn không mong đợi thay đổi này, hãy liên hệ với người vận hành phiên bản.",
  },
  ja: {
    subject: "TaskDesk セキュリティ通知",
    title: "インスタンス管理者の復旧コマンドが使用されました",
    message:
      "インスタンスの監査ログを確認してください。予期しない変更の場合は、インスタンスの運用担当者に連絡してください。",
  },
} as const;

export function getBreakGlassAlertCopy(locale?: string | null) {
  return messages[resolveEmailLocale(locale)];
}
