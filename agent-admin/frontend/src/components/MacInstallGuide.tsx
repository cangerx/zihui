import { Alert, Modal, Typography } from 'antd';

/**
 * macOS 未签名安装包：下载名友好化 + 安装指引
 *
 * 背景：云打包 mac 包未做 Apple 签名/公证，macOS 15+ 的 Gatekeeper 会把
 * 带隔离属性（quarantine）的未签名 app 直接判为「包含恶意软件」并移入废纸篓。
 * 在不办 Apple 开发者账号的前提下，这里提供两条用户可执行的安装路径：
 *   方案 A：终端一键命令（curl 下载不带 quarantine，全程零弹窗，推荐）
 *   方案 B：图形安装 + xattr 去隔离属性（已被拦截用户的补救路径）
 */

export interface MacGuideInfo {
  appName: string; // .app 包名（= 打包时的应用显示名 productName）
  zipName: string; // 落盘 zip 文件名（slug 形式，在线更新链路按名引用，不可改）
  url: string;     // 该 zip 的绝对下载地址（含 origin）
}

/**
 * 双轨命名：落盘文件名保持 slug 不动（latest.yml / latest-mac.yml 按名引用，
 * 改了在线更新会 404），仅把浏览器「另存为」的文件名换成用户可读的显示名。
 * app_name 字符集受后端校验（中英文/数字/空格/-_），天然是安全文件名。
 */
export function friendlyDownloadName(opts: {
  platform?: string;
  appName?: string | null;
  version?: string | null;
  filename: string;
  arch?: string | null;
}): string {
  const { platform, appName, version, filename, arch } = opts;
  const name = (appName || '').trim();
  const ver = (version || '').trim();
  if (!name || !ver) return filename;
  const lower = filename.toLowerCase();
  if (platform === 'mac' || lower.endsWith('.zip') || lower.endsWith('.dmg')) {
    const ext = lower.endsWith('.dmg') ? 'dmg' : 'zip';
    return `${name}-${ver}${arch ? `-${arch}` : ''}-mac.${ext}`;
  }
  if (lower.endsWith('.exe')) return `${name}-${ver}-setup.exe`;
  return filename;
}

/** 绝对下载地址：与下载链接同源（/{stored_path}） */
export function absoluteDownloadUrl(storedPath: string): string {
  return `${window.location.origin}/${storedPath.replace(/^\/+/, '')}`;
}

/** 方案 A 一键命令：curl 下载不带 com.apple.quarantine，Gatekeeper 不拦截 */
export function buildOneLiner(info: MacGuideInfo): string {
  // ditto -x -k 解压 zip 完整保留 .app 内符号链接（第三方解压工具会破坏 → 报「已损坏」）
  return `cd /tmp && curl -LO "${info.url}" && ditto -x -k "${info.zipName}" /Applications/ && rm "${info.zipName}"`;
}

/** 方案 B 去隔离命令：-c 清全部扩展属性、-r 递归整个 .app */
export function buildXattrCmd(appName: string): string {
  return `xattr -cr "/Applications/${appName}.app"`;
}

/** 命令展示块：等宽 + 灰底 + 右上角复制按钮 */
function CommandBlock({ text }: { text: string }) {
  return (
    <Typography.Paragraph
      copyable={{ text }}
      style={{
        fontFamily: 'monospace',
        fontSize: 12,
        background: '#f6f6f6',
        padding: '10px 12px',
        borderRadius: 6,
        wordBreak: 'break-all',
      }}
    >
      {text}
    </Typography.Paragraph>
  );
}

export default function MacInstallGuideModal({ open, onClose, info }: {
  open: boolean;
  onClose: () => void;
  info: MacGuideInfo | null;
}) {
  if (!info) return null;
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      mask={false}
      destroyOnClose
      title={`macOS 安装指引：${info.appName}`}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="为什么 macOS 会报「包含恶意软件」并把应用移入废纸篓？"
        description="本安装包未做 Apple 开发者签名与公证，macOS 15 及更高版本对浏览器下载的未签名应用一律按此处理，并非真的含有恶意代码。按下面任一方式安装即可，仅首次安装需要这一步。"
      />

      <Typography.Title level={5}>方案 A（推荐）：终端一键安装，全程无弹窗</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        原理：用命令行下载的文件不带「隔离」标记，系统不会拦截。在 Mac 上打开「终端」（启动台搜索 Terminal），粘贴执行：
      </Typography.Paragraph>
      <CommandBlock text={buildOneLiner(info)} />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        执行完成后到「应用程序」文件夹打开 {info.appName}。若机器上装过旧版，先把旧版拖入废纸篓再执行。
      </Typography.Paragraph>

      <Typography.Title level={5}>方案 B：图形安装（已下载并被拦截时用这条补救）</Typography.Title>
      <ol style={{ fontSize: 13, lineHeight: 2, paddingLeft: 20, margin: 0 }}>
        <li>重新下载 zip 并双击解压（<b>必须用系统自带「归档实用工具」</b>，第三方解压软件会破坏应用内部结构，报「已损坏」）</li>
        <li>把 <b>{info.appName}.app</b> 拖进「应用程序」文件夹</li>
        <li>打开「终端」，粘贴执行下面这行（作用是移除下载隔离标记）：</li>
      </ol>
      <CommandBlock text={buildXattrCmd(info.appName)} />
      <ol start={4} style={{ fontSize: 13, lineHeight: 2, paddingLeft: 20, margin: 0 }}>
        <li>正常打开应用</li>
      </ol>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        提示：此后的「在线更新」不受此限制 —— 应用内下载的更新包不带隔离标记，替换后即可直接使用，不会再触发拦截。
      </Typography.Paragraph>
    </Modal>
  );
}
