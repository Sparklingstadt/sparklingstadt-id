import type { Locale } from "../../i18n/routing.ts";

export type MailKind = "verify" | "changeEmail" | "emailChangeRequested" | "alreadyRegistered" | "resetPassword";

const SERVICE = "Sparklingstadt ID";

type Template = (link: string) => { subject: string; text: string };

const templates: Record<Locale, Record<MailKind, Template>> = {
  ja: {
    verify: (link) => ({
      subject: `${SERVICE}：メールアドレスの確認`,
      text: `${SERVICE} にご登録いただきありがとうございます。\n次のリンクを開き、表示されたボタンを押してメールアドレスを確認してください（24時間有効です）。\n\n${link}\n\n心当たりがない場合は、このメールを破棄してください。\n`,
    }),
    changeEmail: (link) => ({
      subject: `${SERVICE}：新しいメールアドレスの確認`,
      text: `${SERVICE} のメールアドレス変更を受け付けました。\n次のリンクを開き、表示されたボタンを押すと、このアドレスへの変更が完了します（24時間有効です）。\n\n${link}\n\n心当たりがない場合は、このメールを破棄してください。\n`,
    }),
    emailChangeRequested: (link) => ({
      subject: `${SERVICE}：メールアドレス変更の申請がありました`,
      text: `${SERVICE} のメールアドレスを別のアドレスに変更する申請がありました。新しいアドレスで確認されるまでは、今のアドレスのままです。\nご自身で申請した場合は、このメールを破棄してください。\n\n心当たりがない場合は、パスワードが第三者に知られているおそれがあります。次のリンクからパスワードを再設定してください（再設定すると、この申請は取り消されます）。\n\n${link}\n`,
    }),
    alreadyRegistered: (link) => ({
      subject: `${SERVICE}：ご登録について`,
      text: `このメールアドレスは、すでに ${SERVICE} に登録されています。\nログインできない場合は、次のリンクからパスワードを再設定してください。\n\n${link}\n\n心当たりがない場合は、このメールを破棄してください。\n`,
    }),
    resetPassword: (link) => ({
      subject: `${SERVICE}：パスワードの再設定`,
      text: `${SERVICE} のパスワード再設定を受け付けました。\n次のリンクから新しいパスワードを設定してください（1時間有効です）。\n\n${link}\n\n心当たりがない場合は、このメールを破棄してください。\n`,
    }),
  },
  "zh-cn": {
    verify: (link) => ({
      subject: `${SERVICE}：确认电子邮件地址`,
      text: `感谢您注册 ${SERVICE}。\n请打开下面的链接，并点击页面上的按钮确认您的电子邮件地址（24 小时内有效）。\n\n${link}\n\n如果这不是您本人的操作，请忽略此邮件。\n`,
    }),
    changeEmail: (link) => ({
      subject: `${SERVICE}：确认新的电子邮件地址`,
      text: `我们已收到更改 ${SERVICE} 电子邮件地址的请求。\n打开下面的链接，并点击页面上的按钮即可完成更改（24 小时内有效）。\n\n${link}\n\n如果这不是您本人的操作，请忽略此邮件。\n`,
    }),
    emailChangeRequested: (link) => ({
      subject: `${SERVICE}：收到更改电子邮件地址的请求`,
      text: `我们收到了将 ${SERVICE} 的电子邮件地址更改为其他地址的请求。在新地址完成确认之前，仍使用当前的地址。\n如果这是您本人的操作，请忽略此邮件。\n\n如果这不是您本人的操作，您的密码可能已被他人知晓。请通过下面的链接重新设置密码（重新设置后，此请求将被取消）。\n\n${link}\n`,
    }),
    alreadyRegistered: (link) => ({
      subject: `${SERVICE}：关于您的注册`,
      text: `此电子邮件地址已注册 ${SERVICE}。\n如果无法登录，请通过下面的链接重新设置密码。\n\n${link}\n\n如果这不是您本人的操作，请忽略此邮件。\n`,
    }),
    resetPassword: (link) => ({
      subject: `${SERVICE}：重新设置密码`,
      text: `我们已收到重新设置 ${SERVICE} 密码的请求。\n请通过下面的链接设置新密码（1 小时内有效）。\n\n${link}\n\n如果这不是您本人的操作，请忽略此邮件。\n`,
    }),
  },
  "zh-tw": {
    verify: (link) => ({
      subject: `${SERVICE}：確認電子郵件地址`,
      text: `感謝您註冊 ${SERVICE}。\n請開啟下方連結，並按下頁面上的按鈕確認您的電子郵件地址（24 小時內有效）。\n\n${link}\n\n若這不是您本人的操作，請忽略此郵件。\n`,
    }),
    changeEmail: (link) => ({
      subject: `${SERVICE}：確認新的電子郵件地址`,
      text: `我們已收到變更 ${SERVICE} 電子郵件地址的申請。\n開啟下方連結，並按下頁面上的按鈕即可完成變更（24 小時內有效）。\n\n${link}\n\n若這不是您本人的操作，請忽略此郵件。\n`,
    }),
    emailChangeRequested: (link) => ({
      subject: `${SERVICE}：收到變更電子郵件地址的申請`,
      text: `我們已收到將 ${SERVICE} 的電子郵件地址變更為其他地址的申請。在新地址完成確認之前，仍會使用目前的地址。\n若這是您本人的操作，請忽略此郵件。\n\n若這不是您本人的操作，您的密碼可能已被他人得知。請透過下方連結重新設定密碼（重新設定後，此申請將會取消）。\n\n${link}\n`,
    }),
    alreadyRegistered: (link) => ({
      subject: `${SERVICE}：關於您的註冊`,
      text: `此電子郵件地址已註冊 ${SERVICE}。\n若無法登入，請透過下方連結重新設定密碼。\n\n${link}\n\n若這不是您本人的操作，請忽略此郵件。\n`,
    }),
    resetPassword: (link) => ({
      subject: `${SERVICE}：重新設定密碼`,
      text: `我們已收到重新設定 ${SERVICE} 密碼的申請。\n請透過下方連結設定新密碼（1 小時內有效）。\n\n${link}\n\n若這不是您本人的操作，請忽略此郵件。\n`,
    }),
  },
};

export function renderMail(kind: MailKind, locale: Locale, link: string): { subject: string; text: string } {
  return templates[locale][kind](link);
}
